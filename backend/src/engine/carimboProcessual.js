/**
 * Carimbos de sistema processual (PJe, PROJUDI) que o tribunal imprime em cada
 * página dos autos.
 *
 * ─── Por que isto precisa sair do texto antes da extração ────────────────────
 *
 * No dossiê C6 homologado em 16/09/2026, todas as 27 páginas começam com
 * "28/10/2025: JUNTADA DE PETIÇÃO DE INICIAL". Nenhum padrão do extrator
 * reconhecia o rótulo "LOCAL E DATA DE EMISSÃO", a cascata caía na primeira data
 * do texto, e o laudo afirmou que o contrato era de 28/10/2025, a data da
 * juntada. Prazo, carência, CET implícito e o intervalo de proveniência foram
 * todos calculados sobre essa data.
 *
 * O carimbo não é lixo: diz quem juntou o documento, em que movimento e quando.
 * Por isso ele sai do pool contratual e vai para `metadadosProcessuais`.
 *
 * ─── Carimbo no meio da linha ────────────────────────────────────────────────
 *
 * Com `pdftotext -layout`, o PROJUDI imprime "Documento assinado digitalmente -
 * TJAM" e "Validação deste em ..." na margem direita, na MESMA linha de texto do
 * contrato. Apagar a linha inteira apagaria cláusula. Esses dois padrões removem
 * só o trecho que casa, a partir de um bloco longo de espaços.
 */

const PADROES_LINHA_INTEIRA = [
  // PJe
  /^Este documento foi gerado pelo usu[aá]rio\s+\S+(?:\s+\S+)*\s+em\s+\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}:\d{2}$/i,
  /^N[uú]mero do documento:\s*\d{20,}$/i,
  /^https:\/\/pje\.[^\s]+$/i,
  /^Assinado eletronicamente por:\s*.+\s+-\s+\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}:\d{2}$/i,
  /^Num\.\s*\d+\s*-\s*P[áa]g\.\s*\d+$/i,
  // PROJUDI
  /^PROJUDI\s+-\s+Processo:\s*[\d.\-]+\s+-\s+Ref\.\s*mov\.\s*[\d.]+\s+-\s+Assinado digitalmente por\s+.+$/i,
  /^\d{2}\/\d{2}\/\d{4}:\s*JUNTADA\s+DE\s+.+$/i,
  /^Documento assinado digitalmente\s+-\s+TJ[A-Z]{2}$/i,
  /^Valida[çc][ãa]o deste em\s+https?:\/\/\S*projudi\S*(?:\s+-\s+Identificador:\s*[A-Z0-9 ]+)?$/i,
];

// Carimbo na margem direita de uma linha que também tem texto do documento.
const PADROES_MARGEM = [
  /\s{8,}Documento assinado digitalmente\s+-\s+TJ[A-Z]{2}\s*$/i,
  /\s{8,}Valida[çc][ãa]o deste em\s+https?:\/\/\S*projudi\S*(?:\s+-\s+Identificador:\s*[A-Z0-9 ]+)?\s*$/i,
];

/**
 * Metadados do carimbo. Só o que o próprio carimbo afirma; nada é inferido.
 */
function lerMetadados(removidos) {
  const juntos = removidos.join("\n");
  const projudi = juntos.match(
    /PROJUDI\s+-\s+Processo:\s*([\d.\-]+)\s+-\s+Ref\.\s*mov\.\s*([\d.]+)\s+-\s+Assinado digitalmente por\s+([^\n]+)/i
  );
  const juntada = juntos.match(/(\d{2}\/\d{2}\/\d{4}):\s*(JUNTADA\s+DE\s+[^.\n]+?)\.?(?:\s+Arq:\s*([^\n]+))?$/im);
  const tribunal = juntos.match(/assinado digitalmente\s+-\s+(TJ[A-Z]{2})/i)?.[1]?.toUpperCase()
    || juntos.match(/projudi\.(tj[a-z]{2})\.jus\.br/i)?.[1]?.toUpperCase()
    || juntos.match(/pje\.(tj[a-z]{2}|trf\d)\.jus\.br/i)?.[1]?.toUpperCase()
    || null;
  const identificador = juntos.match(/Identificador:[ \t]*([A-Z0-9]{3,}(?:[ \t]+[A-Z0-9]{3,})*)/)?.[1]?.trim() || null;
  const pjeAssinatura = juntos.match(/Assinado eletronicamente por:\s*(.+?)\s+-\s+(\d{2}\/\d{2}\/\d{4})\s+\d{2}:\d{2}:\d{2}/i);
  const pjeNum = juntos.match(/Num\.\s*(\d+)\s*-\s*P[áa]g\./i)?.[1] || null;

  const sistema = projudi || /projudi/i.test(juntos) ? "PROJUDI" : removidos.length ? "PJe" : null;
  if (!sistema) return null;

  const datas = Array.from(new Set(juntos.match(/\b\d{2}\/\d{2}\/\d{4}\b/g) || []));
  const descricao = juntada?.[2]
    ? juntada[2].toLowerCase().replace(/^\w/, (c) => c.toUpperCase()).replace(/\binicial\b/i, "inicial")
    : null;

  return {
    sistema,
    tribunal,
    processo: projudi?.[1] || null,
    movimento: projudi?.[2] || pjeNum,
    descricao_movimento: descricao,
    arquivo_juntado: juntada?.[3]?.trim() || null,
    data_juntada: juntada?.[1] || pjeAssinatura?.[2] || null,
    juntado_por: projudi?.[3]?.trim() || pjeAssinatura?.[1]?.trim() || null,
    identificador_validacao: identificador,
    datas_do_carimbo: datas,
  };
}

/**
 * Separa carimbos processuais do texto do documento.
 *
 * Quebras de página (`\f`) são preservadas mesmo quando a linha que as carrega é
 * removida: a numeração de página é usada para citar a origem dos campos.
 *
 * @param {string} value texto extraído do PDF
 * @returns {{text: string, removed: string[], metadados: object|null}}
 */
export function separarCarimboProcessual(value) {
  const text = String(value || "");
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  const removed = [];
  const kept = [];

  for (const line of text.split(/\r?\n/)) {
    const quebras = (line.match(/\f/g) || []).join("");
    const trimmed = line.replace(/\f/g, "").trim();
    if (trimmed && PADROES_LINHA_INTEIRA.some((pattern) => pattern.test(trimmed))) {
      removed.push(trimmed);
      // A linha some, a quebra de página fica.
      if (quebras) kept.push(quebras);
      continue;
    }
    let linha = line;
    for (const pattern of PADROES_MARGEM) {
      const match = linha.match(pattern);
      if (match) {
        removed.push(match[0].trim());
        linha = linha.slice(0, match.index);
      }
    }
    kept.push(linha);
  }

  return { text: kept.join(newline), removed, metadados: lerMetadados(removed) };
}

/**
 * Número da página (1-based) de uma posição do texto, contando `\f`.
 * Texto sem quebra de página (OCR, pdf-parse) devolve null: sem página conhecida,
 * o laudo não inventa uma.
 */
export function paginaDoIndice(texto, indice) {
  const t = String(texto || "");
  if (!t.includes("\f") || !Number.isFinite(indice) || indice < 0) return null;
  return (t.slice(0, indice).match(/\f/g) || []).length + 1;
}
