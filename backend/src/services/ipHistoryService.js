import { classifyIpHistory } from "../engine/ipHistory.js";
import { cached, TTL } from "../utils/externalCache.js";

/**
 * Histórico do IP NA DATA DO ATO, via RIPEstat Data API (gratuita, sem chave,
 * cobre todos os RIRs). Portado do motor pericial.
 *
 * Geolocalizar pela data da CONSULTA pode classificar como estrangeiro um bloco
 * que, na data da contratação, era anunciado por operadora brasileira e só foi
 * realocado ou alugado depois. A classificação (`classifyIpHistory`) decide se a
 * régua de distância deve ceder lugar à nota de proveniência do endereço.
 */

const FETCH_TIMEOUT_MS = 8_000;
const RIPESTAT = "https://stat.ripe.net/data";

async function ripestat(caminho) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const r = await fetch(`${RIPESTAT}/${caminho}`, {
      signal: controller.signal,
      headers: { "User-Agent": "ForenseDoc/3.0 (laudo pericial)" },
    });
    if (!r.ok) return null;
    const body = await r.json();
    return body?.status === "ok" ? body.data : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** "dd/mm/aaaa [hh:mm[:ss]]" ou ISO → "aaaa-mm-ddThh:mm:ss". */
export function parseActDateToIso(value) {
  const br = String(value || "").match(/(\d{2})\/(\d{2})\/(\d{4})(?:\s+(?:[àa]s\s+)?(\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (br) {
    const [, dd, mm, yyyy, hh = "00", min = "00", ss = "00"] = br;
    return `${yyyy}-${mm}-${dd}T${hh}:${min}:${ss}`;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 19);
}

async function consultarHistorico(ip, actDateIso, currentIsp) {
  const ato = new Date(actDateIso).getTime();
  const inicio = new Date(ato - 3 * 86400000).toISOString().slice(0, 19);
  const fim = new Date(ato + 3 * 86400000).toISOString().slice(0, 19);
  // O histórico de RIR tem granularidade diária: start = end com hora exata
  // pode não cair em nenhum intervalo e devolver lista vazia.
  const dia = `${actDateIso.slice(0, 10)}T00:00:00`;
  const recurso = encodeURIComponent(ip);

  const [rirNaData, rirAtual, roteamento, redeAtual] = await Promise.all([
    ripestat(`rir/data.json?resource=${recurso}&starttime=${dia}&endtime=${dia}`),
    ripestat(`rir/data.json?resource=${recurso}`),
    ripestat(`routing-history/data.json?resource=${recurso}&starttime=${inicio}&endtime=${fim}`),
    ripestat(`network-info/data.json?resource=${recurso}`),
  ]);

  const asnNaData = roteamento?.by_origin?.[0]?.origin ? Number(roteamento.by_origin[0].origin) : null;
  const asnAtual = Number.isFinite(Number(redeAtual?.asns?.[0])) ? Number(redeAtual.asns[0]) : null;
  const detentorNaData = asnNaData
    ? (await ripestat(`as-overview/data.json?resource=AS${asnNaData}`))?.holder || null
    : null;

  return classifyIpHistory(
    { asn: asnNaData, asnHolder: detentorNaData, rir: rirNaData?.rirs?.[0]?.rir || null },
    { asn: asnAtual, rir: rirAtual?.rirs?.[0]?.rir || null, orgName: currentIsp || null },
  );
}

/**
 * @param {string} ip endereço público
 * @param {string} actDate data do ato ("dd/mm/aaaa hh:mm:ss" ou ISO)
 * @param {string|null} currentIsp provedor da geolocalização atual
 * @returns {Promise<object|null>} classificação, ou null sem data utilizável
 */
export async function lookupIpHistory(ip, actDate, currentIsp = null) {
  const actDateIso = parseActDateToIso(actDate);
  if (!ip || !actDateIso) return null;
  // Chave por dia: o histórico tem granularidade diária, e a mesma trilha
  // repete o endereço em vários eventos do mesmo dia.
  return cached("ip-history", `${ip}@${actDateIso.slice(0, 10)}`, TTL.geoip, () =>
    consultarHistorico(ip, actDateIso, currentIsp)
  );
}
