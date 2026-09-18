import { describe, it, expect } from "vitest";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

/**
 * Fixture de regressão com o PDF real do dossiê C6.
 *
 * O arquivo tem nome, CPF e selfie de pessoa real e NÃO é versionado. O teste
 * lê de `FORENSEDOC_FIXTURES_DIR/dossiê.pdf` e é pulado quando a variável não
 * existe. Cobre o que o texto anonimizado do corpus não cobre: hashes,
 * páginas, imagens e procedência do arquivo.
 *
 *   FORENSEDOC_FIXTURES_DIR=../../documentação/doc_teste npx vitest run tests/fixturesPrivadas.test.js
 */

const DIR = process.env.FORENSEDOC_FIXTURES_DIR;
const ARQUIVO = DIR ? path.resolve(DIR, "dossiê.pdf") : null;
const disponivel = ARQUIVO ? await access(ARQUIVO).then(() => true, () => false) : false;

// O corpo do describe roda na coleta mesmo com skip; sem o arquivo, nada é lido.
let buf = null;
let r = null;
if (disponivel) {
  const { analisarDocumento } = await import("../src/engine/analisarDocumento.js");
  const { extractPdfMetadata } = await import("../src/services/pdfService.js");
  const { extractPdfTextWithOcr } = await import("../src/services/ocrService.js");
  buf = await readFile(ARQUIVO);
  const [extraction, rawMetadata] = await Promise.all([extractPdfTextWithOcr(buf), extractPdfMetadata(buf)]);
  r = await analisarDocumento({ pdfBuffer: buf, extraction, rawMetadata });
}

describe.skipIf(!disponivel)("fixture privado: dossiê C6 (PDF real)", () => {
  it("identidade do arquivo confere com a verificação independente", () => {
    expect(buf.length).toBe(1093194);
    expect(createHash("sha256").update(buf).digest("hex")).toBe("abc18b73e5731e29d0bc4deedb56a132c7f9336ca8b162cd74125b3d7ab43a5e");
    expect(r.metadata.totalPages).toBe(27);
  });

  it("procedência é exportação do PROJUDI/TJAM, sem lacuna imputada ao banco", () => {
    const p = r.metadata.digitalSignature.procedencia;
    expect(p).toMatchObject({
      procedencia: "EXPORTACAO_SISTEMA_PROCESSUAL",
      sistema: "PROJUDI",
      tribunal: "TJAM",
      movimento: "1.6",
      data_juntada: "28/10/2025",
      juntado_por: "Daniel Sena Almeida",
      dias_criacao_apos_contrato: 390,
    });
    expect(r.extracted.achados_irregularidade.map((a) => a.codigo)).not.toContain("INT2");
  });

  it("com a selfie inventariada, biometria não aparece como mera descrição do instrumento", () => {
    expect((r.extracted.imagens_pdf.imagens || []).filter((i) => i.biometricaProvavel).length).toBeGreaterThan(0);
    expect(r.extracted.assinatura.metodos_descritos_no_fluxo.map((m) => m.rotulo).join(" ")).not.toMatch(/biometr/i);
  });

  it("data do contrato e aferição matemática no PDF real", () => {
    expect(r.extracted.contrato.data_contrato).toBe("25/06/2025");
    expect(r.extracted.afericao_matematica.cet_implicito_mensal).toBe("7,5894%");
    expect(r.extracted.afericao_matematica.composicao_confere).toBe(true);
  });
});
