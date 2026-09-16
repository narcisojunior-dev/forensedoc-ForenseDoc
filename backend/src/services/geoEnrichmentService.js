import { getIpInfo } from "./apiService.js";
import { geocodeAddress } from "./geocodingService.js";
import { haversineKm } from "../utils/geoUtils.js";
import { isIP } from "node:net";
import { describeIpDivergence, classifyDeclaredDivergence } from "../utils/geoDivergence.js";
import { lookupRdapIp } from "./rdapService.js";
import { parseUserAgentForensic } from "../utils/userAgentParser.js";

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
export async function enrichGeography(extracted, homeAddress, homeCoord = null) {
  const cliente = extracted.cliente || {};

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
    const [geo, rdap] = await Promise.all([
      getIpInfo(ipInfo.endereco),
      lookupRdapIp(ipInfo.endereco).catch(() => null),
    ]);
    const parsedUa = ipInfo.user_agent ? parseUserAgentForensic(ipInfo.user_agent) : null;

    ipResults.push({
      ...ipInfo,
      geo,
      rdap,
      parsedUserAgent: parsedUa,
      // Distingue "o documento não trazia" de "a consulta falhou" — num laudo,
      // as duas ausências têm significados diferentes.
      geoFailure: geo ? null : "nenhum provedor de geolocalização respondeu",
    });
  }

  // 2. Ponto de referência: endereço residencial. Manual (da tela) tem
  // prioridade sobre o extraído do contrato.
  const manual = (homeAddress || "").trim();
  const extractedAddr = [cliente.endereco, cliente.bairro, cliente.cidade, cliente.estado, cliente.cep]
    .filter(Boolean)
    .join(", ");
  const homeQuery = manual || extractedAddr || null;
  const homeSource = manual
    ? "Informado manualmente"
    : extractedAddr
      ? "Extraído do contrato"
      : null;

  // Coordenada confirmada pelo operador vence a geocodificação automática.
  let homeGeo;
  if (homeCoord && Number.isFinite(homeCoord.lat) && Number.isFinite(homeCoord.lon)) {
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
      divergenciaResidencia: describeIpDivergence({
        km: distance,
        referenciaConfirmada,
        referenciaRotulo: homeSource,
      }),
      divergenciaAssinatura: describeIpDivergence({
        km: distanceToSignature,
        referenciaConfirmada: contractGeo?.precision === "gps",
        referenciaRotulo: "geolocalização declarada no contrato",
      }),
    };
  });

  let contractToHomeKm = null;
  if (contractGeo && homeGeo) {
    contractToHomeKm = haversineKm(homeGeo.lat, homeGeo.lon, contractGeo.lat, contractGeo.lon);
  }

  return {
    home: { query: homeQuery, source: homeSource, geo: homeGeo },
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
