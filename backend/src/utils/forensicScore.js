/**
 * Cálculo do Índice de Incompatibilidade Forense (Forensic Anomaly Score).
 * Gera uma pontuação normalizada de 0 a 100 baseada no distanciamento físico
 * entre o domicílio comprovado, a origem do tráfego IP e o GPS do ato.
 */

import { distanciaKm } from "./distancia.js";

export function calculateForensicScore({ distKmIp, distKmGps, distKmIpVsGps }) {
  // Sem nenhuma distância à residência não há índice: o antigo `|| 0` produzia
  // "compatível com o domicílio" justamente quando o confronto foi recusado.
  const ip = distanciaKm(distKmIp);
  const gps = distanciaKm(distKmGps);
  if (ip === null && gps === null) {
    return {
      score: null,
      nivel: "NÃO AFERIDO",
      tom: "neutral",
      rotulo: "CONFRONTO COM A RESIDÊNCIA NÃO AFERIDO",
      conclusao: "Não há distância válida até a residência do contratante; o índice de incompatibilidade geográfica não é calculado.",
    };
  }
  let score = 0;
  const distRef = Math.max(ip ?? 0, gps ?? 0);

  if (distRef >= 1000) {
    score = 95 + Math.min(5, Math.floor((distRef - 1000) / 500));
  } else if (distRef >= 500) {
    score = 80 + Math.floor(((distRef - 500) / 500) * 15);
  } else if (distRef >= 150) {
    score = 60 + Math.floor(((distRef - 150) / 350) * 20);
  } else if (distRef >= 50) {
    score = 30 + Math.floor(((distRef - 50) / 100) * 30);
  } else {
    score = Math.floor((distRef / 50) * 30);
  }

  // Se IP e GPS estão coerentes entre si (< 50 km) mas a milhares de km do domicílio,
  // a probabilidade de fraude deliberada por terceiro é máxima.
  if (distRef >= 500 && distanciaKm(distKmIpVsGps) !== null && distanciaKm(distKmIpVsGps) <= 50) {
    score = Math.max(score, 98);
  }

  score = Math.min(100, Math.max(0, score));

  let nivel = "BAIXO";
  let tom = "success";
  let rotulo = "COMPATÍVEL / BAIXO RISCO";
  let conclusao = "A origem dos registros coincide ou situa-se em raio compatível com o domicílio declarado.";

  if (score >= 80) {
    nivel = "CRÍTICO";
    tom = "danger";
    rotulo = "RISCO CRÍTICO DE FRAUDE";
    conclusao =
      "Incompatibilidade geográfica absoluta. Todos os elementos técnicos apontam execução do ato em localidade remota e distinta do domicílio do titular.";
  } else if (score >= 50) {
    nivel = "ALTO";
    tom = "warning";
    rotulo = "ANOMALIA GEOGRÁFICA ELEVADA";
    conclusao =
      "Divergência expressiva de localidade que extrapola a margem esperada de erro de operadora ou deslocamento corriqueiro.";
  } else if (score >= 25) {
    nivel = "MODERADO";
    tom = "warning";
    rotulo = "DIVERGÊNCIA MODERADA";
    conclusao = "Pequena oscilação de município ou região metropolitana. Requer exame do histórico de deslocamento.";
  }

  return {
    score,
    nivel,
    tom,
    rotulo,
    conclusao,
  };
}
