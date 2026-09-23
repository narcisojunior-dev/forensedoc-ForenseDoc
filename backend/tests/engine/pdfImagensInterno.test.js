import { describe, it, expect } from "vitest";
import { inventarioImagensInterno, varrerObjetosDeImagem } from "../../src/engine/pdfImagensInterno.js";
import { inspectPdfImagesInterno } from "../../src/engine/pdfForensics.js";

// JPEG mínimo válido (1x1), com JFIF e sem EXIF. As dimensões que o motor lê
// vêm do dicionário do XObject, não do JPEG, e é isso que a heurística usa.
const JPEG_1X1 = Buffer.from(
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDA0MCwsMDxgQEBEQEBgYFBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBj/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==",
  "base64"
);

/**
 * PDF com um XObject JPEG (dimensões declaradas) desenhado nas páginas pedidas.
 * @param {{width:number,height:number,paginas:number,desenharEm:number[]}} opts
 */
function pdfComFoto({ width = 360, height = 640, paginas = 2, desenharEm = [1, 2] } = {}) {
  const objects = [];
  objects[0] = "<< /Type /Catalog /Pages 2 0 R >>";
  const kids = [];
  const imagemObj = 3 + paginas * 2;
  for (let i = 0; i < paginas; i += 1) {
    const pageObj = 3 + i * 2;
    const contentObj = pageObj + 1;
    kids.push(`${pageObj} 0 R`);
    const usa = desenharEm.includes(i + 1);
    objects[pageObj - 1] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << ${usa ? `/XObject << /Im1 ${imagemObj} 0 R >>` : ""} >> /Contents ${contentObj} 0 R >>`;
    const stream = usa ? "q 180 0 0 320 100 300 cm /Im1 Do Q" : "q Q";
    objects[contentObj - 1] = `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`;
  }
  objects[1] = `<< /Type /Pages /Count ${paginas} /Kids [${kids.join(" ")}] >>`;
  const dict = `<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${JPEG_1X1.length} >>`;
  objects[imagemObj - 1] = { dict, stream: JPEG_1X1 };

  const partes = [Buffer.from("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n", "latin1")];
  const offsets = [];
  let pos = partes[0].length;
  objects.forEach((object, index) => {
    offsets.push(pos);
    const cabeca = Buffer.from(`${index + 1} 0 obj\n`, "latin1");
    let corpo;
    if (typeof object === "string") corpo = Buffer.from(`${object}\nendobj\n`, "latin1");
    else corpo = Buffer.concat([Buffer.from(`${object.dict}\nstream\n`, "latin1"), object.stream, Buffer.from("\nendstream\nendobj\n", "latin1")]);
    partes.push(cabeca, corpo);
    pos += cabeca.length + corpo.length;
  });
  const xref = pos;
  let tabela = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) tabela += `${String(o).padStart(10, "0")} 00000 n \n`;
  tabela += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  partes.push(Buffer.from(tabela, "latin1"));
  return Buffer.concat(partes);
}

describe("inventário de imagens sem o Poppler", () => {
  it("lê o objeto JPEG bruto, com dimensões do dicionário e hash do fluxo", () => {
    const objetos = varrerObjetosDeImagem(pdfComFoto());
    expect(objetos).toHaveLength(1);
    expect(objetos[0]).toMatchObject({ width: 360, height: 640, filtro: "DCTDecode", mascara: false });
    expect(objetos[0].bytes.equals(JPEG_1X1)).toBe(true);
  });

  it("atribui a página pelo pdf.js e repete a linha quando a mesma foto aparece em duas páginas", async () => {
    const r = await inventarioImagensInterno(pdfComFoto({ paginas: 3, desenharEm: [1, 3] }));
    const fotos = r.imagens.filter((i) => i.width === 360);
    expect(fotos.map((i) => i.page)).toEqual([1, 3]);
    expect(new Set(fotos.map((i) => i.sha256)).size).toBe(1);
    expect(fotos[0]).toMatchObject({ enc: "jpeg", formato: "JPEG", exif: false, jfif: true, origem_hash: "fluxo bruto do objeto" });
    expect(fotos[0].miniatura).toMatch(/^data:image\/jpeg;base64,/);
  });

  it("produz os mesmos achados do caminho pdfimages: IMG2 para a foto repetida e biometria provável", async () => {
    const r = await inspectPdfImagesInterno(pdfComFoto({ paginas: 2, desenharEm: [1, 2] }), "assinado por biometria facial", "pdfimages ausente no teste");
    expect(r.disponivel).toBe(true);
    expect(r.ferramenta).toMatch(/leitor interno/);
    expect(r.imagens.filter((i) => i.biometricaProvavel)).toHaveLength(2);
    expect(r.grupos_repetidos).toHaveLength(1);
    expect(r.grupos_repetidos[0].paginas).toEqual([1, 2]);
    expect(r.achados.some((a) => a.codigo === "IMG2")).toBe(true);
    expect(r.achados.some((a) => a.codigo === "IMG0")).toBe(false);
    expect(r.observacao).toMatch(/pdfimages ausente no teste/);
  });

  it("não confunde ausência de ferramenta com ausência de imagem", async () => {
    const r = await inspectPdfImagesInterno(pdfComFoto({ paginas: 1, desenharEm: [] }), "", "sem pdfimages");
    // O objeto existe no arquivo, mas não é desenhado em página nenhuma: entra sem página.
    expect(r.total).toBe(1);
    expect(r.imagens[0].page).toBeNull();
  });
});
