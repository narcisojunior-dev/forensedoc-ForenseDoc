import PDFDocument from "pdfkit";
import { classifyDeclaredDivergence } from "../utils/geoDivergence.js";
import { fetchStaticMap, mapPointsIpVsHome, mapPointsHomeVsDeclared } from "./staticMapService.js";
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
  // Pré-busca dos DOIS mapas do § 5, em paralelo. Cada um responde a uma
  // pergunta pericial distinta (ver staticMapService.js) e nenhum é requisito:
  // se a busca falhar, a seção sai com as coordenadas e as distâncias.
  const [mapaIpResidencia, mapaResidenciaDeclarado] = await Promise.all([
    fetchStaticMap(mapPointsIpVsHome(result)).catch(() => null),
    fetchStaticMap(mapPointsHomeVsDeclared(result)).catch(() => null),
  ]);

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
  sectionGeo(ctx, result, { mapaIpResidencia, mapaResidenciaDeclarado });
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

/**
 * Reserva espaço para um bloco que não deve ser partido pela quebra de página.
 *
 * Os guardas espalhados pelos helpers medem cada elemento isoladamente, então um
 * veredito e a frase que o explica podiam caber "cada um" e ainda assim acabar em
 * páginas diferentes: o § 5.2 saía com o rótulo COMPATÍVEL no pé de uma página e
 * "O documento situa a assinatura praticamente no mesmo local" solto no topo da
 * seguinte, sem o número a que se referia.
 */
function reserve(ctx, pontos) {
  if (ctx.doc.y > ctx.doc.page.height - pontos) ctx.doc.addPage();
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
  field(ctx, "Arquivo analisado", result.file?.name || "nome não informado");
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
function drawMap(ctx, mapBuffer, legenda) {
  const { doc, contentWidth } = ctx;
  const imgH = contentWidth * (460 / 780); // mesma proporção da imagem buscada
  if (doc.y + imgH + 52 > doc.page.height - 60) doc.addPage();
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
    .text(legenda, MARGIN, doc.y, { width: contentWidth, align: "center" });
  doc.moveDown(0.4);
}

function sectionGeo(ctx, result, mapas = {}) {
  // O § 5 abre sempre com o parágrafo de enquadramento e o bloco de referência.
  // O guarda padrão do `heading` (140pt) deixava o título e a introdução órfãos
  // no pé da página, com o resto da seção começando só na página seguinte.
  if (ctx.doc.y > ctx.doc.page.height - 300) ctx.doc.addPage();

  heading(ctx, "§ 5 · Geolocalização da assinatura · confronto geográfico");

  const home = result.home?.geo;
  const cg = result.contractGeo;
  const ipRef = (result.ipAnalysis || []).find((ip) => ip.geo?.lat != null);
  // Prefere a classificação persistida pelo enriquecimento; recalcula só para
  // análises gravadas antes de `contractGeo.divergencia` existir.
  const declarado =
    cg?.divergencia ||
    (cg?.distance != null
      ? classifyDeclaredDivergence(cg.distance, {
          referenciaConfirmada: home?.precision === "manual",
        })
      : null);

  // ─── Ponto de referência ───────────────────────────────────────────────────
  paragraph(
    ctx,
    "Esta seção apresenta DOIS confrontos independentes, cada um com seu mapa. Eles respondem a perguntas diferentes e não se somam: o primeiro verifica de onde partiu a CONEXÃO que gerou o ato; o segundo verifica o que o DOCUMENTO afirma sobre o local do ato. Ambos usam como referência a residência informada.",
    { size: 9 }
  );

  subheading(ctx, "Ponto de referência · residência do contratante");
  if (result.home?.query) field(ctx, `Endereço (${result.home.source || "referência"})`, result.home.query);
  if (home && Number.isFinite(home.lat) && Number.isFinite(home.lon)) {
    // A coordenada NUMÉRICA é obrigatória: todas as distâncias abaixo derivam
    // dela, e sem o valor o laudo deixa de ser reproduzível por terceiro.
    field(ctx, "Coordenada adotada", `${home.lat}, ${home.lon}`, { mono: true });
    field(
      ctx,
      "   Origem da coordenada",
      home.precision === "manual"
        ? "confirmada pelo operador (padrão-ouro deste laudo)"
        : `${home.display || "não informada"} (precisão ${precisionText(home)})`
    );
  }
  if (home && (home.precision === "city" || !home.precision)) {
    paragraph(
      ctx,
      "Atenção: a coordenada da residência foi resolvida apenas em nível de cidade. As distâncias derivadas dela são aproximadas e não devem ser tratadas como medidas exatas sem confirmação da coordenada pelo operador.",
      { color: DANGER, size: 8.5 }
    );
  }
  if (!home) {
    paragraph(
      ctx,
      "Não foi possível estabelecer a coordenada de referência da residência. Sem ela, nenhum dos dois confrontos abaixo pode ser calculado.",
      { color: DANGER, size: 9 }
    );
  }

  // ─── Confronto 1: origem da conexão × residência ──────────────────────────
  subheading(ctx, "§ 5.1 · Confronto 1 · origem da conexão (IP) × residência informada");
  paragraph(
    ctx,
    "Pergunta: a conexão que originou a assinatura partiu da região onde o contratante reside? A localização do IP tem precisão de nível de operadora, isto é, aponta o roteador de saída e não o aparelho. A margem, portanto, é de dezenas de quilômetros, e só a incompatibilidade de ordem de grandeza tem valor indiciário.",
    { color: MUTED, size: 8.5 }
  );

  if (!ipRef) {
    paragraph(
      ctx,
      (result.ipAnalysis || []).length
        ? "Confronto não realizado: há endereço IP no documento, mas nenhuma coordenada foi obtida para ele (ver § 5.3)."
        : "Confronto não realizado: não foi extraído endereço IP do documento.",
      { color: MUTED, size: 9 }
    );
  } else {
    field(ctx, "Endereço IP", ipRef.endereco, { mono: true });
    field(
      ctx,
      "Origem da conexão",
      `${[ipRef.geo.city, ipRef.geo.region, ipRef.geo.country].filter(Boolean).join(" / ")} (${ipRef.geo.lat}, ${ipRef.geo.lon})`
    );
    const d = ipRef.divergenciaResidencia;
    if (d) {
      reserve(ctx, 170); // mesmo motivo do § 5.2: veredito e síntese juntos
      badge(ctx, "Distância entre a origem do IP e a residência", `${d.km.toFixed(2)} km · ${d.rotulo}`, d.tom === "ok");
      paragraph(ctx, d.sintese, { size: 9, color: d.tom === "danger" ? DANGER : INK });
    } else if (!home) {
      paragraph(ctx, "Distância não calculada: falta a coordenada de referência.", { color: MUTED, size: 8.5 });
    }

    if (mapas.mapaIpResidencia) {
      drawMap(
        ctx,
        mapas.mapaIpResidencia,
        "Mapa 1. Origem da conexão pelo endereço IP (I, vermelho) × residência informada (R, azul). A linha representa a distância geodésica (Haversine). O ponto I indica o ponto de presença da operadora, NÃO a posição do aparelho. Base cartográfica OpenStreetMap."
      );
    }
  }

  // ─── Confronto 2: residência × geolocalização declarada ───────────────────
  subheading(ctx, "§ 5.2 · Confronto 2 · residência informada × geolocalização declarada no documento");
  paragraph(
    ctx,
    "Pergunta: a coordenada que o próprio documento registra como local da assinatura corresponde à residência do contratante? Aqui as duas coordenadas são de precisão métrica (GPS declarado e ponto confirmado). A comparação é direta e, ao contrário do Confronto 1, uma divergência de poucos quilômetros já é significativa.",
    { color: MUTED, size: 8.5 }
  );

  if (!cg) {
    paragraph(
      ctx,
      result.geoDeclaredPresent
        ? "Confronto não realizado: o documento indica geolocalização da assinatura, mas não foi possível obter coordenadas válidas nem geocodificar o endereço declarado."
        : "Confronto não realizado: não foi localizada geolocalização (coordenadas GPS) declarada no log de assinatura deste documento.",
      { color: MUTED, size: 9 }
    );
  } else {
    if (cg.endereco) field(ctx, "Endereço declarado", cg.endereco);
    field(ctx, "Coordenada declarada", `${cg.lat}, ${cg.lon}`, { mono: true });
    field(ctx, "   Origem da coordenada", `${cg.fonte || "não informada"} (precisão ${precisionText(cg)})`);
    if (cg.dataHora) field(ctx, "   Data / hora do registro", cg.dataHora);

    // Régua PRÓPRIA deste confronto. `riskFromDistance` (50/300/1000 km) é
    // calibrada para geolocalização de IP e rotulava 1,47 km como "RISCO BAIXO"
    // logo abaixo do parágrafo que afirma o contrário — ver geoDivergence.js.
    if (declarado) {
      // Veredito + síntese + eventual ressalva formam um bloco só.
      reserve(ctx, 170);
      badge(
        ctx,
        "Distância entre o local declarado e a residência",
        `${declarado.km.toFixed(2)} km · ${declarado.rotulo}`,
        declarado.nivel === "compativel"
      );
      paragraph(ctx, declarado.sintese, { size: 9 });
      if (declarado.ressalva) paragraph(ctx, declarado.ressalva, { color: MUTED, size: 8.5 });
    }

    if (mapas.mapaResidenciaDeclarado) {
      drawMap(
        ctx,
        mapas.mapaResidenciaDeclarado,
        "Mapa 2. Residência informada (R, azul) × geolocalização declarada no documento (A, âmbar). A linha representa a distância geodésica (Haversine). Ambos os pontos têm precisão métrica, ao contrário do Mapa 1. Base cartográfica OpenStreetMap."
      );
    }
  }

  // ─── Leitura conjunta ─────────────────────────────────────────────────────
  // O cruzamento dos dois confrontos é o achado que nenhum deles produz
  // isoladamente, e era exatamente o que o mapa único não permitia enxergar.
  // O gatilho segue a CLASSIFICAÇÃO dos dois confrontos, não um limite solto em
  // km: o texto afirma "praticamente no mesmo local", e isso só é verdade na
  // faixa compatível. O `< 30 km` anterior faria o laudo escrever essa frase
  // para uma divergência de 29 km, que é justamente um achado relevante.
  if (ipRef?.divergenciaResidencia && declarado) {
    const ipLonge = ipRef.divergenciaResidencia.nivel !== "compativel";
    if (ipLonge && declarado.nivel === "compativel") {
      paragraph(
        ctx,
        `Leitura conjunta dos dois confrontos: o documento declara que a assinatura ocorreu a ${declarado.km.toFixed(2)} km da residência do contratante, praticamente no mesmo local, mas a conexão que originou o ato partiu de ${ipRef.divergenciaResidencia.km.toFixed(2)} km de distância. A coordenada declarada e a origem real da conexão apontam regiões distintas. A divergência não comprova fraude e admite explicações legítimas (uso de rede de terceiro, imprecisão da base de geolocalização, roteamento da operadora), mas é ponto que exige esclarecimento da instituição financeira, a quem incumbe demonstrar a autenticidade do ato (STJ, Tema 1.061).`,
        { color: DANGER, size: 9 }
      );
    } else if (ipLonge && declarado.nivel !== "compativel") {
      // Os dois confrontos divergem. Vale dizer isso explicitamente, senão o
      // leitor precisa cruzar duas seções para perceber que nada fecha.
      paragraph(
        ctx,
        `Leitura conjunta dos dois confrontos: nenhum dos dois pontos coincide com a residência informada. O local declarado no documento está a ${declarado.km.toFixed(2)} km e a origem da conexão a ${ipRef.divergenciaResidencia.km.toFixed(2)} km. As duas divergências são independentes e devem ser esclarecidas separadamente, confrontadas com a data e hora do registro, com a versão do contratante sobre onde esteve e com a localização do correspondente bancário.`,
        { color: DANGER, size: 9 }
      );
    }
  }

  sectionIpTrace(ctx, result);

  if (!cg && !ips.length && !result.home?.query) {
    paragraph(ctx, "Não foram extraídos dados de geolocalização (IP, coordenadas ou endereço) suficientes para o confronto geográfico neste documento.", { color: MUTED });
  }
  paragraph(ctx, NOTA_DISTANCIA, { color: MUTED, size: 8.5 });
}

/**
 * § 5.3 — detalhamento do rastro de conexão.
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
  subheading(ctx, "§ 5.3 · Rastro de conexão · detalhamento dos endereços IP");

  paragraph(
    ctx,
    "Um endereço IP não carrega coordenada. A localização abaixo vem de base que mapeia blocos de IP ao ponto de presença da operadora, ou seja, ao roteador de saída, não ao aparelho. Em rede móvel brasileira, com CGNAT e blocos IPv6 alocados por região, o ponto devolvido tende à capital ou ao centro de operação do estado. Divergências de dezenas de quilômetros são esperadas; o que tem valor indiciário é a incompatibilidade de ordem de grandeza.",
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

    // Endereço de CGNAT não é ausência de dado nem falha de consulta: é um
    // endereço que, por natureza, não localiza ninguém. Tratá-lo com a mesma
    // frase de "o provedor não respondeu" seria impreciso, e a consequência
    // probatória (o endereço sozinho não individualiza o assinante) é o ponto
    // mais importante a registrar quando o documento traz IPv4.
    if (ip.compartilhado) {
      paragraph(
        ctx,
        "Este endereço pertence ao espaço compartilhado entre assinantes (CGNAT, RFC 6598, faixa 100.64.0.0/10). Trata-se de endereço interno da operadora, atribuído simultaneamente a um grande número de clientes, razão pela qual não corresponde a uma localização geográfica do usuário e não é possível confrontá-lo com a residência informada. A identificação de quem utilizava a conexão depende de requisição à operadora do conjunto endereço, PORTA LÓGICA e data e hora do acesso (Marco Civil da Internet, arts. 13 e 15, c/c art. 22). A ausência de qualquer um desses três elementos no documento inviabiliza a identificação, ainda que o endereço esteja registrado.",
        { color: DANGER, size: 8.5 }
      );
      if (!ip.porta) {
        paragraph(
          ctx,
          "Observa-se que o documento NÃO registra a porta lógica, elemento sem o qual a operadora não consegue individualizar o assinante em conexão sob CGNAT.",
          { color: DANGER, size: 8.5 }
        );
      }
      continue;
    }

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
      `${[ip.geo.city, ip.geo.region, ip.geo.country].filter(Boolean).join(" / ")} (${ip.geo.lat}, ${ip.geo.lon})`
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

/*
 * ─── Numeração contígua ───────────────────────────────────────────────────────
 *
 * O rastro de IP era o § 6 e passou a ser o § 5.3, mas as seções seguintes
 * mantiveram 7, 8 e 9. Somado ao fato de que irregularidades e observações só
 * eram impressas quando havia conteúdo, o laudo do documento de teste saía com a
 * numeração pulando de § 5 para § 8 — o tipo de detalhe que faz um leitor
 * técnico duvidar de que o documento esteja completo.
 *
 * As duas seções passam a ser SEMPRE impressas. Além de fechar o buraco, é a
 * postura correta num laudo: afirmar que não se encontrou irregularidade é
 * conclusão pericial; omitir a seção deixa o leitor sem saber se o exame foi
 * feito.
 */
function sectionIrregularities(ctx, extracted) {
  const evs = extracted.evidencias_irregularidade || [];
  heading(ctx, "§ 6 · Evidências de irregularidade", { danger: evs.length > 0 });

  if (!evs.length) {
    paragraph(
      ctx,
      "A análise dos elementos extraídos deste documento não identificou evidência autônoma de irregularidade. A ausência de achado nesta seção não convalida o instrumento: as ressalvas dos §§ 4 e 5 subsistem e devem ser lidas em conjunto.",
      { size: 9 }
    );
    return;
  }

  for (const ev of evs) {
    const { doc, contentWidth } = ctx;
    if (doc.y > doc.page.height - 100) doc.addPage();
    doc.fontSize(9.5).font("Helvetica").fillColor(DANGER).text("▸ ", MARGIN, doc.y, { continued: true });
    doc.fillColor(INK).text(ev, { width: contentWidth });
    doc.moveDown(0.2);
  }
}

function sectionRemarks(ctx, extracted) {
  heading(ctx, "§ 7 · Observações periciais complementares");
  paragraph(
    ctx,
    extracted.observacoes_periciais ||
      "Não há observação complementar além do que já consta das seções anteriores."
  );
}

function sectionLegal(ctx) {
  heading(ctx, "§ 8 · Fundamentação normativa aplicável");
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
