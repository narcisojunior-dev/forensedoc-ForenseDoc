/**
 * Conclusão do § 2.1 redigida a partir dos vereditos da aferição matemática.
 *
 * ─── O defeito que motivou (MED-06 da rodada 2) ─────────────────────────────
 *
 * O texto era binário: todos os itens conferindo davam a frase de consistência,
 * qualquer outro caso dava "encontrou pontos que exigem conferência manual".
 * No dossiê C6 todos os itens conferiam, exceto o prazo total declarado, e o
 * laudo encerrava o quadro com uma frase genérica que contradizia o próprio
 * quadro. A conclusão agora nomeia o que confere, o que diverge e o que não foi
 * aferido, com o motivo.
 */

const CONSISTENTE =
  "Não se identificou inconsistência aritmética entre a taxa de juros declarada, o valor financiado, o número e o valor das parcelas, o somatório e o Custo Efetivo Total informado. As irregularidades apontadas neste laudo são de natureza formal e informacional, não de cálculo.";

const veredito = (valor) => (valor === true ? "CONFERE" : valor === false ? "DIVERGE" : "NAO_AFERIDO");

/** Itens do quadro, na ordem em que o § 2.1 os exibe. */
function itensDaAfericao(m) {
  const cet = m.cet_implicito_veredito === "Confere" ? true : m.cet_implicito_veredito === "NÃO CONFERE" ? false : null;
  return [
    { nome: "prazo total declarado", estado: veredito(m.prazo_confere), detalhe: m.prazo_descricao, motivo: "prazo declarado ou último vencimento não localizado" },
    { nome: "somatório das parcelas", estado: veredito(m.somatorio_confere), detalhe: m.somatorio_calculado && m.somatorio_declarado ? `calculado ${m.somatorio_calculado}, declarado ${m.somatorio_declarado}` : null, motivo: "somatório declarado, número ou valor das parcelas não localizado" },
    { nome: "composição do valor financiado", estado: veredito(m.composicao_confere), detalhe: m.composicao_financiado_calculada ? `calculado ${m.composicao_financiado_calculada}` : null, motivo: "componentes do financiado não localizados" },
    { nome: "valor presente pela taxa declarada", estado: veredito(m.vp_confere), detalhe: m.vp_taxa_declarada ? `calculado ${m.vp_taxa_declarada}` : null, motivo: "taxa, vencimentos ou valor financiado não localizados" },
    { nome: "CET implícito no fluxo", estado: veredito(cet), detalhe: m.cet_implicito_mensal ? `${m.cet_implicito_mensal} ao mês` : null, motivo: m.cet_implicito_motivo || "CET declarado ou fluxo de parcelas não localizado" },
    { nome: "anualização do CET", estado: veredito(m.cet_anual_confere), detalhe: m.cet_anual_calculado ? `calculado ${m.cet_anual_calculado} em 365 dias` : null, motivo: "CET anual declarado não localizado" },
    { nome: "relação entre CET e taxa de juros", estado: veredito(m.cet_maior_que_juros), detalhe: m.cet_maior_que_juros === false ? "CET declarado não supera a taxa de juros" : null, motivo: "CET ou taxa de juros não localizados" },
  ];
}

const comDetalhe = (item) => (item.detalhe ? `${item.nome} (${item.detalhe})` : item.nome);

function juntar(lista) {
  if (lista.length <= 1) return lista.join("");
  return `${lista.slice(0, -1).join("; ")} e ${lista.at(-1)}`;
}

/**
 * @param {object} m resultado de `buildMathAudit`
 * @returns {string}
 */
export function redigirConclusaoAfericao(m = {}) {
  const itens = itensDaAfericao(m);
  const confere = itens.filter((i) => i.estado === "CONFERE");
  const diverge = itens.filter((i) => i.estado === "DIVERGE");
  const naoAferido = itens.filter((i) => i.estado === "NAO_AFERIDO");

  const frasesNaoAferido = naoAferido.length
    ? ` Não foram aferidos: ${juntar(naoAferido.map((i) => `${i.nome} (${i.motivo})`))}.`
    : "";

  if (!confere.length && !diverge.length) {
    return `A aferição matemática não pôde ser realizada com os dados localizados no instrumento.${frasesNaoAferido}`;
  }
  if (!diverge.length && !naoAferido.length) return CONSISTENTE;
  if (!diverge.length) {
    return `A aferição matemática confere em todos os itens aferidos: ${juntar(confere.map((i) => i.nome))}.${frasesNaoAferido}`;
  }
  if (diverge.length === 1 && diverge[0].nome === "prazo total declarado" && confere.length) {
    return `A aferição financeira confere em todos os pontos aferidos, exceto no prazo total declarado${diverge[0].detalhe ? `: ${diverge[0].detalhe}` : ""}.${frasesNaoAferido}`;
  }
  const frasesConfere = confere.length ? ` Conferem: ${juntar(confere.map((i) => i.nome))}.` : "";
  return `A aferição matemática diverge em ${diverge.length === 1 ? "um item" : `${diverge.length} itens`}: ${juntar(diverge.map(comDetalhe))}.${frasesConfere}${frasesNaoAferido} Os itens divergentes exigem conferência manual antes de conclusão sobre a consistência financeira.`;
}
