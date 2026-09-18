import { getIpInfo } from "./apiService.js";
import { geocodeAddress, reverseGeocode } from "./geocodingService.js";
import { lookupIpHistory } from "./ipHistoryService.js";
import { haversineKm } from "../utils/geoUtils.js";
import { isIP } from "node:net";
import { describeIpDivergence, classifyDeclaredDivergence, aplicarHistoricoDoIp } from "../utils/geoDivergence.js";
import { lookupRdapIp } from "./rdapService.js";
import { parseUserAgentForensic } from "../utils/userAgentParser.js";
import { ESTADO_CONFRONTO, avaliarConflitoReferencia, descreverEstadoConfronto } from "../utils/referenciaResidencial.js";
import { montarConfrontoEnderecos } from "../utils/confrontoEnderecos.js";

/**
 * Confronto geográfico do §5 do laudo (Módulo 4, Fase A).
 *
 * Reproduz no worker o que antes o navegador calculava e descartava
 * (frontend/src/pages/Analyze.jsx:129-175): geolocaliza os IPs extraídos,
 * geocodifica o endereço residencial e o local declarado da assinatura, e
 * mede as distâncias por Haversine.
 *
 * Persistir isso é o que torna o laudo REPRODUTÍVEL — reabrir a análise não
 * refaz a geocodificação ao vivo, que poderia devolver outro resultado.
 *
 * @param {object}  extracted resultado da extração local
 * @param {string=} homeAddress endereço residencial informado na tela (tem
 *   prioridade sobre o extraído do contrato, como na regra do frontend)
 * @param {{lat:number, lon:number}=} homeCoord coordenada confirmada pelo
 *   operador — quando presente, é usada direto (precisão máxima), sem
 *   geocodificar. É o padrão-ouro forense: ponto confirmado por humano.
 */
export async function enrichGeography(extracted, homeAddress, homeCoord = null, contestacao = null) {
  const cliente = extracted.cliente || {};
  // Data do ato para o histórico do IP: a do próprio registro, senão a da
  // assinatura, senão a do contrato.
  const dataDoAtoPadrao =
    extracted.assinatura?.data_hora_assinatura || extracted.contrato?.data_contrato || null;

  // 1. Geolocalizar cada IP extraído do PDF.
  //
  // O gate era `/^\d{1,3}(\.\d{1,3}){3}$/` — só IPv4. Assinadores brasileiros
  // registram o IP em IPv6 na rede móvel, e esses endereços passavam direto com
  // `geo: null`: o § 6 listava o IP e afirmava "geolocalização indisponível"
  // sem nunca ter consultado provedor nenhum.
  const ipResults = [];
  for (const ipInfo of extracted.ips || []) {
    if (!isIP(ipInfo.endereco)) {
      ipResults.push({ ...ipInfo, geo: null, geoFailure: "endereço inválido" });
      continue;
    }
    // CGNAT (100.64.0.0/10) é espaço interno da operadora. Consultar provedor
    // devolveria, na melhor hipótese, nada e, na pior, o centroide de um bloco
    // que não corresponde a lugar nenhum. Um laudo não pode apresentar isso como
    // origem do ato: o correto é declarar por que o confronto não é possível.
    if (ipInfo.compartilhado) {
      ipResults.push({
        ...ipInfo,
        geo: null,
        geoFailure:
          "endereço de espaço compartilhado (CGNAT, RFC 6598): é interno da operadora e não corresponde a uma localização geográfica do usuário",
      });
      continue;
    }
    // Faixa privada, loopback ou link-local (classificação do motor pericial):
    // nenhum provedor localiza isso, e "nenhum provedor respondeu" seria falso.
    if (ipInfo.classe && !["PUBLICO", "CGNAT"].includes(ipInfo.classe)) {
      ipResults.push({
        ...ipInfo,
        geo: null,
        geoFailure: `endereço de faixa ${ipInfo.classe.toLowerCase()}: não é roteável na internet pública e não corresponde a uma localização geográfica`,
      });
      continue;
    }
    const [geo, rdap] = await Promise.all([
      getIpInfo(ipInfo.endereco),
      lookupRdapIp(ipInfo.endereco).catch(() => null),
    ]);
    const parsedUa = ipInfo.user_agent ? parseUserAgentForensic(ipInfo.user_agent) : null;
    const historico = geo
      ? await lookupIpHistory(ipInfo.endereco, ipInfo.data_hora || dataDoAtoPadrao, geo.isp).catch(() => null)
      : null;

    ipResults.push({
      ...ipInfo,
      geo: historico?.suppressDistanceRisk && geo ? { ...geo, registro_na_data_nota: historico.note } : geo,
      historico,
      rdap,
      parsedUserAgent: parsedUa,
      // Distingue "o documento não trazia" de "a consulta falhou" — num laudo,
      // as duas ausências têm significados diferentes.
      geoFailure: geo ? null : "nenhum provedor de geolocalização respondeu",
    });
  }

  // 2. Ponto de referência: endereço residencial. O manual (da tela) só vale
  // depois de conferido contra a cidade, a UF e o CEP do instrumento.
  const manual = (homeAddress || "").trim();
  const temCoordManual = Boolean(homeCoord && Number.isFinite(homeCoord.lat) && Number.isFinite(homeCoord.lon));
  const referenciaManual = Boolean(manual || temCoordManual);
  const enderecoNaoInformado = cliente.estados_campos?.endereco?.estado === "LOCALIZADO_VAZIO";
  const instrumento = { cidade: cliente.cidade || null, uf: cliente.estado || null, cep: cliente.cep || null };

  // Com o endereço registrado como "não informado", bairro, cidade e CEP que
  // sobram são de outros quadros e levariam a distância ao centro do município.
  const extractedAddr = enderecoNaoInformado
    ? ""
    : [cliente.endereco, cliente.bairro, cliente.cidade, cliente.estado, cliente.cep].filter(Boolean).join(", ");
  let homeQuery = manual || extractedAddr || null;
  let homeSource = manual
    ? "Informado manualmente"
    : temCoordManual
      ? "Coordenada confirmada pelo operador"
      : extractedAddr
        ? "Extraído do contrato"
        : null;

  // Coordenada confirmada pelo operador vence a geocodificação automática.
  let homeGeo;
  if (temCoordManual) {
    homeGeo = {
      lat: homeCoord.lat,
      lon: homeCoord.lon,
      display: "Coordenada confirmada pelo operador",
      precision: "manual",
      source: "manual",
      cityMatch: true,
    };
  } else {
    homeGeo = homeQuery ? await geocodeAddress(homeQuery) : null;
  }

  // Ponto do endereço que o próprio instrumento registra. Com o endereço do
  // contratante em branco, vale a sede do município declarado, com a precisão
  // anotada: é o que o dossiê afirma sobre onde o contratante está.
  const consultaInstrumento = extractedAddr || [instrumento.cidade, instrumento.uf, instrumento.cep].filter(Boolean).join(", ");
  const geoInstrumento = consultaInstrumento ? await geocodeAddress(consultaInstrumento).catch(() => null) : null;
  const pontoInstrumento = geoInstrumento && Number.isFinite(geoInstrumento.lat)
    ? {
        lat: geoInstrumento.lat,
        lon: geoInstrumento.lon,
        rotulo: consultaInstrumento,
        precisao: extractedAddr ? geoInstrumento.precision || "endereco" : "municipio",
      }
    : null;
  // A referência informada na geração do laudo continua registrada mesmo quando
  // é recusada como referência: a distância até o instrumento mede o conflito.
  const pontoLaudo = referenciaManual && homeGeo && Number.isFinite(homeGeo.lat)
    ? { lat: homeGeo.lat, lon: homeGeo.lon, rotulo: homeQuery, precisao: homeGeo.precision || null }
    : null;

  let estadoConfronto = ESTADO_CONFRONTO.DISPONIVEL;
  let conflito = null;
  if (referenciaManual) {
    conflito = await avaliarConflitoReferencia({
      cliente,
      enderecoManual: manual,
      pontoManual: homeGeo && Number.isFinite(homeGeo.lat) ? { lat: homeGeo.lat, lon: homeGeo.lon } : null,
      geoManual: temCoordManual ? null : homeGeo,
      servicos: { geocodeAddress, reverseGeocode },
    });
    if (conflito) {
      const justificativa = String(contestacao?.justificativa || "").trim();
      if (contestacao?.contestado && justificativa) {
        estadoConfronto = ESTADO_CONFRONTO.LIBERADO_PELO_OPERADOR;
      } else {
        estadoConfronto = ESTADO_CONFRONTO.RECUSADO_CONFLITO;
        homeGeo = null;
      }
    }
  } else if (enderecoNaoInformado) {
    estadoConfronto = ESTADO_CONFRONTO.INDISPONIVEL_NAO_INFORMADO;
    homeGeo = null;
    homeQuery = null;
    homeSource = null;
  }

  // 3. Geolocalização declarada da assinatura: coordenada GPS do log, senão
  // geocodificar o endereço declarado.
  let contractGeo = null;
  const g = extracted.geolocalizacao_assinatura;
  if (g && g.presente) {
    const plat = g.latitude != null ? parseFloat(String(g.latitude).replace(",", ".")) : NaN;
    const plon = g.longitude != null ? parseFloat(String(g.longitude).replace(",", ".")) : NaN;
    if (!Number.isNaN(plat) && !Number.isNaN(plon)) {
      // Coordenada GPS vinda do próprio log do contrato — precisão máxima.
      contractGeo = {
        lat: plat,
        lon: plon,
        endereco: g.endereco_declarado,
        fonte: g.fonte,
        precisao: g.precisao_metros,
        dataHora: g.data_hora,
        geocoded: false,
        precision: "gps",
        cityMatch: true,
      };
    } else if (g.endereco_declarado) {
      const gc = await geocodeAddress(g.endereco_declarado);
      if (gc) {
        contractGeo = {
          lat: gc.lat,
          lon: gc.lon,
          endereco: g.endereco_declarado,
          fonte: g.fonte,
          precisao: g.precisao_metros,
          dataHora: g.data_hora,
          geocoded: true,
          precision: gc.precision,
          geocodeSource: gc.source,
          cityMatch: gc.cityMatch,
        };
      }
    }
  }

  // 4. Distâncias por Haversine. Cada IP é confrontado com DOIS pontos:
  //    - a residência (distance): a conexão partiu de perto de onde o cliente mora?
  //    - a geolocalização declarada da assinatura (distanceToSignature): a origem
  //      real da conexão bate com o local que o contrato AFIRMA que a assinatura
  //      aconteceu? Incompatibilidade grosseira aqui é forte indício de GPS
  //      forjado ou assinatura por terceiro. (Geo por IP é de nível de operadora,
  //      então serve como indício de larga escala, não como coordenada exata.)
  const referenciaConfirmada = homeGeo?.precision === "manual";
  const ipAnalysis = ipResults.map((ip) => {
    let distance = null;
    let distanceToSignature = null;
    if (ip.geo?.lat != null && ip.geo?.lon != null) {
      if (homeGeo) distance = haversineKm(homeGeo.lat, homeGeo.lon, ip.geo.lat, ip.geo.lon);
      if (contractGeo) distanceToSignature = haversineKm(contractGeo.lat, contractGeo.lon, ip.geo.lat, ip.geo.lon);
    }

    // Confronto explícito contra o ponto de referência do operador, com a
    // leitura pericial da faixa. Antes só existia o número em km, e interpretá-lo
    // ficava por conta de quem lesse o laudo.
    return {
      ...ip,
      distance,
      distanceToSignature,
      divergenciaResidencia: aplicarHistoricoDoIp(
        describeIpDivergence({ km: distance, referenciaConfirmada, referenciaRotulo: homeSource }),
        ip.historico
      ),
      divergenciaAssinatura: aplicarHistoricoDoIp(
        describeIpDivergence({
          km: distanceToSignature,
          referenciaConfirmada: contractGeo?.precision === "gps",
          referenciaRotulo: "geolocalização declarada no contrato",
        }),
        ip.historico
      ),
    };
  });

  // Município em que o GPS declarado realmente cai. Um ponto a 40 km pode estar
  // em outro município, o que pesa mais na diligência do que a distância bruta.
  if (contractGeo) {
    const municipio = await reverseGeocode(contractGeo.lat, contractGeo.lon).catch(() => null);
    if (municipio?.municipio) {
      contractGeo = {
        ...contractGeo,
        municipio: municipio.municipio,
        uf: municipio.uf,
        municipioDisplay: municipio.display,
      };
    }
  }

  let contractToHomeKm = null;
  if (contractGeo && homeGeo) {
    contractToHomeKm = haversineKm(homeGeo.lat, homeGeo.lon, contractGeo.lat, contractGeo.lon);
  }

  const pontoIp = ipAnalysis.find((ip) => Number.isFinite(ip.geo?.lat) && Number.isFinite(ip.geo?.lon));

  /*
   * D3 · confronto B: coordenada declarada × município de emissão do instrumento.
   *
   * Independe da residência informada, e por isso continua valendo quando ela é
   * recusada. A sede do município é geocodificada aqui, e a coordenada obtida
   * viaja na saída junto com a fórmula, para que o número não seja uma
   * afirmação sem origem.
   */
  const localEmissao = extracted.contrato?.local_emissao || null;
  let pontoEmissao = null;
  if (localEmissao?.municipio) {
    const consulta = [localEmissao.municipio, localEmissao.uf].filter(Boolean).join(", ");
    const sede = await geocodeAddress(consulta).catch(() => null);
    if (sede && Number.isFinite(sede.lat) && Number.isFinite(sede.lon)) {
      pontoEmissao = {
        lat: sede.lat,
        lon: sede.lon,
        rotulo: `${localEmissao.municipio}/${localEmissao.uf}`,
        precisao: "municipio",
        fonte: `${sede.source || "provedor não identificado"}; referência municipal geocodificada a partir de "${consulta}"`,
      };
    }
  }

  const confrontoEnderecos = montarConfrontoEnderecos({
    instrumento: pontoInstrumento,
    laudo: pontoLaudo,
    emissao: pontoEmissao,
    ip: pontoIp ? { lat: pontoIp.geo.lat, lon: pontoIp.geo.lon, rotulo: [pontoIp.geo.city, pontoIp.geo.region].filter(Boolean).join("/") || pontoIp.endereco, precisao: "ip", fonte: pontoIp.geo.source || null } : null,
    gps: contractGeo ? { lat: contractGeo.lat, lon: contractGeo.lon, rotulo: contractGeo.municipio || "coordenada do log", precisao: contractGeo.precision || "gps", fonte: contractGeo.fonte || contractGeo.source || "coordenada declarada no documento" } : null,
  });

  const home = {
    query: homeQuery,
    source: homeSource,
    geo: homeGeo,
    estado_confronto: estadoConfronto,
    conflito,
    justificativa: estadoConfronto === ESTADO_CONFRONTO.LIBERADO_PELO_OPERADOR ? String(contestacao.justificativa).trim() : null,
    instrumento,
    endereco_literal: cliente.endereco_literal || cliente.estados_campos?.endereco?.valor || null,
    endereco_nao_informado: enderecoNaoInformado,
    instrumento_geo: pontoInstrumento,
    emissao_geo: pontoEmissao,
    local_emissao: localEmissao,
    referencia_informada_geo: pontoLaudo,
  };
  home.alerta = descreverEstadoConfronto(home);

  return {
    home,
    confronto_enderecos: confrontoEnderecos,
    // A classificação do Confronto 2 é persistida junto com a distância, pelo
    // mesmo motivo de `divergenciaResidencia`: PDF e tela leem a MESMA análise.
    // Enquanto cada lado calculava a sua, as duas versões do laudo divergiam —
    // e a tela ainda usava a régua do IP (50/300/1000 km) para um confronto de
    // precisão métrica.
    contractGeo: contractGeo
      ? {
          ...contractGeo,
          distance: contractToHomeKm,
          divergencia: classifyDeclaredDivergence(contractToHomeKm, { referenciaConfirmada }),
        }
      : null,
    geoDeclaredPresent: !!(g && g.presente),
    ipAnalysis,
  };
}
