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
  // Form-feed terminal cria uma página vazia a mais. A extração do Poppler o
  // emite, e sem isto o dossiê de 27 páginas era segmentado como 28.
  if (paginas.length > 1 && !paginas.at(-1).trim()) paginas.pop();
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
    if (bloco) {
      // FINO-03 (rodada 2): no dossiê o quadro é descritivo, emitido pela própria
      // instituição, e não assinatura aposta a instrumento negocial.
      const tipo = documentos.at(-1).tipo === "DOSSIE" ? "QUADRO_DESCRITIVO" : "BLOCO_ASSINATURA";
      documentos.at(-1).blocosAssinatura.push({ pagina: numero, tipo, ...bloco });
    }
  });

  /*
   * ─── D11 · a contagem de páginas inclui página de fecho ──────────────────────
   *
   * A pág. 7 do dossiê C6 traz apenas a faixa de cabeçalho e uma linha de rodapé
   * com site, horário e SAC. Ela entra nas 12 páginas usadas no cálculo de 2,25
   * segundos por página do aceite da CCB.
   *
   * A contagem não está errada: o documento aceito tem mesmo 12 páginas no
   * arquivo, e é sobre o total que a métrica deve ser calculada, porque foi o
   * arquivo inteiro que foi apresentado ao consumidor. Mas a defesa vai contar
   * isso, e o achado fica mais forte antecipando. Duas contagens, então: total e
   * com conteúdo negocial, com a métrica sobre a total e a outra ao lado.
   */
  documentos.forEach((d) => {
    const doDocumento = paginas.slice(d.paginaInicial - 1, d.paginaFinal);
    const negociais = doDocumento.filter((pagina) => temConteudoNegocial(pagina)).length;
    d.paginas_total = d.paginaFinal - d.paginaInicial + 1;
    d.paginas_conteudo_negocial = negociais;
    d.paginas_fecho = d.paginas_total - negociais;
  });

  const titulados = documentos.filter((d) => d.tituloDetectado).length;
  return { documentos, confiavel: titulados >= 2 };
}

/** Rodapé institucional: site, horário de atendimento, SAC, ouvidoria. */
const RODAPE = /www\.|\bSAC\b|ouvidoria|atendimento|\d{4}-\d{4}|0800|central\s+de\s+relacionamento|p[áa]gina\s+\d+\s*(?:de|\/)\s*\d+|via\s+n[ãa]o\s+negoci[áa]vel|via\s+do\s+cliente|documento\s+assinado\s+digitalmente|assinado\s+digitalmente\s+por|PROJUDI|JUNTADA\s+DE\s+PETI[ÇC][ÃA]O|^\s*Arq:/i;

/**
 * Resto de texto abaixo do qual a página não tem frase própria. Uma cláusula
 * curta real ("O contratante autoriza o desconto das parcelas em sua folha de
 * pagamento.") tem 72 caracteres e precisa contar como conteúdo.
 */
const LIMIAR_FECHO = 40;

/**
 * A página tem conteúdo negocial, ou é só cabeçalho e rodapé?
 *
 * ─── Por que não é um limiar de tamanho ─────────────────────────────────────
 *
 * A primeira versão media o texto restante contra 120 caracteres. Isso trata
 * página curta como página vazia: uma cláusula de uma linha só seria contada
 * como fecho, e a contagem de conteúdo negocial, que existe para ANTECIPAR o
 * argumento da defesa, passaria a dar munição a ele.
 *
 * Fecho é a página que tem moldura reconhecida e nada além dela. Duas condições,
 * não uma. Sem marcador de moldura, a página conta como conteúdo, porque o que
 * não se reconhece não se classifica: na dúvida, conteúdo.
 */
export function temConteudoNegocial(pagina) {
  const linhas = String(pagina || "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (!linhas.length) return false;

  const temMoldura = linhas.some((l) => RODAPE.test(l));
  const resto = linhas.filter((l) => !RODAPE.test(l)).join(" ").replace(/\s+/g, " ").trim();

  // Página sem moldura reconhecida não é fecho, seja qual for o tamanho.
  if (!temMoldura) return true;
  return resto.length >= LIMIAR_FECHO;
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
  const descrever = (d) => {
    if (!d.blocosAssinatura.length) return "sem bloco de assinatura";
    const paginas = (tipo) => d.blocosAssinatura.filter((b) => (b.tipo || "BLOCO_ASSINATURA") === tipo).map((b) => b.pagina);
    return [
      paginas("BLOCO_ASSINATURA").length ? `bloco de assinatura na pág. ${paginas("BLOCO_ASSINATURA").join(", ")}` : null,
      paginas("QUADRO_DESCRITIVO").length ? `quadro descritivo de assinatura, emitido pela instituição, na pág. ${paginas("QUADRO_DESCRITIVO").join(", ")}` : null,
    ].filter(Boolean).join(" e ");
  };
  const resumo = segmentacao.documentos.map((d) => `${d.titulo} (${faixa(d)}): ${descrever(d)}`).join("; ");
  // Só blocos apostos a documento negocial contam como assinatura.
  const totalBlocos = segmentacao.documentos.reduce((n, d) => n + d.blocosAssinatura.filter((b) => (b.tipo || "BLOCO_ASSINATURA") === "BLOCO_ASSINATURA").length, 0);

  // Fragmentos não contíguos e aditivos impedem imputar ausência ao contrato
  // inteiro a partir apenas do primeiro segmento com o mesmo título.
  const principais = segmentacao.documentos.filter((d) => d.tipo === "INSTRUMENTO_PRINCIPAL");
  if (principais.length > 1 || !principal || principal.blocosAssinatura.length || !acessoriosAssinados.length) return { achado: null, resumo, totalBlocos };
  return {
    resumo,
    totalBlocos,
    achado: {
      codigo: "ASS1",
      gravidade: "ALTA",
      titulo: "Instrumento principal sem bloco de assinatura",
      texto: `O arquivo apresentado não exibe bloco de assinatura na ${principal.titulo} (${faixa(principal)}). A legenda de assinatura eletrônica localizada pertence a ${acessoriosAssinados.map((d) => `${d.titulo.toLowerCase()} (pág. ${d.blocosAssinatura.map((b) => b.pagina).join(", ")})`).join(" e ")}. A declaração de que o instrumento foi assinado, se houver, não substitui o bloco de assinatura no próprio instrumento que gera a obrigação.`,
    },
  };
}

/*
 * ─── D12 · anomalia de paginação no rodapé do modelo ─────────────────────────
 *
 * As Condições Gerais do dossiê C6 ocupam as págs. 8 a 14 e trazem rodapé
 * próprio `CG.CLTv1.20250420` numerado de 1/5 até 7/5: sete páginas numeradas
 * contra cinco declaradas no denominador.
 *
 * A leitura foi confirmada visualmente na pág. 14 renderizada antes de virar
 * código, porque a primeira leitura tinha sido de imagem e leitura de imagem
 * erra. Mesmo confirmada, o estado é `indicio` e nunca `comprovado`: a leitura
 * possível é que o documento juntado não corresponda ao modelo cuja numeração o
 * rodapé declara, e isso não se conclui de uma contagem de rodapé.
 */

/**
 * Rodapé de modelo: rótulo alfanumérico e, na MESMA linha, `n/m`. No PDF os dois
 * ficam nas extremidades da linha, separados por um bloco de espaços, e o rótulo
 * aparece tanto como "CG.CLTv1..." quanto como "CG CLTv1...".
 */
const RODAPE_MODELO = /^[ \t]*([A-Z]{2,6}[. ][A-Za-z0-9.]{4,30}?)[ \t]{2,}(\d{1,3})\s*\/\s*(\d{1,3})[ \t]*$/gm;

/**
 * @param {string} texto texto com quebras de página, sem carimbo processual
 * @returns {Array<{modelo: string, numeradores: number[], denominador: number, paginas: number[]}>}
 */
export function detectarAnomaliaPaginacao(texto) {
  const paginas = String(texto || "").split("\f");
  const porModelo = new Map();

  paginas.forEach((pagina, i) => {
    RODAPE_MODELO.lastIndex = 0;
    let m;
    while ((m = RODAPE_MODELO.exec(pagina)) !== null) {
      const modelo = m[1].replace(/\.$/, "");
      const numerador = Number(m[2]);
      const denominador = Number(m[3]);
      if (!Number.isFinite(numerador) || !Number.isFinite(denominador) || denominador === 0) continue;
      if (!porModelo.has(modelo)) porModelo.set(modelo, { modelo, numeradores: [], denominadores: new Set(), paginas: [] });
      const registro = porModelo.get(modelo);
      registro.numeradores.push(numerador);
      registro.denominadores.add(denominador);
      registro.paginas.push(i + 1);
    }
  });

  return [...porModelo.values()]
    .filter((r) => r.denominadores.size === 1 && Math.max(...r.numeradores) > [...r.denominadores][0])
    .map((r) => ({
      modelo: r.modelo,
      numeradores: r.numeradores,
      denominador: [...r.denominadores][0],
      maior_numerador: Math.max(...r.numeradores),
      paginas: r.paginas,
    }));
}
