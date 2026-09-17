/**
 * Homologação ponta a ponta do motor contra o dossiê C6 do relatório de
 * homologação (relatório-motor-novo.md, seção "Fixture de regressão").
 *
 * Roda o mesmo pipeline do worker (texto, metadados, análise, sumário,
 * coerência) sobre o PDF real e confere cada valor de referência. Não usa rede,
 * banco nem fila. Os valores esperados não incluem dado pessoal do contratante.
 *
 *   node scripts/homologarDossie.mjs <caminho/dossiê.pdf>
 *
 * Sai com código 1 se algum item não conferir.
 */
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { analisarDocumento } from "../src/engine/analisarDocumento.js";
import { extractPdfMetadata } from "../src/services/pdfService.js";
import { extractPdfTextWithOcr } from "../src/services/ocrService.js";
import { buildSummaryForResult } from "../src/services/analysisRecompute.js";
import { verificarCoerencia } from "../src/engine/coerenciaLaudo.js";
import { fundamentacaoPara } from "../src/reports/laudoTexts.js";

const arquivo = process.argv[2];
if (!arquivo) {
  console.error("uso: node scripts/homologarDossie.mjs <dossiê.pdf>");
  process.exit(2);
}

const buf = await readFile(arquivo);
const [extraction, rawMetadata] = await Promise.all([extractPdfTextWithOcr(buf), extractPdfMetadata(buf)]);
const analise = await analisarDocumento({ pdfBuffer: buf, extraction, rawMetadata });
const e = analise.extracted;
const m = e.afericao_matematica;
const result = { text: JSON.stringify(e), metadata: analise.metadata, hashes: {}, ipAnalysis: [], home: null, contractGeo: null };
result.sumarioIrregularidades = buildSummaryForResult(result, e);
const codigos = e.achados_irregularidade.map((a) => a.codigo);
const docs = (e.documentos_logicos?.documentos || []).map((d) => `${d.tipo} ${d.paginaInicial}-${d.paginaFinal}`);
const p = analise.metadata.digitalSignature?.procedencia || {};

const itens = [
  ["Identidade", "SHA-256", createHash("sha256").update(buf).digest("hex"), "abc18b73e5731e29d0bc4deedb56a132c7f9336ca8b162cd74125b3d7ab43a5e"],
  ["Identidade", "Páginas", analise.metadata.totalPages, 27],
  ["Identidade", "Imagens", e.imagens_pdf?.total, 103],
  ["Contrato", "Data do contrato", e.contrato.data_contrato, "25/06/2025"],
  ["Contrato", "Data da juntada", e.metadados_processuais?.data_juntada, "28/10/2025"],
  ["Contrato", "Produto", e.contrato.produto_codigo, "CONSIGNADO_CLT"],
  ["Contrato", "Empregador não identificado", e.contrato.empregador?.identificado, false],
  ["Contrato", "Valor liberado", e.contrato.valor_liberado, "R$ 1.779,15"],
  ["Contrato", "Seguros", e.contrato.seguros, "R$ 218,64"],
  ["Contrato", "IOF financiado", e.contrato.iof_financiado, "R$ 36,07"],
  ["Contrato", "Composição confere", [m.composicao_financiado_calculada, m.composicao_confere], ["R$ 2.033,86", true]],
  ["Contrato", "Somatório confere", [e.contrato.valor_total_parcelas, m.somatorio_confere], ["R$ 2.700,00", true]],
  ["Contrato", "Prazo efetivo diverge", [m.prazo_calculado_dias, m.prazo_confere], [249, false]],
  ["Contrato", "Carência e juros", [e.contrato.carencia_dias, e.contrato.juros_carencia], [98, "R$ 355,88"]],
  ["Contrato", "Custo total", [e.contrato.custo_total, e.contrato.custo_total_percentual], ["R$ 920,85", "51,76%"]],
  ["Contrato", "CET implícito", [m.cet_implicito_mensal, m.cet_implicito_veredito], ["7,5894%", "Confere"]],
  ["Contrato", "CET anual confere (365 dias)", [m.cet_anual_confere, m.cet_anual_convencao], [true, "365 dias"]],
  ["Contrato", "Liberação sem comprovante", [e.liberacao_credito?.declarada?.banco, e.liberacao_credito?.comprovante, codigos.includes("LIB1")], ["237", null, true]],
  ["Contratante", "RG suspeito", e.cliente.estados_campos?.rg?.estado, "LOCALIZADO_SUSPEITO"],
  ["Contratante", "Endereço localizado e vazio", e.cliente.estados_campos?.endereco?.estado, "LOCALIZADO_VAZIO"],
  ["Contratante", "Cidade e UF", [e.cliente.cidade, e.cliente.estado], ["Manaquiri", "AM"]],
  ["Assinatura", "Documentos lógicos", docs, ["DOSSIE 1-2", "INSTRUMENTO_PRINCIPAL 3-7", "CONDICOES_GERAIS 8-14", "SEGURO 15-17", "TERMOS 18-27"]],
  ["Assinatura", "Sem ASS1 falso (bloco da CCB na pág. 6)", codigos.includes("ASS1"), false],
  ["Assinatura", "Hash declarado nulo", e.assinatura.hash_documento_assinado, null],
  ["Assinatura", "Código de autenticação declarado", Boolean(e.assinatura.codigo_autenticacao_declarado), true],
  ["Assinatura", "Procedência", [p.procedencia, p.sistema, p.tribunal, p.movimento], ["EXPORTACAO_SISTEMA_PROCESSUAL", "PROJUDI", "TJAM", "1.6"]],
  ["Trilha", "Eventos e duração", [e.trilha_eventos?.eventos?.length, e.trilha_eventos?.duracao_total_s], [6, 204]],
  ["Trilha", "Eventos sem IP / sem geolocalização", [e.trilha_eventos?.eventos?.filter((x) => !x.ip).length, e.trilha_eventos?.eventos?.filter((x) => x.lat === null).length], [2, 3]],
  ["Trilha", "Fuso GMT declarado e achado TZ1", [e.trilha_eventos?.fuso?.trilha, codigos.includes("TZ1")], ["GMT", true]],
  ["Biometria", "Imagem biométrica", [e.imagem_biometrica?.pagina, e.imagem_biometrica?.largura, e.imagem_biometrica?.altura, e.imagem_biometrica?.bytes, e.imagem_biometrica?.exif], [1, 360, 640, 39308, false]],
  ["Biometria", "SHA-256 da imagem", String(e.imagem_biometrica?.sha256 || "").toLowerCase(), "8943786a11efbb7634d03c7ef9999e11c2fb681e334ac97ce341faa7210ac3f9"],
  ["Seguro", "Prêmio, IOF e pró-labore", [e.seguro_prestamista?.premio, e.seguro_prestamista?.iof, e.seguro_prestamista?.pro_labore], ["R$ 218,64", "R$ 0,83", "R$ 98,02"]],
  ["Seguro", "Achados SEG1 a SEG6", ["SEG1", "SEG2", "SEG3", "SEG4", "SEG5", "SEG6"].every((c) => codigos.includes(c)), true],
  ["Negativos", "Sem CAD2 (benefício do INSS)", codigos.includes("CAD2"), false],
  ["Negativos", "Sem INT2 (reimpressão imputada ao banco)", codigos.includes("INT2"), false],
  ["Negativos", "Bloco normativo sem Lei 8.213", /8\.213/.test(JSON.stringify(fundamentacaoPara(e.contrato.produto_codigo))), false],
  ["Negativos", "Biometria não é 'apenas clausulado'", e.assinatura.metodos_mencionados_clausulado.some((x) => /biometr/i.test(x)), false],
  ["Coerência", "Nenhuma contradição entre seções", verificarCoerencia(result, e).map((c) => c.regra), []],
  ["Sumário", "Primeiros achados", result.sumarioIrregularidades.findings.slice(0, 2).map((f) => f.key), ["LIB1", "BIO2"]],
];

let falhas = 0;
let grupo = null;
for (const [g, rotulo, obtido, esperado] of itens) {
  if (g !== grupo) {
    console.log(`\n${g}`);
    grupo = g;
  }
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas += 1;
  console.log(`  ${ok ? "ok    " : "FALHOU"} ${rotulo}${ok ? "" : `: obtido ${JSON.stringify(obtido)}, esperado ${JSON.stringify(esperado)}`}`);
}
console.log(`\n${itens.length - falhas} de ${itens.length} itens conferem.`);
process.exit(falhas ? 1 : 0);
