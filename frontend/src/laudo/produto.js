/**
 * Modalidade do produto, do lado do laudo.
 *
 * Espelha `backend/src/engine/produto.js`, como já ocorre com `eixosAchado.js`
 * e `distancia.js`: o laudo é renderizado no navegador e não pode depender do
 * servidor para decidir quais campos existem na ficha.
 *
 * ─── D7 · ficha de INSS impressa em contrato celetista ───────────────────────
 *
 * O § 3 do laudo FD-20260917 imprimiu "Matrícula INSS", "Número do benefício" e
 * "Espécie do benefício", os três como não identificados, num contrato que o
 * próprio § 2 classificou como consignado CLT. Campo que não se aplica à
 * modalidade não é impresso como "não identificado", porque isso afirma uma
 * lacuna onde não há campo a preencher.
 */

const MODALIDADES_CONHECIDAS = new Set([
  "CONSIGNADO_CLT",
  "CONSIGNADO_INSS",
  "CONSIGNADO_SERVIDOR",
  "INDETERMINADO",
]);

/** Modalidades em que os campos de benefício previdenciário fazem sentido. */
const MODALIDADES_COM_BENEFICIO = new Set(["CONSIGNADO_INSS"]);

/**
 * A ficha de benefício previdenciário se aplica a esta modalidade?
 *
 * Modalidade indeterminada ou desconhecida mantém os campos: na dúvida, o laudo
 * mostra o que leu. A supressão vale para a modalidade afirmada que os exclui.
 *
 * @param {string|null|undefined} produtoCodigo `contrato.produto_codigo`
 * @returns {boolean}
 */
export function fichaBeneficioSeAplica(produtoCodigo) {
  const codigo = String(produtoCodigo || "").toUpperCase();
  if (!codigo || codigo === "INDETERMINADO") return true;
  if (!MODALIDADES_CONHECIDAS.has(codigo)) return true;
  return MODALIDADES_COM_BENEFICIO.has(codigo);
}

/**
 * D6 · rótulo com a origem do valor.
 *
 * O § 2 do laudo dava três campos como não identificados enquanto o § 2.1 os
 * calculava. Ligados os dois, ficou faltando o principal: dizer ao leitor qual
 * é qual. Extraído do instrumento e calculado pelo sistema não são a mesma
 * afirmação, e guardar a distinção só no JSON não a leva ao laudo.
 *
 * @param {string} rotulo
 * @param {string|null|undefined} origem `*_origem` do campo
 * @returns {string}
 */
export function marcarOrigem(rotulo, origem) {
  if (origem === "CALCULADO_PELO_SISTEMA") return `${rotulo} · calculado pelo sistema`;
  if (origem === "EXTRAIDO_DO_INSTRUMENTO") return `${rotulo} · extraído do instrumento`;
  return rotulo;
}
