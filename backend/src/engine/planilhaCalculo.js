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
  const prazo = t.match(/Prazo[ \t]+Total[ \t]*:?[ \t]*(\d{1,4})[ \t]*(meses|m[eê]s|dias)/i);

  return {
    componentes,
    ...totais,
    numero_parcelas: parcelas,
    data_primeiro_vencimento: vencimentos?.[1] || null,
    data_ultimo_vencimento: vencimentos?.[2] || null,
    prazo_total_declarado: prazo
      ? { quantidade: Number(prazo[1]), unidade: /dia/i.test(prazo[2]) ? "dias" : "meses", texto: prazo[0].replace(/\s+/g, " ").trim() }
      : null,
  };
}
