import { isIP } from "node:net";

/**
 * Allowlist de origem dos webhooks da Asaas (Seção 2.6 do plano).
 *
 * Segunda camada, depois do `asaas-access-token`: mesmo que o token vaze,
 * a requisição precisa vir da faixa de IPs da Asaas.
 *
 * Os CIDRs vêm de ASAAS_WEBHOOK_IPS (lista separada por vírgula) porque a
 * Asaas pode alterá-los — deixá-los fixos no código transformaria uma mudança
 * de infra deles numa interrupção de cobrança aqui. Consulte a faixa atual na
 * documentação de webhooks da Asaas e preencha a variável.
 *
 * Sem a variável configurada, o middleware apenas registra a origem e libera
 * a passagem: a proteção por token continua valendo e é melhor logar do que
 * derrubar o faturamento por uma allowlist vazia.
 */

function ipToBigInt(ip) {
  const version = isIP(ip);
  if (version === 4) {
    return ip.split(".").reduce((acc, octet) => (acc << 8n) + BigInt(octet), 0n);
  }
  if (version === 6) {
    // Expande a notação "::" antes de converter.
    const [head, tail = ""] = ip.split("::");
    const headParts = head ? head.split(":") : [];
    const tailParts = tail ? tail.split(":") : [];
    const missing = 8 - headParts.length - tailParts.length;
    const parts = [...headParts, ...Array(Math.max(missing, 0)).fill("0"), ...tailParts];
    return parts.reduce((acc, part) => (acc << 16n) + BigInt(parseInt(part || "0", 16)), 0n);
  }
  return null;
}

/** Aceita "1.2.3.4" (host único) ou "1.2.3.0/24". */
function parseCidr(entry) {
  const [address, prefix] = entry.trim().split("/");
  const version = isIP(address);
  if (!version) return null;

  const bits = version === 4 ? 32 : 128;
  const prefixLength = prefix === undefined ? bits : Number(prefix);
  if (!Number.isInteger(prefixLength) || prefixLength < 0 || prefixLength > bits) return null;

  const base = ipToBigInt(address);
  if (base === null) return null;

  const mask = prefixLength === 0 ? 0n : ((1n << BigInt(prefixLength)) - 1n) << BigInt(bits - prefixLength);
  return { version, network: base & mask, mask };
}

const ALLOWED = (process.env.ASAAS_WEBHOOK_IPS || "")
  .split(",")
  .map((entry) => entry.trim())
  .filter(Boolean)
  .map((entry) => {
    const parsed = parseCidr(entry);
    if (!parsed) console.error(`[Webhook] CIDR inválido em ASAAS_WEBHOOK_IPS, ignorado: "${entry}"`);
    return parsed;
  })
  .filter(Boolean);

if (ALLOWED.length === 0) {
  console.warn(
    "[Webhook] ASAAS_WEBHOOK_IPS não configurada — allowlist de IP desativada. " +
      "Os webhooks continuam protegidos apenas pelo asaas-access-token."
  );
}

export function isIpAllowed(ip) {
  if (ALLOWED.length === 0) return true;

  // Express entrega IPv4 mapeado em IPv6 (::ffff:1.2.3.4) atrás de proxy.
  const normalized = ip?.startsWith("::ffff:") ? ip.slice(7) : ip;
  const version = isIP(normalized || "");
  if (!version) return false;

  const value = ipToBigInt(normalized);
  if (value === null) return false;

  return ALLOWED.some((cidr) => cidr.version === version && (value & cidr.mask) === cidr.network);
}

export function asaasIpAllowlist(req, res, next) {
  if (isIpAllowed(req.ip)) return next();

  console.warn(`[Webhook] Requisição rejeitada — IP fora da allowlist: ${req.ip}`);
  return res.status(403).end();
}
