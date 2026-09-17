// Classificação histórica de um IP a partir dos dados do RIPEstat Data API
// (gratuita, sem chave, cobre todos os RIRs). Motivação (relatório técnico
// de 09/09/2026, item 7): geolocalizar um IP pela data da CONSULTA, não
// pela data do ATO, pode devolver "Polônia, risco crítico" para um bloco
// que em 2023 era anunciado por uma operadora brasileira e só foi
// realocado/alugado depois — o que classificaria erroneamente um acesso
// legítimo como fraude internacional. Este módulo só decide, a partir de
// dados já buscados; a busca em si (fetch ao RIPEstat) fica em server.js.

// ASNs de grandes operadoras brasileiras (fixas e móveis) — quando o ASN de
// origem NA DATA do ato pertence a uma delas, o IP era brasileiro naquele
// momento mesmo que a geolocalização atual aponte para outro país.
export const BRAZILIAN_CARRIER_ASNS = new Map([
  [7738, "Telemar Norte Leste / V.tal (Oi)"],
  [8167, "Telemar Norte Leste (Oi)"],
  [28573, "Claro NXT/Claro S.A."],
  [22085, "Claro S.A. (embratel)"],
  [26599, "Telefônica Brasil (Vivo)"],
  [18881, "Telefônica Brasil (Vivo)"],
  [27699, "Telefônica Brasil (Vivo)"],
  [26615, "TIM S.A."],
  [53006, "Algar Telecom"],
  [4230, "Claro S.A. (Embratel)"],
  [16735, "Algar Telecom/CTBC"],
  [7162, "Americanet/Vivo"],
]);

const LEASE_MARKETPLACE_MARKERS = [
  /\bipxo\b/i,
  /\blease/i,
  /triathlon\s+trading/i,
  /internet\s+utilities/i,
  /ip\s*v?4\s*leasing/i,
  /cogent.*broker/i,
];

export function isLeaseMarketplaceOrg(name) {
  return LEASE_MARKETPLACE_MARKERS.some((pattern) => pattern.test(String(name || "")));
}

export function isBrazilianCarrierAsn(asn) {
  return BRAZILIAN_CARRIER_ASNS.has(Number(asn));
}

// snapshot: { asn, asnHolder, rir, country, orgName } na data do ato.
// current: idem, na data da consulta (agora).
export function classifyIpHistory(snapshot, current) {
  if (!snapshot || (!snapshot.asn && !snapshot.rir)) {
    return {
      status: "SEM_HISTORICO",
      transferredAfterAct: null,
      label: null,
      note: "Não foi possível recuperar o histórico de roteamento/RIR do IP na data do ato junto ao RIPEstat.",
    };
  }

  const asnChanged = Boolean(snapshot.asn && current?.asn && Number(snapshot.asn) !== Number(current.asn));
  const rirChanged = Boolean(snapshot.rir && current?.rir && snapshot.rir !== current.rir);
  const transferredAfterAct = asnChanged || rirChanged;
  const brazilianAtDate = isBrazilianCarrierAsn(snapshot.asn);
  const leaseMarketplace = isLeaseMarketplaceOrg(current?.orgName) || isLeaseMarketplaceOrg(snapshot.orgName);

  if (transferredAfterAct) {
    const holderAtDate = snapshot.asnHolder || (brazilianAtDate ? BRAZILIAN_CARRIER_ASNS.get(Number(snapshot.asn)) : null) || `AS${snapshot.asn}`;
    return {
      status: "REGISTRO_ALTERADO_APOS_O_ATO",
      transferredAfterAct: true,
      brazilianCarrierAtDate: brazilianAtDate,
      label: "REGISTRO ALTERADO APÓS O ATO",
      note: `Na data do ato o endereço era anunciado por ${holderAtDate}${snapshot.rir ? ` (RIR ${snapshot.rir})` : ""}. A geolocalização atual${current?.country ? ` (${current.country})` : ""} reflete uma transferência/realocação posterior do bloco e não descreve o acesso na data analisada.`,
      suppressDistanceRisk: true,
    };
  }

  if (leaseMarketplace) {
    return {
      status: "BLOCO_MARKETPLACE_ALUGUEL",
      transferredAfterAct: false,
      brazilianCarrierAtDate: brazilianAtDate,
      label: "BLOCO EM MARKETPLACE DE ALUGUEL",
      note: "O detentor do bloco (na data do ato ou atualmente) é uma organização de revenda/aluguel de endereços IPv4; a geolocalização desse tipo de bloco é volátil e não confiável isoladamente.",
      suppressDistanceRisk: true,
    };
  }

  if (brazilianAtDate) {
    return {
      status: "OPERADORA_BRASILEIRA_NA_DATA",
      transferredAfterAct: false,
      brazilianCarrierAtDate: true,
      label: "OPERADORA BRASILEIRA NA DATA DO ATO",
      note: `O ASN de origem na data do ato (AS${snapshot.asn}, ${snapshot.asnHolder || BRAZILIAN_CARRIER_ASNS.get(Number(snapshot.asn))}) pertence a uma operadora brasileira; use a precisão de estado/região e o GPS do ato quando houver, não a cidade da geolocalização por IP.`,
      suppressDistanceRisk: false,
      precisionOverride: "estado/região (rede de operadora brasileira)",
    };
  }

  return {
    status: "SEM_TRANSFERENCIA_DETECTADA",
    transferredAfterAct: false,
    brazilianCarrierAtDate: false,
    label: null,
    note: null,
    suppressDistanceRisk: false,
  };
}
