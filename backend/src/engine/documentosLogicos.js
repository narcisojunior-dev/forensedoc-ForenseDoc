/**
 * Segmentação do arquivo em documentos lógicos e vínculo de cada bloco de
 * assinatura ao documento a que pertence.
 *
 * ─── Por que ─────────────────────────────────────────────────────────────────
 *
 * Um dossiê de contratação digital junta num PDF só a cédula, as condições
 * gerais, a proposta de seguro e os termos de uso. Uma "menção textual de
 * assinatura" solta não diz O QUE foi assinado. O relatório de homologação
 * pediu o achado "CCB sem bloco de assinatura" para o dossiê C6; a conferência
 * mostrou bloco no fim da pág. 6 da CCB. Por isso a regra só dispara quando a
 * segmentação é confiável e o instrumento principal realmente não tem bloco.
 *
 * ─── Fronteiras ──────────────────────────────────────────────────────────────
 *
 * Um documento começa numa página cujo topo traz título reconhecido. Página sem
 * título continua o documento anterior (cabeçalho repetido, "Página 2 de 10",
 * rodapé de versão das condições gerais).
 */

const TIPOS = [
  { tipo: "DOSSIE", titulo: "Dossiê probatório", regex: /Dossi[êe]\s+Probat[óo]rio|Trilha\s+de\s+auditoria|Relat[óo]rio\s+de\s+assinaturas?/i },
  // Condições gerais antes do instrumento: o título delas cita a cédula
  // ("CONDIÇÕES GERAIS DA CÉDULA DE CRÉDITO BANCÁRIO").
  { tipo: "CONDICOES_GERAIS", titulo: "Condições gerais", regex: /^\s*CONDI[ÇC][ÕO]ES\s+GERAIS\b/im },
  { tipo: "INSTRUMENTO_PRINCIPAL", titulo: "Cédula de Crédito Bancário (condições específicas)", regex: /^\s*C[ÉE]DULA\s+DE\s+CR[ÉE]DITO\s+BANC[ÁA]RIO|^\s*CONTRATO\s+DE\s+(?:EMPR[ÉE]STIMO|CART[ÃA]O|CR[ÉE]DITO)/im },
  { tipo: "SEGURO", titulo: "Proposta de adesão ao seguro", regex: /Proposta\s+de\s+Ades[ãa]o|Seguro\s+Prestamista|Certificado\s+(?:Individual\s+)?de\s+Seguro/i },
  { tipo: "TERMOS", titulo: "Termos de uso e política de privacidade", regex: /TERMOS\s+DE\s+USO|POL[ÍI]TICA\s+DE\s+PRIVACIDADE/i },
  { tipo: "COMPROVANTE", titulo: "Comprovante de transferência", regex: /COMPROVANTE\s+DE\s+(?:TRANSFER[ÊE]NCIA|TED|PIX|TRANSA[ÇC][ÃA]O)/i },
];

// Linhas de topo que não são título: cabeçalho repetido em todas as folhas
// ("VIA NÃO NEGOCIÁVEL") e folha complementar do dossiê ("PROTOCOLO DE
// AUTENTICIDADE"). Saem antes de procurar o título.
const LINHA_NAO_TITULO = /^\s*(?:PROTOCOLO\s+DE\s+AUTENTICIDADE|VIA\s+N[ÃA]O\s+NEGOCI[ÁA]VEL.*)$/i;

const BLOCO_ASSINATURA = [
  /Documento\s+assinado\s+eletronicamente\s+por\s*:?\s*([A-ZÁÀÂÃÉÊÍÓÔÕÚÇ][A-ZÁÀÂÃÉÊÍÓÔÕÚÇ ]{3,80}(?:\n\s*[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ ]{2,40})?)/,
  /ASSINADO\s+ELETRONICAMENTE\s+POR\s*:?\s*\n?\s*([A-ZÁÀÂÃÉÊÍÓÔÕÚÇ][A-ZÁÀÂÃÉÊÍÓÔÕÚÇ ]{3,80})/,
  /Assinatura\s+do\s+(?:Emitente|Proponente|Contratante|Cliente|Tomador|Devedor)/i,
];

function topoDaPagina(pagina, linhas = 4) {
  return pagina
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !LINHA_NAO_TITULO.test(l))
    .slice(0, linhas)
    .join("\n");
}

function blocosDeAssinatura(pagina) {
  for (const regex of BLOCO_ASSINATURA) {
    const m = pagina.match(regex);
    if (m) {
      const titular = m[1] ? m[1].replace(/\s+/g, " ").trim() : null;
      return { presente: true, titular, trecho: m[0].replace(/\s+/g, " ").trim().slice(0, 160) };
    }
  }
  return null;
}

/**
 * @param {string} texto texto com quebras de página (`\f`), sem carimbo processual
 * @returns {{documentos: object[], confiavel: boolean}|null} null quando não há páginas
 */
export function segmentarDocumentos(texto) {
  const t = String(texto || "");
  if (!t.includes("\f")) return null;
  const paginas = t.split("\f");
  const documentos = [];

  paginas.forEach((pagina, i) => {
    const numero = i + 1;
    const topo = topoDaPagina(pagina);
    const reconhecido = TIPOS.find(({ regex }) => regex.test(topo));
    const atual = documentos.at(-1);
    if (reconhecido && (!atual || atual.tipo !== reconhecido.tipo || /P[áa]gina\s+1\s*(?:de|\/)/i.test(pagina))) {
      documentos.push({ tipo: reconhecido.tipo, titulo: reconhecido.titulo, paginaInicial: numero, paginaFinal: numero, tituloDetectado: true, blocosAssinatura: [] });
    } else if (atual) {
      atual.paginaFinal = numero;
    } else {
      documentos.push({ tipo: "OUTRO", titulo: "Documento não identificado", paginaInicial: numero, paginaFinal: numero, tituloDetectado: false, blocosAssinatura: [] });
    }
    const bloco = blocosDeAssinatura(pagina);
    if (bloco) documentos.at(-1).blocosAssinatura.push({ pagina: numero, ...bloco });
  });

  const titulados = documentos.filter((d) => d.tituloDetectado).length;
  return { documentos, confiavel: titulados >= 2 };
}

export function documentoDaPagina(segmentacao, pagina) {
  return segmentacao?.documentos.find((d) => pagina >= d.paginaInicial && pagina <= d.paginaFinal) || null;
}

/**
 * ASS1: instrumento principal sem bloco de assinatura enquanto documento
 * acessório tem. Só com segmentação confiável: é achado de gravidade alta, e o
 * erro de segmentação produziria afirmação falsa.
 */
export function avaliarAssinaturaPorDocumento(segmentacao) {
  if (!segmentacao?.confiavel) return { achado: null, resumo: null };
  const principal = segmentacao.documentos.find((d) => d.tipo === "INSTRUMENTO_PRINCIPAL" && d.tituloDetectado);
  const acessoriosAssinados = segmentacao.documentos.filter((d) => d !== principal && d.tipo !== "DOSSIE" && d.blocosAssinatura.length);
  const faixa = (d) => (d.paginaInicial === d.paginaFinal ? `pág. ${d.paginaInicial}` : `págs. ${d.paginaInicial} a ${d.paginaFinal}`);
  const resumo = segmentacao.documentos
    .map((d) => `${d.titulo} (${faixa(d)}): ${d.blocosAssinatura.length ? `bloco de assinatura na pág. ${d.blocosAssinatura.map((b) => b.pagina).join(", ")}` : "sem bloco de assinatura"}`)
    .join("; ");

  if (!principal || principal.blocosAssinatura.length || !acessoriosAssinados.length) return { achado: null, resumo };
  return {
    resumo,
    achado: {
      codigo: "ASS1",
      gravidade: "ALTA",
      titulo: "Instrumento principal sem bloco de assinatura",
      texto: `O arquivo apresentado não exibe bloco de assinatura na ${principal.titulo} (${faixa(principal)}). A legenda de assinatura eletrônica localizada pertence a ${acessoriosAssinados.map((d) => `${d.titulo.toLowerCase()} (pág. ${d.blocosAssinatura.map((b) => b.pagina).join(", ")})`).join(" e ")}. A declaração de que o instrumento foi assinado, se houver, não substitui o bloco de assinatura no próprio instrumento que gera a obrigação.`,
    },
  };
}
