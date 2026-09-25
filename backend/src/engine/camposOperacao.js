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

/*
 * ─── D3 · município de emissão como ponto próprio do confronto ───────────────
 *
 * Quando a referência residencial informada na geração do laudo é recusada por
 * conflito com o instrumento, o confronto contra a residência cai, e deve cair.
 * Mas dois outros confrontos não dependem dela e usam apenas dados do próprio
 * instrumento e do dossiê:
 *
 *   B. coordenada declarada × município de emissão declarado no instrumento
 *   C. coordenada declarada × cidade do registro público do IP
 *
 * O C já existe como par `gps-x-ip`. Faltava o B, porque o município de emissão
 * (item 3 da CCB, "LOCAL E DATA DE EMISSÃO: Manaquiri - AM - 25/06/2025") nunca
 * foi extraído como ponto autônomo: o único ponto "do instrumento" era o
 * endereço cadastral do contratante, que é outra coisa e pode estar vazio.
 */

/** "LOCAL E DATA DE EMISSÃO: Manaquiri - AM - 25/06/2025" */
const LOCAL_EMISSAO = [
  /LOCAL\s+E\s+DATA\s+DE\s+EMISS[ÃA]O\s*:?\s*([A-Za-zÀ-ÿ'´`^~.\- ]{2,60}?)\s*[-–/]\s*([A-Z]{2})\b/i,
  /LOCAL\s+DE\s+EMISS[ÃA]O\s*:?\s*([A-Za-zÀ-ÿ'´`^~.\- ]{2,60}?)\s*[-–/]\s*([A-Z]{2})\b/i,
  /Emitid[ao]\s+em\s+([A-Za-zÀ-ÿ'´`^~.\- ]{2,60}?)\s*[-–/]\s*([A-Z]{2})\b/i,
  // Bloco de assinatura eletrônica da CCB do Banco Master/Credcesta:
  // "DOCUMENTO ASSINADO ELETRONICAMENTE / Local: Amparo - SP". É o local do
  // ato declarado pelo próprio instrumento, na mesma página da coordenada.
  /^[ \t]*Local(?:\s+d[ae]\s+assinatura)?\s*:\s*([A-Za-zÀ-ÿ'´`^~.\- ]{2,60}?)\s*[-–/]\s*([A-Z]{2})\b(?=[ \t]*(?:$|[,.;]|\d{2}\/\d{2}\/\d{4}))/im,
];

/**
 * Município e UF de emissão declarados no instrumento.
 *
 * @param {string} texto texto do documento
 * @returns {{municipio: string, uf: string, literal: string}|null}
 */
export function extrairLocalEmissao(texto) {
  const t = String(texto || "");
  for (const regex of LOCAL_EMISSAO) {
    const m = t.match(regex);
    if (!m) continue;
    const municipio = m[1].replace(/\s+/g, " ").trim().replace(/[.,;-]+$/, "");
    const uf = m[2].toUpperCase();
    // "de" e "da" sobrando, ou município de uma letra, são leitura errada.
    if (municipio.length < 3) continue;
    return { municipio, uf, literal: m[0].replace(/\s+/g, " ").trim() };
  }
  return null;
}
