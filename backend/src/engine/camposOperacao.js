/**
 * Tipo de operação, operação portada e modalidade de desconto lidos do quadro
 * da operação quando o layout não traz campo dedicado.
 *
 * ─── O defeito que motivou (MED-04 da rodada 2) ─────────────────────────────
 *
 * No dossiê C6 os três campos saíam "Não identificado" embora a pág. 3 os
 * declare: item 5.5 com "[ X ] Livre Utilização" e as outras finalidades
 * desmarcadas, item 5.1 com "Saldo Portado / Refinanciado R$ 0,00" e os campos
 * (i), (ii) e (iii) da operação original em branco, e item 7.1 com desconto em
 * folha de pagamento. Os padrões existentes só liam Bradesco, BB e Agibank.
 */

import { stripDiacritics } from "./format.js";

const OPCOES_FINALIDADE = [
  { rotulo: "Livre utilização", regex: /^livre\s+utiliza/i, portada: false },
  { rotulo: "Portabilidade de crédito", regex: /^portabilidade/i, portada: true },
  { rotulo: "Refinanciamento de dívida", regex: /^refinanciamento/i, portada: true },
];

/**
 * Caixas de seleção da finalidade do crédito ("[ X ] Livre Utilização").
 * O PDF em colunas quebra rótulos ("Refinanciamento de" / "Dívida"), por isso a
 * opção é reconhecida pelo início do rótulo.
 */
export function lerFinalidadeMarcada(texto) {
  const t = String(texto || "");
  const ancora = t.search(/FINALIDADE\s+DO\s+CR[ÉE]DITO/i);
  if (ancora < 0) return null;
  const trecho = t.slice(Math.max(0, ancora - 300), ancora + 400);
  const caixas = [...trecho.matchAll(/\[\s*([Xx])?\s*\]\s*([A-Za-zÀ-ú][^\[\n]{2,40})/g)];
  const opcoes = caixas
    .map((m) => ({ marcada: Boolean(m[1]), opcao: OPCOES_FINALIDADE.find((o) => o.regex.test(m[2].trim())) }))
    .filter((c) => c.opcao);
  const marcadas = opcoes.filter((c) => c.marcada);
  if (marcadas.length !== 1) return null;
  return {
    rotulo: marcadas[0].opcao.rotulo,
    portada: marcadas[0].opcao.portada,
    desmarcadas: opcoes.filter((c) => !c.marcada).map((c) => c.opcao.rotulo),
  };
}

/** Campos (i), (ii) e (iii) da operação original: true quando algum traz valor. */
function operacaoOriginalPreenchida(texto) {
  const t = String(texto || "");
  const campos = [
    /\(i\)[ \t]*Contrato[ \t]*\/[ \t]*Opera[çc][ãa]o[ \t]+Original[ \t]*:?([^\n]*)/i,
    /\(ii\)[ \t]*Credor[ \t]+Original[ \t]*:?([^\n]*)/i,
    /\(iii\)[ \t]*Saldo[ \t]+Devedor(?:[ \t]*\(estimado\))?[ \t]*:?([^\n]*)/i,
  ];
  const valores = campos.map((re) => t.match(re));
  if (valores.some((m) => !m)) return null;
  return valores.some((m) => {
    const v = m[1].replace(/R\$|[_.\-\s]/g, "").replace(/^0+,?0*$/, "");
    return v.length > 0;
  });
}

const zerado = (valor) => valor !== null && valor !== undefined && /^R?\$?\s*0+(?:[.,]0+)?$/.test(String(valor).replace(/\s/g, ""));
const positivo = (valor) => valor !== null && valor !== undefined && !zerado(valor) && /\d/.test(String(valor));

/**
 * @param {string} texto texto do documento
 * @param {{produtoCodigo?: string, saldoPortado?: string|null}} contexto
 */
export function extrairCamposOperacao(texto, { produtoCodigo = null, saldoPortado = null } = {}) {
  const finalidade = lerFinalidadeMarcada(texto);
  const originalPreenchida = operacaoOriginalPreenchida(texto);

  let operacaoPortada = null;
  if (positivo(saldoPortado) || originalPreenchida === true) operacaoPortada = true;
  else if (zerado(saldoPortado) && originalPreenchida === false) operacaoPortada = false;
  else if (finalidade && originalPreenchida !== true && !positivo(saldoPortado)) operacaoPortada = finalidade.portada ? null : false;

  const flat = stripDiacritics(String(texto || "")).replace(/\s+/g, " ");
  const descontoEmFolha = /descontad[ao]s?\s+(?:diretamente\s+)?(?:da|na|em)\s+(?:sua\s+)?folha\s+de\s+pagamento|desconto\s+em\s+folha\s+de\s+pagamento/i.test(flat);
  let modalidade = null;
  if (descontoEmFolha && ["CONSIGNADO_CLT", "CONSIGNADO_SERVIDOR"].includes(produtoCodigo)) {
    modalidade = "Folha de pagamento, por consignação";
  } else if (produtoCodigo === "CONSIGNADO_INSS") {
    modalidade = "Benefício previdenciário";
  }

  return {
    tipo_operacao: finalidade?.rotulo || null,
    tipo_operacao_desmarcadas: finalidade?.desmarcadas || null,
    operacao_portada: operacaoPortada,
    modalidade_desconto_provavel: modalidade,
  };
}
