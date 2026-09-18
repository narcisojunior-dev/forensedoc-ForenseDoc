/**
 * Classificação do produto de crédito consignado, antes de escolher marco
 * normativo e regras de achado.
 *
 * ─── O defeito que motivou ───────────────────────────────────────────────────
 *
 * O laudo do dossiê C6 apontou "benefício previdenciário não identificado" e
 * citou a Lei 8.213/1991 numa operação de consignado do trabalhador celetista.
 * O gatilho era a palavra "consignado" isolada, e o dossiê ainda traz a nota
 * "informações ratificadas pelo INSS/Dataprev" no rodapé da pág. 1. Em juízo o
 * banco responderia que não há benefício porque não há INSS, e o achado cairia
 * junto com a credibilidade do resto do laudo.
 *
 * ─── Pontuação por marcadores ────────────────────────────────────────────────
 *
 * Marcador estrutural (campo do quadro da operação, rodapé de versão das
 * condições gerais, garantia típica do produto) pesa mais que menção solta no
 * clausulado. Uma nota de rodapé citando o INSS não pode, sozinha, vencer cinco
 * marcadores independentes de CLT.
 */

const MARCADORES = {
  CONSIGNADO_CLT: [
    { regex: /INSTITUI[ÇC][ÃA]O\s+CONSIGNANTE\s*\/\s*EMPREGADOR/i, peso: 3, nome: "campo instituição consignante/empregador" },
    { regex: /\bCONSIG\s+TRAB\b/i, peso: 3, nome: "código CONSIG TRAB" },
    { regex: /\bCG\s+CLTv?[\d.]+/i, peso: 3, nome: "condições gerais CLT" },
    { regex: /verbas\s+rescis[óo]rias/i, peso: 2, nome: "garantia sobre verbas rescisórias" },
    { regex: /saldo\s+(?:da\s+conta\s+vinculada\s+)?(?:do\s+)?FGTS/i, peso: 2, nome: "garantia sobre saldo do FGTS" },
    { regex: /dados\s+do\s+trabalhador\s+na\s+Dataprev/i, peso: 2, nome: "consulta de dados do trabalhador na Dataprev" },
    { regex: /Minist[ée]rio\s+do\s+Trabalho|\bMTE\b/i, peso: 1, nome: "Ministério do Trabalho" },
    { regex: /v[íi]nculo\s+empregat[íi]cio|empregados?\s+regidos?\s+pela\s+CLT/i, peso: 1, nome: "vínculo empregatício" },
    { regex: /desconto\s+em\s+folha\s+de\s+pagamento|folha\s+de\s+pagamento/i, peso: 1, nome: "folha de pagamento" },
  ],
  CONSIGNADO_INSS: [
    { regex: /\bHISCR?E\b|\bHISCON\b/i, peso: 3, nome: "extrato HISCRE/HISCON" },
    { regex: /esp[ée]cie\s+(?:do\s+)?benef[íi]cio/i, peso: 3, nome: "espécie do benefício" },
    { regex: /\bN[ºo°]?\s*(?:do\s+)?benef[íi]cio\s*[:\-]?\s*\d{6,}/i, peso: 3, nome: "número do benefício" },
    { regex: /\bNB\s*[:\-]?\s*\d{6,}/i, peso: 3, nome: "NB" },
    { regex: /\bDIB\b/i, peso: 2, nome: "DIB" },
    { regex: /aposentad[oa]|pensionista/i, peso: 1, nome: "aposentado/pensionista" },
    { regex: /\bINSS\b/i, peso: 1, nome: "menção ao INSS" },
  ],
  CONSIGNADO_SERVIDOR: [
    { regex: /servidor(?:es)?\s+p[úu]blico/i, peso: 2, nome: "servidor público" },
    { regex: /[óo]rg[ãa]o\s+(?:consignante|pagador)/i, peso: 2, nome: "órgão consignante" },
    { regex: /\bSIAPE\b/i, peso: 3, nome: "SIAPE" },
  ],
};

const ROTULOS = {
  CONSIGNADO_CLT: "Crédito consignado do trabalhador (CLT)",
  CONSIGNADO_INSS: "Crédito consignado em benefício do INSS",
  CONSIGNADO_SERVIDOR: "Crédito consignado de servidor público",
  INDETERMINADO: null,
};

/**
 * @param {string} flat texto do documento
 * @returns {{codigo: string, rotulo: string|null, marcadores: string[], pontuacao: object, confianca: "ALTA"|"BAIXA"}}
 */
export function classificarProduto(flat) {
  const texto = String(flat || "");
  // Campos preenchidos da operação prevalecem sobre cláusulas genéricas de
  // folha, FGTS ou rescisão que também constam em modelos usados pelo INSS.
  const plano = texto.replace(/\s+/g, " ");
  const fonteInss = /Nome\s+do\s+Empregador[^\n]{0,120}Consignante[\s\S]{0,150}?\bINSS\b/i.test(texto)
    || /(?:Fonte\s+Pagadora|Nome\s+do\s+Empregador)[^\n]{0,150}\n[^\n]{0,100}\bINSS\b/i.test(texto)
    || /CONV[EÊ]NIO:[^\n]{0,100}\([xX]\)\s*INSS/i.test(texto)
    || /(?:Fonte\s+Pagadora(?:\s*\(Conv[eê]nio\))?(?:\s*\/\s*[ÓO]rg[ãa]o\s+pagador)?|Empregador\s*\(Nome\s+da\s+Fonte\s+Pagadora\))\s*:?\s*(?:CNPJ\/MF\s*)?(?:MFACIL\s+CONSIG\s+)?INSS\b/i.test(plano)
    || /(?:Nome\s+do\s+Empregador[^\n]{0,100}\n)[^\n]{0,80}\bINSS\b/i.test(texto)
    || /Ente\s+Consignante\)\s*:\s*INSTITUTO\s+NACIONAL\s+DO\s+SEGURO\s+SOCIAL/i.test(plano)
    || /(?:Contrato\s+de\s+Empr[eé]stimo\s+Pessoal\s*-\s*Consignado\s*-\s*INSS|Consigna[cç][aã]o\s+e\/ou\s+Reten[cç][aã]o\s*-\s*INSS)/i.test(plano);
  const fonteClt = /\bCONSIG\s+TRAB\b|\bCG[.\s]*CLTv?[\d.]+/i.test(plano);
  if (fonteInss && !fonteClt) return {codigo:"CONSIGNADO_INSS", rotulo:ROTULOS.CONSIGNADO_INSS, marcadores:["fonte pagadora ou título do instrumento: INSS"], pontuacao:{CONSIGNADO_INSS:10}, confianca:"ALTA"};
  const pontuacao = {};
  const encontrados = {};
  for (const [codigo, lista] of Object.entries(MARCADORES)) {
    pontuacao[codigo] = 0;
    encontrados[codigo] = [];
    for (const { regex, peso, nome } of lista) {
      if (regex.test(texto)) {
        pontuacao[codigo] += peso;
        encontrados[codigo].push(nome);
      }
    }
  }

  if (!fonteClt && !/INSTITUI[ÇC][ÃA]O\s+CONSIGNANTE\s*\/\s*EMPREGADOR/i.test(plano)) pontuacao.CONSIGNADO_CLT = 0;
  const ordenados = Object.entries(pontuacao).sort((a, b) => b[1] - a[1]);
  const [primeiro, segundo] = ordenados;
  // Abaixo de 3 pontos não há marcador estrutural nenhum: melhor não classificar.
  if (!primeiro || primeiro[1] < 3) {
    return { codigo: "INDETERMINADO", rotulo: null, marcadores: [], pontuacao, confianca: "BAIXA" };
  }
  const margem = primeiro[1] - (segundo?.[1] || 0);
  return {
    codigo: primeiro[0],
    rotulo: ROTULOS[primeiro[0]],
    marcadores: encontrados[primeiro[0]],
    pontuacao,
    confianca: margem >= 3 ? "ALTA" : "BAIXA",
  };
}

/**
 * Empregador declarado no quadro da operação ("INSTITUIÇÃO CONSIGNANTE /
 * EMPREGADOR: 000007 - CONSIG TRAB").
 *
 * No consignado CLT é o empregador quem desconta a parcela em folha. Um código
 * genérico sem razão social nem CNPJ não identifica quem faria o desconto.
 */
export function extrairEmpregador(texto) {
  const t = String(texto || "");
  const m = t.match(/INSTITUI[ÇC][ÃA]O\s+CONSIGNANTE\s*\/\s*EMPREGADOR\s*:?[ \t]*([^\n]{2,120})/i);
  if (!m) return null;
  const bruto = m[1].replace(/\s{2,}.*$/, "").trim();
  const codigo = bruto.match(/^(\d{3,})\s*-?\s*/)?.[1] || null;
  const nome = bruto.replace(/^\d{3,}\s*-?\s*/, "").trim() || null;
  // Só o CNPJ da própria linha: o mais próximo abaixo costuma ser o do
  // correspondente ou do credor.
  const cnpj = bruto.match(/\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/)?.[0] || null;
  const generico = !cnpj && (!nome || /^CONSIG(?:NADO)?\s+TRAB(?:ALHADOR)?$/i.test(nome) || nome.length < 6);
  return { literal: bruto, codigo, nome, cnpj, identificado: !generico };
}

/*
 * ─── D7 · ficha de INSS impressa em contrato celetista ───────────────────────
 *
 * O § 3 do laudo FD-20260917 imprimiu "Matrícula INSS", "Número do benefício" e
 * "Espécie do benefício", os três como não identificados, num contrato que o
 * próprio § 2 classificou como consignado CLT e cujas condições gerais trazem o
 * rodapé CG.CLTv1.20250420.
 *
 * Não muda conclusão nenhuma, e é por isso que incomoda: é o tipo de descuido
 * que faz o juiz duvidar do cuidado do resto. Campo que não se aplica à
 * modalidade não é impresso como "não identificado", porque isso afirma uma
 * lacuna onde não há campo a preencher.
 */

/** Modalidades em que os campos de benefício previdenciário fazem sentido. */
const MODALIDADES_COM_BENEFICIO = new Set(["CONSIGNADO_INSS"]);

/**
 * A ficha de benefício previdenciário se aplica a esta modalidade?
 *
 * Modalidade indeterminada mantém os campos: na dúvida, o laudo mostra o que
 * leu. A supressão vale para a modalidade afirmada que os exclui.
 *
 * @param {string|null|undefined} produtoCodigo `contrato.produto_codigo`
 * @returns {boolean}
 */
export function fichaBeneficioSeAplica(produtoCodigo) {
  const codigo = String(produtoCodigo || "").toUpperCase();
  if (!codigo || codigo === "INDETERMINADO") return true;
  if (!(codigo in ROTULOS)) return true;
  return MODALIDADES_COM_BENEFICIO.has(codigo);
}
