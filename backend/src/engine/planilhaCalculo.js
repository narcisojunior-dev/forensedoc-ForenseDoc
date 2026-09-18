import { paginaDoIndice } from "./carimboProcessual.js";
import { normalizeMoney } from "./format.js";

/**
 * Planilha de cálculo da operação ("Características da operação e planilha de
 * cálculo"), lida por rótulo.
 *
 * ─── O defeito que motivou ───────────────────────────────────────────────────
 *
 * A composição do financiado era `liberado + IOF`. No dossiê C6 a planilha traz,
 * em linha própria, "Seguros(¹) R$ 218,64", e a soma correta fecha no centavo
 * com o valor total financiado. O laudo acusou divergência numa conta certa, ao
 * lado de um rótulo que dizia "liberado + IOF + seguro".
 *
 * ─── Rótulo na mesma linha ───────────────────────────────────────────────────
 *
 * A planilha tem duas colunas lado a lado ("Seguros(¹) R$ 218,64 10,75%  Venc.
 * 1ª e Última Parcela 01/10/2025 - 01/03/2026"). Cada valor é ancorado no próprio
 * rótulo, na mesma linha, e nunca por posição: o mesmo rótulo aparece solto no
 * clausulado ("o Valor Liberado será creditado") e ali não há valor.
 *
 * Componente não localizado fica `localizado: false`. Nunca vira zero: somar
 * zero no lugar de um componente que existe e não foi lido é exatamente o erro
 * que gerou a divergência falsa.
 */

const MOEDA = String.raw`R\$[ \t]*([\d.]+,\d{2})`;
const SEP = String.raw`[ \t]*:?[ \t]*`;

const COMPONENTES = {
  valor_liberado: { rotulo: "Valor Liberado", regex: new RegExp(String.raw`Valor[ \t]+Liberado(?![ \t]+(?:ao|ser))${SEP}${MOEDA}`, "i") },
  saldo_portado: { rotulo: "Saldo Portado / Refinanciado", regex: new RegExp(String.raw`Saldo[ \t]+(?:Portado|Refinanciado)(?:[ \t]*\/[ \t]*Refinanciado)?${SEP}${MOEDA}`, "i") },
  tarifa_cadastro: { rotulo: "Tarifa de Cadastro", regex: new RegExp(String.raw`Tarifa[ \t]+de[ \t]+Cadastro${SEP}${MOEDA}`, "i") },
  seguros: { rotulo: "Seguros", regex: new RegExp(String.raw`Seguros?(?:[ \t]*\((?:¹|1)\)|¹)?${SEP}${MOEDA}`, "i") },
  iof_financiado: { rotulo: "IOF (Financiado)", regex: new RegExp(String.raw`IOF[ \t]*\(?Financiado\)?${SEP}${MOEDA}`, "i") },
};

const TOTAIS = {
  valor_total_financiado: new RegExp(String.raw`Valor[ \t]+Total[ \t]+Financiado${SEP}${MOEDA}`, "i"),
  valor_total_ao_final: new RegExp(String.raw`Valor[ \t]+Total[ \t]+ao[ \t]+Final${SEP}${MOEDA}`, "i"),
  valor_parcela: new RegExp(String.raw`Valor[ \t]+da[ \t]+Parcela${SEP}(?:R\$[ \t]*)?([\d.]+,\d{2})`, "i"),
};

/**
 * @param {string} texto texto do documento (com quebras de página, se houver)
 * @returns {object|null} null quando o documento não tem planilha reconhecível
 */
export function extrairPlanilhaCalculo(texto) {
  const t = String(texto || "");
  const componentes = {};
  let localizados = 0;
  for (const [campo, { rotulo, regex }] of Object.entries(COMPONENTES)) {
    const m = t.match(regex);
    componentes[campo] = m
      ? { rotulo, valor: normalizeMoney(m[1]), localizado: true, pagina: paginaDoIndice(t, m.index) }
      : { rotulo, valor: null, localizado: false, pagina: null };
    if (m) localizados += 1;
  }

  const totais = {};
  for (const [campo, regex] of Object.entries(TOTAIS)) {
    const m = t.match(regex);
    totais[campo] = m ? normalizeMoney(m[1]) : null;
  }

  // Um valor liberado solto não é planilha. Exige o total financiado e pelo
  // menos mais um componente além do liberado.
  if (!totais.valor_total_financiado || localizados < 2) return null;

  const parcelas = t.match(/N[ºo°][ \t]*de[ \t]+Parcelas(?:[ \t]*\(mensais\))?[ \t]*:?[ \t]*(\d{1,3})\b/i)?.[1] || null;
  const vencimentos = t.match(/Venc\.?[ \t]*1[ªa][ \t]*e[ \t]*[ÚU]ltima[ \t]+Parcela[ \t]*:?[ \t]*(\d{2}\/\d{2}\/\d{4})[ \t]*-[ \t]*(\d{2}\/\d{2}\/\d{4})/i);
  /*
   * ─── D4 · prazo com ressalva escrita no mesmo campo ──────────────────────────
   *
   * O item 5.1 da CCB do dossiê C6 escreve o campo assim:
   *
   *     "Prazo Total: 6 meses ou até o pagamento da última parcela, o que
   *      acontecer por último"
   *
   * O padrão anterior terminava em `(meses|mês|dias)` e `prazo[0]` parava ali.
   * A ressalva, que está DENTRO do mesmo campo que o laudo leu, caía fora do
   * match antes de qualquer comparação, e a camada matemática recebia "6 meses"
   * como prazo fechado. O laudo então marcou "Diverge" contra um campo que nunca
   * afirmou prazo fechado.
   *
   * A extração passa a resolver o token completo antes de a camada matemática
   * comparar: o número, a unidade e o resto da cláusula até o fim da linha.
   */
  const prazo = t.match(/Prazo[ \t]+Total[ \t]*:?[ \t]*(\d{1,4})[ \t]*(meses|m[eê]s|dias)([^\n]*)/i);
  // A planilha é de duas colunas e o campo continua ALGUMAS LINHAS ABAIXO, na
  // mesma coluna, com linhas da outra coluna interleavadas no meio:
  //
  //     ...                                  Prazo Total:6 meses ou até o pagamento da última parcela, o
  //     IOF (Financiado)   R$ 36,07   1,77%
  //                                          que acontecer por último.
  //
  // Parar na quebra de linha cortava a ressalva ao meio. A continuação é
  // reconhecida pelo alinhamento: mesma coluna do rótulo, e nunca uma linha que
  // comece na coluna zero, que pertence à outra coluna do quadro.
  const ressalva = prazo ? continuarNaMesmaColuna(t, prazo) : "";
  // "ou até...", "o que ocorrer por último", "prorrogável", "no mínimo": o campo
  // condiciona o próprio prazo e não declara um valor fechado.
  const temExtensao = /\bou\s+at[ée]\b|o\s+que\s+(?:acontecer|ocorrer|vier)\s+por\s+[úu]ltimo|prorrog|renov|no\s+m[íi]nimo|at[ée]\s+o\s+pagamento/i.test(ressalva);

  return {
    componentes,
    ...totais,
    numero_parcelas: parcelas,
    data_primeiro_vencimento: vencimentos?.[1] || null,
    data_ultimo_vencimento: vencimentos?.[2] || null,
    prazo_total_declarado: prazo
      ? {
        quantidade: Number(prazo[1]),
        unidade: /dia/i.test(prazo[2]) ? "dias" : "meses",
        // O campo como o documento o escreve, com a continuação da outra linha:
        // é este texto que a ficha do laudo publica, e cortá-lo aqui repetiria
        // na apresentação o corte que o comparador fazia.
        // Rótulo, número e unidade, mais a ressalva completa. `prazo[0]` já
        // contém o começo da ressalva, então ele é cortado no fim da unidade
        // para não duplicá-la.
        texto: `${prazo[0].slice(0, prazo[0].length - (prazo[3] || "").length)} ${ressalva}`
          .replace(/\s+/g, " ")
          .trim(),
        // O token completo, com a ressalva, e o que ela significa para a
        // comparação. Quem compara precisa saber que o campo é condicional.
        ressalva: ressalva || null,
        condicional: temExtensao,
      }
      : null,
  };
}


/** Tolerância de recuo, em caracteres, para reconhecer a mesma coluna. */
const TOLERANCIA_COLUNA = 12;
/** Quantas linhas abaixo ainda podem conter a continuação do campo. */
const LINHAS_DE_CONTINUACAO = 4;

/**
 * Continuação de um campo em planilha de duas colunas.
 *
 * @param {string} texto texto completo
 * @param {RegExpMatchArray} match match do campo, com `index`
 * @returns {string} a ressalva completa, incluindo o que estava na primeira linha
 */
function continuarNaMesmaColuna(texto, match) {
  const inicioDaLinha = texto.lastIndexOf("\n", match.index) + 1;
  const coluna = match.index - inicioDaLinha;
  let acumulado = (match[3] || "").trim();

  // Nada após a unidade: o campo é só "6 meses" e está completo. Procurar
  // continuação aqui capturaria uma linha alheia que por acaso esteja alinhada.
  if (!acumulado) return "";
  // Ponto final na própria linha: o campo terminou ali.
  if (/[.;]$/.test(acumulado)) return acumulado;

  const restante = texto.slice(texto.indexOf("\n", match.index) + 1).split("\n");
  for (const linha of restante.slice(0, LINHAS_DE_CONTINUACAO)) {
    const recuo = linha.length - linha.trimStart().length;
    const conteudo = linha.trim();
    if (!conteudo) continue;
    // Linha da outra coluna do quadro: recuo menor que o do rótulo.
    if (recuo < coluna - TOLERANCIA_COLUNA) continue;
    // Rótulo novo com valor monetário ou percentual não é continuação de frase.
    if (/R\$\s*[\d.]+,\d{2}|\d+,\d{2}\s*%/.test(conteudo)) continue;
    // Um novo campo rotulado encerra o anterior.
    if (/^[A-ZÀ-Ý][^:]{2,40}:/.test(conteudo)) break;
    acumulado = `${acumulado} ${conteudo}`.replace(/\s+/g, " ").trim();
    if (/[.;]$/.test(acumulado)) break;
  }
  return acumulado;
}
