import { isIP } from "node:net";

/**
 * Casamento de IP contra lista de CIDRs.
 *
 * Extraído de middleware/webhookIpAllowlist.js quando o painel admin passou a
 * precisar da mesma lógica (N2 da auditoria). Duplicar o parser de CIDR em dois
 * middlewares significaria corrigir bugs de IPv6 em dois lugares.
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
export function parseCidr(entry) {
  const [address, prefix] = entry.trim().split("/");
  const version = isIP(address);
  if (!version) return null;

  const bits = version === 4 ? 32 : 128;
  const prefixLength = prefix === undefined ? bits : Number(prefix);
  if (!Number.isInteger(prefixLength) || prefixLength < 0 || prefixLength > bits) return null;

  const base = ipToBigInt(address);
  if (base === null) return null;

  const mask =
    prefixLength === 0 ? 0n : ((1n << BigInt(prefixLength)) - 1n) << BigInt(bits - prefixLength);
  return { version, network: base & mask, mask };
}

/**
 * Lê uma variável de ambiente com CIDRs separados por vírgula.
 * Entradas inválidas são logadas e ignoradas, nunca derrubam o boot.
 */
export function parseCidrList(rawValue, envName) {
  return (rawValue || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const parsed = parseCidr(entry);
      if (!parsed) console.error(`[IPAllowlist] CIDR inválido em ${envName}, ignorado: "${entry}"`);
      return parsed;
    })
    .filter(Boolean);
}

/** O IP está em alguma das faixas? Lista vazia => sempre false (decida no chamador). */
export function matchesCidrList(ip, list) {
  if (list.length === 0) return false;

  // Express entrega IPv4 mapeado em IPv6 (::ffff:1.2.3.4) atrás de proxy.
  const normalized = ip?.startsWith("::ffff:") ? ip.slice(7) : ip;
  const version = isIP(normalized || "");
  if (!version) return false;

  const value = ipToBigInt(normalized);
  if (value === null) return false;

  return list.some((cidr) => cidr.version === version && (value & cidr.mask) === cidr.network);
}
