export async function digestHash(algorithm, buffer) {
  const hash = await crypto.subtle.digest(algorithm, buffer);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

export function classifyHashString(s) {
  if (!s || typeof s !== "string") return null;
  const v = s.trim();
  const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const uuidAny = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (uuidV4.test(v)) return { format: "UUID v4", isHash: false, detalhe: "Identificador UUID versão 4, gerado aleatoriamente, sem relação criptográfica com o conteúdo do documento" };
  if (uuidAny.test(v)) return { format: "UUID", isHash: false, detalhe: "Identificador UUID, sem relação criptográfica com o conteúdo do documento" };
  if (/^[0-9a-fA-F]{64}$/.test(v)) return { format: "SHA-256", isHash: true, detalhe: "Cadeia hexadecimal de 64 caracteres, compatível com SHA-256" };
  if (/^[0-9a-fA-F]{40}$/.test(v)) return { format: "SHA-1", isHash: true, detalhe: "Cadeia hexadecimal de 40 caracteres, compatível com SHA-1" };
  if (/^[0-9a-fA-F]{32}$/.test(v)) return { format: "MD5", isHash: true, detalhe: "Cadeia hexadecimal de 32 caracteres, compatível com MD5" };
  return { format: "Formato não reconhecido", isHash: false, detalhe: "Cadeia não corresponde a nenhum formato de hash criptográfico conhecido" };
}
