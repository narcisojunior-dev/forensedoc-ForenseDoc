/**
 * PDF mínimo com texto pesquisável, uma página por string. Sem dependência
 * externa, para os testes do motor pericial exercitarem leitura real de PDF.
 */
export function makeSearchablePdf(pageTexts) {
  const escape = (value) => String(value).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  const fontObject = 3 + pageTexts.length * 2;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "",
  ];
  const pageReferences = [];
  for (const [index, pageText] of pageTexts.entries()) {
    const pageObject = 3 + index * 2;
    const contentObject = pageObject + 1;
    pageReferences.push(`${pageObject} 0 R`);
    objects[pageObject - 1] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontObject} 0 R >> >> /Contents ${contentObject} 0 R >>`;
    const stream = `BT /F1 10 Tf 36 756 Td (${escape(pageText)}) Tj ET`;
    objects[contentObject - 1] = `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`;
  }
  objects[1] = `<< /Type /Pages /Count ${pageTexts.length} /Kids [${pageReferences.join(" ")}] >>`;
  objects[fontObject - 1] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";

  let body = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(body));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(body);
}
