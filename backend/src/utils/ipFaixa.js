/**
 * Faixa do endereço IP: operadora, provedor regional, hospedagem ou VPN.
 *
 * ─── Por que ─────────────────────────────────────────────────────────────────
 *
 * Ninguém contrata consignado de dentro de um servidor. Um IP de data center,
 * de VPN ou de proxy na trilha de assinatura é um dos sinais mais fortes de que
 * quem estava do outro lado não era o consumidor com o próprio celular. O laudo
 * geolocalizava o IP e dizia a cidade; não dizia que tipo de rede era. Aqui a
 * classificação é por nome do provedor (ISP/org/ASN devolvido pela consulta e
 * pelo RDAP), sem base paga. É heurística de texto: o laudo diz isso e nunca
 * conclui fraude só por ela.
 */

const OPERADORAS_MOVEIS = /\b(claro|vivo|telef[oô]nica|tim\b|oi\s*m[oó]vel|oi\s*s\.?a|nextel|algar|sercomtel|brisanet|unifique|surf\s*telecom|correios\s*celular)\b/i;
const OPERADORAS_FIXAS = /\b(net\s*servi[çc]os|embratel|gvt|copel|cabo\s*telecom|desktop|americanet|sumicity|vero\b|ligga|hughes|viasat|starlink|sky\b|oi\s*fibra|vivo\s*fibra|claro\s*net)\b/i;
const HOSPEDAGEM = /\b(amazon|aws|amazon\s*technologies|google\s*(cloud|llc)|microsoft|azure|oracle\s*cloud|ovh|hetzner|digital\s*ocean|digitalocean|vultr|linode|akamai|cloudflare|fastly|hostinger|locaweb|kinghost|umbler|godaddy|contabo|scaleway|leaseweb|ionos|rackspace|equinix|hostgator|servers?\b|hosting|host\s*services|data\s*center|datacenter|colocation|cloud\s*computing|vps)\b/i;
const VPN_PROXY = /\b(vpn|nordvpn|expressvpn|surfshark|proton|mullvad|private\s*internet\s*access|cyberghost|hide\s*my\s*ass|windscribe|proxy|tor\s*exit|relay)\b/i;
const PROVEDOR_REGIONAL = /\b(telecom|telecomunica[çc][õo]es|provedor|internet|net\b|fibra|comunica[çc][ãa]o\s*multim[ií]dia|\bscm\b|banda\s*larga|isp\b|ltda|me\b|eireli)\b/i;

/**
 * @param {object} args
 * @param {string|null} [args.isp] campo isp/org da geolocalização
 * @param {string|null} [args.owner] titular do bloco (RDAP)
 * @param {string|null} [args.asn]
 * @returns {{tipo: string, rotulo: string, motivo: string, alerta: boolean}}
 */
export function classificarFaixaIp({ isp = null, owner = null, asn = null } = {}) {
  const nome = [isp, owner].filter(Boolean).join(" · ").trim();
  if (!nome) {
    return { tipo: "desconhecida", rotulo: "faixa não identificada", motivo: "sem nome de provedor na consulta nem no RDAP", alerta: false };
  }
  const base = { nome, asn: asn || null };
  if (VPN_PROXY.test(nome)) {
    return { ...base, tipo: "vpn", rotulo: "VPN / proxy", motivo: `o titular do bloco (${nome}) opera serviço de VPN ou proxy`, alerta: true };
  }
  if (HOSPEDAGEM.test(nome)) {
    return { ...base, tipo: "hospedagem", rotulo: "data center / hospedagem", motivo: `o titular do bloco (${nome}) é provedor de hospedagem ou nuvem, não de acesso residencial ou móvel`, alerta: true };
  }
  if (OPERADORAS_MOVEIS.test(nome)) {
    return { ...base, tipo: "operadora", rotulo: "operadora de telefonia (móvel ou fixa)", motivo: `bloco de ${nome}`, alerta: false };
  }
  if (OPERADORAS_FIXAS.test(nome)) {
    return { ...base, tipo: "operadora", rotulo: "operadora de banda larga fixa", motivo: `bloco de ${nome}`, alerta: false };
  }
  if (PROVEDOR_REGIONAL.test(nome)) {
    return { ...base, tipo: "provedor_regional", rotulo: "provedor regional de acesso (SCM)", motivo: `bloco de ${nome}, provedor de acesso local`, alerta: false };
  }
  return { ...base, tipo: "indeterminada", rotulo: "faixa não classificada", motivo: `o nome do titular (${nome}) não permite classificar a natureza da rede`, alerta: false };
}
