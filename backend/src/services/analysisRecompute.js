import { haversineKm } from "../utils/geoUtils.js";
import { describeIpDivergence, classifyDeclaredDivergence, aplicarHistoricoDoIp } from "../utils/geoDivergence.js";
import { buildCustodyChain } from "../reports/custodyChain.js";
import { buildIrregularitySummary, classifyIpRole } from "../engine/irregularitySummary.js";
import { verificarCoerencia, coerenciaBloqueante } from "../engine/coerenciaLaudo.js";
import { montarConfrontoGeografico } from "../utils/distancia.js";
import { montarConfrontoEnderecos } from "../utils/confrontoEnderecos.js";

/**
 * Sumário executivo do motor pericial (placar de gravidade, GPS x IP,
 * diligências), montado a partir do resultado persistido.
 *
 * Depende das distâncias e da extração, então é recalculado em todo caminho
 * que as altera. Falhar aqui não pode derrubar o laudo: o sumário é síntese do
 * que já está nas seções, e na falha o resultado segue sem ele.
 */
export function buildSummaryForResult(result, extracted) {
  try {
    return buildIrregularitySummary({
      reportId: result.reportId,
      file: result.file
        ? { name: result.file.name, sizeKB: result.file.sizeBytes != null ? (result.file.sizeBytes / 1024).toFixed(2) : null }
        : null,
      hashes: result.hashes,
      metadata: result.metadata,
      extracted,
      home: result.home,
      confronto_geografico: result.confronto_geografico || montarConfrontoGeografico(result),
      confronto_enderecos: result.confronto_enderecos || montarConfrontoEnderecos(pontosDoConfronto(result, extracted)),
      contractGeo: result.contractGeo,
      geoDeclaredPresent: result.geoDeclaredPresent,
      ipAnalysis: result.ipAnalysis || [],
    });
  } catch (err) {
    console.error("[Recompute] Falha ao montar o sumário executivo:", err.message);
    return null;
  }
}

/**
 * Recalcula tudo que DERIVA dos dados de uma análise.
 *
 * ─── Por que isto precisou existir ───────────────────────────────────────────
 *
 * A correção de coordenada (`correctAnalysisGeo`) atualizava as distâncias em
 * quilômetros, mas não as CLASSIFICAÇÕES que dependem delas. O laudo passava a
 * exibir a distância nova ao lado do rótulo antigo: 12 km marcados como
 * "DIVERGÊNCIA GRAVE" porque a classificação era de quando a distância era 800.
 *
 * Num laudo pericial isso é pior que não ter a correção, porque o número e o
 * veredito se contradizem dentro da mesma linha, e quem lê não sabe em qual
 * acreditar.
 *
 * A cadeia de custódia tinha o mesmo problema por outro caminho: ela conta
 * elementos PRESENTES, então preencher um campo que faltava deveria elevá-la, e
 * não elevava.
 *
 * ─── Uma função só, chamada por todos os caminhos ────────────────────────────
 *
 * Correção de coordenada, correção de campo pelo operador e, no futuro,
 * qualquer outra edição precisam recalcular exatamente as mesmas coisas. Manter
 * isso espalhado é garantir que o próximo caminho esqueça um pedaço.
 *
 * A função é PURA e local: nenhuma consulta externa, nenhum acesso a banco. Roda
 * em microssegundos, o que é o que permite a correção ser síncrona na requisição
 * em vez de virar mais um job na fila.
 */
/** Pontos dos quatro pares, a partir do resultado já recalculado. */
export function pontosDoConfronto(result, extracted = {}) {
  const eventos = extracted.trilha_eventos?.eventos || [];
  const evidencias = filtro => eventos.flatMap((ev, i) => filtro(ev) ? [`evento-${i + 1}: ${ev.nome || "registro"} ${ev.data_hora || ""}`] : []);
  const ip = (result.ipAnalysis || []).find((i) => Number.isFinite(i.geo?.lat) && Number.isFinite(i.geo?.lon));
  const laudo = result.home?.geo && Number.isFinite(result.home.geo.lat)
    ? { lat: result.home.geo.lat, lon: result.home.geo.lon, rotulo: result.home.query, precisao: result.home.geo.precision || null }
    : result.home?.referencia_informada_geo || null;
  return {
    instrumento: result.home?.instrumento_geo || null,
    emissao: result.home?.emissao_geo || null,
    laudo,
    ip: ip ? { lat: ip.geo.lat, lon: ip.geo.lon, rotulo: [ip.endereco, [ip.geo.city, ip.geo.region].filter(Boolean).join("/")].filter(Boolean).join(" · "), precisao: ip.historico?.precisionOverride || ip.geo.granularity || "ip", fonte: ip.geo.source || null, consulta: ip.geo.queryId || null, consultadoEm: ip.geo.queriedAt || null, evidencias: evidencias(ev => ev.ip === ip.endereco) } : null,
    gps: result.contractGeo && Number.isFinite(result.contractGeo.lat)
      ? { lat: result.contractGeo.lat, lon: result.contractGeo.lon, rotulo: result.contractGeo.municipio || "coordenada do log", precisao: result.contractGeo.precision || "gps", fonte: result.contractGeo.fonte || result.contractGeo.source || "coordenada declarada no documento", evidencias: evidencias(ev => ev.lat === result.contractGeo.lat && ev.lon === result.contractGeo.lon) }
      : null,
  };
}

export function recomputeDerived(result, extracted) {
  const home = result.home?.geo;
  const referenciaConfirmada = home?.precision === "manual";

  // ── Confronto 2: residência × geolocalização declarada ────────────────────
  let contractGeo = result.contractGeo;
  if (contractGeo && Number.isFinite(contractGeo.lat) && Number.isFinite(contractGeo.lon)) {
    const distance =
      home && Number.isFinite(home.lat) && Number.isFinite(home.lon)
        ? haversineKm(home.lat, home.lon, contractGeo.lat, contractGeo.lon)
        : null;
    contractGeo = {
      ...contractGeo,
      distance,
      divergencia: classifyDeclaredDivergence(distance, { referenciaConfirmada }),
    };
  }

  // ── Confronto 1 e rastro de IP ────────────────────────────────────────────
  const ipAnalysis = (result.ipAnalysis || []).map((ip) => {
    const temGeo = Number.isFinite(ip.geo?.lat) && Number.isFinite(ip.geo?.lon);

    const distance =
      temGeo && home && Number.isFinite(home.lat) && Number.isFinite(home.lon)
        ? haversineKm(home.lat, home.lon, ip.geo.lat, ip.geo.lon)
        : null;

    const distanceToSignature =
      temGeo && contractGeo && Number.isFinite(contractGeo.lat)
        ? haversineKm(contractGeo.lat, contractGeo.lon, ip.geo.lat, ip.geo.lon)
        : null;

    const role = classifyIpRole(ip, { extracted });
    const consultaLimitada = role !== "access" && Number.isFinite(distanceToSignature);
    return {
      ...ip,
      role,
      distance,
      distanceToSignature,
      divergenciaResidencia: aplicarHistoricoDoIp(
        describeIpDivergence({ km: distance, referenciaConfirmada, referenciaRotulo: result.home?.source }),
        ip.historico
      ),
      divergenciaAssinatura: consultaLimitada ? {
        km: distanceToSignature, nivel: "descritivo", rotulo: "DISTÂNCIA DESCRITIVA", tom: "neutral",
        sintese: "Distância entre o GPS declarado e os pontos retornados pela consulta de geolocalização do IP. O papel desse IP na sessão não foi determinado nesta análise. Sem margem de erro fornecida, esse número não confirma nem afasta presença física ou autoria.",
        ressalva: "Consulta externa não comprova a localização na data do ato. A coordenada do documento não foi confirmada pelo operador.",
      } : aplicarHistoricoDoIp(
        describeIpDivergence({
          km: distanceToSignature,
          referenciaConfirmada: false,
          referenciaDeclarada: true,
          referenciaRotulo: "geolocalização declarada no contrato",
        }),
        ip.historico
      ),
    };
  });

  const recalculado = { ...result, contractGeo, ipAnalysis };
  recalculado.confronto_geografico = montarConfrontoGeografico(recalculado);
  recalculado.confronto_enderecos = montarConfrontoEnderecos(pontosDoConfronto(recalculado, extracted));
  const sumarioIrregularidades = buildSummaryForResult(recalculado, extracted);
  return {
    ...recalculado,
    sumarioIrregularidades,
    coerencia: verificarCoerencia({ ...recalculado, sumarioIrregularidades }, extracted),
    coerencia_bloqueante: coerenciaBloqueante(),
    // A completude muda quando um elemento que faltava passa a existir, e é
    // justamente esse o efeito de o operador preencher um campo.
    cadeiaCustodia: buildCustodyChain(
      extracted,
      ipAnalysis,
      Boolean(result.geoDeclaredPresent || contractGeo)
    ),
  };
}
