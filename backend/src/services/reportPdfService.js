import PDFDocument from "pdfkit";
import { riskFromDistance } from "../utils/geoUtils.js";
import { fetchStaticMap, signatureMapPoints } from "./staticMapService.js";
import {
  FIRM,
  NOTA_ASSINATURA,
  NOTA_HASH_SISTEMA,
  NOTA_DISTANCIA,
  FUNDAMENTACAO,
  NOTA_FUNDAMENTACAO_RESSALVA,
  avisoLegal,
} from "../reports/laudoTexts.js";
import { buildCustodyChain } from "../reports/custodyChain.js";

// Paleta sóbria para peça processual (impressão em preto e branco continua legível).
const INK = "#1a1a1a";
const MUTED = "#6b7280";
const ACCENT = "#0f766e";
const DANGER = "#b91c1c";
const RULE = "#d4d4d8";

const MARGIN = 50;

/**
 * Gera o laudo pericial em PDF a partir do `result` persistido de uma análise.
 * Devolve o próprio PDFDocument (stream legível) para o controller encanar na
 * resposta — geração on-demand, sem cache (M4.3).
 *
 * É async porque busca a imagem do mapa estático (Geoapify) ANTES de montar o
 * documento — o PDFKit constrói de forma síncrona, então a imagem precisa já
 * estar em memória. Se o mapa não vier (sem chave, sem coordenadas ou falha),
 * o §5 sai sem ele, com a tabela de coordenadas de sempre.
 *
 * @param {object} analysis linha de Analysis (para id, datas)
 * @param {object} result   Analysis.result já parseado
 */
export async function buildReportPdf(analysis, result) {
  // Pré-busca do mapa (não bloqueia o laudo se falhar).
  const mapBuffer = await fetchStaticMap(signatureMapPoints(result)).catch(() => null);

  const doc = new PDFDocument({
    size: "A4",
    margins: { top: MARGIN, bottom: 70, left: MARGIN, right: MARGIN },
    bufferPages: true, // necessário para numerar o rodapé no fim
    info: {
      Title: `Laudo ForenseDoc ${analysis.id.slice(0, 8)}`,
      Author: FIRM.nome,
      Creator: FIRM.sistema,
    },
  });

  const extracted = safeParse(result.text) || {};
  const timestamp = result.generatedAt
    ? new Date(result.generatedAt).toLocaleString("pt-BR", { timeZone: "America/Fortaleza" })
    : new Date(analysis.createdAt).toLocaleString("pt-BR", { timeZone: "America/Fortaleza" });

  const ctx = { doc, contentWidth: doc.page.width - MARGIN * 2 };

  cover(ctx, analysis, result, timestamp);
  sectionIdentity(ctx, result, extracted);
  sectionMetadata(ctx, result.metadata);
  sectionContract(ctx, extracted);
  sectionClient(ctx, extracted);
  sectionSignature(ctx, extracted, result);
  sectionGeo(ctx, result, mapBuffer);
  sectionIrregularities(ctx, extracted);
  sectionRemarks(ctx, extracted);
  sectionLegal(ctx);
  legalNotice(ctx, timestamp);

  paintFooters(doc, result.hashes?.sha256);

  doc.end();
  return doc;
}

// ─────────────────────────────────────────────────────────────
// Helpers de layout
// ─────────────────────────────────────────────────────────────

function safeParse(raw) {
  if (!raw) return null;
  try {
    return JSON.parse(String(raw).replace(/```json|```/g, "").trim());
  } catch {
    return null;
  }
}

/** Subtítulo de subseção (§ 4.1), sem a régua do heading principal. */
function subheading(ctx, title) {
  const { doc, contentWidth } = ctx;
  if (doc.y > doc.page.height - 160) doc.addPage();
  doc.moveDown(0.4);
  doc
    .fontSize(10.5)
    .fillColor(INK)
    .font("Helvetica-Bold")
    .text(title, MARGIN, doc.y, { width: contentWidth });
  doc.moveDown(0.2);
}

function heading(ctx, title, { danger = false } = {}) {
  const { doc, contentWidth } = ctx;
  if (doc.y > doc.page.height - 140) doc.addPage();
  doc.moveDown(0.8);
  doc
    .fontSize(12)
    .fillColor(danger ? DANGER : ACCENT)
    .font("Helvetica-Bold")
    .text(title, { width: contentWidth });
  doc
    .moveTo(doc.x, doc.y + 2)
    .lineTo(doc.x + contentWidth, doc.y + 2)
    .strokeColor(RULE)
    .lineWidth(0.5)
    .stroke();
  doc.moveDown(0.5);
}

// Linha rótulo: valor, em fluxo natural. Omite quando o valor é vazio.
// Usa `continued` em vez de posição absoluta — posicionar Y à mão confundia
// o fluxo do PDFKit e gerava uma página por campo.
function field(ctx, label, value, { mono = false } = {}) {
  if (value === null || value === undefined || value === "") return;
  const { doc, contentWidth } = ctx;
  if (doc.y > doc.page.height - 90) doc.addPage();
  doc
    .fontSize(9.5)
    .font("Helvetica")
    .fillColor(MUTED)
    .text(`${label}:  `, { width: contentWidth, continued: true })
    .font(mono ? "Courier" : "Helvetica")
    .fillColor(INK)
    .text(String(value));
  doc.moveDown(0.15);
}

function paragraph(ctx, text, { color = INK, size = 9.5, italic = false } = {}) {
  const { doc, contentWidth } = ctx;
  if (doc.y > doc.page.height - 120) doc.addPage();
  doc
    .fontSize(size)
    .font(italic ? "Helvetica-Oblique" : "Helvetica")
    .fillColor(color)
    .text(text, MARGIN, doc.y, { width: contentWidth, align: "justify", lineGap: 1.5 });
  doc.moveDown(0.5);
}

function badge(ctx, label, value, ok) {
  const { doc, contentWidth } = ctx;
  if (doc.y > doc.page.height - 90) doc.addPage();
  doc
    .fontSize(9.5)
    .font("Helvetica")
    .fillColor(MUTED)
    .text(`${label}:  `, { width: contentWidth, continued: true })
    .font("Helvetica-Bold")
    .fillColor(ok ? ACCENT : DANGER)
    .text(value);
  doc.moveDown(0.15);
}

// ─────────────────────────────────────────────────────────────
// Seções
// ─────────────────────────────────────────────────────────────

function cover(ctx, analysis, result, timestamp) {
  const { doc, contentWidth } = ctx;
  doc.fontSize(11).font("Helvetica-Bold").fillColor(ACCENT).text(FIRM.sistema.toUpperCase(), { align: "center" });
  doc.moveDown(0.3);
  doc.fontSize(19).font("Helvetica-Bold").fillColor(INK).text("Laudo Técnico Pericial", { align: "center" });
  doc.fontSize(11).font("Helvetica").fillColor(MUTED).text("Análise forense de contrato de consignado", { align: "center" });
  doc.moveDown(0.5);
  doc.fontSize(8.5).fillColor(MUTED).text(`${FIRM.nome} · ${FIRM.oab}`, { align: "center" });
  doc.moveDown(1);

  doc.moveTo(MARGIN, doc.y).lineTo(MARGIN + contentWidth, doc.y).strokeColor(RULE).lineWidth(1).stroke();
  doc.moveDown(0.6);

  field(ctx, "Identificador do laudo", analysis.id);
  field(ctx, "Arquivo analisado", result.file?.name || "—");
  field(ctx, "Tamanho do arquivo", result.file?.sizeBytes ? `${(result.file.sizeBytes / 1024).toFixed(2)} KB` : null);
  field(ctx, "Data de geração", timestamp);
  if (result.usedOcr) field(ctx, "OCR", `Aplicado em ${result.ocrPages} página(s)`);
}

function sectionIdentity(ctx, result, extracted) {
  heading(ctx, "§ 1 · Identificação e integridade criptográfica");
  if (result.hashes) {
    field(ctx, "SHA-256 (calculado pelo servidor)", result.hashes.sha256, { mono: true });
    field(ctx, "SHA-1 (calculado pelo servidor)", result.hashes.sha1, { mono: true });
  }
  const declared = extracted.assinatura?.hash_documento_assinado;
  if (declared) field(ctx, "Hash declarado no documento", declared, { mono: true });
  field(ctx, "Tipo de documento", extracted.tipo_documento);
  field(ctx, "Qualidade de leitura/OCR", extracted.qualidade_ocr);
  paragraph(ctx, NOTA_HASH_SISTEMA, { color: MUTED, size: 8.5 });
}

function sectionMetadata(ctx, metadata) {
  if (!metadata) return;
  heading(ctx, "§ 1.1 · Verificação dos metadados internos do PDF");
  field(ctx, "Número de páginas", metadata.totalPages);
  field(ctx, "Autor declarado", metadata.author);
  field(ctx, "Aplicativo criador", metadata.creator);
  field(ctx, "Produtor", metadata.producer);
  field(ctx, "Data de criação", metadata.creationDate);
  field(ctx, "Data de modificação", metadata.modDate);
  if (metadata.warnings?.length) {
    paragraph(ctx, metadata.warnings.join(" "), { color: DANGER, size: 8.5 });
  }
}

function sectionContract(ctx, extracted) {
  const c = extracted.contrato || {};
  heading(ctx, "§ 2 · Dados do instrumento contratual");
  field(ctx, "Número do contrato", c.numero);
  field(ctx, "Banco / instituição", c.banco);
  field(ctx, "Modalidade", c.modalidade);
  field(ctx, "Valor contratado", c.valor_contratado);
  field(ctx, "Valor da parcela", c.valor_parcela);
  field(ctx, "Número de parcelas", c.numero_parcelas);
  field(ctx, "Taxa de juros mensal", c.taxa_juros_mensal);
  field(ctx, "Taxa de juros anual", c.taxa_juros_anual);
  field(ctx, "CET mensal", c.cet_mensal);
  field(ctx, "CET anual", c.cet_anual);
  field(ctx, "Data do contrato", c.data_contrato);
}

function sectionClient(ctx, extracted) {
  const c = extracted.cliente || {};
  heading(ctx, "§ 3 · Qualificação do contratante");
  field(ctx, "Nome completo", c.nome);
  field(ctx, "CPF", c.cpf);
  field(ctx, "RG", c.rg);
  field(ctx, "Data de nascimento", c.data_nascimento);
  field(ctx, "Endereço", c.endereco);
  field(ctx, "Cidade / Estado", [c.cidade, c.estado].filter(Boolean).join(" / "));
  field(ctx, "CEP", c.cep);
  field(ctx, "Telefone", c.telefone);
  field(ctx, "Número do benefício", c.numero_beneficio);
}

function sectionSignature(ctx, extracted, result = {}) {
  const a = extracted.assinatura || {};
  heading(ctx, "§ 4 · Assinatura eletrônica e cadeia de custódia");
  badge(ctx, "Assinatura presente", a.presente ? "CONFIRMADA" : "AUSENTE", !!a.presente);
  paragraph(ctx, NOTA_ASSINATURA, { color: MUTED, size: 8.5 });
  field(ctx, "Plataforma de assinatura", a.plataforma);
  field(ctx, "Tipo de assinatura", a.tipo);
  field(ctx, "Titular do signatário", a.titular_certificado);
  field(ctx, "Data / hora da assinatura", a.data_hora_assinatura);
  field(ctx, "Algoritmo de hash", a.algoritmo_hash);
  if (a.metodos_autenticacao?.length) field(ctx, "Métodos de autenticação", a.metodos_autenticacao.join(" · "));

  sectionCustodyChain(ctx, extracted, result.ipAnalysis || [], !!result.geoDeclaredPresent, result.cadeiaCustodia);
}

/**
 * § 4.1 — cadeia de custódia elemento por elemento.
 *
 * Antes eram oito selos "PRESENTE / AUSENTE" e nada mais: o laudo concluía que a
 * cadeia estava incompleta sem dizer o que cada elemento comprova, qual norma o
 * exige ou que efeito a ausência produz. Uma conclusão sem demonstração não
 * sustenta impugnação.
 */
function sectionCustodyChain(ctx, extracted, ipAnalysis = [], geoPresente = false, persistida = null) {
  const { doc, contentWidth } = ctx;
  // Prefere a avaliação persistida pelo worker; recalcula apenas para laudos
  // gerados antes de ela passar a ser gravada.
  const cadeia = persistida?.elementos?.length
    ? persistida
    : buildCustodyChain(extracted, ipAnalysis, geoPresente);

  doc.moveDown(0.5);
  subheading(ctx, "§ 4.1 · Cadeia de custódia do ato de assinatura");

  paragraph(ctx, cadeia.definicao, { color: MUTED, size: 8.5 });

  // Placar antes do detalhamento: quem lê o laudo em diagonal precisa do
  // veredito, quem lê a fundo encontra o porquê abaixo.
  const av = cadeia.avaliacao;
  badge(
    ctx,
    "Completude da cadeia",
    `${cadeia.presentes}/${cadeia.total} · ${av.pct}% · ${av.rotulo}`,
    av.tom === "ok"
  );
  paragraph(ctx, av.leitura, { size: 9 });

  doc.moveDown(0.3);
  for (const e of cadeia.elementos) {
    if (doc.y + 68 > doc.page.height - 80) doc.addPage();

    const cor = e.presente ? ACCENT : DANGER;
    doc
      .fontSize(9)
      .font("Helvetica-Bold")
      .fillColor(cor)
      .text(`${e.presente ? "[PRESENTE]" : "[AUSENTE]"} ${e.nome}`, MARGIN, doc.y, {
        width: contentWidth,
      });

    doc.fontSize(8.5).font("Helvetica").fillColor(INK);
    doc.text(`Função probatória: ${e.comprova}`, MARGIN + 12, doc.y + 1, {
      width: contentWidth - 12,
    });
    doc.fillColor(MUTED).text(`Base normativa: ${e.norma}`, MARGIN + 12, doc.y + 1, {
      width: contentWidth - 12,
    });

    // O efeito da ausência só é impresso quando o elemento falta — no laudo, o
    // que importa é a consequência concreta, não a hipótese.
    if (!e.presente) {
      doc.fillColor(DANGER).text(`Efeito da ausência: ${e.ausencia}`, MARGIN + 12, doc.y + 1, {
        width: contentWidth - 12,
      });
    }
    doc.moveDown(0.35);
  }

  if (cadeia.faltantes.length) {
    paragraph(
      ctx,
      `Elementos ausentes (${cadeia.faltantes.length}): ${cadeia.faltantes.map((e) => e.nome.toLowerCase()).join("; ")}.`,
      { color: DANGER, size: 9 }
    );
  }

  paragraph(ctx, cadeia.efeitoProcessual, { size: 9 });
}

// Rótulo legível da precisão de uma coordenada.
const PRECISION_LABEL = {
  manual: "confirmada pelo operador",
  gps: "GPS do log do contrato",
  rooftop: "nível de endereço (número)",
  street: "nível de rua",
  postal: "nível de CEP",
  city: "nível de cidade (aproximada)",
};

function precisionText(geoLike) {
  const p = geoLike?.precision;
  return p && PRECISION_LABEL[p] ? PRECISION_LABEL[p] : "precisão não determinada";
}


// Insere a imagem do mapa estático (residência × assinatura declarada) com
// legenda. Quebra de página se não couber no espaço restante.
function drawMap(ctx, mapBuffer) {
  const { doc, contentWidth } = ctx;
  const imgH = contentWidth * (460 / 780); // mesma proporção da imagem buscada
  if (doc.y + imgH + 40 > doc.page.height - 60) doc.addPage();
  doc.moveDown(0.4);
  try {
    doc.image(mapBuffer, MARGIN, doc.y, { width: contentWidth });
    doc.y += imgH + 4;
  } catch (err) {
    console.error("[ReportPdf] Falha ao embutir mapa:", err.message);
    return;
  }
  doc
    .fontSize(8)
    .font("Helvetica-Oblique")
    .fillColor(MUTED)
    .text(
      "Mapa: residência do cliente (R, azul) · local declarado da assinatura (A, âmbar) · origem da conexão pelo endereço IP (I, vermelho). As linhas representam distâncias geodésicas (Haversine). O ponto I tem precisão de nível de operadora e não indica a posição do aparelho. Base cartográfica OpenStreetMap.",
      MARGIN,
      doc.y,
      { width: contentWidth, align: "center" }
    );
  doc.moveDown(0.4);
}

function sectionGeo(ctx, result, mapBuffer) {
  heading(ctx, "§ 5 · Geolocalização da assinatura · confronto geográfico");

  const home = result.home?.geo;
  if (result.home?.query || home) {
    if (result.home?.query) field(ctx, `Residência (${result.home.source || "referência"})`, result.home.query);
    if (home?.display) field(ctx, "Coordenada da residência", `${home.display} — precisão ${precisionText(home)}`);
    // Aviso explícito quando a residência é só aproximada (nível de cidade):
    // a distância derivada dela não pode ser tratada como exata.
    if (home && (home.precision === "city" || !home.precision)) {
      paragraph(
        ctx,
        "Atenção: a coordenada da residência foi resolvida apenas em nível de cidade. A distância abaixo é aproximada e não deve ser usada como medida exata sem confirmação da coordenada pelo operador.",
        { color: DANGER, size: 8.5 }
      );
    }
  }

  const cg = result.contractGeo;
  if (cg) {
    field(ctx, "Local declarado da assinatura", cg.endereco || `${cg.lat}, ${cg.lon}`);
    field(ctx, "Coordenadas", `${cg.lat}, ${cg.lon} — precisão ${precisionText(cg)}`);
    if (cg.distance != null) {
      const r = riskFromDistance(cg.distance);
      badge(ctx, "Distância assinatura ate residência", `${cg.distance.toFixed(2)} km · ${r.label}`, r.score <= 1);
    }
  }

  // Mapa real dos dois pontos, quando disponível.
  if (mapBuffer) drawMap(ctx, mapBuffer);

  sectionIpTrace(ctx, result);

  if (!cg && !ips.length && !result.home?.query) {
    paragraph(ctx, "Não foram extraídos dados de geolocalização (IP, coordenadas ou endereço) suficientes para o confronto geográfico neste documento.", { color: MUTED });
  }
  paragraph(ctx, NOTA_DISTANCIA, { color: MUTED, size: 8.5 });
}

/**
 * § 6 — rastro de conexão e confronto com o ponto de referência.
 *
 * A versão anterior imprimia "IP <endereço> — cidade/UF" e duas distâncias.
 * Faltava o que dá valor probatório ao dado: o rótulo com que o assinador
 * registrou o endereço, a versão do protocolo, a porta lógica, a data/hora
 * associada, o provedor de geolocalização consultado e — principalmente — a
 * leitura pericial da divergência, que antes o leitor tinha de inferir de um
 * número em quilômetros.
 */
function sectionIpTrace(ctx, result) {
  const { doc, contentWidth } = ctx;
  const ips = result.ipAnalysis || [];
  if (!ips.length) return;

  doc.moveDown(0.5);
  subheading(ctx, "§ 5.1 · Rastro de conexão (endereços IP)");

  paragraph(
    ctx,
    "Um endereço IP não carrega coordenada. A localização abaixo vem de base que mapeia blocos de IP ao ponto de presença da operadora — o roteador de saída, não o aparelho. Em rede móvel brasileira, com CGNAT e blocos IPv6 alocados por região, o ponto devolvido tende à capital ou ao centro de operação do estado. Divergências de dezenas de quilômetros são esperadas; o que tem valor indiciário é a incompatibilidade de ordem de grandeza.",
    { color: MUTED, size: 8.5 }
  );

  for (const ip of ips) {
    if (doc.y + 110 > doc.page.height - 80) doc.addPage();
    doc.moveDown(0.35);

    // Cabeçalho do IP: endereço + como o documento o registrou.
    doc
      .fontSize(9.5)
      .font("Helvetica-Bold")
      .fillColor(INK)
      .text(`${ip.endereco}${ip.porta ? ` (porta lógica ${ip.porta})` : ""}`, MARGIN, doc.y, {
        width: contentWidth,
      });
    doc
      .fontSize(8.5)
      .font("Helvetica")
      .fillColor(MUTED)
      .text(
        `IPv${ip.versao || "?"} · ${ip.rotulo ? `registrado como “${ip.rotulo}”` : "sem rótulo explícito no documento"}`,
        MARGIN + 12,
        doc.y + 1,
        { width: contentWidth - 12 }
      );

    if (ip.data_hora) field(ctx, "   Data / hora do registro", ip.data_hora);
    if (ip.user_agent) field(ctx, "   Dispositivo declarado", ip.user_agent);

    if (!ip.geo) {
      // Distinção essencial num laudo: o documento trazia o dado, a CONSULTA
      // falhou. Tratar as duas ausências como iguais induziria a erro.
      paragraph(
        ctx,
        `Geolocalização não obtida (${ip.geoFailure || "motivo não registrado"}). O endereço consta do documento; a ausência de coordenada decorre de falha na consulta ao provedor, não de omissão do instrumento.`,
        { color: DANGER, size: 8.5 }
      );
      continue;
    }

    field(
      ctx,
      "   Origem da conexão",
      `${[ip.geo.city, ip.geo.region, ip.geo.country].filter(Boolean).join(" / ")} — ${ip.geo.lat}, ${ip.geo.lon}`
    );
    if (ip.geo.isp) field(ctx, "   Operadora (ISP)", ip.geo.isp);
    field(ctx, "   Fonte da geolocalização", ip.geo.source || "não informada");

    // Confronto com a referência do operador — o coração do § 5.1.
    const dr = ip.divergenciaResidencia;
    if (dr) {
      badge(ctx, "   IP × residência informada", `${dr.km.toFixed(2)} km · ${dr.rotulo}`, dr.tom === "ok");
      paragraph(ctx, dr.sintese, { size: 8.5, color: dr.tom === "danger" ? DANGER : INK });
      paragraph(ctx, dr.ressalva, { size: 8, color: MUTED });
    }

    const da = ip.divergenciaAssinatura;
    if (da) {
      badge(ctx, "   IP × GPS declarado no contrato", `${da.km.toFixed(2)} km · ${da.rotulo}`, da.tom === "ok");
      paragraph(ctx, da.sintese, { size: 8.5, color: da.tom === "danger" ? DANGER : INK });
    }
  }
}

function sectionIrregularities(ctx, extracted) {
  const evs = extracted.evidencias_irregularidade || [];
  if (!evs.length) return;
  heading(ctx, "§ 7 · Evidências de irregularidade", { danger: true });
  for (const ev of evs) {
    const { doc, contentWidth } = ctx;
    if (doc.y > doc.page.height - 100) doc.addPage();
    doc.fontSize(9.5).font("Helvetica").fillColor(DANGER).text("▸ ", MARGIN, doc.y, { continued: true });
    doc.fillColor(INK).text(ev, { width: contentWidth });
    doc.moveDown(0.2);
  }
}

function sectionRemarks(ctx, extracted) {
  if (!extracted.observacoes_periciais) return;
  heading(ctx, "§ 8 · Observações periciais complementares");
  paragraph(ctx, extracted.observacoes_periciais);
}

function sectionLegal(ctx) {
  heading(ctx, "§ 9 · Fundamentação normativa aplicável");
  for (const { grupo, itens } of FUNDAMENTACAO) {
    const { doc, contentWidth } = ctx;
    if (doc.y > doc.page.height - 130) doc.addPage();
    doc.moveDown(0.3);
    doc.fontSize(10).font("Helvetica-Bold").fillColor(INK).text(grupo, { width: contentWidth });
    doc.moveDown(0.2);
    for (const [disp, sint] of itens) {
      if (doc.y > doc.page.height - 100) doc.addPage();
      doc.fontSize(9).font("Helvetica-Bold").fillColor(ACCENT).text(disp, { width: contentWidth });
      doc.fontSize(9).font("Helvetica").fillColor(INK).text(sint, { width: contentWidth, align: "justify", lineGap: 1 });
      doc.moveDown(0.3);
    }
  }
  paragraph(ctx, NOTA_FUNDAMENTACAO_RESSALVA, { color: MUTED, size: 8.5 });
}

function legalNotice(ctx, timestamp) {
  const { doc, contentWidth } = ctx;
  doc.moveDown(0.5);
  if (doc.y > doc.page.height - 160) doc.addPage();
  doc.moveTo(MARGIN, doc.y).lineTo(MARGIN + contentWidth, doc.y).strokeColor(RULE).lineWidth(0.5).stroke();
  doc.moveDown(0.4);
  doc.fontSize(7.5).font("Helvetica-Oblique").fillColor(MUTED).text(avisoLegal(timestamp), { width: contentWidth, align: "justify", lineGap: 1 });
}

// Rodapé em todas as páginas: numeração + SHA-256 do documento analisado.
function paintFooters(doc, sha256) {
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);

    // Zerar a margem inferior durante a escrita: sem isso, o texto na faixa
    // do rodapé cai dentro da margem, o PDFKit acha que "não cabe" e injeta
    // páginas órfãs no fim — o que gerava 9 páginas físicas com 3 rodapés.
    const savedBottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;

    const y = doc.page.height - 45;
    const width = doc.page.width - MARGIN * 2;
    doc.fontSize(7).font("Helvetica").fillColor(MUTED);
    if (sha256) {
      doc.text(`SHA-256: ${sha256}`, MARGIN, y, { width, align: "left", lineBreak: false });
    }
    doc.text(`Página ${i + 1} de ${range.count} · ${FIRM.sistema}`, MARGIN, y + 10, {
      width,
      align: "center",
      lineBreak: false,
    });

    doc.page.margins.bottom = savedBottom;
  }
}
