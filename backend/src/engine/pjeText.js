const PJE_FOOTER_PATTERNS = [
  /^Este documento foi gerado pelo usu[aá]rio\s+\S+(?:\s+\S+)*\s+em\s+\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}:\d{2}$/i,
  /^N[uú]mero do documento:\s*\d{20,}$/i,
  /^https:\/\/pje\.[^\s]+$/i,
  /^Assinado eletronicamente por:\s*.+\s+-\s+\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}:\d{2}$/i,
  /^Num\.\s*\d+\s*-\s*P[áa]g\.\s*\d+$/i,
];

export function stripPjeFooter(value) {
  const text = String(value || "");
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  const removed = [];
  const lines = text.split(/\r?\n/);
  const kept = lines.filter((line) => {
    const trimmed = line.trim();
    if (!trimmed || !PJE_FOOTER_PATTERNS.some((pattern) => pattern.test(trimmed))) return true;
    removed.push(trimmed);
    return false;
  });
  return { text: kept.join(newline), removed };
}

export { PJE_FOOTER_PATTERNS };
