import { describe, it, expect } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { heuristicExtractionFromText } from "../src/services/extractionService.js";
import { lerCaminho } from "../src/services/fieldReview.js";

/**
 * Corpus de regressão da extração.
 *
 * ─── O que este teste resolve, e o que não resolve ───────────────────────────
 *
 * A extração é heurística sobre texto de bancos que escrevem cada um de um
 * jeito. Não existe regex que cubra o formato que ainda não apareceu, e este
 * teste não tenta. Ele garante o outro lado: que o formato JÁ VISTO nunca mais
 * quebre.
 *
 * A necessidade veio de um caso concreto. Três documentos revelaram quatro
 * defeitos, e o quarto foi INTRODUZIDO pela correção do terceiro: exigir caixa
 * alta no nome consertou o contrato do PAN e quebrou o dossiê de trilha, que
 * escreve em Title Case. Só apareceu porque um terceiro documento entrou no
 * teste. Enquanto o corpus for um documento, cada correção tem chance de
 * quebrar um formato que ninguém está olhando.
 *
 * ─── Por que os documentos não estão aqui ────────────────────────────────────
 *
 * Os originais são dossiês reais, com CPF, endereço e telefone de terceiros que
 * não são clientes do sistema. O que está versionado é o texto ANONIMIZADO com
 * preservação de formato (ver `corpus/anonimizar.mjs` e `corpus/README.md`),
 * porque todos os defeitos encontrados foram sensíveis à forma, não ao conteúdo.
 *
 * ─── Acrescentar documento é acrescentar um JSON ─────────────────────────────
 *
 * Nenhum código novo. É essa propriedade que faz o corpus crescer de fato: se
 * cada documento exigisse um teste escrito à mão, ele pararia de crescer no
 * terceiro.
 */

const DIRETORIO = path.join(path.dirname(fileURLToPath(import.meta.url)), "corpus/casos");

const arquivos = (await readdir(DIRETORIO)).filter((nome) => nome.endsWith(".json"));
const casos = await Promise.all(
  arquivos.map(async (nome) => ({
    nome,
    ...JSON.parse(await readFile(path.join(DIRETORIO, nome), "utf8")),
  }))
);

describe("corpus de regressão", () => {
  it("existe pelo menos um caso, e o teste não está passando por estar vazio", () => {
    // Sem esta asserção, apagar a pasta de casos deixaria a suíte VERDE, que é o
    // pior resultado possível: a proteção some e nada avisa.
    expect(casos.length).toBeGreaterThan(0);
  });

  describe.each(casos)("$nome", (caso) => {
    const extraido = heuristicExtractionFromText(caso.texto);

    it.each(Object.entries(caso.esperado || {}))("extrai %s", (caminho, esperado) => {
      expect(lerCaminho(extraido, caminho)).toStrictEqual(esperado);
    });

    it("não reintroduz o defeito que motivou este caso", () => {
      for (const [caminho, proibidos] of Object.entries(caso.proibido || {})) {
        expect(proibidos).not.toContain(lerCaminho(extraido, caminho) ?? null);
      }
    });

    it("o texto versionado não carrega dado pessoal com formato reconhecível", () => {
      /*
       * Segunda barreira, e deliberadamente redundante com a ferramenta de
       * anonimização.
       *
       * A ferramenta é rodada uma vez, na geração; este teste roda em toda
       * suíte, inclusive sobre um caso que alguém tenha escrito à mão ou colado
       * de outro lugar sem passar por ela. Um CPF real dentro do repositório é
       * incidente de proteção de dados, não bug, e o custo de conferir de novo é
       * de milissegundos.
       *
       * Os CPFs de teste conhecidos são liberados: eles PRECISAM estar aqui,
       * porque a validação de dígito verificador faz parte do que se testa.
       */
      const CPFS_FICTICIOS = ["111.444.777-35", "11144477735", "222.555.888-46"];
      const cpfs = (caso.texto.match(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g) || []).filter(
        (cpf) => !CPFS_FICTICIOS.includes(cpf)
      );
      expect(cpfs).toEqual([]);
    });
  });
});
