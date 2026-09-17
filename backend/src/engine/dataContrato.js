import { paginaDoIndice } from "./carimboProcessual.js";

/**
 * Data do contrato por RÓTULO, com registro de todas as candidatas.
 *
 * A versão anterior aceitava a primeira data do texto quando nenhum rótulo
 * conhecido casava. No dossiê C6 essa data era a da juntada nos autos, impressa
 * no topo de todas as páginas, e o laudo informou ao juízo uma data de
 * contratação quatro meses posterior à real.
 *
 * Regras:
 *   1. rótulo antes de posição: a data só é "do contrato" se algo no documento
 *      disser isso;
 *   2. todas as candidatas rotuladas ficam registradas; se discordarem, o laudo
 *      avisa em vez de escolher em silêncio;
 *   3. data sem rótulo continua sendo último recurso, mas nunca uma data de
 *      carimbo processual, e sempre com confiança baixa.
 */

// Ordem = prioridade. Janela de uma linha extra para rótulo em cabeçalho de
// tabela com o valor na linha de baixo ("Local e data" / "Manaquiri - AM - ...").
const ROTULOS = [
  { rotulo: "LOCAL E DATA DE EMISSÃO", regex: /LOCAL\s+E\s+DATA\s+DE\s+EMISS[ÃA]O\s*:?[^\d\n]{0,80}?(\d{2}\/\d{2}\/\d{4})/gi },
  { rotulo: "Data de emissão", regex: /\bData\s+(?:de\s+)?emiss[ãa]o\s*[:\-]?\s*(\d{2}\/\d{2}\/\d{4})/gi },
  { rotulo: "Data da contratação", regex: /\bData\s+da\s+contrata[çc][ãa]o\s*[:\-]?\s*(\d{2}\/\d{2}\/\d{4})/gi },
  {
    rotulo: "Local e data",
    regex: /\bLocal\s+e\s+data(?!\s+(?:de\s+emiss|retro))(?:\s+da\s+proposta)?[^\d\n]{0,160}(?:\n[^\d\n]{0,160}?)?(\d{2}\/\d{2}\/\d{4})/gi,
  },
  { rotulo: "Data do contrato", regex: /\bData\s+do\s+contrato\s*[:\-]?\s*(\d{2}\/\d{2}\/\d{4})/gi },
  { rotulo: "Emitida em", regex: /\bEmitid[ao]\s+em\s*[:\-]?\s*(\d{2}\/\d{2}\/\d{4})/gi },
];

/**
 * @param {string} texto texto do documento, já sem carimbo processual
 * @param {object} opts
 * @param {Array<{valor:string, rotulo:string}>} [opts.prioritarias] datas lidas
 *   por layout dedicado de banco, que continuam valendo antes dos rótulos genéricos
 * @param {string[]} [opts.datasProcessuais] datas do carimbo do tribunal
 * @param {string[]} [opts.datasSemRotulo] candidatas por posição (último recurso)
 * @param {string[]} [opts.datasExcluidas] ex.: data de nascimento
 * @returns {{valor: string|null, rotulo: string|null, pagina: number|null, origem: string|null,
 *   confianca: "ALTA"|"BAIXA"|null, candidatos: object[], alertas: object[]}}
 */
export function extrairDataContrato(texto, {
  prioritarias = [],
  datasProcessuais = [],
  datasSemRotulo = [],
  datasExcluidas = [],
} = {}) {
  const t = String(texto || "");
  const processuais = new Set(datasProcessuais.filter(Boolean));
  const excluidas = new Set(datasExcluidas.filter(Boolean));
  const candidatos = [];

  for (const { valor, rotulo } of prioritarias) {
    if (valor) candidatos.push({ valor, rotulo, pagina: null, fonte: "layout dedicado" });
  }
  for (const { rotulo, regex } of ROTULOS) {
    for (const match of t.matchAll(regex)) {
      const indiceData = match.index + match[0].lastIndexOf(match[1]);
      candidatos.push({ valor: match[1], rotulo, pagina: paginaDoIndice(t, indiceData), fonte: "rótulo" });
    }
  }

  const alertas = [];
  const rotulados = candidatos.filter((c) => !excluidas.has(c.valor));
  const distintos = Array.from(new Set(rotulados.map((c) => c.valor)));
  if (distintos.length > 1) {
    alertas.push({
      codigo: "DAT1",
      gravidade: "MÉDIA",
      titulo: "Datas de contratação divergentes no instrumento",
      texto: `O documento traz datas diferentes sob rótulos de data da contratação: ${rotulados
        .map((c) => `${c.valor} (${c.rotulo}${c.pagina ? `, pág. ${c.pagina}` : ""})`)
        .join("; ")}. Este laudo adotou ${rotulados[0].valor}, do rótulo de maior prioridade. A data efetiva deve ser confirmada no instrumento.`,
    });
  }

  let escolhido = rotulados[0] || null;
  let confianca = escolhido ? "ALTA" : null;

  if (!escolhido) {
    const semRotulo = datasSemRotulo.find((d) => d && !processuais.has(d) && !excluidas.has(d));
    if (semRotulo) {
      escolhido = { valor: semRotulo, rotulo: null, pagina: null, fonte: "posição no texto" };
      confianca = "BAIXA";
    }
  }

  if (escolhido && processuais.has(escolhido.valor)) {
    confianca = "BAIXA";
    alertas.push({
      codigo: "DAT2",
      gravidade: "MÉDIA",
      titulo: "Data do contrato coincide com data do carimbo processual",
      texto: `A data adotada como data do contrato (${escolhido.valor}) é a mesma do carimbo do sistema processual impresso sobre o documento. Ela pode ser a data da juntada nos autos, e não a da contratação; confira o instrumento.`,
    });
  }

  const origem = escolhido
    ? escolhido.rotulo
      ? `rótulo "${escolhido.rotulo}"${escolhido.pagina ? `, pág. ${escolhido.pagina}` : ""}`
      : "primeira data do texto sem rótulo de contratação"
    : null;

  return {
    valor: escolhido?.valor || null,
    rotulo: escolhido?.rotulo || null,
    pagina: escolhido?.pagina || null,
    origem,
    confianca,
    candidatos,
    alertas,
  };
}
