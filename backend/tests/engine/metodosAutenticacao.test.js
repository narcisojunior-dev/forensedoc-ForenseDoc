import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { extrairMetodosDescritos, ESTADO_METODOS } from "../../src/engine/metodosAutenticacao.js";
import { heuristicExtractionFromText } from "../../src/engine/extraction.js";

/**
 * D1 · fator de autenticação afirmado sem existir no material.
 *
 * O laudo FD-20260917-ABC18B73E5 imprimiu "SMS Token · E-mail" no § 4 para um
 * dossiê sem a palavra "token". Os casos negativos 1 a 3 são os reproduzidos
 * pelo Codex contra a regra antiga; todos retornavam verdadeiro.
 */

const CASO = path.join(path.dirname(fileURLToPath(import.meta.url)), "../corpus/casos/c6-consig-clt-dossie.json");
const { texto: dossieC6 } = JSON.parse(await readFile(CASO, "utf8"));

describe("D1 · métodos de autenticação só com trecho ancorado", () => {
  describe("casos negativos", () => {
    it("negação: 'a assinatura eletrônica não utiliza SMS Token' não afirma método", () => {
      const r = extrairMetodosDescritos("A assinatura eletrônica não utiliza SMS Token.");
      expect(r.estado).toBe(ESTADO_METODOS.NAO_LOCALIZADO_NO_MATERIAL);
      expect(r.metodos).toEqual([]);
    });

    it("cláusula de comunicação: SMS após o aceite não é fator de autenticação", () => {
      const r = extrairMetodosDescritos("Após o aceite, o cliente receberá comunicações sobre parcelas por SMS.");
      expect(r.estado).toBe(ESTADO_METODOS.NAO_LOCALIZADO_NO_MATERIAL);
      expect(r.metodos).toEqual([]);
    });

    it("SMS sozinho, sem método, não vira token", () => {
      const r = extrairMetodosDescritos("O aceite dos Termos será confirmado e o número de celular receberá SMS.");
      expect(r.metodos.map((m) => m.codigo)).not.toContain("TOKEN");
    });

    it("menção fora de qualquer contexto de fluxo não afirma método", () => {
      const r = extrairMetodosDescritos("A tabela de tarifas do produto está disponível no site, com token de consulta.");
      expect(r.estado).toBe(ESTADO_METODOS.NAO_LOCALIZADO_NO_MATERIAL);
    });
  });

  /**
   * Revisão independente do Codex. A primeira versão da regra enumerava verbos
   * de negação no nível do segmento e deixava passar estas três formas, todas
   * como LOCALIZADO. Negação é relação com o termo, não propriedade do segmento.
   */
  describe("negação contextual", () => {
    const negativos = [
      ["cópula e particípio", "A assinatura eletrônica não é realizada com SMS Token."],
      ["verbo de exclusão sem 'não'", "A assinatura eletrônica dispensa senha."],
      ["preposição 'sem'", "A autenticação ocorre sem token."],
      ["negação posposta ao termo", "Para a assinatura eletrônica, o token não é utilizado."],
      ["'prescinde de'", "O aceite prescinde de senha ou token."],
      ["'nenhum'", "A autenticação não exige nenhum token de uso único."],
      ["'sem' antes de selfie", "A assinatura eletrônica é concluída sem selfie do contratante."],
    ];

    it.each(negativos)("%s", (_rotulo, frase) => {
      const r = extrairMetodosDescritos(frase);
      expect(r.estado).toBe(ESTADO_METODOS.NAO_LOCALIZADO_NO_MATERIAL);
      expect(r.metodos).toEqual([]);
    });

    /**
     * Texto de OCR chega sem acento. "não e realizada" traz a cópula "é" escrita
     * como "e", e a quebra de conjunção chegou a lê-la como coordenação, o que
     * fazia a negação deixar de alcançar o termo.
     */
    it.each([
      ["A assinatura eletronica nao e realizada com SMS Token."],
      ["A assinatura eletronica dispensa senha."],
      ["A autenticacao ocorre sem token."],
      ["Para a assinatura eletronica, o token nao e utilizado."],
    ])("sem acentuação: %s", (frase) => {
      expect(extrairMetodosDescritos(frase).estado).toBe(ESTADO_METODOS.NAO_LOCALIZADO_NO_MATERIAL);
    });

    it("negação de um método não derruba outro afirmado na mesma cláusula", () => {
      const r = extrairMetodosDescritos("A assinatura eletrônica dispensa senha e se dá pela coleta da biometria facial.");
      const codigos = r.metodos.map((m) => m.codigo);
      expect(codigos).toContain("BIOMETRIA");
      expect(codigos).not.toContain("SENHA");
    });

    it("canal negado não entra no rótulo", () => {
      const r = extrairMetodosDescritos("Para assinar, o cliente informa o token gerado no aplicativo, sem SMS.");
      expect(r.metodos[0].codigo).toBe("TOKEN");
      expect(r.metodos[0].canal).not.toBe("SMS");
    });
  });

  /**
   * SELFIE e SENHA entraram no catálogo por simetria com a regra antiga. O
   * Codex condicionou a manutenção do suporte a casos positivos e negativos
   * específicos, porque negativo por construção não demonstra suporte.
   */
  /**
   * O trecho impresso é a evidência. Cortar os primeiros 300 caracteres da
   * cláusula fazia o preâmbulo longo empurrar método e canal para fora da
   * janela: a classificação acertava e a evidência saía sem o que a sustentava.
   */
  describe("ancoragem do trecho em cláusula longa", () => {
    const longa = "Para formalizacao da contratacao, observadas as condicoes gerais do instrumento, "
      + "as caracteristicas financeiras da operacao e os elementos de identificacao apresentados pelo contratante, "
      + "mediante conferencia dos documentos disponibilizados durante a jornada e apos ciencia dos valores e prazos "
      + "estabelecidos na proposta, a assinatura eletronica utiliza codigo de autenticacao enviado via SMS";

    it("classifica o método e o canal", () => {
      const r = extrairMetodosDescritos(longa);
      expect(r.metodos[0].codigo).toBe("TOKEN");
      expect(r.metodos[0].canal).toBe("SMS");
    });

    it("o trecho impresso contém o método e o canal que sustentam a afirmação", () => {
      const { trecho } = extrairMetodosDescritos(longa).metodos[0];
      expect(trecho).toMatch(/codigo de autenticacao/i);
      expect(trecho).toMatch(/SMS/);
      expect(trecho).toMatch(/assinatura eletronica/i);
    });

    it("marca com reticências o contexto que não coube", () => {
      const { trecho } = extrairMetodosDescritos(longa).metodos[0];
      expect(trecho.startsWith("…")).toBe(true);
      expect(trecho.length).toBeLessThanOrEqual(320);
    });

    it("cláusula curta sai inteira, sem reticências", () => {
      const { trecho } = extrairMetodosDescritos("O aceite utiliza token de autenticação de uso único.").metodos[0];
      expect(trecho).not.toMatch(/…/);
    });
  });

  describe("SELFIE e SENHA", () => {
    it("positivo · selfie descrita como etapa da assinatura", () => {
      const r = extrairMetodosDescritos("Para concluir a assinatura eletrônica, o contratante envia uma selfie para validação de identidade.");
      const selfie = r.metodos.find((m) => m.codigo === "SELFIE");
      expect(selfie).toBeDefined();
      expect(selfie.trecho).toMatch(/selfie/i);
      expect(selfie.eixo).toBe("descrito_no_instrumento");
    });

    it("negativo · selfie em cláusula de comunicação não é método", () => {
      const r = extrairMetodosDescritos("Após o aceite, enviaremos avisos e a selfie cadastrada por e-mail.");
      expect(r.metodos.map((m) => m.codigo)).not.toContain("SELFIE");
    });

    it("positivo · senha descrita como etapa do aceite", () => {
      const r = extrairMetodosDescritos("O aceite é confirmado mediante digitação da senha pessoal do cliente.");
      const senha = r.metodos.find((m) => m.codigo === "SENHA");
      expect(senha).toBeDefined();
      expect(senha.trecho).toMatch(/senha/i);
    });

    it("negativo · senha citada em cláusula de segurança não é método do fluxo", () => {
      const r = extrairMetodosDescritos("O C6 não solicita sua senha por e-mail; desconfie de comunicações nesse sentido.");
      expect(r.metodos.map((m) => m.codigo)).not.toContain("SENHA");
    });
  });

  describe("caso positivo", () => {
    const frase = "O aceite utiliza token de autenticação de uso único.";

    it("token descrito como etapa do fluxo é preservado como método", () => {
      const r = extrairMetodosDescritos(frase);
      expect(r.estado).toBe(ESTADO_METODOS.LOCALIZADO);
      expect(r.metodos).toHaveLength(1);
      expect(r.metodos[0].codigo).toBe("TOKEN");
    });

    it("não infere SMS de token genérico", () => {
      const r = extrairMetodosDescritos(frase);
      expect(r.metodos[0].canal).toBeNull();
      expect(r.metodos[0].rotulo).not.toMatch(/SMS/i);
      expect(JSON.stringify(r.metodos)).not.toMatch(/SMS/i);
    });

    it("o método vem com o trecho que o sustenta e o eixo declarado", () => {
      const r = extrairMetodosDescritos(frase);
      expect(r.metodos[0].trecho).toMatch(/token de autenticação de uso único/i);
      expect(r.metodos[0].eixo).toBe("descrito_no_instrumento");
    });

    it("o canal só entra no rótulo quando o próprio trecho o nomeia", () => {
      const r = extrairMetodosDescritos("Para assinar, o cliente informa o token de uso único enviado por SMS.");
      expect(r.metodos[0].canal).toBe("SMS");
      expect(r.metodos[0].rotulo).toMatch(/SMS/);
    });
  });

  describe("método descrito x evento observado", () => {
    it("descrição e evento biométrico são preservados em eixos distintos", () => {
      const frase = "A assinatura eletrônica se dá pela coleta da biometria facial do contratante.";
      expect(extrairMetodosDescritos(frase).metodos.map((m) => m.codigo)).toContain("BIOMETRIA");
      const comEvento = extrairMetodosDescritos(frase, { biometriaRegistradaComoEvento: true });
      expect(comEvento.metodos.map((m) => m.codigo)).toContain("BIOMETRIA");
      expect(comEvento.metodos[0].rotulo).not.toMatch(/apenas/i);
    });
  });

  describe("regressão do dossiê C6", () => {
    it("o dossiê não contém a palavra token", () => {
      expect(dossieC6).not.toMatch(/\btoken\b/i);
    });

    it("não emite SMS Token em lugar nenhum da extração", () => {
      const extraido = heuristicExtractionFromText(dossieC6);
      expect(JSON.stringify(extraido.assinatura)).not.toMatch(/SMS\s*Token/i);
    });

    it("preserva a descrição biométrica apesar do evento também estar presente", () => {
      const extraido = heuristicExtractionFromText(dossieC6);
      expect(extraido.assinatura.metodos_descritos_estado).toBe(ESTADO_METODOS.LOCALIZADO);
      expect(extraido.assinatura.metodos_descritos_no_fluxo.map(m => m.codigo)).toContain("BIOMETRIA");
    });

    it("o campo legado ambíguo não existe mais", () => {
      const extraido = heuristicExtractionFromText(dossieC6);
      expect(extraido.assinatura.metodos_mencionados_clausulado).toBeUndefined();
    });
  });
});
