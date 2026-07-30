import { isIP } from "node:net";

/**
 * Extração de endereços IP do texto de um documento assinado eletronicamente.
 *
 * ─── Por que isto não é um regex solto ───────────────────────────────────────
 *
 * A versão anterior usava `/\b((?:\d{1,3}\.){3}\d{1,3})\b/` e produzia dois
 * erros graves num laudo pericial:
 *
 *   1. FALSOS POSITIVOS. Um User-Agent como
 *      "Chrome/130.0.0.0 Safari/537.36" casa como IP. Numeração de seções
 *      ("3.3.3.1") também. O laudo passava a afirmar que o documento continha
 *      endereços IP que nunca estiveram nele — inventava prova.
 *
 *   2. IPv6 IGNORADO. Assinadores brasileiros registram cada vez mais o IP em
 *      IPv6 (rede móvel), no formato "IP e Porta Lógica:
 *      2804:18:6881:4f33:e868:6941:39ee:81fc: 56256". Nenhum era capturado, e
 *      o § 6 do laudo declarava "nenhum endereço IP identificado" num documento
 *      que trazia o endereço de forma explícita.
 *
 * A estratégia agora é a inversa: procurar primeiro os RÓTULOS que os
 * assinadores usam ("IP e Porta Lógica", "Endereço IP", "IP do signatário") e,
 * só depois, varrer o texto solto — sempre validando com `isIP()` do Node e
 * descartando o que vem de contexto notoriamente ruidoso.
 */

/** Rótulos usados pelas plataformas de assinatura brasileiras. */
const ROTULOS = [
  "IP e Porta L[óo]gica",
  "Endere[çc]o(?:\\s+de)?\\s+IP",
  "IP\\s+do\\s+(?:signat[áa]rio|assinante|usu[áa]rio)",
  "IP\\s+de\\s+(?:origem|acesso|conex[ãa]o)",
  "IP\\s+(?:capturado|registrado)",
  "IP",
];

// Um IPv6 pode conter "::" e terminar com ":porta". O grupo captura o endereço
// sem a porta final, que é tratada em separado.
const IPV6_BRUTO = "(?:[0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}";
const IPV4_BRUTO = "(?:\\d{1,3}\\.){3}\\d{1,3}";

/**
 * Trechos que produzem números parecidos com IPv4 e nunca são endereços.
 * Testados na VIZINHANÇA do candidato, não no texto todo.
 */
const CONTEXTO_RUIDOSO =
  /(?:chrome|safari|firefox|edge|opera|applewebkit|webkit|gecko|mozilla|samsungbrowser|version|vers[ãa]o|build|sdk|android|ios|windows\s*nt)\s*\/?\s*$/i;

/** Faixas que não identificam um usuário na internet pública. */
function ehIpUtilizavel(ip) {
  const v = isIP(ip);
  if (!v) return false;

  if (v === 4) {
    const o = ip.split(".").map(Number);
    if (o[0] === 0 || o[0] === 127 || o[0] === 10) return false; // este host, loopback, privada
    if (o[0] === 172 && o[1] >= 16 && o[1] <= 31) return false; // privada
    if (o[0] === 192 && o[1] === 168) return false; // privada
    if (o[0] === 169 && o[1] === 254) return false; // link-local
    if (o[0] >= 224) return false; // multicast / reservado
    // Um IPv4 com todos os octetos < 10 é quase sempre numeração de versão
    // ou de seção ("3.3.3.1"), não endereço roteável.
    if (o.every((n) => n < 10)) return false;
    return true;
  }

  const baixo = ip.toLowerCase();
  if (baixo === "::1" || baixo === "::") return false; // loopback / indefinido
  if (baixo.startsWith("fe80")) return false; // link-local
  if (/^f[cd]/.test(baixo)) return false; // unique local (fc00::/7)
  return true;
}

/** Remove a porta que os assinadores anexam ao endereço. */
function separarPorta(bruto) {
  const texto = bruto.trim().replace(/[.,;]+$/, "");

  // IPv4 com porta: "200.1.2.3:56256"
  const v4 = texto.match(/^((?:\d{1,3}\.){3}\d{1,3}):(\d{2,5})$/);
  if (v4) return { ip: v4[1], porta: v4[2] };

  if (isIP(texto)) return { ip: texto, porta: null };

  // IPv6 seguido de porta, com ou sem espaço: "2804:...:81fc: 56256".
  // O último grupo só é porta se o que sobra continuar sendo IPv6 válido —
  // caso contrário ele é um hextet legítimo do próprio endereço.
  const m = texto.match(/^(.*?):\s*(\d{2,5})$/);
  if (m && isIP(m[1])) return { ip: m[1], porta: m[2] };

  return { ip: texto, porta: null };
}

/** Data/hora e User-Agent que aparecem perto do IP, para a cadeia de custódia. */
function contextoAoRedor(flat, indice) {
  const janela = flat.slice(Math.max(0, indice - 400), indice + 400);
  const dataHora = janela.match(
    /(\d{2}\/\d{2}\/\d{4}(?:\s+(?:[àa]s\s+)?\d{2}:\d{2}(?::\d{2})?)?)/
  );
  const userAgent = janela.match(/(Mozilla\/5\.0[^"]{0,200}?)(?:\s+Identificador|\s{2,}|$)/);
  return {
    dataHora: dataHora ? dataHora[1] : null,
    userAgent: userAgent ? userAgent[1].trim() : null,
  };
}

/**
 * @param {string} rawText texto extraído do PDF
 * @returns {Array<{endereco: string, versao: 4|6, porta: string|null,
 *                  rotulo: string|null, contexto: string,
 *                  data_hora: string|null, user_agent: string|null}>}
 */
export function extractIpAddresses(rawText) {
  const flat = String(rawText || "").replace(/\s+/g, " ");
  const achados = new Map(); // endereço → registro (deduplica preservando o 1º)

  const registrar = (bruto, indice, rotulo) => {
    const { ip, porta } = separarPorta(bruto);
    if (!ehIpUtilizavel(ip)) return;

    const chave = ip.toLowerCase();
    if (achados.has(chave)) {
      // Um achado rotulado é mais confiável que um encontrado solto: substitui.
      if (rotulo && !achados.get(chave).rotulo) {
        achados.set(chave, { ...achados.get(chave), rotulo, porta: porta || achados.get(chave).porta });
      }
      return;
    }

    const { dataHora, userAgent } = contextoAoRedor(flat, indice);
    achados.set(chave, {
      endereco: ip,
      versao: isIP(ip),
      porta: porta || null,
      rotulo: rotulo || null,
      contexto: rotulo
        ? `Registrado no documento sob o rótulo "${rotulo}"`
        : "Encontrado no texto do documento, sem rótulo explícito",
      data_hora: dataHora,
      user_agent: userAgent,
    });
  };

  // ─── 1ª passada: endereços precedidos de rótulo (alta confiança) ───────────
  for (const rotulo of ROTULOS) {
    const re = new RegExp(
      `(${rotulo})\\s*[:\\-]?\\s*((?:${IPV6_BRUTO})(?::\\s*\\d{2,5})?|(?:${IPV4_BRUTO})(?::\\d{2,5})?)`,
      "gi"
    );
    for (const m of flat.matchAll(re)) {
      registrar(m[2], m.index, m[1].replace(/\s+/g, " ").trim());
    }
  }

  // ─── 2ª passada: varredura livre, descartando contexto ruidoso ─────────────
  for (const re of [new RegExp(IPV6_BRUTO, "g"), new RegExp(`\\b${IPV4_BRUTO}\\b`, "g")]) {
    for (const m of flat.matchAll(re)) {
      // "Chrome/130.0.0.0" — o que vem imediatamente antes denuncia a origem.
      const antes = flat.slice(Math.max(0, m.index - 40), m.index);
      if (CONTEXTO_RUIDOSO.test(antes)) continue;
      registrar(m[0], m.index, null);
    }
  }

  // Rotulados primeiro: o § 6 do laudo lista o mais confiável no topo.
  return [...achados.values()].sort((a, b) => (b.rotulo ? 1 : 0) - (a.rotulo ? 1 : 0));
}
