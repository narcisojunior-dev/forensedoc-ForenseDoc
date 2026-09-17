import { isIP } from "node:net";

function normalizeIpText(text) {
  return String(text || "")
    .replace(/(\d)\s*\n\s*(\d)/g, "$1 $2")
    .replace(/,\s*\n\s*/g, ", ")
    .replace(/(\d)\s*[.·]\s*(?=\d)/g, "$1.");
}

function ipv4Parts(ip) {
  return String(ip).split(".").map((part) => Number(part));
}

export function classifyIpAddress(ip) {
  const version = isIP(ip);
  if (!version) return "INVALIDO";
  const mapped = String(ip).match(/^::ffff:((?:\d{1,3}\.){3}\d{1,3})$/i)?.[1];
  const ipv4 = version === 4 ? ip : mapped;
  if (ipv4) {
    const [a, b] = ipv4Parts(ipv4);
    if (a === 127) return "LOOPBACK";
    if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return "PRIVADO RFC1918";
    if (a === 100 && b >= 64 && b <= 127) return "CGNAT";
    if (a === 169 && b === 254) return "LINK-LOCAL";
    return "PUBLICO";
  }
  if (/^::1$/i.test(ip)) return "LOOPBACK";
  if (/^(?:fc|fd)/i.test(ip)) return "PRIVADO RFC4193";
  if (/^fe80:/i.test(ip)) return "LINK-LOCAL";
  return "PUBLICO";
}

export function extractIpAddresses(text) {
  const normalized = normalizeIpText(text);
  const found = [];

  for (const match of normalized.matchAll(/(?<![0-9A-Fa-f:])::ffff:(?:\d{1,3}\.){3}\d{1,3}(?![0-9A-Fa-f:.])/gi)) {
    if (isIP(match[0])) found.push({ ip: match[0], index: match.index });
  }

  const ipv4 = Array.from(normalized.matchAll(/(?<![A-Za-zÀ-ÿ0-9_-])((?:\d{1,3}\.){3}\d{1,3})(?![0-9A-Za-zÀ-ÿ_.-])/g))
    .filter((match) => {
      const before = normalized.slice(Math.max(0, match.index - 40), match.index);
      const after = normalized.slice(match.index + match[1].length, match.index + match[1].length + 40);
      return !/(?:chrome|firefox|safari|edge|android|version)\s*\/?\s*$/i.test(before)
        && !/(?:quadro|item|cl[aá]usula|subitem)\s+[IVXLCDM\d.-]*$/i.test(before)
        && !/^::ffff:/i.test(normalized.slice(Math.max(0, match.index - 7), match.index))
        && !/^\s*[-–]\s*[A-ZÀ-ÿ]/.test(after);
    })
    .map((match) => ({ ip: match[1], index: match.index }));
  found.push(...ipv4);

  const ipv6 = (normalized.match(/\b(?:[0-9A-Fa-f]{0,4}:){2,7}[0-9A-Fa-f]{0,4}\b/g) || [])
    .map((candidate) => candidate.replace(/:+$/, ""))
    .map((candidate) => ({ ip: candidate, index: normalized.indexOf(candidate) }))
    .filter(({ ip }) => ip.includes(":") && isIP(ip) === 6);
  found.push(...ipv6);

  return found
    .sort((a, b) => a.index - b.index)
    .map(({ ip }) => ip)
    .filter((ip, index, all) => isIP(ip) && all.indexOf(ip) === index);
}
