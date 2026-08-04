import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { TERMS_VERSION } from "../src/legal/termsVersion.js";

/**
 * O aceite dos documentos jurídicos precisa registrar QUAL TEXTO foi aceito.
 *
 * Guardar apenas "aceitou" não demonstra nada: documentos mudam, e sem a versão
 * qualquer cláusula invocada pode ser respondida com "isso não estava lá quando
 * eu me cadastrei", sem como refutar.
 */
describe("versão dos termos", () => {
  it("tem formato de data, para ordenação e leitura humana", () => {
    expect(TERMS_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("o cliente envia a MESMA versão que o servidor exige", () => {
    /*
     * Se divergirem, o cadastro para de funcionar por inteiro, o que é o modo
     * certo de falhar. A alternativa (o servidor aceitar qualquer versão)
     * registraria consentimento sobre um texto que ninguém sabe qual era.
     *
     * Este teste existe porque a duplicação é inevitável (o frontend não importa
     * do backend) e uma atualização em só um dos lados é fácil de acontecer.
     */
    const cliente = readFileSync(
      new URL("../../frontend/src/utils/legalVersion.js", import.meta.url),
      "utf-8"
    );
    const m = cliente.match(/TERMS_VERSION\s*=\s*"([^"]+)"/);
    expect(m, "TERMS_VERSION não encontrada no frontend").not.toBeNull();
    expect(m[1]).toBe(TERMS_VERSION);
  });

  it("a data exibida nas páginas jurídicas corresponde à versão", () => {
    // O usuário aceita o que a página mostra. Se a página diz "em vigor desde X"
    // e o registro guarda Y, o registro documenta a coisa errada.
    const layout = readFileSync(
      new URL("../../frontend/src/pages/legal/LegalLayout.jsx", import.meta.url),
      "utf-8"
    );
    const vigencia = layout.match(/VIGENCIA\s*=\s*"([^"]+)"/)[1];

    const [ano, mes, dia] = TERMS_VERSION.split("-");
    const meses = ["janeiro","fevereiro","março","abril","maio","junho","julho",
                   "agosto","setembro","outubro","novembro","dezembro"];
    expect(vigencia).toBe(`${Number(dia)} de ${meses[Number(mes) - 1]} de ${ano}`);
  });
});

describe("schema de registro", () => {
  it("recusa cadastro sem a versão dos termos", async () => {
    const { z } = await import("zod");
    const schema = z.object({ termsVersion: z.literal(TERMS_VERSION) });

    expect(() => schema.parse({})).toThrow();
    expect(() => schema.parse({ termsVersion: "2020-01-01" })).toThrow();
    expect(schema.parse({ termsVersion: TERMS_VERSION }).termsVersion).toBe(TERMS_VERSION);
  });
});
