import { exigirEmissaoCoerente } from "../engine/validarEmissao.js";
import PDFDocument from "pdfkit";
import { classifyDeclaredDivergence } from "../utils/geoDivergence.js";
import { fetchStaticMap, mapPointsIpVsHome, mapPointsHomeVsDeclared, mapPointsDeclaredVsIp } from "./staticMapService.js";
import {
  FIRM,
  NOTA_ASSINATURA,
  NOTA_HASH_SISTEMA,
  NOTA_DISTANCIA,
  fundamentacaoPara,
  NOTA_FUNDAMENTACAO_RESSALVA,
  avisoLegal,
} from "../reports/laudoTexts.js";
import { buildCustodyChain } from "../reports/custodyChain.js";
import * as temaModelo from "../reports/temaModelo.js";
import { desenharQr, urlDeVerificacao } from "../reports/qrVerificacao.js";
import { calculateForensicScore } from "../utils/forensicScore.js";
import { generateJudicialQuesitos } from "../reports/quesitosTemplate.js";
import { montarConfrontoGeografico } from "../utils/distancia.js";
import { descreverIndisponibilidade } from "../utils/confrontoEnderecos.js";
import { fichaBeneficioSeAplica } from "../engine/produto.js";
import { distanciaKm, distanciaSuspeita, formatarDistancia } from "../utils/distancia.js";
import { haversineKm } from "../utils/geoUtils.js";
import {
  confrontoHash,
  shortHash,
  formatCnpj,
  formatCpf,
  labelHashState,
  labelProvenance,
  noteForDeclaredHashState,
  reportIssues,
  issueBucket,
  GRUPOS_ACHADOS,
  extractCnjFromName,
  labelComparisonStatus,
  semPontoFinal,
  labelModalidade,
  formatMetadataWarning,
  sanearSumario,
} from "../reports/laudoApresentacao.js";

// Paleta sóbria para peça processual (impressão em preto e branco continua legível).
const INK = "#1a1a1a";
const MUTED = "#6b7280";
const ACCENT = "#0f766e";
const DANGER = "#b91c1c";
const RULE = "#d4d4d8";

const MARGIN = 50;
// O rodapé é escrito a partir de `page.height - 45`. Uma margem inferior de
// 70pt deixava 25pt de faixa morta em toda página do laudo; 58pt encostam o
// texto do corpo 13pt acima da linha do SHA-256, sem invadi-la.
const MARGIN_BOTTOM = 58;
// Largura do mapa estático como fração da coluna de texto. A imagem vem em
// 780x460, e à largura cheia ocupava 292pt (40% da altura útil): não cabendo
// no resto da página, ela empurrava tudo e abria um vazio do mesmo tamanho.
const MAP_WIDTH_RATIO = 0.78;
// Redução máxima tolerada para encaixar o mapa no que resta da página. Abaixo de
// 75% os rótulos de município da base cartográfica deixam de ser legíveis em
// impressão, e aí compensa mais jogar a figura para a folha seguinte.
const MAP_MIN_SCALE = 0.75;

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
export async function buildReportPdf(analysis, result, opcoes = {}) {
  exigirEmissaoCoerente(result);
  /*
   * `tema` escolhe o desenho do laudo. "modelo" é o padrão: cartões, linha com
   * o valor à direita, selos em pílula, Inter e JetBrains Mono, o mesmo desenho
   * que o laudo tinha quando era exportado como imagem pelo navegador, agora em
   * vetor e com texto pesquisável. "classico" fica disponível para comparação e
   * para voltar atrás sem reescrever nada. O conteúdo, as regras e a paginação
   * protegida são os mesmos nos dois.
   */
  const tema = opcoes.tema === "classico" ? "classico" : "modelo";
  /*
   * Registro de verificação pública do laudo (código + SHA-256 do conteúdo).
   * Vem de fora porque o PDF não deve consultar o banco: quem monta o
   * documento recebe pronto o que vai imprimir.
   *
   * É opcional de propósito. Laudo antigo, anterior ao backfill, continua
   * sendo gerado sem o bloco em vez de falhar.
   */
  const verificacao = opcoes.verificacao || null;
  // Pré-busca dos DOIS mapas do § 5, em paralelo. Cada um responde a uma
  // pergunta pericial distinta (ver staticMapService.js) e nenhum é requisito:
  // se a busca falhar, a seção sai com as coordenadas e as distâncias.
  const [mapaIpResidencia, mapaResidenciaDeclarado, mapaDeclaradoIp] = await Promise.all([
    fetchStaticMap(mapPointsIpVsHome(result)).catch(() => null),
    fetchStaticMap(mapPointsHomeVsDeclared(result)).catch(() => null),
    fetchStaticMap(mapPointsDeclaredVsIp(result)).catch(() => null),
  ]);

  const doc = new PDFDocument({
    size: "A4",
    margins: tema === "modelo"
      ? { top: temaModelo.MARGEM_TOPO, bottom: temaModelo.MARGEM_RODAPE, left: temaModelo.MARGEM_TEXTO, right: temaModelo.MARGEM_TEXTO }
      : { top: MARGIN, bottom: MARGIN_BOTTOM, left: MARGIN, right: MARGIN },
    bufferPages: true, // necessário para numerar o rodapé no fim
    info: {
      Title: `Laudo ForenseDoc ${result.reportId || analysis.id}`,
      Author: FIRM.nome,
      Creator: FIRM.sistema,
    },
  });

  // Fontes padrão PDFKit usam WinAnsi: normalizar acentos compostos e sinais
  // matemáticos evita nomes corrompidos e operadores ilegíveis no texto extraído.
  const escrever = doc.text.bind(doc);
  doc.text = (text, ...args) => escrever(typeof text === "string" ? text.normalize("NFC").replace(/−/g, "-").replace(/→/g, "->").replace(/≥/g, ">=").replace(/≤/g, "<=") : text, ...args);
  const extraido = safeParse(result.text);
  const extracted = extraido || {};
  const timestamp = result.generatedAt
    ? new Date(result.generatedAt).toLocaleString("pt-BR", { timeZone: "America/Fortaleza" })
    : new Date(analysis.createdAt).toLocaleString("pt-BR", { timeZone: "America/Fortaleza" });

  const ctx = { doc, contentWidth: doc.page.width - MARGIN * 2, tema, cartao: null };
  if (tema === "modelo") {
    temaModelo.registrarFontes(doc);
    // A moldura é pintada a cada página nova; o cartão aberto fecha no pé e
    // recomeça no topo, para a seção não perder a borda ao virar a folha.
    doc.on("pageAdded", () => {
      const { x, y } = doc;
      temaModelo.pintarMoldura(doc);
      doc.x = x;
      doc.y = y;
      temaModelo.quebrarCartao(ctx);
    });
    temaModelo.pintarMoldura(doc);
    doc.x = temaModelo.MARGEM_TEXTO;
    doc.y = temaModelo.MARGEM_TOPO;
  }
  // O sumário passa pelo mesmo saneamento da tela (montarRelatorio.js): item
  // que a tela retira de sumário legado não pode reaparecer no PDF.
  const sumario = sanearSumario(result.sumarioIrregularidades || null, result.home, result.ipAnalysis || [], result.contractGeo);

  cover(ctx, analysis, result, timestamp, extracted);
  sectionVerificacao(ctx, verificacao);
  sectionProcessingNotices(ctx, result, Boolean(extraido));
  sectionReview(ctx, result);
  sectionIdentity(ctx, result, extracted);
  sectionMetadata(ctx, result.metadata);
  sectionDigitalSignature(ctx, result.metadata);
  sectionContract(ctx, extracted);
  sectionCreditRelease(ctx, extracted);
  sectionInsurance(ctx, extracted);
  sectionClient(ctx, extracted, result);
  sectionSignature(ctx, extracted, result);
  sectionContractingTrail(ctx, extracted, result);
  sectionEventTrail(ctx, extracted);
  sectionImages(ctx, extracted);
  sectionGeo(ctx, result, { mapaIpResidencia, mapaResidenciaDeclarado, mapaDeclaradoIp });
  sectionIrregularities(ctx, extracted, sumario?.projecao);
  sectionProcessComparison(ctx, result.processComparison);
  sectionRemarks(ctx, extracted);
  sectionQuesitos(ctx, extracted, result);
  sectionLegal(ctx, extracted, result);
  sectionExecutiveSummary(ctx, sumario, result.reportId);
  sectionImageAnnex(ctx, extracted);
  legalNotice(ctx, timestamp);

  if (tema === "modelo") {
    temaModelo.fecharCartao(ctx);
    temaModelo.pintarRodapes(doc, result.hashes?.sha256);
  } else {
    paintFooters(doc, result.hashes?.sha256);
  }

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
  if (ctx.tema === "modelo") return temaModelo.subheading(ctx, title);
  const { doc, contentWidth } = ctx;
  reserve(ctx, 54); // título da subseção + duas linhas do que vem abaixo
  doc.moveDown(0.3);
  doc
    .fontSize(10.5)
    .fillColor(INK)
    .font("Helvetica-Bold")
    .text(title, MARGIN, doc.y, { width: contentWidth });
  doc.moveDown(0.2);
}

function heading(ctx, title, { danger = false } = {}) {
  if (ctx.tema === "modelo") return temaModelo.heading(ctx, title, { danger });
  const { doc, contentWidth } = ctx;
  reserve(ctx, 62); // título + régua + duas linhas, para o heading não ficar órfão
  doc.moveDown(0.6);
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
  if (ctx.tema === "modelo") return temaModelo.field(ctx, label, value, { mono });
  const { doc, contentWidth } = ctx;
  reserve(ctx, 16); // uma linha
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
  if (ctx.tema === "modelo") return temaModelo.paragraph(ctx, text, { color, size, italic });
  const { doc, contentWidth } = ctx;
  // O PDFKit já quebra o parágrafo sozinho no meio; a guarda só evita começar um
  // com menos de duas linhas de espaço, o que deixaria uma viúva no pé.
  reserve(ctx, 30);
  doc
    .fontSize(size)
    .font(italic ? "Helvetica-Oblique" : "Helvetica")
    .fillColor(color)
    .text(text, MARGIN, doc.y, { width: contentWidth, align: "justify", lineGap: 1.5 });
  doc.moveDown(0.35);
}

/**
 * Reserva espaço para um bloco que não deve ser partido pela quebra de página.
 *
 * Os guardas espalhados pelos helpers medem cada elemento isoladamente, então um
 * veredito e a frase que o explica podiam caber "cada um" e ainda assim acabar em
 * páginas diferentes: o § 5.2 saía com o rótulo COMPATÍVEL no pé de uma página e
 * "O documento situa a assinatura praticamente no mesmo local" solto no topo da
 * seguinte, sem o número a que se referia.
 *
 * `pontos` é a altura REAL do bloco. A formulação anterior (`y > page.height -
 * pontos`) embutia a margem inferior no número, então cada guarda descartava
 * silenciosamente uma margem a mais de página: as reservas de 170pt protegiam
 * 100pt de texto e jogavam fora os outros 70.
 */
function reserve(ctx, pontos) {
  const { doc } = ctx;
  // Invariante que fecha a classe inteira do defeito: quebrar a página quando
  // ela ainda está intacta produz, por definição, uma folha em branco. Acontecia
  // com qualquer bloco mais alto do que a área útil — a guarda disparava, abria
  // a página, disparava de novo no topo e assim por diante. Aqui o bloco maior
  // que a folha simplesmente começa no topo e transborda como o PDFKit já sabe
  // tratar, em vez de empurrar uma página vazia à frente dele.
  if (doc.y <= doc.page.margins.top + 1) return;
  if (espacoLivre(doc) < pontos) doc.addPage();
}

/** Pontos de altura ainda utilizáveis na página corrente, já fora da margem. */
function espacoLivre(doc) {
  return doc.page.height - doc.page.margins.bottom - doc.y;
}

function badge(ctx, label, value, ok) {
  if (ctx.tema === "modelo") return temaModelo.badge(ctx, label, value, ok);
  const { doc, contentWidth } = ctx;
  reserve(ctx, 16);
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

const FUNDO_CABECALHO = "#f1f5f9";
const FUNDO_DESTAQUE = "#fef2f2";

/**
 * Tabela em fluxo, com quebra de página linha a linha e cabeçalho repetido.
 *
 * A tela apresenta a trilha, o histórico de ações e as imagens em tabelas; o
 * PDF imprimia uma linha "rótulo: valor" por evento, e as colunas que não
 * cabiam nessa linha (dispositivo, hora local, classe da imagem) ficavam de
 * fora. `colunas` traz a largura como fração da coluna de texto.
 */
function table(ctx, colunas, linhas, { size = 7.5, destaque = null } = {}) {
  if (ctx.tema === "modelo") return temaModelo.table(ctx, colunas, linhas, { size, destaque });
  const { doc, contentWidth } = ctx;
  if (!linhas.length) return;
  const PAD = 3;
  const larguras = colunas.map((c) => c.largura * contentWidth);
  const fonte = (i, negrito) => (negrito ? "Helvetica-Bold" : colunas[i].mono ? "Courier" : "Helvetica");
  const texto = (v) => (v === null || v === undefined || v === "" ? "-" : String(v));
  const medir = (valores, negrito) =>
    Math.max(
      ...valores.map((v, i) => {
        doc.font(fonte(i, negrito)).fontSize(size);
        return doc.heightOfString(texto(v), { width: larguras[i] - PAD * 2 });
      })
    ) + PAD * 2;
  const desenhar = (valores, { negrito = false, fundo = null } = {}) => {
    const altura = medir(valores, negrito);
    const y = doc.y;
    if (fundo) doc.rect(MARGIN, y, contentWidth, altura).fillColor(fundo).fill();
    let x = MARGIN;
    valores.forEach((v, i) => {
      doc.font(fonte(i, negrito)).fontSize(size).fillColor(INK).text(texto(v), x + PAD, y + PAD, { width: larguras[i] - PAD * 2 });
      x += larguras[i];
    });
    doc.moveTo(MARGIN, y + altura).lineTo(MARGIN + contentWidth, y + altura).strokeColor(RULE).lineWidth(0.4).stroke();
    doc.x = MARGIN;
    doc.y = y + altura;
  };
  const cabecalho = colunas.map((c) => c.titulo);
  reserve(ctx, medir(cabecalho, true) + medir(linhas[0], false));
  desenhar(cabecalho, { negrito: true, fundo: FUNDO_CABECALHO });
  linhas.forEach((linha, i) => {
    if (espacoLivre(doc) < medir(linha, false)) {
      doc.addPage();
      desenhar(cabecalho, { negrito: true, fundo: FUNDO_CABECALHO });
    }
    desenhar(linha, { fundo: destaque?.(i) ? FUNDO_DESTAQUE : null });
  });
  doc.font("Helvetica");
  doc.moveDown(0.4);
}

/** Item de lista com marcador, usado para achados e diligências. */
function bullet(ctx, text, { color = INK, size = 9 } = {}) {
  if (ctx.tema === "modelo") return temaModelo.bullet(ctx, text, { color, size });
  const { doc, contentWidth } = ctx;
  reserve(ctx, 24);
  // "•" existe na codificação WinAnsi das fontes padrão; "▸" não.
  doc.fontSize(size).font("Helvetica").fillColor(ACCENT).text("•", MARGIN, doc.y, { width: 10 });
  doc.moveUp();
  doc.fillColor(color).text(text, MARGIN + 12, doc.y, { width: contentWidth - 12, align: "justify", lineGap: 1.2 });
  doc.x = MARGIN;
  doc.moveDown(0.25);
}

// ─────────────────────────────────────────────────────────────
// Seções
// ─────────────────────────────────────────────────────────────

function cover(ctx, analysis, result, timestamp, extracted = {}) {
  const { doc, contentWidth } = ctx;

  // ─── Visual Law: Resumo Executivo para o Magistrado / Perito ────────────────
  // Distâncias do confronto canônico: recusado o confronto, não há índice.
  const confrontoCapa = result.confronto_geografico || montarConfrontoGeografico(result);
  const distKmIp = confrontoCapa.distancias.ips_residencia[0]?.km ?? null;
  const distKmGps = confrontoCapa.distancias.gps_residencia;
  const distKmIpVsGps = confrontoCapa.gps_ip;
  const scoreObj = calculateForensicScore({ distKmIp, distKmGps, distKmIpVsGps });

  const ipLoc = result.ipAnalysis?.[0]?.geo?.city
    ? `${result.ipAnalysis[0].geo.city}/${result.ipAnalysis[0].geo.region || ""}`
    : "Não localizada";
  // Referência recusada não é domicílio: a capa usa a qualificação do
  // instrumento e diz que o endereço informado não foi utilizado.
  const recusada = confrontoCapa.status === "RECUSADO_CONFLITO" || confrontoCapa.status === "INDISPONIVEL_NAO_INFORMADO";
  const inst = result.home?.instrumento || {};
  const cidadeInstrumento = [inst.cidade, inst.uf].filter(Boolean).join("/");
  const homeLoc = recusada
    ? `${cidadeInstrumento || "não identificado no instrumento"} (qualificação do instrumento; o endereço informado não foi utilizado)`
    : result.home?.geo?.display || result.home?.query || "Domicílio declarado";
  const km = (v) => `${v.toFixed(1).replace(".", ",")} km`;
  const cg = result.contractGeo;
  const temGps = cg && Number.isFinite(cg.lat) && Number.isFinite(cg.lon);
  const origemDetalhe = distKmIp !== null
    ? `${km(distKmIp)} do domicílio`
    : distKmIpVsGps !== null
      ? `${km(distKmIpVsGps)} do GPS declarado no ato`
      : "N/D";
  const gpsTexto = !temGps
    ? "Não registrado"
    : `${cg.municipio ? `${cg.municipio}${cg.uf ? `/${cg.uf}` : ""} ` : ""}(${cg.lat}, ${cg.lon})${distKmGps !== null ? `, ${km(distKmGps)} do domicílio` : ", confronto com a residência não aferido"}`;

  const resumoTitulo = "Resumo executivo · índice de anomalia forense";
  const resumoValor = scoreObj.score === null ? scoreObj.rotulo : `${scoreObj.score}/100 · ${scoreObj.rotulo}`;
  const resumoLinhas = [
    `Domicílio do titular: ${homeLoc}`,
    `Estimativa da consulta do IP: ${ipLoc} (${origemDetalhe})`,
    `GPS registrado no ato: ${gpsTexto}`,
  ];
  const tamanhoArquivo = result.file?.sizeBytes
    ? `${(result.file.sizeBytes / 1024).toFixed(2)} KB (${result.file.sizeBytes.toLocaleString("pt-BR")} bytes)`
    : null;
  const escopo = "Integridade criptográfica · Metadados e OCR · Cadeia de custódia · Confronto geográfico";

  if (ctx.tema === "modelo") {
    return temaModelo.capa(ctx, {
      protocolo: result.reportId || analysis.id,
      emissao: `${timestamp}\n(Fortaleza, BRT)`,
      arquivo: result.file?.name || "nome não informado",
      tamanho: tamanhoArquivo,
      sha256: result.hashes?.sha256,
      produto: extracted.contrato?.produto || "Instrumento de crédito",
      ocr: result.usedOcr ? `Aplicado em ${result.ocrPages} página(s)` : null,
      escopo,
      resumoTitulo,
      resumoValor,
      resumoLinhas,
      alerta: scoreObj.score !== null && scoreObj.score >= 80,
    });
  }

  doc.fontSize(11).font("Helvetica-Bold").fillColor(ACCENT).text(FIRM.sistema.toUpperCase(), { align: "center" });
  doc.moveDown(0.3);
  doc.fontSize(19).font("Helvetica-Bold").fillColor(INK).text("Laudo Técnico Pericial", { align: "center" });
  doc.fontSize(11).font("Helvetica").fillColor(MUTED).text("Exame automatizado de integridade, autoria e consistência documental", { align: "center" });
  doc.moveDown(0.5);
  doc.fontSize(8.5).fillColor(MUTED).text(FIRM.descricao, { align: "center" });
  doc.moveDown(1);

  doc.moveTo(MARGIN, doc.y).lineTo(MARGIN + contentWidth, doc.y).strokeColor(RULE).lineWidth(1).stroke();
  doc.moveDown(0.6);

  field(ctx, "Instrumento examinado", extracted.contrato?.produto || "Instrumento de crédito");
  field(ctx, "Identificador do laudo", result.reportId || analysis.id);
  field(ctx, "Arquivo analisado", result.file?.name || "nome não informado");
  field(ctx, "Tamanho do arquivo", result.file?.sizeBytes ? `${(result.file.sizeBytes / 1024).toFixed(2)} KB (${result.file.sizeBytes.toLocaleString("pt-BR")} bytes)` : null);
  field(ctx, "Data de geração", `${timestamp} (Fortaleza, BRT)`);
  if (result.usedOcr) field(ctx, "OCR", `Aplicado em ${result.ocrPages} página(s)`);
  field(ctx, "Escopo do exame", "Integridade criptográfica · Metadados e OCR · Cadeia de custódia · Confronto geográfico");

  doc.moveDown(0.6);
  const boxX = MARGIN;
  const boxY = doc.y;
  const boxWidth = contentWidth;
  const boxHeight = 105;

  doc
    .roundedRect(boxX, boxY, boxWidth, boxHeight, 4)
    .fillColor(scoreObj.score >= 80 ? "#fef2f2" : "#f8fafc")
    .strokeColor(scoreObj.score >= 80 ? "#fca5a5" : "#cbd5e1")
    .lineWidth(1)
    .fillAndStroke();

  doc
    .fontSize(10)
    .font("Helvetica-Bold")
    .fillColor(scoreObj.score >= 80 ? DANGER : ACCENT)
    .text("RESUMO EXECUTIVO · ÍNDICE DE ANOMALIA FORENSE", boxX + 12, boxY + 10, { width: boxWidth - 24 });

  doc
    .fontSize(15)
    .font("Helvetica-Bold")
    .fillColor(scoreObj.score >= 80 ? DANGER : INK)
    .text(scoreObj.score === null ? scoreObj.rotulo : `${scoreObj.score}/100 · ${scoreObj.rotulo}`, boxX + 12, boxY + 26);

  doc
    .fontSize(8.5)
    .font("Helvetica")
    .fillColor(INK)
    .text(
      `• Domicílio do titular: ${homeLoc}\n` +
      `• Estimativa da consulta do IP: ${ipLoc} (${origemDetalhe})\n` +
      `• GPS registrado no ato: ${gpsTexto}`,
      boxX + 12,
      boxY + 48,
      { width: boxWidth - 24, lineGap: 1.5 }
    );

  // O texto do quadro deixa o cursor horizontal recuado; sem voltar à margem,
  // todo o § 1 saía deslocado.
  doc.x = MARGIN;
  doc.y = boxY + boxHeight + 10;
}

/**
 * Avisos de processamento que a tela exibe logo abaixo da capa: a nota do
 * worker (ex.: OCR parcial) e a falha da extração estruturada. Quem lê só o
 * PDF precisa saber que o laudo saiu com dados parciais.
 */
function sectionProcessingNotices(ctx, result, extracaoValida) {
  if (result.warning) {
    subheading(ctx, "Nota de processamento");
    paragraph(ctx, result.warning, { size: 9 });
  }
  if (!extracaoValida) {
    subheading(ctx, "Extração automática parcial");
    paragraph(
      ctx,
      "A extração automática não retornou dados estruturados válidos. O laudo foi gerado com os dados disponíveis.",
      { color: DANGER, size: 9 }
    );
  }
}

/**
 * § 0 — campos conferidos pelo operador.
 *
 * A extração é automatizada e frágil a formato novo. Quando o operador confere
 * ou completa um campo, isso NÃO pode ficar implícito: o leitor da peça precisa
 * saber quais dados vieram da leitura automática e quais foram atestados por
 * pessoa identificada.
 *
 * Declarar fortalece a peça em vez de enfraquecê-la. Um dado conferido por
 * humano tem mais peso que um extraído por heurística, e esconder a conferência
 * desperdiçaria exatamente o que ela agrega.
 *
 * O valor ANTERIOR também é declarado, porque distingue dois atos diferentes:
 * preencher o que faltava e substituir o que o sistema havia lido. O segundo
 * pede mais atenção de quem avalia a prova.
 */
function sectionReview(ctx, result) {
  const revisados = Object.entries(result.camposRevisados || {});
  if (revisados.length === 0) return;

  heading(ctx, "§ 0 · Campos conferidos pelo operador");
  paragraph(
    ctx,
    "Os campos abaixo foram conferidos ou completados manualmente pelo operador antes da emissão desta peça. A extração automatizada não os localizou, ou os localizou de forma divergente. Cada registro indica o valor anterior, o valor adotado e o momento da conferência.",
    { size: 9 }
  );

  for (const [, r] of revisados) {
    field(ctx, r.rotulo, r.valor ?? "não informado");
    field(
      ctx,
      "   Antes da conferência",
      r.anterior ? String(r.anterior) : "campo não localizado pela extração"
    );
    field(
      ctx,
      "   Conferido em",
      new Date(r.em).toLocaleString("pt-BR", { timeZone: "America/Fortaleza" })
    );
    ctx.doc.moveDown(0.2);
  }

  paragraph(
    ctx,
    "A conferência humana é requisito de uso deste sistema, e não uma exceção: o laudo é instrumento de apoio e depende de validação por quem o utiliza. O registro acima documenta que essa validação ocorreu.",
    { color: MUTED, size: 8.5 }
  );
}

/**
 * Bloco de verificação pública: código, hash do laudo e QR Code.
 *
 * Fica no fluxo comum, logo depois da capa, e não dentro dela. Os dois temas
 * desenham a capa de formas muito diferentes ("modelo" monta um cartão com
 * degradê e medidas próprias, protegido por teste de regressão), e duplicar o
 * bloco nas duas implementações significaria manter duas versões da mesma
 * coisa. Como seção própria, ele sai igual nos dois e é fácil de achar no
 * documento impresso, que é onde alguém vai procurá-lo.
 */
function sectionVerificacao(ctx, verificacao) {
  if (!verificacao) return;
  const { doc, contentWidth } = ctx;

  const LADO_QR = 74;
  reserve(ctx, LADO_QR + 46);

  heading(ctx, "Verificação de autenticidade");

  const yTopo = doc.y;
  const { lado } = desenharQr(doc, {
    conteudo: urlDeVerificacao(verificacao.codigo),
    x: MARGIN,
    y: yTopo,
    lado: LADO_QR,
  });

  const xTexto = MARGIN + lado + 16;
  const larguraTexto = contentWidth - lado - 16;

  doc.fontSize(8).font("Helvetica").fillColor(MUTED)
    .text("CÓDIGO DE VERIFICAÇÃO", xTexto, yTopo, { width: larguraTexto, characterSpacing: 0.4 });
  doc.fontSize(12).font("Courier-Bold").fillColor(INK)
    .text(verificacao.codigo, xTexto, doc.y + 1, { width: larguraTexto });

  doc.fontSize(8).font("Helvetica").fillColor(MUTED)
    .text("SHA-256 DESTE LAUDO", xTexto, doc.y + 6, { width: larguraTexto, characterSpacing: 0.4 });
  doc.fontSize(7).font("Courier").fillColor(INK)
    .text(verificacao.laudoHash, xTexto, doc.y + 1, { width: larguraTexto });

  doc.fontSize(7.5).font("Helvetica").fillColor(MUTED)
    .text(
      `Aponte a câmera para o código ao lado ou informe o código de verificação em ${urlDeVerificacao("").replace(/\/$/, "")}. A conferência é pública e não exige cadastro.`,
      xTexto,
      doc.y + 6,
      { width: larguraTexto }
    );

  // O texto pode ser mais curto que o QR: a linha de baixo tem que começar
  // depois do mais alto dos dois, senão a próxima seção invade o código.
  doc.y = Math.max(doc.y, yTopo + lado) + 8;
  doc.x = MARGIN;

  paragraph(
    ctx,
    "O código acima confere o CONTEÚDO do laudo, não o arquivo. O PDF é remontado a cada download e seus bytes mudam a cada geração, o que tornaria o resumo do arquivo inútil como prova de integridade. Na página de verificação constam os mesmos resumos criptográficos impressos aqui e o nome do titular de forma parcial, para conferência.",
    { size: 8 }
  );
}

function sectionIdentity(ctx, result, extracted) {
  heading(ctx, "§ 1 · Identificação e integridade criptográfica");
  field(ctx, "Nome do arquivo", result.file?.name);
  if (result.file?.sizeBytes) {
    field(ctx, "Tamanho", `${(result.file.sizeBytes / 1024).toFixed(2)} KB (${result.file.sizeBytes.toLocaleString("pt-BR")} bytes)`);
  }
  field(ctx, "Tipo de documento", extracted.tipo_documento);
  field(ctx, "Qualidade de leitura/OCR", extracted.qualidade_ocr);
  if (result.hashes) {
    field(ctx, "SHA-256 (calculado pelo servidor)", result.hashes.sha256, { mono: true });
    field(ctx, "SHA-1 (calculado pelo servidor)", result.hashes.sha1, { mono: true });
  }

  const a = extracted.assinatura || {};
  const declared = a.hash_documento_assinado ? String(a.hash_documento_assinado).trim() : null;
  if (declared) {
    // Confronto hash informado × hash encontrado, com a mesma decisão da tela.
    const c = confrontoHash(declared, result.hashes?.sha256);
    subheading(ctx, "Confronto · hash informado × hash encontrado");
    field(ctx, "Hash informado no documento", declared, { mono: true });
    field(ctx, "   Algoritmo declarado", a.algoritmo_hash || "não informado");
    field(ctx, "   Formato detectado", `${c.formato || "não identificado"}${c.ehHash ? "" : " (não é hash criptográfico)"}`);
    field(ctx, "Hash encontrado (calculado)", result.hashes?.sha256, { mono: true });
    field(ctx, "   Algoritmo", "SHA-256 (NIST FIPS 180-4), calculado pelo servidor sobre o arquivo original recebido");
    badge(ctx, "Resultado da comparação", c.resultado, c.confere);
    paragraph(ctx, c.nota, { size: 9, color: c.comparavel && !c.confere ? DANGER : INK });
  } else {
    const codigo = a.codigo_autenticacao_declarado;
    if (codigo) {
      // Protocolo não é hash: sai em campo próprio, sem painel de confronto.
      field(ctx, "Código de autenticação declarado (não é hash)", codigo, { mono: true });
      field(ctx, "   Origem do código", a.codigo_autenticacao_origem);
      field(ctx, "   Verificação oferecida", a.codigo_autenticacao_url_verificacao);
    }
    const estado = a.hash_declarado_estado || (codigo ? "DECLARADO_NAO_CONFERIVEL" : "AUSENTE");
    paragraph(ctx, noteForDeclaredHashState(estado, result.hashes?.sha256, a), { size: 9 });
  }
  paragraph(ctx, NOTA_HASH_SISTEMA, { color: MUTED, size: 8.5 });
}

// Avisos de metadado que só registram rastreabilidade, sem indicar alteração.
const SO_NOTAS_DE_RASTREABILIDADE = /Título interno|Autor interno|Assunto|Data de criação interna|não contém assinatura digital incorporada detectável/i;

function sectionMetadata(ctx, metadata) {
  if (!metadata) return;
  heading(ctx, "§ 1.1 · Verificação dos metadados internos do PDF");
  const warnings = metadata.warnings || [];
  const soNotas = warnings.length > 0 && warnings.every((w) => SO_NOTAS_DE_RASTREABILIDADE.test(w));
  badge(
    ctx,
    "Resultado da verificação",
    !warnings.length ? "SEM ALERTAS" : soNotas ? `${warnings.length} NOTA(S)` : `${warnings.length} ALERTA(S)`,
    !warnings.length || soNotas
  );
  const ds = metadata.digitalSignature;
  const sim = (v) => (v ? "Sim" : "Não");
  const linhas = [
    ["Versão do formato PDF", metadata.version],
    ["Número de páginas", metadata.totalPages],
    ["Formato das páginas", metadata.pageFormats?.join(" · ")],
    ["Título interno", metadata.title],
    ["Autor declarado", metadata.author],
    ["Assunto", metadata.subject],
    ["Palavras-chave", metadata.keywords],
    ["Aplicativo criador", metadata.creator],
    ["Produtor / conversor", metadata.producer],
    ["Data de criação interna", metadata.creationDate],
    // O extrator grava `modificationDate`; `modDate` nunca existiu e a linha
    // saía sempre vazia no PDF.
    ["Data de modificação interna", metadata.modificationDate ?? metadata.modDate],
    ["Idioma declarado", metadata.language],
    ["Arquivo criptografado", metadata.encrypted == null ? null : sim(metadata.encrypted)],
    ["PDF linearizado", metadata.linearized == null ? null : sim(metadata.linearized)],
    ["Procedência do arquivo", labelProvenance(ds?.procedencia?.procedencia, ds?.procedencia)],
    ["Formulário AcroForm", metadata.hasAcroForm == null ? null : metadata.hasAcroForm ? "Presente" : "Ausente"],
    ["AcroForm xref", ds?.catalog?.acroformXref],
    ["SigFlags", ds?.catalog?.sigFlags],
    ["Formulário XFA", metadata.hasXfa == null ? null : metadata.hasXfa ? "Presente" : "Ausente"],
    ["Assinatura digital incorporada", metadata.cryptographicSignatureStatus || (metadata.hasEmbeddedSignatures ? "Detectada" : "Não detectada")],
  ];
  for (const [rotulo, valor] of linhas) field(ctx, rotulo, valor);
  field(ctx, "Identificador interno do trailer", metadata.trailerFingerprint, { mono: true });

  if (warnings.length) {
    subheading(ctx, "Achados da auditoria de metadados");
    for (const w of warnings) bullet(ctx, formatMetadataWarning(w), { size: 8.5, color: soNotas ? INK : DANGER });
  }
  paragraph(
    ctx,
    "Metadados são campos declarativos e podem ser alterados por editores de PDF. Eles servem como indício técnico e devem ser avaliados em conjunto com os hashes do arquivo, a assinatura digital incorporada e a cadeia de custódia.",
    { color: MUTED, size: 8.5 }
  );
}

function sectionContract(ctx, extracted) {
  const c = extracted.contrato || {};
  heading(ctx, "§ 2 · Dados do instrumento contratual");
  // O objeto do laudo é a cadeia de custódia. Valor, taxa, CET e prazo da
  // operação não entram: o leitor precisa saber que a ausência é deliberada, e
  // não falha de extração.
  paragraph(
    ctx,
    "Este laudo verifica e valida a cadeia de custódia do documento. As condições econômicas da operação " +
      "(valores, tarifas, tributos, taxas, Custo Efetivo Total e prazos) não integram o exame e não foram aferidas aqui.",
    { color: MUTED, size: 8.5 }
  );
  field(ctx, "Número do contrato", c.numero);
  field(ctx, "Banco / instituição financeira", c.banco);
  field(ctx, "CNPJ da instituição", formatCnpj(c.cnpj_instituicao));
  field(ctx, "Código BACEN", c.codigo_banco_bacen);
  field(ctx, "Produto", c.produto);
  field(ctx, "Modalidade", labelModalidade(c.modalidade));
  field(ctx, "Tipo de operação", c.tipo_operacao);
  field(ctx, "Operação portada", c.operacao_portada === true ? "Sim" : c.operacao_portada === false ? "Não" : null);
  if (c.empregador) field(ctx, "Empregador declarado", `${c.empregador.literal}${c.empregador.identificado ? "" : " (sem razão social e sem CNPJ)"}`);
  field(ctx, "Credor original / cedente", c.credor_original);
  field(ctx, "Agência", c.agencia);
  field(ctx, "Conta-corrente", c.conta_corrente);
  field(ctx, "Nome da agência", c.nome_agencia);
  field(ctx, "Banco de recebimento", c.banco_recebimento);
  field(ctx, "Data do contrato", c.data_contrato);
  if (c.data_contrato_origem) field(ctx, "   Origem da data", `${c.data_contrato_origem}${c.data_contrato_confianca === "BAIXA" ? " · confiança baixa" : ""}`);
  if (c.data_contrato_nota) paragraph(ctx, c.data_contrato_nota, { color: DANGER, size: 8.5 });
  field(ctx, "Primeiro vencimento", c.data_primeiro_vencimento);
  field(ctx, "Último vencimento", c.data_ultimo_vencimento);
  field(ctx, "Modalidade de desconto provável", c.modalidade_desconto_provavel);
  // A nota das datas vinha do § de dados econômicos, que saiu do laudo.
  if (c.datas_nota) paragraph(ctx, c.datas_nota, { color: DANGER, size: 8.5 });
}

function sectionClient(ctx, extracted, result = {}) {
  const c = extracted.cliente || {};
  heading(ctx, "§ 3 · Qualificação do contratante");
  const origem = c.origens || {};
  const inferido = (campo, valor) => (origem[campo]?.startsWith("INFERIDO") && valor ? `${valor} (inferido)` : valor);
  // Vazio no documento e suspeito são achados sobre o instrumento, e não podem
  // desaparecer do laudo como se o campo não existisse.
  const estados = c.estados_campos || {};
  const comEstado = (campo, valor) => {
    const e = estados[campo];
    if (e?.estado === "LOCALIZADO_SUSPEITO") return `${valor || e.valor} (suspeito: ${e.motivo})`;
    if (e?.estado === "LOCALIZADO_VAZIO") return e.valor ? `Localizado e vazio no instrumento: "${e.valor}"` : "Localizado e vazio no instrumento";
    return valor;
  };
  field(ctx, "Nome completo", c.nome);
  field(ctx, "CPF", formatCpf(c.cpf));
  field(ctx, "RG", comEstado("rg", c.rg));
  field(ctx, "Data de nascimento", c.data_nascimento);
  field(ctx, "Endereço (extraído do contrato)", comEstado("endereco", c.endereco));
  field(ctx, "Bairro", c.bairro);
  field(ctx, "Cidade", inferido("cidade", c.cidade));
  field(ctx, "Estado", inferido("estado", c.estado));
  field(ctx, "CEP", c.cep);
  field(ctx, "Telefone", c.telefone);
  field(ctx, "E-mail", comEstado("email", c.email));
  if (estados.ocupacao?.estado === "LOCALIZADO_VAZIO") field(ctx, "Ocupação", comEstado("ocupacao", null));
  // D7: campo de benefício previdenciário não se imprime em modalidade que não
  // o comporta. "Não identificado" ali afirma lacuna onde não há campo.
  if (fichaBeneficioSeAplica(extracted.contrato?.produto_codigo)) {
    field(ctx, "Matrícula INSS", c.matricula_inss);
    field(ctx, "Número do benefício", c.numero_beneficio);
    field(ctx, "Espécie do benefício", c.especie_beneficio);
  }
  field(ctx, "Banco de recebimento", c.banco_recepcao);
  if (c.origens) {
    paragraph(
      ctx,
      "Município, UF, bairro e CEP são exibidos com controle de origem. Campos inferidos não substituem a qualificação completa no instrumento original.",
      { color: MUTED, size: 8.5 }
    );
  }
  // A verificação de endereços, dois a dois, e a referência residencial estão
  // no § 5, junto dos confrontos que dependem delas.
  if (result.confronto_enderecos?.pares?.length || result.home?.query || result.home?.alerta) {
    paragraph(ctx, "A verificação dos endereços, dois a dois, e o endereço de referência adotado para as distâncias constam do § 5.", { color: MUTED, size: 8.5 });
  }
}

function sectionSignature(ctx, extracted, result = {}) {
  const a = extracted.assinatura || {};
  heading(ctx, "§ 4 · Assinatura eletrônica e cadeia de custódia");
  badge(ctx, "Registro textual de assinatura", a.presente ? "LOCALIZADO" : "NÃO LOCALIZADO", !!a.presente);
  paragraph(ctx, NOTA_ASSINATURA, { color: MUTED, size: 8.5 });
  paragraph(
    ctx,
    "Esta seção separa assinatura eletrônica/digital, menção textual no corpo do documento, forma de aceite registrada e assinatura criptográfica incorporada ao PDF. O laudo descreve evidências e ausências técnicas; a consequência jurídica depende de valoração no caso concreto.",
    { color: MUTED, size: 8.5 }
  );
  const cripto = a.assinatura_criptografica || {};
  const estadoCripto = cripto.estado || (result.metadata?.hasEmbeddedSignatures ? "PRESENTE" : "AUSENTE");
  badge(ctx, "Assinatura criptográfica incorporada ao PDF", `${estadoCripto} (detalhe no § 1.2)`, estadoCripto === "PRESENTE");
  if (Number.isFinite(cripto.quantidade)) field(ctx, "Quantidade de assinaturas/campos assinados", cripto.quantidade);
  field(ctx, "Plataforma de assinatura", a.plataforma);
  field(ctx, "Tipo de assinatura", a.tipo);
  field(ctx, "Titular do signatário", a.titular_certificado);
  field(ctx, "CPF indicado", formatCpf(a.cpf_titular));
  field(ctx, "Data / hora da assinatura", a.data_hora_assinatura);
  field(ctx, "Autoridade certificadora", a.certificadora_ac);
  field(ctx, "Nº de série do certificado", a.numero_serie_certificado, { mono: true });
  field(ctx, "Validade do certificado · início", a.validade_certificado_inicio);
  field(ctx, "Validade do certificado · fim", a.validade_certificado_fim);
  field(ctx, "Algoritmo de hash", a.algoritmo_hash);
  field(ctx, "Estado do hash declarado", labelHashState(a.hash_declarado_estado));
  if (a.hash_documento_assinado) field(ctx, "Hash do documento assinado", a.hash_documento_assinado, { mono: true });
  if (a.codigo_autenticacao_declarado) {
    field(ctx, "Estado do código de autenticação", labelHashState(a.codigo_autenticacao_estado || "DECLARADO_NAO_CONFERIVEL"));
  }
  if (a.integridade_pos_assinatura === true || a.integridade_pos_assinatura === false) {
    badge(ctx, "Integridade pós-assinatura", a.integridade_pos_assinatura ? "ÍNTEGRO" : "DOCUMENTO ADULTERADO", a.integridade_pos_assinatura);
  }
  if (a.observacoes) paragraph(ctx, a.observacoes, { size: 9 });
  if (a.metodos_autenticacao?.length) field(ctx, "Métodos de autenticação", a.metodos_autenticacao.join(" · "));
  if (a.metodos_descritos_no_fluxo?.length) {
    field(ctx, "Métodos descritos no instrumento como etapa do fluxo", a.metodos_descritos_no_fluxo.map((m) => m.rotulo).join(" · "));
    for (const metodo of a.metodos_descritos_no_fluxo) {
      paragraph(ctx, `${metodo.rotulo}${metodo.pagina ? ` (pág. ${metodo.pagina})` : ""}: "${metodo.trecho}"`, { color: MUTED, size: 8 });
    }
  } else if (a.metodos_descritos_estado) {
    field(ctx, "Métodos descritos no instrumento como etapa do fluxo", "não localizado no material examinado");
  }
  if (a.mencao_textual) field(ctx, "Menção textual de assinatura", `${a.mencao_textual}${a.mencao_textual_documento ? ` (${a.mencao_textual_documento})` : ""}`);
  if (a.blocos_por_documento) paragraph(ctx, `Blocos de assinatura por documento: ${a.blocos_por_documento}.`, { size: 8.5 });
  if (Number.isFinite(a.blocos_assinatura_total)) field(ctx, "Blocos de assinatura em documentos negociais", a.blocos_assinatura_total);
  if (a.codigo_autenticacao_declarado) {
    field(ctx, "Código de autenticação", `Declarado, conferível apenas pelo emissor (${a.codigo_autenticacao_origem || "origem não identificada"})`);
  }

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
    "Referências documentais localizadas",
    `${cadeia.presentes}/${cadeia.total} · presença documental, sem validação de autoria`,
    true
  );
  paragraph(ctx, av.leitura, { size: 9 });

  doc.moveDown(0.3);
  for (const e of cadeia.elementos) {
    reserve(ctx, 68);

    const cor = e.presente ? ACCENT : DANGER;
    doc
      .fontSize(9)
      .font("Helvetica-Bold")
      .fillColor(cor)
      .text(`${e.presente ? "[PRESENTE]" : "[AUSENTE]"} ${e.nome}`, MARGIN, doc.y, {
        width: contentWidth,
      });

    doc.fontSize(8.5).font("Helvetica").fillColor(INK);
    doc.text(`Finalidade e limite: ${e.comprova}`, MARGIN + 12, doc.y + 1, {
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
      `Referências não localizadas (${cadeia.faltantes.length}): ${cadeia.faltantes.map((e) => e.nome.toLowerCase()).join("; ")}.`,
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

  // A imagem é aberta ANTES de qualquer reserva. Reservar primeiro e só então
  // descobrir que o PDFKit não decodifica o buffer deixava para trás a página
  // que a reserva tinha acabado de abrir — em branco, porque o `return` do
  // catch saía sem desenhar nada nela.
  let imagem;
  try {
    imagem = doc.openImage(mapBuffer);
  } catch (err) {
    console.error("[ReportPdf] Falha ao abrir mapa:", err.message);
    return;
  }

  const larguraNominal = contentWidth * MAP_WIDTH_RATIO;
  const alturaNominal = larguraNominal * (imagem.height / imagem.width);
  const alturaLegenda = 34;

  // Figura não se parte entre páginas, mas encolhe. Empurrar a folha inteira por
  // causa de uma sobra de poucos centímetros era o que abria os vazios grandes
  // no pé da página: até MAP_MIN_SCALE ela cabe onde está, e só abaixo disso vai
  // para a página seguinte.
  const escalaQueCabe = () => Math.min(1, (espacoLivre(doc) - alturaLegenda) / alturaNominal);
  let escala = escalaQueCabe();
  if (escala < MAP_MIN_SCALE) {
    reserve(ctx, alturaNominal + alturaLegenda);
    escala = escalaQueCabe();
  }
  if (!(escala > 0)) return;

  const imgW = larguraNominal * escala;
  const imgH = alturaNominal * escala;
  const imgX = MARGIN + (contentWidth - imgW) / 2;
  doc.moveDown(0.3);
  try {
    doc.image(mapBuffer, imgX, doc.y, { width: imgW });
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
  doc.moveDown(0.6); // a legenda não pode encostar no título que vier a seguir
}

function sectionGeo(ctx, result, mapas = {}) {
  // O § 5 abre sempre com o parágrafo de enquadramento e o bloco de referência.
  // A guarda padrão do `heading` deixava o título e a introdução órfãos no pé da
  // página, com o resto da seção começando só na seguinte.
  reserve(ctx, 200);

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
    "Esta seção avalia três confrontos independentes; cálculos e mapas são apresentados quando os respectivos pontos estão disponíveis. Eles respondem a perguntas diferentes e não se somam: o primeiro verifica de onde partiu a CONEXÃO que gerou o ato; o segundo verifica o que o DOCUMENTO afirma sobre o local do ato; ambos usam como referência a residência informada. O terceiro confronta a geolocalização declarada com a origem da conexão e não depende da residência, por isso continua valendo quando ela é recusada.",
    { size: 9 }
  );

  subheading(ctx, "Ponto de referência · residência do contratante");
  if (result.home?.alerta) {
    paragraph(ctx, result.home.alerta, { color: DANGER, size: 9 });
  }
  // Verificação de endereços, dois a dois: cada linha diz o que compara, e
  // nenhuma delas afirma domicílio.
  const paresEndereco = result.confronto_enderecos?.pares || [];
  if (paresEndereco.length) {
    subheading(ctx, "Verificação de endereços · confrontos dois a dois");
    for (const par of paresEndereco) {
      field(ctx, par.rotulo, par.texto || (par.indisponivel?.length ? `não aferido (${descreverIndisponibilidade(par)})` : null));
      if (par.memoria_calculo) paragraph(ctx, par.memoria_calculo, { color: MUTED, size: 8 });
    }
    if (result.confronto_enderecos?.pontos?.instrumento?.precisao === "municipio") {
      paragraph(
        ctx,
        `O endereço do instrumento foi resolvido em nível de município (${result.confronto_enderecos.pontos.instrumento.rotulo}), porque a instituição não registrou o endereço do contratante. As distâncias que partem dele são aproximadas.`,
        { color: MUTED, size: 8.5 }
      );
    }
  }

  // MED-01: recusado o confronto, o endereço aparece como não utilizado e o
  // alerta acima é o único motivo impresso.
  const referenciaRecusada = ["RECUSADO_CONFLITO", "INDISPONIVEL_NAO_INFORMADO"].includes(result.home?.estado_confronto);
  const enderecoInformado = result.home?.conflito?.manual?.texto || result.home?.query;
  if (referenciaRecusada) {
    if (enderecoInformado) field(ctx, "Endereço informado, não utilizado", enderecoInformado);
  } else if (result.home?.query) field(ctx, `Endereço (${result.home.source || "referência"})`, result.home.query);
  if (!referenciaRecusada && home && Number.isFinite(home.lat) && Number.isFinite(home.lon)) {
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
  if (!home && !result.home?.alerta) {
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
    "Compara o ponto retornado pela consulta do IP com uma referência residencial disponível. A base externa fornece uma estimativa, sem margem de erro aferida neste exame. O resultado não identifica aparelho, roteador ou presença física.",
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
      "Estimativa retornada pela consulta do IP",
      `${[ipRef.geo.city, ipRef.geo.region, ipRef.geo.country].filter(Boolean).join(" / ")} (${ipRef.geo.lat}, ${ipRef.geo.lon})`
    );
    const d = ipRef.divergenciaResidencia;
    if (d) {
      reserve(ctx, 105); // mesmo motivo do § 5.2: veredito e síntese juntos
      badge(ctx, "Distância entre a origem do IP e a residência", `${d.km.toFixed(2)} km · ${d.rotulo}`, d.tom === "ok");
      paragraph(ctx, d.sintese, { size: 9, color: d.tom === "danger" ? DANGER : INK });
    } else if (!home) {
      paragraph(ctx, "Distância não calculada: falta a coordenada de referência.", { color: MUTED, size: 8.5 });
    }

    if (mapas.mapaIpResidencia) {
      drawMap(
        ctx,
        mapas.mapaIpResidencia,
        "Mapa 1. Origem da conexão pelo endereço IP (I, vermelho) × residência informada (R, azul). A linha representa a distância geodésica (Haversine). O ponto I é uma estimativa do provedor de geolocalização; não identifica a posição do aparelho nem comprova ponto de presença da operadora. Base cartográfica OpenStreetMap."
      );
    }
  }

  // ─── Confronto 2: residência × geolocalização declarada ───────────────────
  subheading(ctx, "§ 5.2 · Confronto 2 · residência informada × geolocalização declarada no documento");
  paragraph(
    ctx,
    "Pergunta: a coordenada que o próprio documento registra como local da assinatura corresponde à residência do contratante? A precisão depende da origem dos dois pontos. Coordenada declarada, ponto confirmado e referência municipal têm limites diferentes; sem referência residencial válida não há distância residencial aferida.",
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
    field(ctx, "   Forma de obtenção", cg.geocoded ? "coordenada obtida por geocodificação do endereço declarado" : "coordenada GPS extraída do log");
    if (cg.precisao) field(ctx, "   Precisão declarada", `${cg.precisao} m`);
    if (cg.dataHora) field(ctx, "   Data / hora do registro", cg.dataHora);
    if (cg.municipio) field(ctx, "   Município do local declarado", `${cg.municipio}${cg.uf ? `/${cg.uf}` : ""}`);

    // Régua PRÓPRIA deste confronto. `riskFromDistance` (50/300/1000 km) é
    // calibrada para geolocalização de IP e rotulava 1,47 km como "RISCO BAIXO"
    // logo abaixo do parágrafo que afirma o contrário — ver geoDivergence.js.
    if (declarado) {
      // Veredito + síntese + eventual ressalva formam um bloco só.
      reserve(ctx, 120);
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
        "Mapa 2. Residência informada (R, azul) × geolocalização declarada no documento (A, âmbar). A linha representa a distância geodésica (Haversine). A precisão depende das fontes declaradas para cada ponto. Base cartográfica OpenStreetMap."
      );
    }
  }

  // ─── Confronto 3: geolocalização declarada × origem da conexão ────────────
  // Independe da residência. Com a referência recusada, é a verificação
  // geográfica que resta ao laudo, e não pode sumir junto com as outras duas.
  subheading(ctx, "§ 5.2.1 · Confronto 3 · geolocalização declarada × origem da conexão (IP)");
  paragraph(
    ctx,
    "Compara a coordenada declarada no documento com o ponto retornado pela consulta do IP, independentemente da residência. A consulta atual não comprova localização na data do ato; sem margem de erro validada, a distância não determina compatibilidade física.",
    { color: MUTED, size: 8.5 }
  );
  const ipAssinatura = (result.ipAnalysis || []).find((ip) => ip.divergenciaAssinatura?.km != null);
  if (!cg || !ipRef) {
    paragraph(
      ctx,
      !cg
        ? "Confronto não realizado: o documento não traz coordenada declarada da assinatura."
        : "Confronto não realizado: nenhum endereço IP do documento foi geolocalizado.",
      { color: MUTED, size: 9 }
    );
  } else if (ipAssinatura) {
    const da = ipAssinatura.divergenciaAssinatura;
    reserve(ctx, 105);
    field(ctx, "Endereço IP", ipAssinatura.endereco, { mono: true });
    field(ctx, "Distância entre GPS declarado e consulta do IP", `cerca de ${Math.round(da.km)} km · ${da.rotulo} · consulta atual, sem comprovação histórica`);
    paragraph(ctx, da.sintese, { size: 9, color: da.tom === "danger" ? DANGER : INK });
    if (mapas.mapaDeclaradoIp) {
      drawMap(
        ctx,
        mapas.mapaDeclaradoIp,
        "Mapa 3. Geolocalização declarada no documento (A, âmbar) × estimativa retornada para o IP registrado (I, vermelho). A linha representa a distância geodésica (Haversine). O ponto I é uma estimativa do provedor de geolocalização; não identifica a posição do aparelho nem comprova ponto de presença da operadora. Base cartográfica OpenStreetMap."
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

  /*
   * `ips` era uma variável local desta função e ficou para trás na separação dos
   * dois confrontos: o nome sobreviveu aqui, mas a declaração passou a viver em
   * `sectionIpTrace`. O erro só aparece quando NÃO há geolocalização declarada no
   * documento, porque as condições são avaliadas da esquerda para a direita e
   * `!cg` curto-circuitava em todos os documentos de teste anteriores, que
   * traziam coordenada.
   *
   * Efeito: `ReferenceError` no meio da geração, ou seja, laudo nenhum para um
   * contrato sem GPS declarado, que é um caso comum.
   */
  if (!cg && !(result.ipAnalysis || []).length && !result.home?.query) {
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
    "Um endereço IP não contém coordenadas geográficas. A localização abaixo é uma estimativa de serviço externo, sujeita a atualização e imprecisão. Não identifica, por si só, o aparelho, um roteador específico, o signatário ou a localização na data do ato.",
    { color: MUTED, size: 8.5 }
  );

  for (const ip of ips) {
    reserve(ctx, 110);
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

    if (ip.contexto) field(ctx, "   Contexto no documento", ip.contexto);
    if (ip.classe) field(ctx, "   Classe técnica", ip.classe);
    if (ip.data_hora) field(ctx, "   Data / hora do registro", ip.data_hora);
    if (ip.porta) {
      field(ctx, "   Porta lógica de origem", `${ip.porta} (valor declarado; não comprova sessão ativa)`);
    }

    if (ip.rdap) {
      if (ip.rdap.asn) field(ctx, "   ASN Oficial (Registro.br / LACNIC)", [ip.rdap.asn, ip.rdap.owner].filter(Boolean).join(" · "));
      else if (ip.rdap.owner) field(ctx, "   Titular do bloco (RDAP)", ip.rdap.owner);
      if (ip.rdap.cidr) field(ctx, "   Bloco / Faixa CIDR alocada", ip.rdap.cidr);
    }

    if (ip.parsedUserAgent) {
      const ua = ip.parsedUserAgent;
      field(ctx, "   Ambiente do dispositivo", `${ua.os} ${ua.osVersion || ""} · ${ua.browser} ${ua.browserVersion || ""} (${ua.deviceType})`);
    }
    if (ip.user_agent) field(ctx, "   User-Agent registrado", ip.user_agent);

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
      "   Estimativa da consulta de geolocalização",
      `${[ip.geo.city, ip.geo.region, ip.geo.country].filter(Boolean).join(" / ")} (${ip.geo.lat}, ${ip.geo.lon})`
    );
    if (ip.geo.isp) field(ctx, "   Operadora (ISP / ASN)", ip.geo.isp);
    if (ip.geo.timezone) field(ctx, "   Fuso horário", ip.geo.timezone);
    field(ctx, "   Fonte da geolocalização", ip.geo.source || "não informada");
    field(ctx, "   Consulta externa", `${ip.geo.queryId || "ID não registrado"} · ${ip.geo.queriedAt || "data não registrada"}`);
    field(ctx, "   Granularidade", ip.historico?.precisionOverride || ip.geo.granularity || "não informada");
    paragraph(ctx, "Consulta externa atual não comprova localização histórica na data do ato; a margem de erro do serviço não foi fornecida.", { size: 8, color: MUTED });
    // Motor pericial v2: registro do bloco na data do ato (RIPEstat).
    if (ip.historico?.label) field(ctx, "   Registro do bloco na data do ato", ip.historico.label);
    if (ip.historico?.note) paragraph(ctx, ip.historico.note, { color: MUTED, size: 8.5 });

    // Confronto com a referência do operador — o coração do § 5.1.
    const dr = ip.divergenciaResidencia;
    if (dr) {
      badge(ctx, "   IP × residência informada", `${dr.km.toFixed(2)} km · ${dr.rotulo}`, dr.tom === "ok");
      paragraph(ctx, dr.sintese, { size: 8.5, color: dr.tom === "danger" ? DANGER : INK });
      paragraph(ctx, dr.ressalva, { size: 8, color: MUTED });
    }

    const da = ip.divergenciaAssinatura;
    if (da) {
      field(ctx, "   IP × GPS declarado no contrato", `cerca de ${Math.round(da.km)} km · ${da.rotulo} · consulta atual, sem comprovação histórica`);
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
function sectionIrregularities(ctx, extracted, projecao = null) {
  const temProjecao = Array.isArray(projecao);
  // Com projeção, ela é a fonte única. Deixar `evs` vivo abria uma fuga: com
  // projeção vazia e evidências legadas no `extracted`, o laço do fim da função
  // voltava a imprimir o legado, que é exatamente a segunda lista que o D5
  // eliminou.
  const evs = temProjecao ? [] : (extracted.evidencias_irregularidade || []);
  // D5: a projeção canônica é a fonte única do corpo e do sumário. Sem ela, o
  // renderizador do backend voltava a publicar só `achados_irregularidade` e a
  // divergir do sumário, que é o defeito que o D5 corrige. Projeção vazia é
  // resposta, não ausência de resposta, por isso o teste é de tipo e não de
  // comprimento.
  // Mesma lista, ordem e agrupamento do § de achados da tela (reportIssues).
  const achados = temProjecao || Array.isArray(extracted.achados_irregularidade)
    ? reportIssues(temProjecao ? {} : extracted, temProjecao ? projecao : null)
    : [];
  heading(ctx, "§ 6 · Achados técnicos e diligências", { danger: evs.length > 0 || achados.length > 0 });

  // Motor pericial v2: achado estruturado com código e gravidade.
  if (achados.length) {
    for (const [grupo, titulo] of GRUPOS_ACHADOS) {
      const itens = achados.filter((a) => issueBucket(a) === grupo);
      if (!itens.length) continue;
      subheading(ctx, titulo);
      for (const achado of itens) {
        reserve(ctx, 60);
        const { doc, contentWidth } = ctx;
        const grave = /CR[IÍ]TIC|ALTA|ALTO/i.test(achado.gravidade || "");
        doc
          .fontSize(9.5)
          .font("Helvetica-Bold")
          .fillColor(grave ? DANGER : INK)
          .text(`${achado.codigo} · ${achado.gravidade || ""} · ${achado.titulo}`, MARGIN, doc.y, { width: contentWidth });
        if (achado.texto) paragraph(ctx, achado.texto, { size: 9 });
        else doc.moveDown(0.3);
      }
    }
    return;
  }

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
    reserve(ctx, 32);
    doc.fontSize(9.5).font("Helvetica").fillColor(DANGER).text("• ", MARGIN, doc.y, { continued: true });
    doc.fillColor(INK).text(ev, { width: contentWidth });
    doc.moveDown(0.2);
  }
}

// ─────────────────────────────────────────────────────────────
// Motor pericial v2
// ─────────────────────────────────────────────────────────────

const PROCEDENCIA_PDF = {
  EXPORTACAO_SISTEMA_PROCESSUAL: "exportação de sistema processual",
  NATIVO_PROVAVEL: "arquivo nativo provável",
  RE_RENDERIZACAO_JUDICIAL: "re-renderizado por sistema processual",
  REIMPRESSAO_POSTERIOR_PROVAVEL: "reimpressão posterior provável",
  ARQUIVO_DERIVADO: "arquivo derivado",
};

/** § 1.2 — assinatura digital incorporada, proveniência e imagens. */
function sectionDigitalSignature(ctx, metadata) {
  const ds = metadata?.digitalSignature;
  if (!ds) return;
  heading(ctx, "§ 1.2 · Assinatura digital e proveniência do arquivo");

  badge(ctx, "Assinatura criptográfica incorporada", ds.estado || "INDETERMINADO", ds.estado === "PRESENTE");
  if (ds.motivo) paragraph(ctx, ds.motivo, { color: MUTED, size: 8.5 });
  if (ds.procedencia?.procedencia) {
    const p = ds.procedencia;
    field(
      ctx,
      "Proveniência indicada por elementos do arquivo (não validada)",
      `${PROCEDENCIA_PDF[p.procedencia] || p.procedencia}${p.sistema ? ` (${[p.sistema, p.tribunal].filter(Boolean).join("/")})` : ""}`
    );
    if (p.data_juntada) field(ctx, "   Data da juntada", p.data_juntada);
    if (p.movimento) field(ctx, "   Movimento", `${p.movimento}${p.descricao_movimento ? ` · ${p.descricao_movimento}` : ""}`);
    if (p.juntado_por) field(ctx, "   Assinatura mencionada no carimbo (não validada)", p.juntado_por);
    if (p.identificador_validacao) field(ctx, "   Identificador de validação", p.identificador_validacao, { mono: true });
    if (ds.procedencia.indicios?.length) field(ctx, "Indícios", ds.procedencia.indicios.join(" · "));
    if (ds.procedencia.mensagem) paragraph(ctx, ds.procedencia.mensagem, { size: 8.5 });
  }
  if (ds.catalog) {
    field(ctx, "Formulário AcroForm", ds.catalog.acroform);
    field(ctx, "Atualizações incrementais", `${ds.catalog.incrementalUpdates ?? 0} (${ds.catalog.eofCount ?? 0} marca(s) %%EOF)`);
  }
  const camposAssinatura = ds.catalog?.fields || [];
  if (camposAssinatura.length) {
    subheading(ctx, "Campos de assinatura no catálogo do PDF");
    table(
      ctx,
      [
        { titulo: "Campo", largura: 0.2 },
        { titulo: "xref", largura: 0.07, mono: true },
        { titulo: "Retângulo", largura: 0.2, mono: true },
        { titulo: "Visibilidade", largura: 0.15 },
        { titulo: "Assinado", largura: 0.09 },
        { titulo: "Dic. sig.", largura: 0.08, mono: true },
        { titulo: "Data declarada", largura: 0.11 },
        { titulo: "Subfiltro", largura: 0.1 },
      ],
      camposAssinatura.map((f) => [
        f.nome,
        f.xref,
        f.rect,
        f.invisivel ? "Invisível (/Rect [0 0 0 0])" : "Visível",
        f.assinado ? "Sim" : "Não",
        f.dicionario_sig,
        f.data_declarada,
        f.subfilter,
      ])
    );
  }
  if (ds.pdfsig?.assinaturas?.length) subheading(ctx, "Validação criptográfica pelo pdfsig");
  for (const sig of ds.pdfsig?.assinaturas || []) {
    reserve(ctx, 80);
    subheading(ctx, `Assinatura #${sig.numero}${sig.campo ? ` · ${sig.campo}` : ""}`);
    field(ctx, "   Signatário (CN)", sig.signatario_cn);
    field(ctx, "   DN completo", sig.signatario_dn);
    field(ctx, "   Data da assinatura", sig.data_assinatura);
    field(ctx, "   Algoritmo de resumo", sig.algoritmo_resumo);
    field(ctx, "   Tipo / subfiltro", sig.subfilter);
    field(ctx, "   Validação da assinatura", sig.validacao_assinatura || "NÃO AFERÍVEL");
    field(ctx, "   Validação do certificado", sig.validacao_certificado);
    if (sig.bytesCobertos != null) field(ctx, "   Bytes cobertos", sig.bytesCobertos.toLocaleString("pt-BR"));
    if (sig.coberturaPercentual != null) {
      field(ctx, "   Cobertura do documento", `${String(sig.coberturaPercentual).replace(".", ",")}%`);
    }
    field(ctx, "   Documento integral assinado", sig.notTotalDocumentSigned ? "Não" : "Sim");
  }
  for (const alerta of ds.alerts || []) {
    paragraph(ctx, `${alerta.codigo} · ${alerta.severidade} · ${alerta.titulo}. ${alerta.detalhe}`, {
      color: alerta.severidade === "CRÍTICO" ? DANGER : INK,
      size: 8.5,
    });
  }

  // O inventário de imagens saiu daqui para o § 4.4, junto da selfie e da
  // prova de vida, como na tela.
}

/** § 2.1: forma de liberação declarada e comprovante do crédito. */
function sectionCreditRelease(ctx, extracted) {
  const l = extracted.liberacao_credito;
  if (!l?.declarada) return;
  heading(ctx, "§ 2.1 · Liberação do crédito e comprovante", { danger: !l.comprovante });
  field(ctx, "Forma de liberação declarada", l.declarada.forma);
  field(ctx, "Banco / agência / conta", [l.declarada.banco && `Banco ${l.declarada.banco}`, l.declarada.agencia && `agência ${l.declarada.agencia}`, l.declarada.conta && `conta ${l.declarada.conta}`].filter(Boolean).join(" · "));
  // A existência do comprovante é prova documental; o quanto foi creditado é
  // matéria econômica e não entra no laudo.
  badge(ctx, "Comprovante de transferência no arquivo", l.comprovante ? "LOCALIZADO" : "AUSENTE", Boolean(l.comprovante));
  if (l.comprovante) field(ctx, "   Comprovante", [l.comprovante.pagina && `pág. ${l.comprovante.pagina}`, l.comprovante.data].filter(Boolean).join(" · "));
}

/** § 2.2: seguro prestamista vinculado. */
function sectionInsurance(ctx, extracted) {
  const sg = extracted.seguro_prestamista;
  if (!sg) return;
  heading(ctx, "§ 2.2 · Seguro prestamista vinculado à operação", { danger: (sg.achados || []).some((a) => a.gravidade === "ALTA") });
  field(ctx, "Proposta", sg.proposta);
  field(ctx, "Forma de pagamento", sg.forma_pagamento);
  field(ctx, "Vigência", sg.vigencia?.premissa);
  field(ctx, "Marcos de contagem", sg.marcos_temporais);
  // Prêmio, IOF e pró-labore são preço do seguro: saem do laudo. Ficam a
  // estrutura da apólice e os prazos, que sustentam a adesão e a vigência.
  field(ctx, "Seguradora", sg.seguradora ? `${sg.seguradora.nome}${sg.seguradora.cnpj ? `, CNPJ ${sg.seguradora.cnpj}` : ""}` : null);
  field(ctx, "Corretora", sg.corretora ? `${sg.corretora.nome}, CNPJ ${sg.corretora.cnpj}, SUSEP ${sg.corretora.susep}` : null);
  field(ctx, "Estipulante", sg.estipulante ? `${sg.estipulante.nome}, CNPJ ${sg.estipulante.cnpj}` : null);
  field(ctx, "Beneficiário", sg.beneficiario);
  for (const c of sg.coberturas || []) {
    field(
      ctx,
      `   ${c.nome}`,
      [`carência ${c.carencia_dias == null ? "não identificada" : c.carencia_dias ? `${c.carencia_dias} dias` : "não há"}`, `franquia ${c.franquia_dias == null ? "não identificada" : c.franquia_dias ? `${c.franquia_dias} dias` : "não há"}`, c.teto_parcelas ? `até ${c.teto_parcelas} parcelas` : null].filter(Boolean).join(" · ")
    );
  }
}

/** § 4.3: trilha de eventos com intervalos, segundos por página e fuso. */
function sectionEventTrail(ctx, extracted) {
  const t = extracted.trilha_eventos;
  if (!t?.eventos?.length) return;
  heading(ctx, "§ 4.3 · Trilha de eventos da contratação");
  field(ctx, "Duração total da jornada", `${t.duracao_total} (${t.duracao_total_s} segundos)`);
  if (t.fuso) field(ctx, "Fuso declarado na trilha", `${t.fuso.trilha}; leitura local em ${t.fuso.local}${t.fuso.assinatura_sem_fuso ? "; bloco de assinatura sem fuso" : ""}`);
  const fusoTrilha = t.fuso?.trilha || "declarada";
  table(
    ctx,
    [
      { titulo: "Evento", largura: 0.17 },
      { titulo: `Data/hora (${fusoTrilha})`, largura: 0.12 },
      { titulo: "Hora local", largura: 0.08 },
      { titulo: "Intervalo", largura: 0.09 },
      { titulo: "s/página", largura: 0.09 },
      { titulo: "Dispositivo", largura: 0.12 },
      { titulo: "IP : porta", largura: 0.18, mono: true },
      { titulo: "Geolocalização", largura: 0.15, mono: true },
    ],
    t.eventos.map((ev) => [
      ev.nome,
      ev.data_hora,
      ev.hora_local ? ev.hora_local.split(" ")[1] : null,
      ev.intervalo_s == null ? "referência" : `+${ev.intervalo_s} s`,
      ev.segundos_por_pagina != null ? `${String(ev.segundos_por_pagina).replace(".", ",")} (${ev.documento_aceito?.paginas} págs.)` : null,
      ev.aparelho,
      ev.ip ? `${ev.ip}${ev.porta ? `:${ev.porta}` : ""}` : "ausente",
      ev.lat != null ? `${ev.lat}, ${ev.lon}` : "ausente",
    ]),
    { destaque: (i) => t.eventos[i].segundos_por_pagina != null && t.eventos[i].segundos_por_pagina < 5 }
  );
  if (t.eventos.some((ev) => ev.segundos_por_pagina != null)) {
    paragraph(ctx, "Segundos por página é razão aritmética entre o intervalo e o número de páginas do documento aceito; não mede leitura.", { color: MUTED, size: 8 });
  }
}

const GRAVIDADE_IMAGEM = /CR[IÍ]TICO|ALTO/i;

/**
 * § 4.4 · imagens, selfie e prova de vida, com o conteúdo do quadro da tela:
 * métricas do pdfimages, artefato biométrico com miniatura, achados, grupos de
 * imagens idênticas, tabela das imagens relevantes e diligências.
 */
function sectionImages(ctx, extracted) {
  const img = extracted.imagens_pdf;
  const b = extracted.imagem_biometrica;
  if (!img && !b) return;
  // MED-03: análises gravadas antes da correção ainda trazem o IMG2 de template.
  const achados = (img?.achados || []).filter((f) => !(f.codigo === "IMG2" && f.titulo === "Reuso de imagem de template"));
  heading(ctx, "§ 4.4 · Imagens, selfie e prova de vida", {
    danger: Boolean(b?.achado) || achados.some((f) => GRAVIDADE_IMAGEM.test(f.severidade || "")),
  });
  paragraph(
    ctx,
    "Auditoria automática com Poppler/pdfimages. O objetivo é verificar se o PDF contém fotos/selfies extraíveis, qual a resolução real dessas imagens e se alguma prova visual foi reutilizada byte a byte dentro do mesmo documento.",
    { color: MUTED, size: 8.5 }
  );

  const relevante = (item) => item.biometricaProvavel || item.classificacao === "imagem documental";
  const lista = img?.imagens || [];
  const listadas = lista.filter(relevante);
  const templates = lista.filter((item) => !relevante(item));
  if (img) {
    if (img.disponivel === false) {
      paragraph(ctx, img.observacao || "Inventário de imagens indisponível.", { color: MUTED, size: 8.5 });
    }
    field(ctx, "Imagens listadas", img.total ?? 0);
    field(ctx, "Arquivos extraídos", img.extraidas ?? 0);
    field(ctx, "Grupos de imagens idênticas (hashes repetidos)", img.grupos_repetidos?.length ?? 0);
    field(ctx, "Ferramenta", img.disponivel ? "pdfimages" : "indisponível");
    field(ctx, "Fotografia / biometria provável", lista.filter((i) => i.biometricaProvavel).length);
    field(ctx, "Imagens documentais", lista.filter((i) => i.classificacao === "imagem documental").length);
  }

  if (b) {
    subheading(ctx, `Artefato biométrico · pág. ${b.pagina}`);
    if (b.miniatura && /^data:image\/(jpeg|png);base64,/.test(b.miniatura)) {
      // Decodifica primeiro: miniatura ilegível não pode custar uma quebra de
      // página que depois ninguém preenche.
      let buffer = null;
      try {
        buffer = Buffer.from(b.miniatura.split(",")[1], "base64");
        ctx.doc.openImage(buffer);
      } catch {
        buffer = null; // Imagem ilegível para o PDFKit: seguem só os metadados.
      }
      if (buffer) {
        reserve(ctx, 182); // a miniatura ocupa 176pt e não se parte
        const y = ctx.doc.y;
        ctx.doc.image(buffer, MARGIN, y, { fit: [96, 170] });
        ctx.doc.y = y + 176;
      }
    }
    field(ctx, "Página / dimensões", `pág. ${b.pagina} · ${b.largura} x ${b.altura} pixels (${String(b.megapixels).replace(".", ",")} megapixel)`);
    field(ctx, "Formato e tamanho", [b.formato, b.bytes ? `${b.bytes.toLocaleString("pt-BR")} bytes` : null].filter(Boolean).join(" · "));
    field(ctx, "SHA-256 da imagem", b.sha256, { mono: true });
    field(ctx, "EXIF", b.exif === false ? "ausente" : b.exif ? "presente" : "não aferido");
    field(ctx, "Imagens faciais no arquivo", b.contagem_faciais);
    if (b.dados_do_processo_ausentes?.length) field(ctx, "Não apresentado pelo dossiê", b.dados_do_processo_ausentes.join(", "));
    if (b.achado) paragraph(ctx, b.achado.texto, { color: DANGER, size: 9 });
  }

  if (achados.length) {
    subheading(ctx, "Achados de imagem");
    for (const f of achados) {
      reserve(ctx, 40);
      const { doc, contentWidth } = ctx;
      doc
        .fontSize(9)
        .font("Helvetica-Bold")
        .fillColor(GRAVIDADE_IMAGEM.test(f.severidade || "") ? DANGER : INK)
        .text(`${f.codigo} · ${f.severidade || "ATENÇÃO"} · ${f.titulo}`, MARGIN, doc.y, { width: contentWidth });
      if (f.detalhe) paragraph(ctx, f.detalhe, { size: 8.5 });
      else doc.moveDown(0.3);
    }
  }

  if (templates.length) {
    const gruposRelevantes = (img?.grupos_repetidos || []).filter((g) => (g.imagens || []).some(relevante));
    const repetidos = (img?.grupos_repetidos?.length || 0) - gruposRelevantes.length;
    const porClasse = templates.reduce((acc, item) => ({ ...acc, [item.classificacao || "outra"]: (acc[item.classificacao || "outra"] || 0) + 1 }), {});
    const classes = Object.entries(porClasse).map(([classe, n]) => `${n} ${classe}`).join("; ");
    paragraph(
      ctx,
      `${templates.length === 1 ? "1 imagem de template, sem relevância" : `${templates.length} imagens de template, sem relevância`} para a perícia (${classes})${repetidos ? `, em ${repetidos === 1 ? "1 grupo repetido" : `${repetidos} grupos repetidos`}` : ""}. Inventário completo no anexo técnico.`,
      { color: MUTED, size: 8.5 }
    );
  }

  const grupos = (img?.grupos_repetidos || []).filter((g) => (g.imagens || []).some(relevante));
  if (grupos.length) {
    subheading(ctx, "Imagens repetidas byte a byte");
    grupos.forEach((g, i) => {
      reserve(ctx, 60);
      field(ctx, `Grupo repetido #${i + 1}`, `${g.ocorrencias} ocorrências · SHA-256 ${shortHash(g.sha256, 18, 10)}`);
      field(ctx, "   Páginas", g.paginas?.join(" · "));
      (g.imagens || []).forEach((item, j) => {
        field(ctx, `   Ocorrência ${j + 1}`, `pág. ${item.page}, img ${item.num}, ${item.width} x ${item.height}px, ${item.size || "tamanho não informado"}`);
      });
      paragraph(
        ctx,
        (g.imagens || []).some((item) => item.biometricaProvavel)
          ? "A repetição byte a byte não prova fraude isoladamente, mas impede tratar as ocorrências como capturas independentes. Se uma delas estiver rotulada como prova de vida, recomenda-se exigir logs brutos, desafio de vivacidade, score e laudo do fornecedor biométrico."
          : "Reuso esperado de elemento gráfico do template em todas as páginas. Sem relevância forense biométrica.",
        { color: MUTED, size: 8.5 }
      );
    });
  }

  if (listadas.length) {
    subheading(ctx, "Imagens relevantes para a perícia");
    const repetida = (item) => item.sha256 && (img?.grupos_repetidos || []).some((g) => g.sha256 === item.sha256);
    table(ctx, COLUNAS_IMAGEM, listadas.map(linhaImagem), { destaque: (i) => repetida(listadas[i]) });
  }

  if (lista.some((item) => item.biometricaProvavel)) {
    subheading(ctx, "Leitura forense da biometria visual");
    for (const d of [
      "Exigir do banco a imagem original capturada, e não apenas a imagem reembutida no PDF.",
      "Exigir prova de vida com desafio, score de similaridade, limiar de aceitação, base comparada e fornecedor do algoritmo.",
      "Confrontar hashes individuais das fotos quando o dossiê apresentar “identificação” e “prova de vida” como etapas distintas.",
    ]) bullet(ctx, d);
  }
}

const COLUNAS_IMAGEM = [
  { titulo: "Pág.", largura: 0.07 },
  { titulo: "Img", largura: 0.07 },
  { titulo: "Tipo", largura: 0.1 },
  { titulo: "Dimensão", largura: 0.13, mono: true },
  { titulo: "Classe", largura: 0.2 },
  { titulo: "Tam.", largura: 0.1 },
  { titulo: "SHA-256", largura: 0.33, mono: true },
];

const linhaImagem = (item) => [
  item.page,
  item.num,
  item.type,
  `${item.width} x ${item.height}`,
  item.classificacao || item.enc,
  item.size,
  shortHash(item.sha256 || "-", 14, 8),
];

/** Anexo técnico: inventário completo de imagens, fora do corpo do laudo. */
function sectionImageAnnex(ctx, extracted) {
  const lista = extracted.imagens_pdf?.imagens || [];
  if (!lista.length) return;
  // Anexo em página própria só quando a atual já está cheia: a quebra
  // incondicional abria uma página quase em branco sempre que o corpo do laudo
  // terminava no alto da página.
  reserve(ctx, 220);
  heading(ctx, "Anexo técnico · Inventário de imagens");
  paragraph(ctx, "Todas as imagens listadas por pdfimages, com classificação e SHA-256 individual. Os achados do § 4.4 consideram este conjunto completo.", { color: MUTED, size: 8.5 });
  table(ctx, COLUNAS_IMAGEM, lista.map(linhaImagem));
}

/*
 * O § de dados econômicos complementares e de aferição matemática (somatório,
 * composição do financiado, valor presente, taxa implícita, CET) saiu do laudo:
 * é exame econômico da operação, não verificação de cadeia de custódia. O motor
 * continua calculando e gravando a aferição, que fica disponível no resultado.
 */

/** § 4.2 — trilha da contratação. */
function sectionContractingTrail(ctx, extracted, result = {}) {
  const a = extracted.assinatura || {};
  const trilha = extracted.trilha_acesso;
  const linha = a.linha_do_tempo;
  if (!a.forma_aceite && !linha && !trilha && !a.plataforma_nota) return;

  heading(ctx, "§ 4.2 · Trilha da contratação");
  field(ctx, "Forma de aceite", a.forma_aceite);
  field(ctx, "Telefone do aceite", a.telefone_aceite);
  field(ctx, "Dispositivo", a.dispositivo?.resumo);
  field(ctx, "Código de autenticação declarado", a.codigo_autenticacao_declarado, { mono: true });
  if (a.plataforma_nota) paragraph(ctx, a.plataforma_nota, { size: 9 });
  if (a.assinatura_manual_textual) paragraph(ctx, a.assinatura_manual_textual, { size: 9 });

  if (linha?.steps?.length) {
    subheading(ctx, "Linha do tempo do aceite");
    for (const step of linha.steps) field(ctx, `   ${step.label}`, step.value, { mono: true });
    field(ctx, "   Duração total do fluxo", linha.duracao_total);
    field(ctx, "   Intervalo até o primeiro aceite", linha.intervalo_primeiro_aceite);
  }

  if (trilha?.events?.length) sectionAccessAudit(ctx, trilha, result);
}

/**
 * Auditoria do trilho de acesso (Histórico de Ações do dossiê), com o mesmo
 * conteúdo do quadro da tela: métricas, histórico completo com dispositivo,
 * dispersão das coordenadas, leitura forense e diligências.
 */
function sectionAccessAudit(ctx, audit, result = {}) {
  const ips = result.ipAnalysis || [];
  const primaryIp = ips.find((ip) => ip.endereco === audit.uniqueIps?.[0]) || ips[0];
  const cg = result.contractGeo;
  const gpsIpDistance =
    cg && Number.isFinite(cg.lat) && Number.isFinite(cg.lon) && Number.isFinite(primaryIp?.geo?.lat) && Number.isFinite(primaryIp?.geo?.lon)
      ? haversineKm(cg.lat, cg.lon, primaryIp.geo.lat, primaryIp.geo.lon)
      : null;

  subheading(ctx, "Auditoria da assinatura e do trilho de acesso");
  paragraph(
    ctx,
    "Quadro técnico consolidado a partir do Histórico de Ações do documento. IP, portas, horários, coordenadas e dispositivo são transcritos por OCR e devem ser confrontados com os logs brutos da plataforma antes do uso como prova técnica definitiva.",
    { color: MUTED, size: 8.5 }
  );
  field(ctx, "Eventos detectados", audit.eventCount ?? audit.events.length);
  field(ctx, "IPs únicos", `${audit.uniqueIps?.length || 0}${audit.uniqueIps?.length ? ` (${audit.uniqueIps.join(", ")})` : ""}`);
  field(ctx, "Portas de origem", `${audit.ports?.length || 0}${audit.ports?.length ? ` (${audit.ports.join(", ")})` : ""}`);
  field(ctx, "Pontos GPS legíveis", `${audit.coordinateCount || 0}/${audit.eventCount ?? audit.events.length}`);
  field(ctx, "Fuso da linha do tempo", audit.eventTimezone || "não identificado");

  subheading(ctx, `Histórico de ações completo (${audit.events.length} eventos)`);
  const chave = (ev) => /Selfie|Finalizado/.test(ev.action || "");
  table(
    ctx,
    [
      { titulo: "#", largura: 0.04 },
      { titulo: "Ação", largura: 0.18 },
      { titulo: "Data e hora", largura: 0.13 },
      { titulo: "IP : porta", largura: 0.23, mono: true },
      { titulo: "Latitude", largura: 0.12, mono: true },
      { titulo: "Longitude", largura: 0.12, mono: true },
      { titulo: "Dispositivo", largura: 0.18 },
    ],
    audit.events.map((ev, i) => [
      i + 1,
      ev.action,
      [ev.date, ev.time].filter(Boolean).join(" "),
      ev.ip ? `${ev.ip}${ev.port ? `:${ev.port}` : ""}` : null,
      Number.isFinite(ev.lat) ? ev.lat.toFixed(6) : null,
      Number.isFinite(ev.lon) ? ev.lon.toFixed(6) : null,
      ev.device || "Não identificado",
    ]),
    { destaque: (i) => chave(audit.events[i]) }
  );

  dispersionPlot(ctx, audit);

  subheading(ctx, "Leitura forense");
  if (audit.chronologyInconsistent) {
    bullet(
      ctx,
      `Inconsistência · Carimbos de tempo não conciliados. O campo do assinante está rotulado como UTC (${audit.signatureTimestampUtc}). Convertido para o fuso -03:00, corresponde a ${audit.signatureLocalTime}, antes do primeiro evento às ${audit.firstTime}. Se interpretado como horário local, fica após o último evento às ${audit.lastTime}. A plataforma deve apresentar os logs brutos e o fuso efetivamente aplicado.`,
      { color: DANGER }
    );
  } else {
    bullet(ctx, "A conferir · Cronologia sem inconsistência automática conclusiva. Os horários extraídos não permitiram confirmar, de forma automática, uma contradição temporal. Recomenda-se confrontar o rótulo de fuso e os logs brutos da plataforma.");
  }
  if (!audit.deviceIdentifiable) {
    bullet(
      ctx,
      `Lacuna · Dispositivo sem vínculo inequívoco com hardware. O trilho informa ${audit.device || "sistema operacional e navegador"}, mas não apresenta fabricante, modelo ou IMEI legíveis. Esses dados identificam o ambiente de acesso, não um aparelho físico atribuído ao consumidor.`,
      { color: DANGER }
    );
  }
  const nIps = audit.uniqueIps?.length || 0;
  bullet(
    ctx,
    `A diligenciar · IP público e rastreável. O fluxo utiliza ${nIps === 1 ? `um único IP (${audit.uniqueIps[0]})` : `${nIps} IPs`}, com ${audit.ports?.length || 0} porta(s) de origem. ${primaryIp?.geo ? `A base de geolocalização aponta ${primaryIp.geo.city || "cidade não informada"}/${primaryIp.geo.region || "região não informada"}, provedor ${semPontoFinal(primaryIp.geo.isp) || "não identificado"}.` : "A localização externa do IP não estava disponível."} A identificação do assinante da conexão na data e hora depende de ordem judicial e informação da operadora.`
  );
  if (audit.coordinateCount > 1) {
    const metros = (v) => (Number.isFinite(v) ? v.toFixed(1).replace(".", ",") : "n/d");
    bullet(
      ctx,
      `Ponto de atenção · Coordenadas do trilho formam agrupamento concentrado. Os pontos GPS legíveis apresentam amplitude aproximada de ${metros(audit.northSouthMeters)} m no eixo norte-sul e ${metros(audit.eastWestMeters)} m no eixo leste-oeste. ${gpsIpDistance !== null ? `A distância entre o GPS da assinatura e a localização aproximada do IP é ${gpsIpDistance.toFixed(2).replace(".", ",")} km, classificada como ${gpsIpDistance < 50 ? "geograficamente convergente" : "geograficamente divergente"}.` : "Não foi possível confrontar o agrupamento com a localização do IP."} A concentração favorece coerência espacial, mas não comprova, isoladamente, autoria.`
    );
  }

  subheading(ctx, "Diligências sugeridas");
  for (const d of [
    "Requisitar à operadora a identificação do assinante da conexão vinculada ao IP e ao intervalo temporal registrado, mediante autorização judicial.",
    "Exigir os logs brutos da plataforma de assinatura, com carimbos em formato técnico, fuso, identificador de sessão e política de retenção.",
    "Solicitar fabricante, modelo, identificador do aparelho e método técnico de vinculação da selfie ao dispositivo utilizado, quando esses elementos forem declarados pela plataforma.",
    "Confrontar o titular da conta que recebeu o crédito com o contratante e com os demais elementos de autenticação.",
  ]) bullet(ctx, d);
}

/**
 * Dispersão das coordenadas do trilho, desenhada em vetor: cada ponto é o GPS
 * de um evento, numerado na ordem do histórico, com o norte para cima.
 */
function dispersionPlot(ctx, audit) {
  const { doc, contentWidth } = ctx;
  const pontos = (audit.events || []).filter((ev) => Number.isFinite(ev.lat) && Number.isFinite(ev.lon));
  const W = 300;
  const H = 190;
  const pad = 26;
  // Título e figura juntos: a guarda do subtítulo sozinha deixava o título no
  // pé da página e o gráfico na seguinte.
  if (pontos.length) reserve(ctx, H + 70);
  subheading(ctx, "Dispersão das coordenadas");
  if (!pontos.length) {
    paragraph(ctx, "Não houve coordenadas suficientes para calcular a dispersão dos eventos.", { color: MUTED, size: 8.5 });
    return;
  }
  const x0 = MARGIN + (contentWidth - W) / 2;
  const y0 = doc.y + 4;
  const lats = pontos.map((p) => p.lat);
  const lons = pontos.map((p) => p.lon);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const minLon = Math.min(...lons), maxLon = Math.max(...lons);
  const latSpan = Math.max(maxLat - minLat, 0.00001);
  const lonSpan = Math.max(maxLon - minLon, 0.00001);
  const xy = (p) => ({
    x: x0 + pad + ((p.lon - minLon) / lonSpan) * (W - pad * 2),
    y: y0 + pad + ((maxLat - p.lat) / latSpan) * (H - pad * 2),
  });

  doc.rect(x0 + pad, y0 + pad, W - pad * 2, H - pad * 2).lineWidth(0.6).strokeColor("#9ca3af").stroke();
  for (let passo = 1; passo <= 3; passo += 1) {
    const gx = x0 + pad + ((W - pad * 2) * passo) / 4;
    const gy = y0 + pad + ((H - pad * 2) * passo) / 4;
    doc.moveTo(gx, y0 + pad).lineTo(gx, y0 + H - pad).lineWidth(0.3).strokeColor(RULE).stroke();
    doc.moveTo(x0 + pad, gy).lineTo(x0 + W - pad, gy).lineWidth(0.3).strokeColor(RULE).stroke();
  }
  doc.fontSize(8).font("Helvetica-Bold").fillColor(MUTED).text("N", x0, y0 + 8, { width: W, align: "center" });
  pontos.forEach((p, i) => {
    const { x, y } = xy(p);
    const extremo = i === 0 || i === pontos.length - 1;
    doc.circle(x, y, extremo ? 7 : 5.5).fillColor(extremo ? DANGER : "#475569").fill();
    doc.fontSize(6).font("Helvetica-Bold").fillColor("#ffffff").text(String(i + 1), x - 7, y - 2.5, { width: 14, align: "center", lineBreak: false });
  });
  doc.y = y0 + H + 4;
  doc.x = MARGIN;
  const metros = (v) => (Number.isFinite(v) ? v.toFixed(1).replace(".", ",") : "n/d");
  doc
    .fontSize(8)
    .font("Helvetica-Oblique")
    .fillColor(MUTED)
    .text(`Cada ponto representa o GPS de um evento, na ordem do histórico. Norte para cima. Amplitude aproximada: N-S ${metros(audit.northSouthMeters)} m · L-O ${metros(audit.eastWestMeters)} m.`, MARGIN, doc.y, { width: contentWidth, align: "center" });
  doc.moveDown(0.5);
}

/** § 6.1 — confronto com o processo judicial. */
function sectionProcessComparison(ctx, confronto) {
  if (!confronto || confronto.status !== "COMPLETED") {
    // A tela mantém a seção com a explicação; omitir deixaria o leitor sem
    // saber se o confronto foi tentado.
    heading(ctx, "§ 6.1 · Confronto com o processo judicial");
    paragraph(ctx, "Não foi anexado PDF do processo para confronto. Esta seção fica sem conteúdo até que o arquivo dos autos seja fornecido.", { color: MUTED, size: 9 });
    return;
  }
  const divergencias = confronto.divergences || [];
  const parcial = confronto.resultado === "CONFRONTO PARCIAL";
  heading(ctx, "§ 6.1 · Confronto com o processo judicial", { danger: divergencias.length > 0 || parcial });
  badge(
    ctx,
    "Resultado do confronto automático",
    `${confronto.resultado || "não informado"} · ${divergencias.length ? `${divergencias.length} ponto(s)` : parcial ? "parcial" : "sem divergência"}`,
    !divergencias.length && !parcial
  );
  const cnj = extractCnjFromName(confronto.file?.name);
  if (cnj) field(ctx, "Processo", `Processo nº ${cnj}`);
  field(ctx, "Arquivo do processo", confronto.file?.name);
  field(ctx, "SHA-256 do processo", confronto.file?.sha256, { mono: true });
  field(ctx, "Páginas do processo", confronto.metadata?.totalPages);

  if (confronto.confirmations?.length) {
    subheading(ctx, "Dados do contrato procurados no processo");
    for (const c of confronto.confirmations) {
      field(ctx, `   ${c.label}`, [c.contrato ?? "não informado", c.processo, labelComparisonStatus(c.status)].filter(Boolean).join(" · "));
    }
  }
  if (divergencias.length) subheading(ctx, "Divergências / pontos de atenção");
  for (const d of divergencias) {
    reserve(ctx, 60);
    paragraph(ctx, `${d.label}${d.severidade ? ` (${d.severidade})` : ""}: contrato ${d.contrato} × processo ${d.processo}.${d.detalhe ? ` ${d.detalhe}` : ""}`, {
      color: d.severidade === "DIVERGÊNCIA" ? DANGER : INK,
      size: 9,
    });
    if (d.trecho) paragraph(ctx, `“${d.trecho}”`, { color: MUTED, size: 8, italic: true });
  }
  if (confronto.observations?.length) subheading(ctx, "Observações processuais");
  for (const o of confronto.observations || []) {
    paragraph(ctx, `${o.label}. ${o.detalhe}`, { size: 9 });
    if (o.trecho) paragraph(ctx, `Trecho: “${o.trecho}”`, { color: MUTED, size: 8, italic: true });
  }
  if (confronto.status_note) paragraph(ctx, confronto.status_note, { color: MUTED, size: 8.5 });
}

/** Sumário executivo de irregularidades, ao final do laudo. */
/** Identificação que abre a folha do sumário, igual à da tela. */
function identificacaoDoSumario(sumario, reportId) {
  const contrato = [sumario.bank, sumario.contractNumber].filter(Boolean).join(" ");
  return {
    marca: "ForenseDoc",
    subMarca: "Verificação de cadeia de custódia documental",
    etiqueta: "Sumário executivo",
    linhas: [
      reportId ? `Laudo ${reportId}` : null,
      [contrato || null, sumario.cpf ? `CPF ${sumario.cpf}` : null].filter(Boolean).join(" · ") || null,
    ].filter(Boolean),
  };
}

/** Cabeçalho da folha no tema clássico, sem os recursos do cartão. */
function cabecalhoSumarioClassico(ctx, dados) {
  const { doc, contentWidth } = ctx;
  const altura = 46;
  reserve(ctx, altura + 90);
  const y = doc.y;
  const meia = contentWidth / 2;

  doc.save();
  doc.rect(MARGIN, y, contentWidth, 2).fillColor(ACCENT).fill();
  doc.restore();

  doc.fontSize(10).font("Helvetica-Bold").fillColor(ACCENT)
    .text(dados.marca.toUpperCase(), MARGIN, y + 10, { width: meia, characterSpacing: 0.8, lineBreak: false });
  doc.fontSize(6).font("Helvetica").fillColor(MUTED)
    .text(dados.subMarca.toUpperCase(), MARGIN, y + 24, { width: meia + 40, characterSpacing: 0.4, lineBreak: false });

  doc.fontSize(7).font("Helvetica-Bold").fillColor(INK)
    .text(dados.etiqueta.toUpperCase(), MARGIN + meia, y + 9, { width: meia, align: "right", characterSpacing: 0.6, lineBreak: false });
  let linhaY = y + 20;
  for (const linha of dados.linhas) {
    doc.fontSize(6.6).font("Helvetica").fillColor(MUTED)
      .text(linha, MARGIN + meia - 60, linhaY, { width: meia + 60, align: "right", lineBreak: false });
    linhaY += 9;
  }

  doc.moveTo(MARGIN, y + altura - 5).lineTo(MARGIN + contentWidth, y + altura - 5)
    .lineWidth(0.7).strokeColor(RULE).stroke();
  doc.x = MARGIN;
  doc.y = y + altura;
}

function sectionExecutiveSummary(ctx, sumario, reportId) {
  if (!sumario) return;
  /*
   * O sumário abre com o MESMO cabeçalho da tela, e não com um título de seção
   * qualquer. Na tela ele é peça destacável, e é por "FORENSEDOC · VERIFICAÇÃO
   * DE CADEIA DE CUSTÓDIA DOCUMENTAL · SUMÁRIO EXECUTIVO" que o operador o
   * procura. O conteúdo já saía no PDF antes disto, mas como seção corrida no
   * meio do laudo: quem folheava não reconhecia o bloco e concluía que o
   * sumário não tinha sido impresso.
   *
   * O cabeçalho reserva a própria altura mais o começo do conteúdo, pelo mesmo
   * motivo do anexo de imagens: cabeçalho sozinho no pé da página é pior que
   * nenhum cabeçalho, e a quebra incondicional abriria folha em branco sempre
   * que o corpo do laudo terminasse no alto da página.
   */
  const identificacao = identificacaoDoSumario(sumario, reportId);
  if (ctx.tema === "modelo") temaModelo.cabecalhoSumario(ctx, identificacao);
  else cabecalhoSumarioClassico(ctx, identificacao);

  heading(ctx, "Irregularidades do laudo ForenseDoc, em síntese");
  // Banco, contrato e CPF já estão no cabeçalho: repeti-los aqui como campos
  // duplicaria a mesma identificação a duas linhas de distância.
  field(ctx, "Orientação de revisão", "REVISÃO DOCUMENTAL NECESSÁRIA");
  paragraph(ctx, "Conferir as evidências e diligências de cada item. As classificações individuais orientam a revisão; não atestam fraude, autoria ou validade jurídica.", { color: MUTED, size: 8.5 });
  if (sumario.intro) paragraph(ctx, sumario.intro, { size: 9 });
  const meta = sumario.meta;
  if (meta) {
    paragraph(
      ctx,
      [
        meta.contractDate && `Contrato ${meta.contractDate}`,
        meta.signatureDate && `assinatura ${meta.signatureDate}${meta.methods ? ` (${meta.methods})` : ""}`,
        meta.sha256 && `SHA-256 ${meta.sha256}`,
        meta.size,
        meta.pages,
      ].filter(Boolean).join(" · "),
      { color: MUTED, size: 8.5 }
    );
  }

  subheading(ctx, "Placar de gravidade");
  if (sumario.semAchados) {
    paragraph(ctx, "Sem irregularidade crítica automática conclusiva. Os dados disponíveis não produziram alerta grave, sem prejuízo da revisão humana do contrato e dos logs originais.", { size: 9 });
  }
  for (const f of sumario.findings || []) {
    if (ctx.tema === "modelo") {
      temaModelo.achadoPlacar(ctx, { severidade: f.severity, titulo: f.title, texto: f.text });
      continue;
    }
    reserve(ctx, 52);
    const { doc, contentWidth } = ctx;
    doc
      .fontSize(9)
      .font("Helvetica-Bold")
      .fillColor(f.severity === "ALTA" ? DANGER : f.severity === "FAVORÁVEL" ? ACCENT : INK)
      .text(`${f.severity} · `, MARGIN, doc.y, { width: contentWidth, continued: true })
      .fillColor(INK)
      .text(`${f.title} `, { continued: true })
      .font("Helvetica")
      .text(` ${f.text}`, { align: "justify" });
    doc.moveDown(0.3);
  }

  // D5: o corte de página é declarado e contado, nunca silencioso.
  if (sumario.corte?.aviso) {
    paragraph(ctx, sumario.corte.aviso, { color: MUTED, size: 8 });
  }
  // Sempre presente: a verificação geográfica é parte central do laudo.
  if (sumario.geo) {
    subheading(ctx, sumario.geo.modo === "pares" ? "Verificação de endereços: os confrontos que importam" : "GPS contra IP: o confronto que importa");
    paragraph(ctx, `Onde o documento diz que o ato ocorreu. ${sumario.geo.description || ""}`.trim(), { size: 9 });
    geoScale(ctx, sumario.geo);
  }
  for (const ip of sumario.ipCards || []) {
    field(ctx, `   ${ip.endereco} · ${ip.badge}`, ip.text);
  }
  if (sumario.synthesis) {
    subheading(ctx, "Síntese");
    paragraph(ctx, sumario.synthesis, { size: 9 });
  }

  if (sumario.diligences?.length) {
    subheading(ctx, "Diligências recomendadas");
    sumario.diligences.forEach((d, i) => {
      paragraph(ctx, `${String(i + 1).padStart(2, "0")}. ${d.title}. ${d.text}`, { size: 9 });
    });
  }
  if (sumario.disclaimer) paragraph(ctx, sumario.disclaimer, { color: MUTED, size: 8 });
}

/**
 * Régua logarítmica de distâncias do sumário (0,1 a 10.000 km), a mesma da
 * tela: cada ponto é um confronto, com rótulo e distância.
 */
/** Encurta o texto, com reticências, até caber em uma linha da largura dada. */
function caber(doc, texto, largura) {
  let t = String(texto || "");
  if (doc.widthOfString(t) <= largura) return t;
  while (t.length > 1 && doc.widthOfString(`${t}…`) > largura) t = t.slice(0, -1);
  return `${t.trimEnd()}…`;
}

function geoScale(ctx, geo) {
  const itens = (geo.items || []).filter((i) => distanciaKm(i.distance) !== null && !distanciaSuspeita(i.distance));
  if (!itens.length) return;
  const { doc, contentWidth } = ctx;
  const H = 165;
  reserve(ctx, H + 8);
  if (ctx.tema === "modelo") temaModelo.fundoParaBloco(ctx, H + 8);
  const y0 = doc.y + 4;
  const xIni = MARGIN + 30;
  const xFim = MARGIN + contentWidth - 30;
  const eixoY = y0 + 110;
  const xPara = (km) => xIni + ((Math.log10(Math.max(0.1, Math.min(10000, km))) + 1) / 5) * (xFim - xIni);
  const cor = (role) => (role === "gps" ? "#2f6846" : role === "access" || role === "laudo" ? "#bc631e" : "#203f52");

  doc.moveTo(xIni, eixoY).lineTo(xFim, eixoY).lineWidth(1.5).strokeColor("#d8d0c3").stroke();
  for (const marca of [0.1, 1, 10, 100, 1000, 10000]) {
    const x = xPara(marca);
    doc.moveTo(x, eixoY - 4).lineTo(x, eixoY + 5).lineWidth(0.6).strokeColor("#bdb3a4").stroke();
    doc.fontSize(7).font("Courier").fillColor(MUTED).text(`${marca.toLocaleString("pt-BR")} km`, x - 30, eixoY + 9, { width: 60, align: "center", lineBreak: false });
  }
  itens.forEach((item, i) => {
    const x = xPara(distanciaKm(item.distance));
    const yRotulo = y0 + (i % 4) * 24;
    doc.moveTo(x, yRotulo + 18).lineTo(x, eixoY - 6).lineWidth(1).strokeColor(cor(item.role)).stroke();
    doc.circle(x, eixoY, 4.5).fillColor(cor(item.role)).fill();
    const larguraRotulo = 150;
    const xRotulo = Math.max(MARGIN, Math.min(MARGIN + contentWidth - larguraRotulo, x - larguraRotulo / 2));
    doc.fontSize(7).font("Helvetica-Bold").fillColor(cor(item.role)).text(caber(doc, item.label, larguraRotulo), xRotulo, yRotulo, { width: larguraRotulo, align: "center", lineBreak: false });
    doc.fontSize(7).font("Courier").fillColor(MUTED).text(item.texto || formatarDistancia(item.distance), xRotulo, yRotulo + 9, { width: larguraRotulo, align: "center", lineBreak: false });
  });
  const legenda = geo.modo === "pares"
    ? [["#203f52", "com o endereço do instrumento"], ["#bc631e", "com o endereço do laudo"], ["#2f6846", "GPS do ato × IP"]]
    : [["#2f6846", "GPS da assinatura"], ["#bc631e", "IP de acesso"], ["#203f52", "Infraestrutura"]];
  legenda.forEach(([c, texto], i) => {
    const x = xIni + i * 160;
    doc.circle(x, eixoY + 32, 3.5).fillColor(c).fill();
    doc.fontSize(7.5).font("Helvetica").fillColor(MUTED).text(texto, x + 7, eixoY + 28.5, { width: 150, lineBreak: false });
  });
  doc.x = MARGIN;
  doc.y = eixoY + 46;
  doc.font("Helvetica");
}

function sectionRemarks(ctx, extracted) {
  heading(ctx, "§ 7 · Observações periciais complementares");
  paragraph(
    ctx,
    extracted.observacoes_periciais ||
      "Não há observação complementar além do que já consta das seções anteriores."
  );
  paragraph(
    ctx,
    "Este laudo foi produzido por extração automatizada de texto, metadados e objetos gráficos do arquivo original, com verificação criptográfica local. Os campos extraídos devem ser conferidos contra o instrumento antes do uso em peça processual. As conclusões técnicas das seções anteriores decorrem de exame direto do arquivo e independem de valoração jurídica, que compete ao juízo.",
    { color: MUTED, size: 8.5 }
  );
}

function sectionQuesitos(ctx, extracted, result) {
  const { doc, contentWidth } = ctx;
  heading(ctx, "§ 8 · Sugestão de Quesitos Judiciais ao Juízo e Perito");
  paragraph(
    ctx,
    "Com base nas anomalias técnicas identificadas no presente laudo, sugerem-se os seguintes quesitos periciais para formulação em juízo e fixação dos pontos controvertidos (CPC, art. 465, § 1º, III):",
    { size: 9, color: MUTED }
  );

  // Mesmas entradas da tela (montarRelatorio.js): o IP de referência é o
  // primeiro geolocalizado e a distância é a dele à residência. A distância do
  // GPS declarado, usada antes aqui, fazia o quesito divergir do exibido.
  const ips = result.ipAnalysis || [];
  const ipItem = ips.find((ip) => ip.geo) || ips[0];
  const distanciaIp = distanciaKm(ipItem?.distance);
  const quesitos = generateJudicialQuesitos({
    clienteNome: extracted.cliente?.nome,
    clienteCpf: extracted.cliente?.cpf,
    contratoNumero: extracted.contrato?.numero || extracted.contratoNumero,
    banco: extracted.contrato?.banco || extracted.banco,
    ip: ipItem?.endereco,
    porta: ipItem?.porta,
    gpsCoords: result.contractGeo ? `${result.contractGeo.lat}, ${result.contractGeo.lon}` : null,
    cidadeIp: ipItem?.geo ? [ipItem.geo.city, ipItem.geo.region].filter(Boolean).join(" / ") : null,
    cidadeDomicilio: result.home?.geo ? result.home.geo.display || result.home.query : null,
    distanciaKm: distanciaIp !== null ? distanciaIp.toFixed(1) : null,
    dataHora: ipItem?.data_hora || extracted.assinatura?.data_hora_assinatura,
    achados: extracted.achados_irregularidade || [],
    extracted,
    cadeiaCustodia: result.cadeiaCustodia || null,
  });

  for (const q of quesitos) {
    reserve(ctx, 62);
    doc.moveDown(0.2);
    doc.fontSize(9.5).font("Helvetica-Bold").fillColor(ACCENT).text(`Quesito ${q.numero} · ${q.titulo}:`, { width: contentWidth });
    doc.moveDown(0.1);
    doc.fontSize(9).font("Helvetica").fillColor(INK).text(q.quesito, { width: contentWidth, align: "justify", lineGap: 1.2 });
    doc.fontSize(8).font("Helvetica-Oblique").fillColor(MUTED).text(`Finalidade processual: ${q.finalidade}`, { width: contentWidth });
    doc.moveDown(0.3);
  }
}

function sectionLegal(ctx, extracted = {}, result = {}) {
  heading(ctx, "§ 9 · Fundamentação normativa aplicável");
  // Mesma síntese da tela: quais achados têm maior aderência normativa.
  const hashDeclarado = extracted.assinatura?.hash_documento_assinado;
  const destaques = [];
  if (hashDeclarado && !confrontoHash(String(hashDeclarado).trim(), result.hashes?.sha256).ehHash) destaques.push("defeito formal de integridade do documento");
  destaques.push("validade da assinatura eletrônica e ônus da prova");
  const longe = (km) => distanciaKm(km) !== null && distanciaKm(km) >= 300;
  if (longe(result.contractGeo?.distance) || (result.ipAnalysis || []).some((ip) => longe(ip.distance))) destaques.push("incompatibilidade geográfica do ato");
  paragraph(ctx, `Achados deste laudo com maior aderência normativa: ${destaques.join("; ")}.`, { size: 9 });
  for (const { grupo, itens } of fundamentacaoPara(extracted.contrato?.produto_codigo)) {
    const { doc, contentWidth } = ctx;
    reserve(ctx, 72); // título do grupo + o primeiro dispositivo junto
    doc.moveDown(0.3);
    doc.fontSize(10).font("Helvetica-Bold").fillColor(INK).text(grupo, { width: contentWidth });
    doc.moveDown(0.2);
    for (const [disp, sint] of itens) {
      reserve(ctx, 44);
      doc.fontSize(9).font("Helvetica-Bold").fillColor(ACCENT).text(disp, { width: contentWidth });
      doc.fontSize(9).font("Helvetica").fillColor(INK).text(sint, { width: contentWidth, align: "justify", lineGap: 1 });
      doc.moveDown(0.3);
    }
  }
  // A ressalva diz "a fundamentação acima": vem depois dos dispositivos.
  paragraph(ctx, NOTA_FUNDAMENTACAO_RESSALVA, { color: MUTED, size: 8.5 });
}

function legalNotice(ctx, timestamp) {
  if (ctx.tema === "modelo") return temaModelo.avisoLegalBloco(ctx, avisoLegal(timestamp));
  const { doc, contentWidth } = ctx;
  doc.moveDown(0.5);
  reserve(ctx, 96); // régua + aviso legal inteiro, que não se divide bem
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
