/**
 * Leitura de formulários em colunas, a partir do texto com `pdftotext -layout`.
 *
 * Propostas de seguro e quadros de dados trazem o rótulo numa linha e o valor na
 * de baixo, na mesma coluna. O texto corrido perde essa associação; aqui ela é
 * recuperada pela posição de cada bloco na linha.
 */

/** Blocos de texto separados por dois ou mais espaços, com a coluna inicial. */
export function blocosDaLinha(linha) {
  return Array.from(String(linha || "").matchAll(/\S+(?: \S+)*/g), (m) => ({ texto: m[0], inicio: m.index, fim: m.index + m[0].length }));
}

/**
 * Valor escrito abaixo de um rótulo de coluna.
 *
 * @param {string} texto
 * @param {RegExp} rotulo rótulo, sem flag global
 * @param {object} [opts]
 * @param {number} [opts.maxLinhas] linhas em branco toleradas entre rótulo e valor
 * @returns {string|null}
 */
export function valorAbaixoDoRotulo(texto, rotulo, { maxLinhas = 6 } = {}) {
  const linhas = String(texto || "").split(/\r?\n/);
  for (let i = 0; i < linhas.length - 1; i += 1) {
    const m = linhas[i].match(rotulo);
    if (!m) continue;
    const cabecalho = blocosDaLinha(linhas[i]);
    const indice = cabecalho.findIndex((b) => m.index >= b.inicio && m.index < b.fim);
    if (indice < 0) continue;
    const coluna = cabecalho[indice];
    const proxima = cabecalho[indice + 1]?.inicio ?? Infinity;
    const anterior = cabecalho[indice - 1]?.fim ?? -Infinity;
    let j = i + 1;
    while (j < linhas.length && !linhas[j].replace(/\f/g, "").trim()) j += 1;
    if (j >= linhas.length || j - i > maxLinhas) continue;
    const valor = blocosDaLinha(linhas[j]).find((b) => b.inicio >= Math.max(anterior, coluna.inicio - 6) && b.inicio < proxima - 1);
    return valor ? valor.texto.trim() : null;
  }
  return null;
}
