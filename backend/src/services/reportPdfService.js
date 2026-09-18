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
import { calculateForensicScore } from "../utils/forensicScore.js";
import { generateJudicialQuesitos } from "../reports/quesitosTemplate.js";
import { montarConfrontoGeografico } from "../utils/distancia.js";
import { descreverIndisponibilidade } from "../utils/confrontoEnderecos.js";
import { fichaBeneficioSeAplica } from "../engine/produto.js";
import { distanciaKm } from "../utils/distancia.js";

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
export async function buildReportPdf(analysis, result) {
  exigirEmissaoCoerente(result);
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
    margins: { top: MARGIN, bottom: MARGIN_BOTTOM, left: MARGIN, right: MARGIN },
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
  const extracted = safeParse(result.text) || {};
  const timestamp = result.generatedAt
    ? new Date(result.generatedAt).toLocaleString("pt-BR", { timeZone: "America/Fortaleza" })
    : new Date(analysis.createdAt).toLocaleString("pt-BR", { timeZone: "America/Fortaleza" });

  const ctx = { doc, contentWidth: doc.page.width - MARGIN * 2 };

  cover(ctx, analysis, result, timestamp);
  sectionReview(ctx, result);
  sectionIdentity(ctx, result, extracted);
  sectionMetadata(ctx, result.metadata);
  sectionDigitalSignature(ctx, result.metadata, extracted);
  sectionContract(ctx, extracted);
  sectionEconomics(ctx, extracted);
  sectionCreditRelease(ctx, extracted);
  sectionInsurance(ctx, extracted);
  sectionClient(ctx, extracted);
  sectionSignature(ctx, extracted, result);
  sectionContractingTrail(ctx, extracted);
  sectionEventTrail(ctx, extracted);
  sectionBiometricArtifact(ctx, extracted);
  sectionGeo(ctx, result, { mapaIpResidencia, mapaResidenciaDeclarado, mapaDeclaradoIp });
  sectionIrregularities(ctx, extracted, result.sumarioIrregularidades?.projecao);
  sectionProcessComparison(ctx, result.processComparison);
  sectionRemarks(ctx, extracted);
  sectionQuesitos(ctx, extracted, result);
  sectionLegal(ctx, extracted);
  sectionExecutiveSummary(ctx, result.sumarioIrregularidades, result.reportId);
  sectionImageAnnex(ctx, extracted);
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

  field(ctx, "Identificador do laudo", result.reportId || analysis.id);
  field(ctx, "Arquivo analisado", result.file?.name || "nome não informado");
  field(ctx, "Tamanho do arquivo", result.file?.sizeBytes ? `${(result.file.sizeBytes / 1024).toFixed(2)} KB` : null);
  field(ctx, "Data de geração", timestamp);
  if (result.usedOcr) field(ctx, "OCR", `Aplicado em ${result.ocrPages} página(s)`);

  // ─── Visual Law: Resumo Executivo para o Magistrado / Perito ────────────────
  // Distâncias do confronto canônico: recusado o confronto, não há índice.
  const confrontoCapa = result.confronto_geografico || montarConfrontoGeografico(result);
  const distKmIp = confrontoCapa.distancias.ips_residencia[0]?.km ?? null;
  const distKmGps = confrontoCapa.distancias.gps_residencia;
  const distKmIpVsGps = confrontoCapa.gps_ip;
  const scoreObj = calculateForensicScore({ distKmIp, distKmGps, distKmIpVsGps });

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

  doc.y = boxY + boxHeight + 10;
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

function sectionIdentity(ctx, result, extracted) {
  heading(ctx, "§ 1 · Identificação e integridade criptográfica");
  if (result.hashes) {
    field(ctx, "SHA-256 (calculado pelo servidor)", result.hashes.sha256, { mono: true });
    field(ctx, "SHA-1 (calculado pelo servidor)", result.hashes.sha1, { mono: true });
  }
  const declared = extracted.assinatura?.hash_documento_assinado;
  if (declared) field(ctx, "Hash declarado no documento", declared, { mono: true });
  const codigo = extracted.assinatura?.codigo_autenticacao_declarado;
  if (codigo) {
    // Protocolo não é hash: sai em campo próprio, sem painel de confronto.
    field(ctx, "Código de autenticação declarado", codigo, { mono: true });
    field(ctx, "   Origem", extracted.assinatura.codigo_autenticacao_origem);
    field(ctx, "   Verificação oferecida", extracted.assinatura.codigo_autenticacao_url_verificacao);
  }
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
  // O extrator grava `modificationDate`; `modDate` nunca existiu e a linha
  // saía sempre vazia no PDF.
  field(ctx, "Data de modificação", metadata.modificationDate ?? metadata.modDate);
  if (metadata.warnings?.length) {
    paragraph(ctx, metadata.warnings.join(" "), { color: DANGER, size: 8.5 });
  }
}

function sectionContract(ctx, extracted) {
  const c = extracted.contrato || {};
  heading(ctx, "§ 2 · Dados do instrumento contratual");
  if (c.condicoes_financeiras_nota) paragraph(ctx, c.condicoes_financeiras_nota, { color: DANGER, size: 8.5 });
  field(ctx, "Número do contrato", c.numero);
  field(ctx, "Banco / instituição", c.banco);
  field(ctx, "Produto", c.produto);
  field(ctx, "Modalidade", ({COMPRA_CARTAO: "Compra com cartão", SAQUE_CARTAO_CONSIGNADO: "Saque parcelado do cartão consignado", CDC_COM_GARANTIA: "Crédito direto ao consumidor com garantia", CREDITO_PESSOA_JURIDICA: "Crédito para pessoa jurídica"})[c.modalidade] || c.modalidade);
  if (c.empregador) field(ctx, "Empregador declarado", `${c.empregador.literal}${c.empregador.identificado ? "" : " (sem razão social e sem CNPJ)"}`);
  field(ctx, "Valor contratado", c.valor_contratado);
  field(ctx, "Valor da parcela", c.valor_parcela);
  field(ctx, "Número de parcelas", c.numero_parcelas);
  field(ctx, "Taxa de juros mensal", c.taxa_juros_mensal);
  field(ctx, "Taxa de juros anual", c.taxa_juros_anual);
  field(ctx, "CET mensal", c.cet_mensal);
  field(ctx, "CET anual", c.cet_anual);
  field(ctx, "Data do contrato", c.data_contrato);
  if (c.data_contrato_origem) field(ctx, "   Origem da data", `${c.data_contrato_origem}${c.data_contrato_confianca === "BAIXA" ? " · confiança baixa" : ""}`);
  if (c.data_contrato_nota) paragraph(ctx, c.data_contrato_nota, { color: DANGER, size: 8.5 });
}

function sectionClient(ctx, extracted) {
  const c = extracted.cliente || {};
  heading(ctx, "§ 3 · Qualificação do contratante");
  field(ctx, "Nome completo", c.nome);
  field(ctx, "CPF", c.cpf);
  const estados = c.estados_campos || {};
  field(ctx, "RG", estados.rg?.estado === "LOCALIZADO_SUSPEITO" ? `${c.rg || estados.rg.valor} (suspeito: ${estados.rg.motivo})` : c.rg);
  field(ctx, "Data de nascimento", c.data_nascimento);
  field(
    ctx,
    "Endereço",
    estados.endereco?.estado === "LOCALIZADO_VAZIO" ? `localizado e vazio no instrumento: "${estados.endereco.valor}"` : c.endereco
  );
  field(ctx, "Cidade / Estado", [c.cidade, c.estado].filter(Boolean).join(" / "));
  field(ctx, "CEP", c.cep);
  field(ctx, "Telefone", c.telefone);
  // D7: campo de benefício previdenciário não se imprime em modalidade que não
  // o comporta. "Não identificado" ali afirma lacuna onde não há campo.
  if (fichaBeneficioSeAplica(extracted.contrato?.produto_codigo)) {
    field(ctx, "Número do benefício", c.numero_beneficio);
  }
}

function sectionSignature(ctx, extracted, result = {}) {
  const a = extracted.assinatura || {};
  heading(ctx, "§ 4 · Assinatura eletrônica e cadeia de custódia");
  badge(ctx, "Registro textual de assinatura", a.presente ? "LOCALIZADO" : "NÃO LOCALIZADO", !!a.presente);
  paragraph(ctx, NOTA_ASSINATURA, { color: MUTED, size: 8.5 });
  field(ctx, "Plataforma de assinatura", a.plataforma);
  field(ctx, "Tipo de assinatura", a.tipo);
  field(ctx, "Titular do signatário", a.titular_certificado);
  field(ctx, "Data / hora da assinatura", a.data_hora_assinatura);
  field(ctx, "Algoritmo de hash", a.algoritmo_hash);
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
    field(ctx, "Hash declarado", a.hash_documento_assinado ? "Declarado" : "Ausente");
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

    if (ip.data_hora) field(ctx, "   Data / hora do registro", ip.data_hora);
    if (ip.porta) {
      field(ctx, "   Porta lógica de origem", `${ip.porta} (valor declarado; não comprova sessão ativa)`);
    }

    if (ip.rdap) {
      if (ip.rdap.asn) field(ctx, "   ASN Oficial (Registro.br / LACNIC)", `${ip.rdap.asn} — ${ip.rdap.owner || ""}`);
      if (ip.rdap.cidr) field(ctx, "   Bloco / Faixa CIDR alocada", ip.rdap.cidr);
    }

    if (ip.parsedUserAgent) {
      const ua = ip.parsedUserAgent;
      field(ctx, "   Ambiente do dispositivo", `${ua.os} ${ua.osVersion || ""} · ${ua.browser} ${ua.browserVersion || ""} (${ua.deviceType})`);
    } else if (ip.user_agent) {
      field(ctx, "   Dispositivo declarado", ip.user_agent);
    }

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
    if (ip.geo.isp) field(ctx, "   Operadora (ISP)", ip.geo.isp);
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
  const achados = temProjecao
    ? projecao.map((f) => ({ codigo: f.key, gravidade: f.severity, titulo: f.title, texto: f.text }))
    : Array.isArray(extracted.achados_irregularidade) ? extracted.achados_irregularidade : [];
  heading(ctx, "§ 6 · Evidências de irregularidade", { danger: evs.length > 0 || achados.length > 0 });

  // Motor pericial v2: achado estruturado com código e gravidade.
  if (achados.length) {
    for (const achado of achados) {
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
    doc.fontSize(9.5).font("Helvetica").fillColor(DANGER).text("▸ ", MARGIN, doc.y, { continued: true });
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
function sectionDigitalSignature(ctx, metadata, extracted) {
  const ds = metadata?.digitalSignature;
  const imagens = extracted.imagens_pdf;
  if (!ds && !imagens) return;
  heading(ctx, "§ 1.2 · Assinatura digital, proveniência e imagens do arquivo");

  if (ds) {
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
    for (const sig of ds.pdfsig?.assinaturas || []) {
      reserve(ctx, 80);
      subheading(ctx, `Assinatura #${sig.numero}${sig.campo ? ` · ${sig.campo}` : ""}`);
      field(ctx, "   Signatário (CN)", sig.signatario_cn);
      field(ctx, "   Data da assinatura", sig.data_assinatura);
      field(ctx, "   Algoritmo de resumo", sig.algoritmo_resumo);
      field(ctx, "   Validação da assinatura", sig.validacao_assinatura);
      field(ctx, "   Validação do certificado", sig.validacao_certificado);
      if (sig.coberturaPercentual != null) {
        field(ctx, "   Cobertura do documento", `${String(sig.coberturaPercentual).replace(".", ",")}%`);
      }
    }
    for (const alerta of ds.alerts || []) {
      paragraph(ctx, `${alerta.codigo} · ${alerta.severidade} · ${alerta.titulo}. ${alerta.detalhe}`, {
        color: alerta.severidade === "CRÍTICO" ? DANGER : INK,
        size: 8.5,
      });
    }
  }

  if (imagens) {
    subheading(ctx, "Inventário de imagens incorporadas");
    if (!imagens.disponivel) {
      paragraph(ctx, imagens.observacao || "Inventário de imagens indisponível.", { color: MUTED, size: 8.5 });
    } else {
      const lista = imagens.imagens || [];
      const templates = lista.filter((i) => !i.biometricaProvavel && i.classificacao !== "imagem documental");
      field(ctx, "Imagens listadas", imagens.total ?? 0);
      field(ctx, "Fotografia / biometria provável", lista.filter((i) => i.biometricaProvavel).length);
      field(ctx, "Imagens documentais", lista.filter((i) => i.classificacao === "imagem documental").length);
      field(ctx, "Elementos de template (logotipos, fios, máscaras)", `${templates.length} · detalhe no anexo técnico`);
      field(ctx, "Grupos de imagens idênticas", imagens.grupos_repetidos?.length ?? 0);
      // Análises gravadas antes do MED-03 ainda trazem o IMG2 de template.
      for (const achado of (imagens.achados || []).filter((a) => !(a.codigo === "IMG2" && a.titulo === "Reuso de imagem de template"))) {
        paragraph(ctx, `${achado.titulo}. ${achado.detalhe}`, { size: 8.5 });
      }
    }
  }
}

const pctBR = (v, casas = 1) => (v == null ? null : `${(v * 100).toFixed(casas).replace(".", ",")}%`);

/** § 2.2: forma de liberação declarada e comprovante do crédito. */
function sectionCreditRelease(ctx, extracted) {
  const l = extracted.liberacao_credito;
  if (!l?.declarada) return;
  heading(ctx, "§ 2.2 · Liberação do crédito e comprovante", { danger: !l.comprovante });
  field(ctx, "Forma de liberação declarada", l.declarada.forma);
  field(ctx, "Banco / agência / conta", [l.declarada.banco && `Banco ${l.declarada.banco}`, l.declarada.agencia && `agência ${l.declarada.agencia}`, l.declarada.conta && `conta ${l.declarada.conta}`].filter(Boolean).join(" · "));
  field(ctx, "Valor a ser creditado", extracted.contrato?.valor_liberado);
  badge(ctx, "Comprovante de transferência no arquivo", l.comprovante ? "LOCALIZADO" : "AUSENTE", Boolean(l.comprovante));
  if (l.comprovante) field(ctx, "   Comprovante", [l.comprovante.pagina && `pág. ${l.comprovante.pagina}`, l.comprovante.valor, l.comprovante.data].filter(Boolean).join(" · "));
}

/** § 2.3: seguro prestamista vinculado. */
function sectionInsurance(ctx, extracted) {
  const sg = extracted.seguro_prestamista;
  if (!sg) return;
  heading(ctx, "§ 2.3 · Seguro prestamista vinculado à operação", { danger: (sg.achados || []).some((a) => a.gravidade === "ALTA") });
  field(ctx, "Proposta", sg.proposta);
  field(ctx, "Forma de pagamento", sg.forma_pagamento);
  field(ctx, "Vigência", sg.vigencia?.premissa);
  field(ctx, "Marcos de contagem", sg.marcos_temporais);
  field(ctx, "Prêmio", sg.premio ? `${sg.premio}${sg.premio_sobre_liberado != null ? ` (${pctBR(sg.premio_sobre_liberado, 2)} do valor liberado)` : ""}` : null);
  field(ctx, "IOF do seguro", sg.iof);
  field(ctx, "Pró-labore", sg.pro_labore ? `${sg.pro_labore}${sg.pro_labore_sobre_premio != null ? ` (${pctBR(sg.pro_labore_sobre_premio)} do prêmio)` : ""}` : null);
  field(ctx, "Seguradora", sg.seguradora ? `${sg.seguradora.nome}${sg.seguradora.cnpj ? `, CNPJ ${sg.seguradora.cnpj}` : ""}` : null);
  field(ctx, "Corretora", sg.corretora ? `${sg.corretora.nome}, CNPJ ${sg.corretora.cnpj}, SUSEP ${sg.corretora.susep}` : null);
  field(ctx, "Estipulante", sg.estipulante ? `${sg.estipulante.nome}, CNPJ ${sg.estipulante.cnpj}` : null);
  field(ctx, "Beneficiário", sg.beneficiario);
  for (const c of sg.coberturas || []) {
    field(
      ctx,
      `   ${c.nome}`,
      [c.premio, c.participacao_premio != null ? `${pctBR(c.participacao_premio)} do prêmio` : null, `carência ${c.carencia_dias == null ? "não identificada" : c.carencia_dias ? `${c.carencia_dias} dias` : "não há"}`, `franquia ${c.franquia_dias == null ? "não identificada" : c.franquia_dias ? `${c.franquia_dias} dias` : "não há"}`, c.teto_parcelas ? `até ${c.teto_parcelas} parcelas` : null].filter(Boolean).join(" · ")
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
  for (const ev of t.eventos) {
    reserve(ctx, 26);
    field(
      ctx,
      `   ${ev.nome}`,
      [
        `${ev.data_hora}${ev.hora_local ? ` (local ${ev.hora_local.split(" ")[1]})` : ""}`,
        ev.intervalo_s == null ? "referência" : `+${ev.intervalo_s} s`,
        ev.segundos_por_pagina != null ? `${String(ev.segundos_por_pagina).replace(".", ",")} s/pág. (razão aritmética; não mede leitura) em ${ev.documento_aceito.paginas} págs.` : null,
        ev.aparelho ? `dispositivo ${ev.aparelho}` : null,
        ev.ip ? `IP ${ev.ip}${ev.porta ? `:${ev.porta}` : ""}` : "sem IP",
        ev.lat != null ? `${ev.lat}, ${ev.lon}` : "sem geolocalização",
      ].filter(Boolean).join(" · ")
    );
  }
}

/** Bloco do artefato biométrico, com miniatura. */
function sectionBiometricArtifact(ctx, extracted) {
  const b = extracted.imagem_biometrica;
  if (!b) return;
  heading(ctx, "§ 4.4 · Artefato biométrico", { danger: Boolean(b.achado) });
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

/** Anexo técnico: inventário completo de imagens, fora do corpo do laudo. */
function sectionImageAnnex(ctx, extracted) {
  const lista = extracted.imagens_pdf?.imagens || [];
  if (!lista.length) return;
  // Anexo em página própria só quando a atual já está cheia: a quebra
  // incondicional abria uma página quase em branco sempre que o corpo do laudo
  // terminava no alto da página.
  reserve(ctx, 220);
  heading(ctx, "Anexo técnico · Inventário de imagens");
  paragraph(ctx, "Todas as imagens listadas por pdfimages, com classificação e SHA-256 individual.", { color: MUTED, size: 8.5 });
  for (const item of lista) {
    reserve(ctx, 14);
    ctx.doc.fontSize(7.5).font("Courier").fillColor(INK).text(
      `pág. ${item.page} · img ${item.num} · ${item.type} · ${item.width}x${item.height} · ${item.classificacao || item.enc} · ${item.size} · ${String(item.sha256 || "-").slice(0, 16)}`,
      { width: ctx.contentWidth }
    );
  }
  ctx.doc.font("Helvetica");
}

/** § 2.1 — dados econômicos complementares e aferição matemática. */
function sectionEconomics(ctx, extracted) {
  const c = extracted.contrato || {};
  const m = extracted.afericao_matematica;
  const cartao = c.cartao;
  const linhas = [
    ["Valor liberado", c.valor_liberado],
    ["Saldo portado / refinanciado", c.saldo_portado],
    ["Tarifa de cadastro", c.tarifa_cadastro],
    ["Seguros", c.seguros],
    ["IOF financiado", c.iof_financiado],
    ["Somatório das parcelas", c.valor_total_parcelas],
    // D6: o rótulo segue a origem. Chamar de "declarado" um valor que o sistema
    // calculou afirma que o instrumento o trouxe, e não trouxe.
    [c.prazo_dias_origem === "CALCULADO_PELO_SISTEMA" ? "Prazo da operação (dias) · calculado pelo sistema" : "Prazo declarado (dias)", c.prazo_dias],
    // D4: a ficha publica o token completo. Reduzir a "6 meses" um campo que diz
    // "6 meses ou até o pagamento da última parcela" reproduz, na apresentação,
    // exatamente o corte que o comparador fazia.
    ["Prazo total declarado", c.prazo_total_declarado
      ? (c.prazo_total_declarado.condicional
        ? `${c.prazo_total_declarado.texto} · declaração condicional`
        : `${c.prazo_total_declarado.quantidade} ${c.prazo_total_declarado.unidade}`)
      : null],
    ["Prazo efetivo, da emissão ao último vencimento (dias)", c.prazo_efetivo_dias],
    ["Carência até o 1º vencimento (dias)", c.carencia_dias],
    ["Juros estimados na carência (hipótese: liberação na emissão)", c.juros_carencia],
    ["Custo total (somatório − liberado)", c.custo_total ? `${c.custo_total} (${c.custo_total_percentual} do liberado)` : null],
    ["Taxa anual calculada · calculada pelo sistema", c.taxa_juros_anual_calculada],
    [c.prazo_operacao_meses_aprox_origem === "CALCULADO_PELO_SISTEMA" ? "Prazo da operação (meses, aprox.) · calculado pelo sistema" : "Prazo da operação (meses, aprox.)", c.prazo_operacao_meses_aprox],
    ["Tipo de operação", c.tipo_operacao ? `${c.tipo_operacao}${c.tipo_operacao_desmarcadas?.length ? ` (desmarcadas: ${c.tipo_operacao_desmarcadas.join(", ").toLowerCase()})` : ""}` : null],
    ["Operação portada", c.operacao_portada === true ? "Sim" : c.operacao_portada === false ? "Não" : null],
    ["Modalidade de desconto provável", c.modalidade_desconto_provavel],
    ["CNPJ da instituição", c.cnpj_instituicao],
  ].filter(([, v]) => v !== null && v !== undefined && v !== "");
  if (!linhas.length && !m && !cartao && !c.datas_nota) return;

  heading(ctx, "§ 2.1 · Dados econômicos complementares e aferição matemática");
  for (const [rotulo, valor] of linhas) field(ctx, rotulo, valor);
  if (c.datas_nota) paragraph(ctx, c.datas_nota, { color: DANGER, size: 8.5 });

  if (cartao) {
    subheading(ctx, "Cartão consignado de benefício");
    field(ctx, "Limite do cartão", cartao.limiteCartao);
    field(ctx, "Valor máximo de saque", cartao.valorMaximoSaque);
    field(ctx, "Valor consignado mensal", cartao.valorConsignadoMensal);
    field(ctx, "Prazo previsto de liquidação (meses)", cartao.prazoPrevistoLiquidacaoMeses);
    field(ctx, "Tarifa de emissão", cartao.tarifaEmissao);
  }

  if (m) {
    subheading(ctx, "Aferição matemática");
    const confere = (rotulo, valor, detalhe) => {
      if (valor === null || valor === undefined) return;
      badge(ctx, `${rotulo}${detalhe ? ` (${detalhe})` : ""}`, valor ? "CONFERE" : "NÃO CONFERE", valor);
    };
    // D4: prazo condicional não é CONFERE nem NÃO CONFERE, e também não pode
    // sumir. Omitir a linha esconderia do laudo o campo que motivou o achado.
    if (m.prazo_declarado_condicional) {
      badge(ctx, `Prazo declarado × datas${m.prazo_descricao ? ` (${m.prazo_descricao})` : ""}`, "NÃO AFERIDO", null);
      if (m.prazo_declarado_ressalva) {
        paragraph(ctx, `O campo de prazo traz ressalva no próprio texto: "${m.prazo_declarado_ressalva}". Não há prazo fechado a confrontar com as datas.`, { color: MUTED, size: 8.5 });
      }
    } else {
      confere("Prazo declarado × datas", m.prazo_confere, m.prazo_descricao || (m.prazo_calculado_dias != null ? `${m.prazo_calculado_dias} dias` : null));
    }
    confere("Somatório das parcelas", m.somatorio_confere, m.somatorio_calculado);
    confere("Composição do financiado", m.composicao_confere, m.composicao_financiado_calculada);
    if (m.composicao_nota) paragraph(ctx, m.composicao_nota, { color: MUTED, size: 8.5 });
    confere("Valor presente previsto (hipótese: liberação na emissão)", m.vp_confere, m.vp_taxa_declarada);
    if (m.juros_implicito_mensal) {
      field(
        ctx,
        "Taxa implícita sobre o financiado (hipótese: liberação na emissão)",
        `${m.juros_implicito_mensal} a.m. · ${m.juros_implicito_confere ? "confere com" : "diverge da"} taxa declarada${m.juros_implicito_delta_pp !== null ? ` (diferença de ${Math.abs(m.juros_implicito_delta_pp).toFixed(3).replace(".", ",")} ponto)` : ""} · valor presente a essa taxa ${m.vp_taxa_implicita}`
      );
    }
    // As duas convenções lado a lado: a diferença entre elas não é divergência.
    confere(
      m.cet_anual_base === "IMPLICITO" ? `CET anual × CET implícito ${m.cet_anual_base_mensal} a.m.` : "CET anual × CET mensal",
      m.cet_anual_confere,
      m.cet_anual_calculado ? `365 dias ${m.cet_anual_calculado} · 12 meses ${m.cet_anual_calculado_12m}${m.cet_anual_convencao ? ` · contrato usa ${m.cet_anual_convencao}` : ""}` : null
    );
    if (m.cet_anual_calculado_declarado) field(ctx, "Anualização do CET mensal declarado, arredondado (informativa)", `${m.cet_anual_calculado_declarado} em 365 dias`);
    confere(
      "Juros anual × juros mensal",
      m.juros_anual_confere,
      m.juros_anual_calculado_365 ? `365 dias ${m.juros_anual_calculado_365} · 12 meses ${m.juros_anual_calculado_12m}${m.juros_anual_convencao ? ` · contrato usa ${m.juros_anual_convencao}` : ""}` : null
    );
    if (m.cet_implicito_mensal) {
      field(ctx, "CET implícito no fluxo previsto (hipótese: liberação na emissão)", `${m.cet_implicito_mensal} a.m.${m.cet_implicito_veredito ? ` · ${m.cet_implicito_veredito}` : ""}`);
    } else if (m.cet_implicito_status === "NAO_AFERIDO" && m.cet_implicito_motivo) {
      field(ctx, "CET implícito no fluxo previsto (hipótese: liberação na emissão)", `não aferido: ${m.cet_implicito_motivo}`);
    }
    if (m.cet_implicito_nota) paragraph(ctx, m.cet_implicito_nota, { color: MUTED, size: 8.5 });
    if (m.conclusao) paragraph(ctx, m.conclusao, { size: 9 });
  }
}

/** § 4.2 — trilha da contratação. */
function sectionContractingTrail(ctx, extracted) {
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

  if (trilha?.events?.length) {
    subheading(ctx, `Histórico de ações do dossiê (${trilha.eventCount} eventos)`);
    for (const ev of trilha.events) {
      field(
        ctx,
        `   ${ev.action}`,
        [
          [ev.date, ev.time].filter(Boolean).join(" "),
          ev.ip ? `${ev.ip}${ev.port ? `:${ev.port}` : ""}` : null,
          Number.isFinite(ev.lat) && Number.isFinite(ev.lon) ? `${ev.lat.toFixed(5)}, ${ev.lon.toFixed(5)}` : null,
        ]
          .filter(Boolean)
          .join(" · ")
      );
    }
    if (trilha.chronologyInconsistent) {
      paragraph(
        ctx,
        "Os carimbos de tempo da trilha não se conciliam com o horário da assinatura, nem no fuso UTC nem no de Brasília. Os logs brutos devem esclarecer o fuso efetivamente aplicado.",
        { color: DANGER, size: 9 }
      );
    }
  }
}

/** § 6.1 — confronto com o processo judicial. */
function sectionProcessComparison(ctx, confronto) {
  if (!confronto || confronto.status !== "COMPLETED") return;
  const divergencias = confronto.divergences || [];
  heading(ctx, "§ 6.1 · Confronto com o processo judicial", { danger: divergencias.length > 0 });
  field(ctx, "Resultado", confronto.resultado);
  field(ctx, "Arquivo do processo", confronto.file?.name);
  field(ctx, "SHA-256 do processo", confronto.file?.sha256, { mono: true });
  field(ctx, "Páginas do processo", confronto.metadata?.totalPages);

  if (confronto.confirmations?.length) {
    subheading(ctx, "Dados do contrato procurados no processo");
    for (const c of confronto.confirmations) {
      field(ctx, `   ${c.label}`, `${c.contrato ?? "—"} · ${c.processo}`);
    }
  }
  for (const d of divergencias) {
    reserve(ctx, 60);
    paragraph(ctx, `${d.label}: contrato ${d.contrato} × processo ${d.processo}. ${d.detalhe}`, {
      color: d.severidade === "DIVERGÊNCIA" ? DANGER : INK,
      size: 9,
    });
    if (d.trecho) paragraph(ctx, `“${d.trecho}”`, { color: MUTED, size: 8, italic: true });
  }
  for (const o of confronto.observations || []) {
    paragraph(ctx, `${o.label}. ${o.detalhe}`, { size: 9 });
  }
  if (confronto.status_note) paragraph(ctx, confronto.status_note, { color: MUTED, size: 8.5 });
}

/** Sumário executivo de irregularidades, ao final do laudo. */
function sectionExecutiveSummary(ctx, sumario, reportId) {
  if (!sumario) return;
  // Mesma regra do anexo: o sumário ganha página limpa quando sobra pouco, e
  // segue na página corrente quando ela mal foi usada.
  reserve(ctx, 260);
  heading(ctx, `Sumário executivo de irregularidades${reportId ? ` · ${reportId}` : ""}`);
  // Não exibir classificações agregadas antigas ao emitir resultado legado.
  field(ctx, "Orientação de revisão", "REVISÃO DOCUMENTAL NECESSÁRIA");
  paragraph(ctx, "Conferir as evidências e diligências de cada item. As classificações individuais orientam a revisão; não atestam fraude, autoria ou validade jurídica.", { color: MUTED, size: 8.5 });
  if (sumario.intro) paragraph(ctx, sumario.intro, { size: 9 });

  subheading(ctx, "Placar de gravidade");
  if (sumario.semAchados) {
    paragraph(ctx, "Sem irregularidade crítica automática conclusiva. Os dados disponíveis não produziram alerta grave, sem prejuízo da revisão humana do contrato e dos logs originais.", { size: 9 });
  }
  for (const f of sumario.findings || []) {
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
  if (sumario.synthesis) {
    subheading(ctx, "GPS × IP");
    paragraph(ctx, sumario.synthesis, { size: 9 });
  }
  for (const ip of sumario.ipCards || []) {
    field(ctx, `   ${ip.endereco} · ${ip.badge}`, ip.text);
  }

  if (sumario.diligences?.length) {
    subheading(ctx, "Diligências recomendadas");
    sumario.diligences.forEach((d, i) => {
      paragraph(ctx, `${String(i + 1).padStart(2, "0")}. ${d.title}. ${d.text}`, { size: 9 });
    });
  }
  if (sumario.disclaimer) paragraph(ctx, sumario.disclaimer, { color: MUTED, size: 8 });
}

function sectionRemarks(ctx, extracted) {
  heading(ctx, "§ 7 · Observações periciais complementares");
  paragraph(
    ctx,
    extracted.observacoes_periciais ||
      "Não há observação complementar além do que já consta das seções anteriores."
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

function sectionLegal(ctx, extracted = {}) {
  heading(ctx, "§ 9 · Fundamentação normativa aplicável");
  paragraph(ctx, NOTA_FUNDAMENTACAO_RESSALVA, { color: MUTED, size: 8.5 });
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

}

function legalNotice(ctx, timestamp) {
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
