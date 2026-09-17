import { haversineKm } from "../utils/geoUtils.js";
import { describeIpDivergence, classifyDeclaredDivergence, aplicarHistoricoDoIp } from "../utils/geoDivergence.js";
import { buildCustodyChain } from "../reports/custodyChain.js";
import { buildIrregularitySummary } from "../engine/irregularitySummary.js";
import { verificarCoerencia, coerenciaBloqueante } from "../engine/coerenciaLaudo.js";

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

    return {
      ...ip,
      distance,
      distanceToSignature,
      divergenciaResidencia: aplicarHistoricoDoIp(
        describeIpDivergence({ km: distance, referenciaConfirmada, referenciaRotulo: result.home?.source }),
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

  const recalculado = { ...result, contractGeo, ipAnalysis };
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
      Boolean(result.geoDeclaredPresent)
    ),
  };
}
