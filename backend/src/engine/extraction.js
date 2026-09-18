import { extractContractContext, extractExtendedContractFields } from "./contractContext.js";
// Extração heurística estruturada do contrato. Portada do motor de geração
// (backend/server.js): layouts dedicados (Bradesco, BB, Agibank, Facta),
// aferição matemática, achados de irregularidade e trilha de contratação.
import { extractCoordinates } from "./geo.js";
import { extractAuditTrail } from "./audit.js";
import { separarCarimboProcessual, paginaDoIndice } from "./carimboProcessual.js";
import { extrairDataContrato } from "./dataContrato.js";
import { extrairPlanilhaCalculo } from "./planilhaCalculo.js";
import { extrairCamposOperacao, extrairLocalEmissao } from "./camposOperacao.js";
import { redigirConclusaoAfericao } from "./conclusaoAfericao.js";
import { taxaImplicita, valorPresente, vencimentosMensais, conferirAnualizacao, diasEntre } from "./matematicaFinanceira.js";
import { classificarProduto, extrairEmpregador } from "./produto.js";
import { avaliarQualificacao, ESTADO as ESTADO_CAMPO } from "./camposSuspeitos.js";
import { segmentarDocumentos, avaliarAssinaturaPorDocumento, documentoDaPagina, detectarAnomaliaPaginacao } from "./documentosLogicos.js";
import { avaliarComprovanteCredito } from "./comprovanteCredito.js";
import { extrairSeguroPrestamista } from "./seguroPrestamista.js";
import { analisarTrilhaEventos } from "./trilhaEventos.js";
import { extrairMetodosDescritos } from "./metodosAutenticacao.js";
import { moneyToCents, percentToNumber } from "./numberParsing.js";
import { extractFactaCartaoConsignado } from "./factaCartao.js";
import { resolveBankByCnpj } from "./bankRegistry.js";
import { parseUserAgent, assessPlatformIndependence, buildAcceptanceTimeline, formatDurationPt } from "./trilhaAnalysis.js";
import { cnpsCeilingAt } from "./cnpsRateCeiling.js";
import {
  extrairNomeContratante, nomePlausivel, extrairNumeroContrato, numeroContratoPlausivel,
  extrairCoordenadasPlausiveis, coordenadaComoTexto, extrairIps, enderecoPorColunas, valorEhRotulo,
  enderecoInstitucional, enderecoNaoInformado, credorPlausivel, especieBeneficioPlausivel, contaDeCredito,
} from "./salvaguardas.js";
import {
  firstMatch, allMatches, titleCaseName, stripDiacritics, normalizeMoney,
  normalizePercent, centsToMoney, plural, parsePtDate, daysBetweenPtDates,
} from "./format.js";

function extractBlocks(flat) {
  const markers = [
    ["I", /\bI\s*[-–]\s*DADOS\s+DA\s+C[ÉE]DULA\s+DE\s+CR[ÉE]DITO\s+BANC[ÁA]RIO/i],
    ["II", /\bII\s*[-–]\s*INSTITUI[ÇC][ÃA]O\s+CREDORA/i],
    ["III", /\bIII\s*[-–]\s*QUALIFICA[ÇC][ÃA]O\s+DO\s+EMITENTE/i],
    ["IV", /\bIV\s*[-–]\s*DADOS\s+DA\s+OPERA[ÇC][ÃA]O/i],
    ["V", /\bV\s*[-–]\s*FLUXO\s+DA\s+OPERA[ÇC][ÃA]O/i],
    ["VI", /\bVI\s*[-–]\s*FORMA\s+DE\s+LIBERA[ÇC][ÃA]O/i],
    ["VII", /\bVII\s*[-–]\s*CORRESPONDENTE\s+NO\s+PA[ÍI]S/i],
  ];
  const found = markers
    .map(([key, pattern]) => {
      const match = flat.match(pattern);
      return match ? { key, index: match.index } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.index - b.index);
  const blocks = {};
  for (let i = 0; i < found.length; i += 1) {
    blocks[found[i].key] = flat.slice(found[i].index, found[i + 1]?.index ?? flat.length);
  }
  return blocks;
}

function firstField(block, patterns) {
  return firstMatch(block || "", patterns);
}


function isInstitutionalEmail(email) {
  return /@(agi|agibank|banco|bradesco|itau|safra|daycoval|c6bank|pan|bmg|paranabanco)\./i.test(email || "");
}

function validPhone(value, contractNumber, cpf) {
  const digits = String(value || "").replace(/\D/g, "");
  const contractDigits = String(contractNumber || "").replace(/\D/g, "");
  const cpfDigits = String(cpf || "").replace(/\D/g, "");
  if (!digits || digits === contractDigits || digits === cpfDigits) return null;
  if (!/^[1-9]{2}9?\d{8}$/.test(digits)) return null;
  return value;
}

function addMonths(dateString, months) {
  const match = String(dateString || "").match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return null;
  const date = new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1]));
  date.setMonth(date.getMonth() + months);
  return `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}/${date.getFullYear()}`;
}

function findTextualSignature(flat) {
  const match = flat.match(/((?:Documento\s+)?assinado\s+eletronicamente(?:\s+por)?[^.]{0,220}?(?:Biometria\s+Facial|assinatura|consultor|cliente|[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ]{3,})[^.]*\.?)/i);
  return match ? match[1].replace(/\s+/g, " ").trim() : null;
}

function classifyDeclaredHash(block) {
  if (!block) return "AUSENTE";
  const s = String(block).replace(/\s+/g, "");
  const isHex = /^[0-9a-fA-F]+$/.test(s) && [32, 40, 56, 64, 96, 128].includes(s.length);
  const isBase64 = /^[A-Za-z0-9+/]+={0,2}$/.test(s) && s.length % 4 === 0 && s.length >= 24;
  const isBase32 = /^[A-Z2-7]+=*$/.test(s) && s.length >= 32;
  return isHex || isBase64 || isBase32 ? "DECLARADO_CONFERIVEL" : "DECLARADO_NAO_CONFERIVEL";
}

function percentStringToDecimal(value) {
  const number = percentToNumber(value);
  return Number.isFinite(number) ? number / 100 : null;
}

function moneyStringToNumber(value) {
  const cents = moneyToCents(value);
  return cents === null ? null : cents / 100;
}

const pct = (valor, casas = 2) => `${(valor * 100).toFixed(casas).replace(".", ",")}%`;
const moeda = (valor) => (valor === null || !Number.isFinite(valor) ? null : centsToMoney(Math.round(valor * 100)));

// Tolerâncias da aferição. Abaixo delas a diferença é arredondamento, não achado.
const TOLERANCIA_MOEDA = 0.05;
const TOLERANCIA_TAXA_PP = 0.10;
const TOLERANCIA_PRAZO = 0.15;

/**
 * Composição do valor financiado pela soma de TODOS os componentes localizados.
 *
 * Sem planilha estruturada, só liberado e IOF são conhecidos. Se a soma deles
 * não fecha, a diferença pode ser seguro, tarifa ou saldo refinanciado que o
 * extrator não leu, e o laudo não pode afirmar divergência: fica não aferida,
 * com o motivo.
 */
function composicaoDoFinanciado(contract, financiado) {
  const planilha = contract.planilha_calculo?.componentes;
  const componentes = planilha
    ? Object.values(planilha).map((c) => ({ rotulo: c.rotulo, valor: c.valor, localizado: c.localizado }))
    : [
        { rotulo: "Valor liberado", valor: contract.valor_liberado, localizado: Boolean(contract.valor_liberado) },
        { rotulo: "IOF financiado", valor: contract.iof_financiado, localizado: Boolean(contract.iof_financiado) },
        { rotulo: "Seguros", valor: contract.seguros || null, localizado: Boolean(contract.seguros) },
        { rotulo: "Tarifa de cadastro", valor: contract.tarifa_cadastro || null, localizado: Boolean(contract.tarifa_cadastro) },
      ];
  const liberadoOk = componentes.some((c) => /liberado/i.test(c.rotulo) && c.localizado);
  if (!liberadoOk || financiado === null) {
    return { calculada: null, confere: null, componentes, nota: null };
  }
  const soma = componentes.filter((c) => c.localizado).reduce((acc, c) => acc + (moneyStringToNumber(c.valor) || 0), 0);
  const naoLocalizados = componentes.filter((c) => !c.localizado).map((c) => c.rotulo.toLowerCase());
  const diferenca = Math.abs(financiado - soma);
  if (diferenca <= TOLERANCIA_MOEDA) {
    return { calculada: soma, confere: true, componentes, nota: null };
  }
  if (naoLocalizados.length) {
    return {
      calculada: soma,
      confere: null,
      componentes,
      nota: `A soma dos componentes localizados (${moeda(soma)}) difere do total financiado (${moeda(financiado)}) em ${moeda(diferenca)}, mas não foram localizados no instrumento: ${naoLocalizados.join(", ")}. A composição fica não aferida.`,
    };
  }
  return {
    calculada: soma,
    confere: false,
    componentes,
    nota: `A soma de todos os componentes da planilha (${moeda(soma)}) difere do total financiado declarado (${moeda(financiado)}) em ${moeda(diferenca)}.`,
  };
}

export function buildMathAudit(contract) {
  const dataContrato = contract.data_contrato;
  const primeiro = contract.data_primeiro_vencimento;
  const ultimo = contract.data_ultimo_vencimento;
  const parcelas = Number(contract.numero_parcelas || contract.parcelas_mensais);
  const valorParcela = moneyStringToNumber(contract.valor_parcela);
  const somatorio = moneyStringToNumber(contract.valor_total_parcelas);
  const liberado = moneyStringToNumber(contract.valor_liberado);
  const financiado = moneyStringToNumber(contract.valor_total_emprestimo || contract.valor_contratado || contract.valor_novos_recursos);
  const jurosMensal = percentStringToDecimal(contract.taxa_juros_mensal);
  const jurosAnual = percentStringToDecimal(contract.taxa_juros_anual);
  const cetMensal = percentStringToDecimal(contract.cet_mensal);
  const cetAnual = percentStringToDecimal(contract.cet_anual);
  const dataBase = parsePtDate(dataContrato);
  const primeiroData = parsePtDate(primeiro);
  const fluxos = valorParcela && Number.isFinite(parcelas)
    ? vencimentosMensais(primeiroData, parcelas).map((data) => ({ data, valor: valorParcela }))
    : [];

  // ── Prazo: declarado em dias (layouts antigos) ou em meses (planilha) ──────
  // `Number(null)` é 0: sem este cuidado o laudo imprimia "0 declarados".
  const prazoDiasDeclarado = contract.prazo_dias !== null && contract.prazo_dias !== undefined && contract.prazo_dias !== ""
    ? Number(contract.prazo_dias)
    : null;
  const prazoTotal = contract.prazo_total_declarado || null;
  const prazoCalculado = dataContrato && ultimo ? daysBetweenPtDates(dataContrato, ultimo) : null;
  const prazoEfetivoMeses = prazoCalculado !== null ? Number((prazoCalculado / 30).toFixed(1)) : null;
  let prazoConfere = null;
  let prazoDescricao = null;
  if (prazoCalculado !== null && prazoCalculado >= 0) {
    if (Number.isFinite(prazoDiasDeclarado) && prazoDiasDeclarado > 0) {
      prazoConfere = prazoDiasDeclarado === prazoCalculado;
      prazoDescricao = `declarado ${prazoDiasDeclarado} dias, efetivo ${prazoCalculado} dias`;
    } else if (prazoTotal?.quantidade) {
      const declaradoMeses = prazoTotal.unidade === "dias" ? prazoTotal.quantidade / 30 : prazoTotal.quantidade;
      // D4: campo com cláusula de extensão não declara prazo fechado, e não há
      // o que divergir. O desfecho é inconclusivo, com a ressalva ancorada, e a
      // qualificação jurídica do que isso significa fica com o escritório.
      prazoConfere = prazoTotal.condicional
        ? null
        : Math.abs(prazoEfetivoMeses - declaradoMeses) / declaradoMeses <= TOLERANCIA_PRAZO;
      prazoDescricao = prazoTotal.condicional
        ? `declarado de forma condicional ("${prazoTotal.texto}"), efetivo ${prazoCalculado} dias (${nBRDecimal(prazoEfetivoMeses)} meses)`
        : `declarado ${prazoTotal.quantidade} ${prazoTotal.unidade}, efetivo ${prazoCalculado} dias (${nBRDecimal(prazoEfetivoMeses)} meses)`;
    }
  }
  const prazoMesesAprox = Number.isFinite(prazoDiasDeclarado) && prazoDiasDeclarado > 0
    ? Number((prazoDiasDeclarado / 30.4375).toFixed(1))
    : null;
  const carenciaDias = dataContrato && primeiro ? daysBetweenPtDates(dataContrato, primeiro) : null;

  // Juros acumulados entre a emissão e o primeiro vencimento, sobre o financiado.
  const jurosCarencia = carenciaDias > 0 && financiado !== null && jurosMensal !== null
    ? financiado * (Math.pow(1 + jurosMensal, carenciaDias / 30) - 1)
    : null;

  // ── Somatório ──────────────────────────────────────────────────────────────
  const somatorioCalculado = parcelas && valorParcela ? parcelas * valorParcela : null;
  const somatorioConfere = somatorio !== null && somatorioCalculado !== null ? Math.abs(somatorio - somatorioCalculado) <= TOLERANCIA_MOEDA : null;
  const custoTotal = somatorio !== null && liberado ? somatorio - liberado : null;

  // ── Composição ─────────────────────────────────────────────────────────────
  const composicao = composicaoDoFinanciado(contract, financiado);

  // ── Valor presente pela taxa declarada ─────────────────────────────────────
  const fluxoValido = dataBase && fluxos.length && fluxos.every(({ data }) => diasEntre(dataBase, data) >= 0);
  const vpTaxaDeclarada = jurosMensal && fluxoValido ? valorPresente(jurosMensal, fluxos, dataBase) : null;

  // FINO-01 (rodada 2): taxa implícita sobre o valor financiado. O valor presente
  // pela taxa declarada arredondada (5,06%) não coincide ao centavo com o
  // financiado; a taxa que coincide é mostrada ao lado, sem trocar o número que
  // a taxa declarada produz.
  const tirFinanciado = financiado && fluxoValido ? taxaImplicita({ valorPresenteAlvo: financiado, fluxos, dataBase }) : null;
  const jurosImplicito = tirFinanciado?.status === "AFERIDO" ? tirFinanciado.taxa : null;
  const jurosImplicitoDeltaPp = jurosImplicito !== null && jurosMensal !== null ? (jurosMensal - jurosImplicito) * 100 : null;
  const vpTaxaImplicita = jurosImplicito !== null ? valorPresente(jurosImplicito, fluxos, dataBase) : null;

  // ── CET implícito: só com raiz verificada ──────────────────────────────────
  const tir = liberado && fluxos.length
    ? taxaImplicita({ valorPresenteAlvo: liberado, fluxos, dataBase })
    : { status: "NAO_AFERIDO", motivo: !liberado ? "valor liberado não localizado" : "vencimentos ou parcelas não localizados", memoria: null };
  const cetImplicito = tir.status === "AFERIDO" ? tir.taxa : null;
  const cetDeltaPp = cetMensal !== null && cetImplicito !== null ? (cetMensal - cetImplicito) * 100 : null;
  const memoriaTexto = tir.memoria
    ? `Fluxo: valor liberado ${moeda(tir.memoria.valor_presente)} em ${tir.memoria.data_base}; ${tir.memoria.fluxos.length} parcelas de ${moeda(valorParcela)} de ${tir.memoria.fluxos[0]?.data} a ${tir.memoria.fluxos.at(-1)?.data} (vencimentos mensais inferidos do primeiro vencimento); base de ${tir.memoria.base_dias} dias${Number.isFinite(tir.vplResidual) ? `; valor presente residual ${tir.vplResidual.toFixed(4)}` : ""}.`
    : null;
  const cetImplicitoVeredito = cetImplicito === null
    ? null
    : cetDeltaPp !== null && cetDeltaPp < -TOLERANCIA_TAXA_PP
      ? "NÃO CONFERE"
      : cetMensal !== null && jurosMensal !== null && cetMensal < jurosMensal
        ? "NÃO CONFERE"
        : cetDeltaPp !== null
          ? "Confere"
          : null;
  const cetImplicitoNota = cetImplicito === null
    ? (tir.motivo ? `CET implícito não aferido: ${tir.motivo}.` : null)
    : cetDeltaPp === null
      ? null
      : cetImplicitoVeredito === "Confere"
        ? `declarado ${contract.cet_mensal}; diferença de ${Math.abs(cetDeltaPp).toFixed(2).replace(".", ",")} ponto percentual para ${cetDeltaPp >= 0 ? "mais" : "menos"}, sem subdeclaração.`
        : cetMensal !== null && jurosMensal !== null && cetMensal < jurosMensal
          ? "CET declarado inferior à taxa de juros nominal; matematicamente impossível"
          : `CET declarado inferior ao implícito no fluxo em ${Math.abs(cetDeltaPp).toFixed(2).replace(".", ",")} ponto percentual; indício de subdeclaração. ${memoriaTexto}`;

  // ── Anualização pelas duas convenções ──────────────────────────────────────
  // FINO-02 (rodada 2): com o CET implícito aferido e conferindo com o declarado,
  // a anualização parte dele, e não do mensal arredondado (7,59% dava 143,53%
  // contra os 143,52% do contrato). A conta pelo declarado fica informativa.
  const anualizaPeloImplicito = cetImplicito !== null && cetImplicitoVeredito === "Confere" && cetDeltaPp !== null && Math.abs(cetDeltaPp) <= TOLERANCIA_TAXA_PP;
  const cetAnualizado = anualizaPeloImplicito
    ? conferirAnualizacao(cetImplicito, cetAnual)
    : cetMensal !== null ? conferirAnualizacao(cetMensal, cetAnual) : null;
  const cetDeclaradoAnualizado = anualizaPeloImplicito && cetMensal !== null ? conferirAnualizacao(cetMensal, cetAnual) : null;
  const jurosAnualizado = jurosMensal !== null ? conferirAnualizacao(jurosMensal, jurosAnual) : null;
  const cetImplicitoAnual = cetImplicito !== null ? conferirAnualizacao(cetImplicito, null) : null;

  return {
    prazo_declarado_dias: Number.isFinite(prazoDiasDeclarado) && prazoDiasDeclarado > 0 ? prazoDiasDeclarado : null,
    prazo_declarado_meses: prazoTotal?.unidade === "meses" ? prazoTotal.quantidade : null,
    prazo_calculado_dias: prazoCalculado,
    prazo_efetivo_meses: prazoEfetivoMeses,
    prazo_confere: prazoConfere,
    // D4: o campo de prazo é condicional? Quem apresenta precisa saber, porque
    // "diverge" e "prestado de forma condicional" são achados diferentes.
    prazo_declarado_condicional: Boolean(prazoTotal?.condicional),
    prazo_declarado_ressalva: prazoTotal?.ressalva || null,
    prazo_descricao: prazoDescricao,
    prazo_operacao_meses_aprox: prazoMesesAprox,
    carencia_dias: carenciaDias,
    juros_carencia: moeda(jurosCarencia),
    juros_carencia_numero: jurosCarencia,
    custo_total: moeda(custoTotal),
    custo_total_percentual: custoTotal !== null ? pct(custoTotal / liberado) : null,
    somatorio_declarado: contract.valor_total_parcelas || null,
    somatorio_calculado: moeda(somatorioCalculado),
    somatorio_confere: somatorioConfere,
    composicao_financiado_calculada: moeda(composicao.calculada),
    composicao_confere: composicao.confere,
    composicao_componentes: composicao.componentes,
    composicao_nota: composicao.nota,
    vp_taxa_declarada: moeda(vpTaxaDeclarada),
    vp_taxa_declarada_numero: vpTaxaDeclarada,
    vp_confere: financiado !== null && vpTaxaDeclarada !== null ? Math.abs(financiado - vpTaxaDeclarada) <= 2 : null,
    juros_implicito_mensal: jurosImplicito === null ? null : pct(jurosImplicito, 4),
    juros_implicito_mensal_numero: jurosImplicito,
    juros_implicito_delta_pp: jurosImplicitoDeltaPp === null ? null : Number(jurosImplicitoDeltaPp.toFixed(4)),
    juros_implicito_confere: jurosImplicitoDeltaPp === null ? null : Math.abs(jurosImplicitoDeltaPp) <= TOLERANCIA_TAXA_PP,
    vp_taxa_implicita: moeda(vpTaxaImplicita),
    cet_implicito_status: tir.status,
    cet_implicito_motivo: tir.status === "AFERIDO" ? null : tir.motivo,
    cet_implicito_mensal: cetImplicito === null ? null : pct(cetImplicito, 4),
    cet_implicito_anual_calculado: cetImplicitoAnual ? pct(cetImplicitoAnual.dias365) : null,
    cet_implicito_mensal_numero: cetImplicito,
    cet_implicito_veredito: cetImplicitoVeredito,
    cet_delta_pp: cetDeltaPp === null ? null : Number(cetDeltaPp.toFixed(4)),
    cet_implicito_nota: cetImplicitoNota,
    memoria_calculo_cet: tir.memoria,
    cet_anual_calculado: cetAnualizado ? pct(cetAnualizado.dias365) : null,
    cet_anual_base: cetAnualizado ? (anualizaPeloImplicito ? "IMPLICITO" : "DECLARADO") : null,
    cet_anual_base_mensal: cetAnualizado ? pct(anualizaPeloImplicito ? cetImplicito : cetMensal, anualizaPeloImplicito ? 4 : 2) : null,
    cet_anual_calculado_declarado: cetDeclaradoAnualizado ? pct(cetDeclaradoAnualizado.dias365) : null,
    cet_anual_calculado_12m: cetAnualizado ? pct(cetAnualizado.meses12) : null,
    cet_anual_convencao: cetAnualizado?.convencao || null,
    cet_anual_confere: cetAnualizado?.confere ?? null,
    juros_anual_calculado_365: jurosAnualizado ? pct(jurosAnualizado.dias365) : null,
    juros_anual_calculado_12m: jurosAnualizado ? pct(jurosAnualizado.meses12) : null,
    juros_anual_convencao: jurosAnualizado?.convencao || null,
    juros_anual_confere: jurosAnualizado?.confere ?? null,
    cet_maior_que_juros: cetMensal !== null && jurosMensal !== null ? cetMensal > jurosMensal : null,
    somatorio_sobre_liberado_percentual: somatorio !== null && liberado ? `${((somatorio / liberado) * 100).toFixed(1).replace(".", ",")}%` : null,
    conclusao: null,
  };
}

function nBRDecimal(valor) {
  return Number.isFinite(valor) ? valor.toFixed(1).replace(".", ",") : null;
}

function mergeDefined(...objects) {
  return objects.reduce((acc, object) => {
    for (const [key, value] of Object.entries(object || {})) {
      if (value !== null && value !== undefined && value !== "") acc[key] = value;
    }
    return acc;
  }, {});
}

function isInstitutionalAddress(value) {
  return /cidade\s+de\s+deus|vila\s+yara|osasco|alameda\s+rio\s+negro|av\.?\s+paulista|sede\s+social|cnpj|banco\s+/i.test(value || "");
}

function cepLooksInstitutional(flat, cep) {
  if (!cep) return false;
  const index = flat.indexOf(cep);
  if (index < 0) return false;
  return isInstitutionalAddress(flat.slice(Math.max(0, index - 120), index + 120));
}

function extractClientSection(text) {
  const patterns = [
    /(?:^|\n)\s*(?:2\s*-\s*)?(?:Cliente|Contratante|Tomador|Emitente|Devedor|Mutu[aá]rio)\b([\s\S]*?)(?=\n\s*(?:II|III|IV|V|VI|VII|VIII|1\s*-\s*(?:Banco|Credor)|Condi[cç][oõ]es|Caracter[ií]sticas|Opera[cç][oõ]es)\b)/i,
    /(?:Dados\s+do\s+(?:Cliente|Contratante|Tomador)|Qualifica[cç][aã]o\s+do\s+(?:Cliente|Contratante))([\s\S]*?)(?=\n\s*(?:Dados\s+da\s+Opera[cç][aã]o|Opera[cç][aã]o|Contrato|Assinatura|Condi[cç][oõ]es)\b)/i,
  ];
  for (const pattern of patterns) {
    const block = text.match(pattern)?.[1]?.trim();
    if (block && !isInstitutionalAddress(block)) return block;
  }
  return "";
}

function extractGenericContractLayout(text, flat) {
  const clientBlock = extractClientSection(text);
  const clientLine = clientBlock.match(/(?:Nome|Cliente|Contratante|Tomador)\s*(?:CPF\/?MF|CPF|CNPJ)?\s*\n\s*([A-ZÁÀÂÃÉÊÍÓÔÕÚÇ\s]{8,100}?)\s+(\d{11}|\d{3}\.?\d{3}\.?\d{3}-?\d{2})/i)
    || clientBlock.match(/([A-ZÁÀÂÃÉÊÍÓÔÕÚÇ\s]{8,100}?)\s+(?:CPF\/?MF|CPF)\s*[:\-]?\s*(\d{11}|\d{3}\.?\d{3}\.?\d{3}-?\d{2})/i);
  const rgLine = clientBlock.match(/(?:REGISTRO\s+GERAL|RG|Doc\.\s*Identifica[cç][aã]o)[^\n]*?\s+([0-9.\-]{5,20})\s+([A-Z\/]{2,12})?\s*([A-Z]{2})?/i);
  const addressLine = clientBlock.match(/Endere[cç]o[^\n]*\n\s*(.+?)(?:\n|$)/i)
    || clientBlock.match(/Endere[cç]o\s*[:\-]?\s*([^.;\n]{8,140})/i);
  const rawClientAddress = addressLine?.[1]?.replace(/\s{2,}/g, ", ").trim();
  const clientAddress = rawClientAddress && !isInstitutionalAddress(rawClientAddress) ? rawClientAddress : null;
  const cityUf = clientBlock.match(/(?:Cidade|Munic[ií]pio)\s*[:\-]?\s*([A-ZÁÀÂÃÉÊÍÓÔÕÚÇ\s]{3,60})\s+(?:UF|Estado)\s*[:\-]?\s*([A-Z]{2})/i)
    || flat.match(/(?:Local\s+de\s+Celebra[cç][aã]o|Pra[cç]a\s+de\s+Pagamento)\s+(?:[A-Z()ç\s.]+\s+)?([A-ZÁÀÂÃÉÊÍÓÔÕÚÇ]{3,60})\s+(?:\d{2}\/\d{2}\/\d{4}|11\s*-|12\s*-)/i);
  const authArea = text.match(/(?:Assinado\s+eletronicamente\s+por|Documento\s+assinado\s+eletronicamente)[^\n]*\n([\s\S]{0,900}?)(?:Fone|SAC|Ouvidoria|Mod\.:|$)/i)?.[1] || "";
  const authBlockTokens = authArea.split(/\s+/).filter((token) => /^[A-Za-z0-9@#?*]{8}$/.test(token));
  const annualRateBlank = /Taxa\s+de\s+Juros\s+Efetiva[\s\S]{0,120}?[\d,.]+\s*%\s*(?:ao\s+m[eê]s|a\.m\.?)[\s\S]{0,80}?(?:__+|\s)%\s*(?:ao\s+ano|a\.a\.?)/i.test(flat);
  const blankReleasedValue = /Valor\s+Liberado\s+ao\s+Cliente[\s\S]{0,140}?R\$\s*(?:Percentual|%|$)/i.test(flat);
  const tributos = flat.match(/(?:Tributos|IOF)[\s\S]{0,80}?R\$\s*([\d.]+,\d{2})\s+([\d,.]+)%/i);
  const totalDue = normalizeMoney(firstMatch(flat, [
    /Valor\s+Total\s+Devido(?:\s+do\s+Empr[eé]stimo)?[\s\S]{0,80}?R\$\s*([\d.]+,\d{2})/i,
    /Valor\s+total\s+do\s+Empr[eé]stimo[\s\S]{0,160}?R\$\s*([\d.]+,\d{2})/i,
  ]));
  const cnpjInstituicao = firstMatch(flat, [
    /(?:CNPJ\/?MF|CNPJ)\s*[:\-]?\s*(\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2})/i,
  ]);
  const agenciaConta = flat.match(/Ag[eê]ncia\s+D[ií]g\.?\s+(?:Nome\s+da\s+Ag[eê]ncia\s+)?Conta(?:[\s-]*Corrente)?\s+D[ií]g\.?\s+(\d{1,6})\s+(\d{1,2})\s+(\d{1,12})\s+(\d{1,2})/i)
    || flat.match(/Ag[eê]ncia\s*[:\-]?\s*(\d{1,6})\s*(?:D[ií]gito|D[ií]g\.?)?\s*[:\-]?\s*(\d{0,2})[\s\S]{0,90}?Conta[\s-]*Corrente\s*[:\-]?\s*(\d{1,12})\s*(?:D[ií]gito|D[ií]g\.?)?\s*[:\-]?\s*(\d{0,2})/i)
    || flat.match(/Ag[eê]ncia\s*\/\s*Conta\s*[:\-]?\s*(\d{1,6})\s*[-\/]\s*(\d{1,2})\s+(\d{1,12})\s*[-\/]\s*(\d{1,2})/i);
  const tipoOperacao = firstMatch(flat, [
    /Tipo\s+de\s+Opera[cç][aã]o\s*[:\-]?\s*([A-ZÁÀÂÃÉÊÍÓÔÕÚÇ]{3,30})/i,
    /Quadro\s+V-?2[\s\S]{0,220}?\b(NOVO|REFINANCIAMENTO|PORTABILIDADE)\b/i,
  ]);
  const hasPortabilitySource = /institui[cç][aã]o\s+origin[aá]ria|contrato\s+origin[aá]rio|opera[cç][aã]o\s+portad/i.test(flat)
    && !/Tipo\s+de\s+Opera[cç][aã]o\s*[:\-]?\s*NOVO/i.test(flat);
  return {
    contratoNumero: firstMatch(flat, [
      /N[ºo.]?\s*(?:C[eé]dula|Documento|Contrato|Proposta)\s*[:\-]?\s*([A-Z0-9.\-\/]{5,30})/i,
      /(?:Contrato|C[eé]dula|Proposta|Opera[cç][aã]o)\s*(?:n[ºo.]*)?\s*[:\-]?\s*([A-Z0-9.\-\/]{5,30})/i,
    ]),
    dataContrato: firstMatch(flat, [
      /(?:Data\s+(?:do\s+)?(?:Contrato|Opera[cç][aã]o|Celebra[cç][aã]o)|Dt\.\s*Opera[cç][aã]o)\s*[:\-]?\s*(\d{2}\/\d{2}\/\d{4})/i,
      /Local\s+de\s+Celebra[cç][aã]o\s+3\s*-\s*Data\s+[^0-9]{0,80}?(\d{2}\/\d{2}\/\d{4})/i,
    ]),
    clienteNome: titleCaseName(clientLine?.[1]),
    clienteCpf: clientLine?.[2] || null,
    clienteRg: rgLine?.[1] ? [rgLine[1], [rgLine[2], rgLine[3]].filter(Boolean).join("/")].filter(Boolean).join(", ") : null,
    clienteEndereco: clientAddress,
    clienteCidade: titleCaseName(cityUf?.[1]),
    clienteEstado: cityUf?.[2] || null,
    cnpjInstituicao: cnpjInstituicao ? cnpjInstituicao.replace(/\D/g, "") : null,
    codigoBancoBacen: cnpjInstituicao && cnpjInstituicao.replace(/\D/g, "") === "60746948000112" ? "237" : null,
    agencia: agenciaConta ? `${agenciaConta[1]}${agenciaConta[2] ? `-${agenciaConta[2]}` : ""}` : null,
    contaCorrente: agenciaConta ? `${agenciaConta[3]}${agenciaConta[4] ? `-${agenciaConta[4]}` : ""}` : null,
    nomeAgencia: null,
    bancoRecebimento: null,
    tipoOperacao: tipoOperacao ? stripDiacritics(tipoOperacao).toUpperCase() : null,
    operacaoPortada: tipoOperacao && /^PORTABILIDADE$/i.test(stripDiacritics(tipoOperacao)) ? true : tipoOperacao && /^NOVO$/i.test(stripDiacritics(tipoOperacao)) ? false : null,
    valorLiberadoSolicitado: normalizeMoney(firstMatch(flat, [
      /Valor\s+Liberado\/Solicitado[\s\S]{0,100}?R\$\s*([\d.]+,\d{2})/i,
      /Valor\s+Liberado\s+ao\s+Cliente[\s\S]{0,100}?R\$\s*([\d.]+,\d{2})/i,
      /Valor\s+L[ií]quido\s+(?:Liberado|Creditado)[\s\S]{0,80}?R\$\s*([\d.]+,\d{2})/i,
    ])),
    valorContratado: normalizeMoney(firstMatch(flat, [
      /Valor\s+(?:Total\s+do\s+Empr[eé]stimo|da\s+Opera[cç][aã]o|Contratado|Financiado)[\s\S]{0,100}?R\$\s*([\d.]+,\d{2})/i,
      /Valor\s+dos\s+Novos\s+Recursos[\s\S]{0,80}?R\$\s*([\d.]+,\d{2})/i,
    ])) || totalDue,
    iofTotal: normalizeMoney(firstMatch(flat, [
      /(?:Valor\s+)?IOF\s+(?:Total|Financiado)?[\s\S]{0,70}?R\$\s*([\d.]+,\d{2})/i,
      /Tributos[\s\S]{0,70}?R\$\s*([\d.]+,\d{2})/i,
    ])),
    prazoDias: firstMatch(flat, [/Prazo\s+(?:de\s+)?Opera[cç][aã]o[\s\S]{0,40}?(\d{2,5})\s+dias/i]),
    taxaJurosMensal: normalizePercent(firstMatch(flat, [/Taxa\s+de\s+Juros\s+Efetiva[\s\S]{0,90}?([\d,.]+)\s*%\s*(?:ao\s+m[eê]s|a\.m\.?)/i])),
    taxaJurosAnual: normalizePercent(firstMatch(flat, [/(?:Taxa\s+(?:de\s+)?Juros\s+(?:Efetiva\s+)?.{0,60}?)([\d,.]+)\s*%\s*(?:ao\s+ano|a\.a\.?)/i])),
    taxaJurosAnualEmBranco: annualRateBlank,
    numeroParcelas: firstMatch(flat, [/(?:Quantidade|N[uú]mero)\s+(?:de\s+)?Parcelas[\s\S]{0,60}?(\d{1,3})/i]),
    valorParcela: normalizeMoney(firstMatch(flat, [/Valor\s+da\(s\)?\s+Parcela\(s\)?[\s\S]{0,80}?R\$\s*([\d.]+,\d{2})/i, /Valor\s+da\s+Parcela\s*[:\-]?\s*R\$\s*([\d.]+,\d{2})/i])),
    valorTotalParcelas: normalizeMoney(firstMatch(flat, [/(?:Valor\s+Total\s+da\(s\)?\s+Parcela\(s\)?|Somat[oó]rio\s+das\s+Parcelas)[\s\S]{0,90}?R\$\s*([\d.]+,\d{2})/i])),
    primeiroVencimento: firstMatch(flat, [/(?:Vencimento\s+da\s+1[ªa]\s+Parcela|Primeiro\s+Vencimento)[\s\S]{0,80}?(\d{2}\/\d{2}\/\d{4})/i]),
    ultimoVencimento: firstMatch(flat, [/(?:Vencimento\s+da\s+[ÚU]ltima\s+Parcela|[ÚU]ltimo\s+Vencimento)[\s\S]{0,80}?(\d{2}\/\d{2}\/\d{4})/i]),
    cetMensal: normalizePercent(firstMatch(flat, [/Custo\s+Efetivo\s+Total\s*-?\s*CET[\s\S]{0,90}?([\d,.]+)\s*%\s*a\.m\.?/i, /\bCET\s+a\.m\.?\s*[:\-]?\s*([\d,.]+%?)/i])),
    cetAnual: normalizePercent(firstMatch(flat, [/Custo\s+Efetivo\s+Total\s*-?\s*CET(?:[^%]{0,100}[\d,.]+\s*%\s*a\.m\.?)?[^%]{0,100}([\d,.]+)\s*%\s*a\.a\.?/i, /\bCET\s+a\.a\.?\s*[:\-]?\s*([\d,.]+%?)/i])),
    tributosValor: normalizeMoney(tributos?.[1]),
    tributosPercentual: normalizePercent(tributos?.[2]),
    valorLiberadoClienteEmBranco: blankReleasedValue,
    codigoAutenticacao: authBlockTokens.length >= 8 ? authBlockTokens.join(" ") : null,
    assinaturaEletronicaTexto: firstMatch(flat, [/(Documento\s+assinado\s+eletronicamente[^.]{0,180}?CPF\s*n[°ºo]?\s*:\s*\d{3}\.\d{3}\.\d{3}-\d{2})/i, /(\(assinado\s+de\s+forma\s+eletr[oô]nica\)|Assinado\s+eletronicamente\s+por\s+[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ\s]{8,90}|Documento\s+assinado\s+eletronicamente[^.]{0,180})/i]),
  };
}

function extractBradescoConsignado(text, flat) {
  if (!/Banco\s+Bradesco\s+S\.A\.|Contrato\s+de\s+Empr[eé]stimo\s+Pessoal\s+-\s+Consignado\s+-\s+INSS/i.test(flat)) return {};
  if (!/Valor\s+Liberad[oa]\s*\/\s*Solicitado|Contrato\s+de\s+Empr[eé]stimo\s+Pessoal\s*-\s*Consignado\s*-\s*INSS/i.test(flat)) return {};
  const clientBlock = text.match(/2\s*-\s*Cliente([\s\S]*?)(?:II\s*-\s*Opera[cç][oõ]es|III\s*-\s*Caracter[ií]sticas)/i)?.[1] || "";
  const clientLine = clientBlock.match(/Nome\s+CPF\/MF\s*\n\s*([A-ZÁÀÂÃÉÊÍÓÔÕÚÇ\s]{8,90}?)\s+(\d{11})/i);
  const rgLine = clientBlock.match(/REGISTRO\s+GERAL\s+([0-9.\-]{5,20})\s+([A-Z\/]{2,12})\s+([A-Z]{2})/i);
  const addressLine = clientBlock.match(/Endere[cç]o\s+\(Rua\/Av\.\)[^\n]*\n\s*(.+?)\s{2,}([A-Z0-9\/.-]+)\s{2,}(.+?)(?:\n|$)/i);
  const brContractNumber = firstMatch(flat, [
    /N[ºo.]?\s*C[eé]dula\s*:\s*(\d{5,30})/i,
    /N[ºo.]?\s*Documento\s+Dt\.\s*Opera[cç][aã]o\s+Valor\s+\d+\s+\d+\s+\d+\s+\d+\s+(\d{5,30})/i,
  ]);
  const brHeader = flat.match(/N[ºo.]?\s*Documento\s+Dt\.\s*Opera[cç][aã]o\s+Valor\s+\d+\s+\d+\s+\d+\s+\d+\s+\d{11}\s+(\d{5,30})\s+(\d{2}\/\d{2}\/\d{4})\s+R\$\s*([\d.]+,\d{2})/i);
  const brValues = flat.match(/1\s*-\s*Valor\s+Liberado\/Solicitado\s+1\.1\s*-\s*Valor\s+dos\s+Novos\s+Recursos[\s\S]{0,120}?R\$\s*([\d.]+,\d{2})\s+R\$\s*([\d.]+,\d{2})/i);
  const brTotalLoan = firstMatch(flat, [/1\.2\s*-\s*Valor\s+total\s+do\s+Empr[eé]stimo[\s\S]{0,160}?R\$\s*([\d.]+,\d{2})/i]);
  const brIofPrazo = flat.match(/2\s*-\s*Valor\s+IOF\s+Total\s+3\s*-\s*Prazo\s+de\s+Opera[cç][aã]o\s+R\$\s*([\d.]+,\d{2})\s+(\d{2,5})\s+dias/i);
  const brRates = flat.match(/4\.1\s*-\s*Taxa\s+de\s+Juros\s+Efetiva\s+4\.2\s*-\s*Taxa\s+de\s+Juros\s+Efetiva\s+([\d,.]+)\s*%\s*ao\s+m[eê]s\s+([\d,.]*)\s*%\s*ao\s+ano/i);
  const brInstallments = flat.match(/6\s*-\s*Quantidade\s+Parcelas\s+7\s*-\s*Valor\s+da\(s\)\s+Parcela\(s\)\s+em\s+R\$\s+7\.1\s*-\s*Valor\s+Total\s+da\(s\)\s+Parcelas\s+em\s+R\$\s+(\d{1,3})\s+R\$\s*([\d.]+,\d{2})\s+R\$\s*([\d.]+,\d{2})/i);
  const brDueDates = flat.match(/11\s*-\s*Vencimento\s+da\s+1[ªa]\s+Parcela\s+12\s*-\s*Vencimento\s+da\s+[ÚU]ltima\s+Parcela\s+(\d{2}\/\d{2}\/\d{4})\s+(\d{2}\/\d{2}\/\d{4})/i);
  const brCet = flat.match(/Custo\s+Efetivo\s+Total\s*-\s*CET\s+2\s+([\d,.]+)\s*%\s*a\.m\.\s+([\d,.]+)\s*%\s*a\.a\./i);
  const brQuadroIv = flat.match(/1\.1\s*-\s*Tributos\s+1\.2\s*-\s*Seguros\s+1\.3\s*-\s*Tarifas\s+R\$\s*([\d.]+,\d{2})\s+([\d,.]+)%[\s\S]{0,180}?1\.6\s*-\s*Total\s+R\$\s*([\d.]+,\d{2})\s+([\d,.]+)%/i);
  const brValorLiberadoClienteBlank = /Valor\s+Liberado\s+ao\s+Cliente\s+1\s+2\s+R\$\s*Percentual:\s*%/i.test(flat)
    || /Valor\s+Liberado\s+ao\s+Cliente[\s\S]{0,120}?R\$\s+Percentual:\s+%/i.test(flat);
  const brAgencyAccount = flat.match(/Ag[eê]ncia\s+D[ií]g\.?\s+(?:Nome\s+da\s+Ag[eê]ncia\s+)?Conta[\s-]*Corrente\s+D[ií]g\.?\s+(\d{1,6})\s+(\d{1,2})\s+(\d{1,12})\s+(\d{1,2})/i)
    || flat.match(/Ag[eê]ncia\s+D[ií]g\s+Conta\s+D[ií]g\s+CPF\/CNPJ\/MF[\s\S]{0,120}?(\d{1,6})\s+(\d{1,2})\s+(\d{1,12})\s+(\d{1,2})/i)
    || flat.match(/Ag[eê]ncia\s*[:\-]?\s*(\d{1,6})\s*(?:D[ií]gito|D[ií]g\.?)?\s*[:\-]?\s*(\d{1,2})[\s\S]{0,80}?Conta[\s-]*Corrente\s*[:\-]?\s*(\d{1,12})\s*(?:D[ií]gito|D[ií]g\.?)?\s*[:\-]?\s*(\d{1,2})/i);
  const brCnpj = firstMatch(flat, [/CNPJ\/?MF\s*(\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2})/i]);
  const brOperationType = firstMatch(flat, [/Tipo\s+de\s+Opera[cç][aã]o\s*[:\-]?\s*(NOVO|REFINANCIAMENTO|PORTABILIDADE)/i, /V-2[\s\S]{0,180}?\b(NOVO|REFINANCIAMENTO|PORTABILIDADE)\b/i]);
  const authArea = text.match(/Assinado\s+eletronicamente\s+por\s+[^\n]+\n([\s\S]*?)(?:Fone\s+F[aá]cil|Mod\.:)/i)?.[1] || "";
  const authBlockTokens = authArea.split(/\s+/).filter((token) => /^[A-Za-z0-9@#?*]{8}$/.test(token));
  const authBlock = authBlockTokens.length >= 8 ? authBlockTokens.join(" ") : null;
  return {
    isBradesco: true,
    contratoNumero: brContractNumber || brHeader?.[1] || null,
    dataContrato: brHeader?.[2] || firstMatch(flat, [/VII\s*-\s*Outros\s+dados\s+deste\s+Contrato\s+1\s*-\s*N[uú]mero\s+de\s+Vias\s+2\s*-\s*Local\s+de\s+Celebra[cç][aã]o\s+3\s*-\s*Data\s+\d+\s+[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ\s]+?\s+(\d{2}\/\d{2}\/\d{4})/i]),
    clienteNome: titleCaseName(clientLine?.[1]),
    clienteCpf: clientLine?.[2] || null,
    clienteRg: rgLine ? `${rgLine[1]}, ${rgLine[2]}/${rgLine[3]}` : null,
    clienteEndereco: addressLine ? `${addressLine[1].trim()}, ${addressLine[2].trim()}, ${addressLine[3].trim()}` : null,
    clienteCidade: titleCaseName(firstMatch(flat, [/10\s*-\s*Pra[cç]a\s+de\s+Pagamento\s+[A-Z()ç\s.]+\s+([A-ZÁÀÂÃÉÊÍÓÔÕÚÇ]{3,60})\s+11\s*-\s*Vencimento/i, /2\s*-\s*Local\s+de\s+Celebra[cç][aã]o\s+3\s*-\s*Data\s+\d+\s+([A-ZÁÀÂÃÉÊÍÓÔÕÚÇ]{3,60})\s+\d{2}\/\d{2}\/\d{4}/i])),
    clienteEstado: rgLine?.[3] || null,
    cnpjInstituicao: brCnpj ? brCnpj.replace(/\D/g, "") : "60746948000112",
    codigoBancoBacen: "237",
    agencia: brAgencyAccount ? `${brAgencyAccount[1]}-${brAgencyAccount[2]}` : null,
    contaCorrente: brAgencyAccount ? `${brAgencyAccount[3]}-${brAgencyAccount[4]}` : null,
    nomeAgencia: null,
    bancoRecebimento: brAgencyAccount ? "Banco Bradesco S.A." : null,
    tipoOperacao: brOperationType ? stripDiacritics(brOperationType).toUpperCase() : "NOVO",
    operacaoPortada: brOperationType && !/^NOVO$/i.test(brOperationType) ? true : false,
    valorLiberadoSolicitado: normalizeMoney(brValues?.[1]),
    valorNovosRecursos: normalizeMoney(brValues?.[2]),
    valorTotalEmprestimo: normalizeMoney(brTotalLoan),
    valorContratado: normalizeMoney(brHeader?.[3] || brValues?.[2] || brTotalLoan),
    iofTotal: normalizeMoney(brIofPrazo?.[1]),
    prazoDias: brIofPrazo?.[2] || null,
    taxaJurosMensal: normalizePercent(brRates?.[1]),
    taxaJurosAnual: brRates?.[2]?.trim() ? normalizePercent(brRates[2]) : null,
    taxaJurosAnualEmBranco: Boolean(brRates && !brRates[2]?.trim()),
    numeroParcelas: brInstallments?.[1] || null,
    valorParcela: normalizeMoney(brInstallments?.[2]),
    valorTotalParcelas: normalizeMoney(brInstallments?.[3]),
    primeiroVencimento: brDueDates?.[1] || null,
    ultimoVencimento: brDueDates?.[2] || null,
    cetMensal: normalizePercent(brCet?.[1]),
    cetAnual: normalizePercent(brCet?.[2]),
    tributosValor: normalizeMoney(brQuadroIv?.[1]),
    tributosPercentual: normalizePercent(brQuadroIv?.[2]),
    totalPagamentosValor: normalizeMoney(brQuadroIv?.[3]),
    totalPagamentosPercentual: normalizePercent(brQuadroIv?.[4]),
    valorLiberadoClienteEmBranco: brValorLiberadoClienteBlank,
    codigoAutenticacao: authBlock,
    assinaturaEletronicaTexto: firstMatch(flat, [/(\(assinado\s+de\s+forma\s+eletr[oô]nica\)|Assinado\s+eletronicamente\s+por\s+[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ\s]{8,90})/i]),
  };
}

export function heuristicExtractionFromText(rawText) {
  // Carimbos de PJe/PROJUDI saem antes de qualquer padrão: a data da juntada
  // impressa em toda página já foi lida como data do contrato.
  const footer = separarCarimboProcessual(String(rawText || "").replace(/\r/g, "\n"));
  const text = footer.text;
  const metadadosProcessuais = footer.metadados;
  const planilha = extrairPlanilhaCalculo(text);
  const segmentacao = segmentarDocumentos(text);
  const flat = text.replace(/\s+/g, " ").trim();
  const upper = flat.toUpperCase();
  const blocks = extractBlocks(flat);
  const ccbBlock = blocks.I || "";
  const creditorBlock = blocks.II || "";
  const issuerBlock = blocks.III || "";
  const operationBlock = blocks.IV || "";
  const flowBlock = blocks.V || "";
  const releaseBlock = blocks.VI || "";
  const correspondentBlock = blocks.VII || "";
  const lowText = flat.length < 400;

  const cpf = firstMatch(flat, [
    /\b(\d{3}\.?\d{3}\.?\d{3}-?\d{2})\b/,
    /CPF[:\s]*([0-9.\-]{11,14})/i,
  ]);
  const cep = firstMatch(flat, [/\b(\d{5}-?\d{3})\b/]);
  const contratoNumeroMotor = firstMatch(flat, [
    /Compromisso\s+de\s+Pagamento\s*[:\-]?\s*(\d{8,30})/i,
    /C[ÉE]DULA\s+DE\s+CR[ÉE]DITO\s+BANC[ÁA]RIO\s*\(?(?:CCB)?\)?\s*N[ºO.]?\s*([A-Z0-9.\-\/]{5,})/i,
    /\bCCB\s*N[ºO.]?\s*([A-Z0-9.\-\/]{5,})/i,
    /(?:contrato|proposta|c[eé]dula|opera[cç][aã]o)\s*(?:n[ºo.]*)?\s*[:\-]?\s*([A-Z0-9.\-\/]{5,})/i,
    /\b(?:CCB|ADE)\s*[:\-]?\s*([A-Z0-9.\-\/]{5,})/i,
  ]);
  // Padrão genérico do motor aceita palavra ("Documento") como número; só vale
  // com pelo menos quatro dígitos, senão prevalece o padrão validado do SaaS.
  const contratoNumero = [contratoNumeroMotor, extrairNumeroContrato(flat)].find(numeroContratoPlausivel) || null;
  const banco = firstMatch(upper, [
    /\b(BANCO\s+DO\s+BRASIL|BB\s+SOLU[ÇC][ÕO]ES\s+DE\s+D[ÍI]VIDAS)\b/,
    /\b(BANCO\s+BMG|BMG)\b/,
    /\b(BANCO\s+BRADESCO|BRADESCO)\b/,
    /\b(BANCO\s+PAN|PAN)\b/,
    /\b(C6\s+BANK|BANCO\s+C6)\b/,
    /\b(BANCO\s+DAYCOVAL|DAYCOVAL)\b/,
    /\b(BANCO\s+SAFRA|SAFRA)\b/,
    /\b(BANCO\s+ITAU|ITA[UÚ])\b/,
    /\b(BANCO\s+OLE|OL[ÉE]\s+CONSIGNADO)\b/,
    /\b(PARAN[ÁA]\s*BANCO|PARANABANCO)\b/,
    /\b(C6\s+CONSIG)\b/,
    /\b(BANCO\s+AGIBANK|AGIBANK)\b/,
  ]);
  // A detecção de cartão (RMC/RCC) precisa vir antes do padrão genérico de
  // CCB + "empréstimo consignado": um cartão consignado com saque também
  // menciona CCB e "empréstimo" no clausulado (a CCB evidencia o saque), e
  // se o padrão genérico for checado primeiro ele vence indevidamente
  // (achado bloqueante: contrato de cartão sendo tratado como empréstimo).
  const modalidade =
    /Cr[eé]dito\s+Direto\s+ao\s+Consumidor.*?Renegocia[cç][aã]o|BB\s+Solu[cç][oõ]es\s+de\s+D[ií]vidas/i.test(flat) ? "Renegociação CDC" :
    /cart[ãa]o\s+consignado\s+de\s+benef[ií]cio|reserva(?:r[áa])?\s+de\s+margem\s+consign[áa]vel|\bRMC\b/i.test(flat) ? "RMC" :
    /cart[ãa]o\s+de\s+cr[ée]dito\s+consignado|\bRCC\b/i.test(flat) ? "RCC" :
    /C[ÉE]DULA\s+DE\s+CR[ÉE]DITO\s+BANC[ÁA]RIO.*?EMPR[ÉE]STIMO\s+CONSIGNADO/i.test(flat) ? "Emprestimo Consignado" :
    /(?:Antecipa[cç][aã]o\s+(?:do\s+)?(?:saque[- ]anivers[aá]rio|FGTS)|(?:Modalidade|Produto)\s*:\s*FGTS)/i.test(flat) ? "FGTS" :
    /EMPR[ÉE]STIMO|CONSIGNADO/i.test(flat) ? "Emprestimo Pessoal" :
    null;
  const valorContratado = firstMatch(operationBlock || flat, [
    /Valor\s+da\s+Opera[cç][aã]o\s*(?:R\$\s*)?([\d.]+,\d{2})/i,
    /1\s*-\s*Valor\s+da\s+Opera[cç][aã]o\s+2\s*-\s*IOF[\s\S]{0,220}?R\$\s*([\d.]+,\d{2})/i,
    /Valor\s+total\s+do\s+cr[eé]dito\s*[:\-]?\s*(?:R\$\s*)?([\d.]+,\d{2})/i,
    /(?:valor\s+(?:contratado|liberado|financiado|do\s+cr[eé]dito)|cr[eé]dito)\s*[:\-]?\s*(R\$\s*[\d.]+,\d{2})/i,
    /\b(R\$\s*[\d.]+,\d{2})\b/,
  ]);
  const valorParcela = firstMatch(operationBlock || flat, [
    /Valor\s+da\s+Presta[cç][aã]o\s*(?:R\$\s*)?([\d.]+,\d{2})/i,
    /4\s*-\s*Valor\s+da\s+Presta[cç][aã]o\s+5\s*-\s*Prazo[\s\S]{0,160}?R\$\s*([\d.]+,\d{2})/i,
    /Valor\s+da\s+parcela\s*[:\-]?\s*(?:R\$\s*)?([\d.]+,\d{2})/i,
    /(?:valor\s+da\s+parcela|parcela)\s*[:\-]?\s*(R\$\s*[\d.]+,\d{2})/i,
    /(?:valor\s+da\s+parcela|parcela)\s*[:\-]?\s*([\d.]+,\d{2})\b/i,
    /valor\s+parcela\s+de\s+origem\s*[:\-]?\s*(R\$?\s*[\d.]+,\d{2})/i,
    /(?:presta[cç][aã]o)\s*[:\-]?\s*(R\$\s*[\d.]+,\d{2})/i,
  ]);
  const numeroParcelas = firstMatch(operationBlock || flat, [
    /Prazo\s+da\s+Opera[cç][aã]o\s*[:\-]?\s*(\d{1,3})/i,
    /4\s*-\s*Valor\s+da\s+Presta[cç][aã]o\s+5\s*-\s*Prazo[\s\S]{0,180}?R\$\s*[\d.]+,\d{2}\s+(\d{1,3})\s+Mensal/i,
    /Quantidade\s+de\s+parcelas\s*[:\-]?\s*(\d{1,3})/i,
    /N[ºO.]?\s*de\s+Parcelas\s*\(mensais\)\s*(\d{1,3})/i,
    /(?:n[úu]mero\s+de\s+parcelas|parcelas|prazo)\s*[:\-]?\s*(\d{2,3})/i,
    /(\d{2,3})\s*(?:parcelas|presta[cç][oõ]es)/i,
  ]);
  const taxaMensal = normalizePercent(firstMatch(flowBlock || flat, [
    /Taxa\s+de\s+Juros\s+Efetiva\s*[:\-]?\s*([\d,.]+)\s*%\s*a\.?m/i,
    /\b\d+\s*[-–]\s*Taxa\s+a\.m\.?\s*[:\-]?\s*([\d,.]+%?)/i,
    /Taxa\s+de\s+Juros\s*([\d,.]+\s*%)\s*a\.?m\.?/i,
    /(?:juros\s+mensal|taxa\s+mensal)\s*[:\-]?\s*([\d,.]+\s*%)/i,
  ]));
  const taxaAnual = normalizePercent(firstMatch(flowBlock || flat, [
    /\b\d+\s*[-–]\s*Taxa\s+a\.a\.?\s*[:\-]?\s*([\d,.]+%?)/i,
    /Taxa\s+de\s+Juros\s*[\d,.]+\s*%\s*a\.?m\.?\s*\/\s*([\d,.]+\s*%)\s*a\.?a\.?/i,
    /(?:juros\s+anual|taxa\s+anual)\s*[:\-]?\s*([\d,.]+\s*%)/i,
  ]));
  const cetMensal = normalizePercent(firstMatch(flowBlock || flat, [
    /\bCET\s+a\.m\.?\s*[:\-]?\s*([\d,.]+%?)/i,
    /CET\s*[–-]\s*CUSTO\s+EFETIVO\s+TOTAL\s*[:\-]?\s*([\d,.]+\s*%)\s*a\.?m\.?/i,
    /(?:CET\s+mensal|C\.?E\.?T\.?\s*a\.?m\.?)\s*[:\-]?\s*([\d,.]+\s*%)/i,
  ]));
  const cetAnual = normalizePercent(firstMatch(flowBlock || flat, [
    /Custo\s+Efetivo\s+Total\s+CET\s*[:\-]?\s*([\d,.]+)\s*%\s*a\.?a/i,
    /\bCET\s+a\.a\.?\s*[:\-]?\s*([\d,.]+%?)/i,
    /CET\s*[–-]\s*CUSTO\s+EFETIVO\s+TOTAL\s*[:\-]?\s*[\d,.]+\s*%\s*a\.?m\.?\s*\/\s*([\d,.]+\s*%)\s*a\.?a\.?/i,
    /(?:CET\s+anual|C\.?E\.?T\.?\s*a\.?a\.?)\s*[:\-]?\s*([\d,.]+\s*%)/i,
  ]));
  const dates = allMatches(flat, /\b(\d{2}\/\d{2}\/\d{4})\b/g);
  const ccbDates = allMatches(ccbBlock, /\b(\d{2}\/\d{2}\/\d{4})\b/g);
  const operationDates = allMatches(operationBlock, /\b(\d{2}\/\d{2}\/\d{4})\b/g);
  const issuerBirthDate = firstMatch(issuerBlock || flat, [/Nome\s*\/\s*Data\s+Nasc\.?\s*[:\-]?\s*[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ\s]{8,80}?\s*\/\s*(\d{2}\/\d{2}\/\d{4})/i, /(?:nascimento|data\s+nasc\.?)\s*[:\-]?\s*(\d{2}\/\d{2}\/\d{4})/i]);
  const signatureText = findTextualSignature(flat);
  const manualSignatureNameRaw = firstMatch(text, [/^\s*Por\s*:\s*([^\n]{8,100})/im]);
  const manualSignatureName = titleCaseName(manualSignatureNameRaw);
  const agibankAcceptance = text.match(/ASSINATURA\s+DIGITAL\s+Forma\s+de\s+Aceite\s+N[uú]mero\s+celular\s+Data\s*-\s*hora\s+([A-Z ]{3,40})\s+(\d{8,14})\s+(\d{2}\/\d{2}\/\d{4}\s*-\s*\d{2}:\d{2}:\d{2})/i);
  const structuredAcceptance = agibankAcceptance?.[1]?.trim() || firstMatch(flat, [/Forma\s+de\s+Aceite\s*[:\-]?\s*([^.;\n]{3,80}?)(?=\s+(?:N[uú]mero|Data|Hora|CPF|$))/i]);
  const acceptancePhone = validPhone(agibankAcceptance?.[2] || firstMatch(flat, [
    /Forma\s+de\s+Aceite\s+N[uú]mero\s+celular[\s\S]{0,120}?\b(\d{8,14})\b/i,
    /N[uú]mero\s+celular\s*[:\-]?\s*(\(?\d{2}\)?\s*9?\d{4}-?\d{4})/i,
    /telefone\s+(?:do\s+)?aceite\s*[:\-]?\s*(\(?\d{2}\)?\s*9?\d{4}-?\d{4})/i,
  ]), contratoNumero, cpf);
  const signatureDateTime = agibankAcceptance?.[3]?.replace(/\s*-\s*/, " ") || firstMatch(flat, [/(\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}(?::\d{2})?)/]);
  const agiClienteNomeBruto = firstMatch(text, [/Nome\s+do\s+cliente:\s*([^\n]+)/i, /Nome:\s*([A-ZÁÀÂÃÉÊÍÓÔÕÚÇ\s]{8,80})\s+CPF:/i]);
  const agiClienteNome = nomePlausivel(titleCaseName(agiClienteNomeBruto)) ? agiClienteNomeBruto : null;
  const agiDataNascimento = firstMatch(text, [/Data\s+de\s+nascimento:\s*(\d{2}\/\d{2}\/\d{4})/i]);
  const agiEndereco = firstMatch(text, [/Endere[cç]o:\s*([^\n]+)/i]);
  const agiBairro = firstMatch(text, [/Bairro:\s*([^\n\t]+?)\s+CEP:/i]);
  const agiCep = firstMatch(text, [/Bairro:[^\n]*?CEP:\s*(\d{5}-?\d{3})/i]);
  const agiCidadeEstado = text.match(/Cidade:\s*([^\n\t]+?)\s+UF:\s*([A-Z]{2})/i);
  const agiValueList = flat.match(/B\)\s*IOF\s*R\$\s*([\d.]+,\d{2})\s*R\$\s*([\d.]+,\d{2})\s*R\$\s*([\d.]+,\d{2})\s*R\$\s*([\d.]+,\d{2})\s*R\$\s*([\d.]+,\d{2})/i);
  const agiContractStart = firstMatch(text, [/Data\s+e\s+hora\s+do\s+in[ií]cio\s+da\s+contrata[cç][aã]o:\s*(\d{2}\/\d{2}\/\d{4})/i]);
  const vencimentos = flat.match(/Venc\.?\s*1[ªa]?\s*e\s*[ÚU]ltima\s+Parcela\s*(\d{2}\/\d{2}\/\d{4})\s*-\s*(\d{2}\/\d{2}\/\d{4})/i);
  const bbConditionValues = flat.match(/1\s*-\s*Valor\s+da\s+Opera[cç][aã]o\s+2\s*-\s*IOF\s+Financiado\s+3\s*-\s*Valor\s+Entrada\s+R\$\s*([\d.]+,\d{2})\s+R\$\s*([\d.]+,\d{2})\s+R\$\s*([\d.]+,\d{2})/i);
  const bbPaymentValues = flat.match(/4\s*-\s*Valor\s+da\s+Presta[cç][aã]o\s+5\s*-\s*Prazo\s+da\s+Opera[cç][aã]o:?\s+6\s*-\s*Periodicidade\s+de\s+Pgto:?\s+R\$\s*([\d.]+,\d{2})\s+(\d{1,3})\s+Mensal/i);
  const bbDueDates = flat.match(/7\s*-\s*Data\s+base\s+de\s+Vencimento\s+8\s*-\s*Data\s+da\s+1[ªa]\s+Parcela\s+9\s*-\s*Data\s+da\s+[úu]ltima\s+Parcela\s+(\d{1,2})\s+(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2})\.(\d{2})\.(\d{4})/i);
  const bbTotals = flat.match(/10\s*-\s*Ag[eê]ncia\s*\/\s*Conta:?\s+11\s*-\s*Somat[oó]rio\s+das\s+Parcelas\s+12\s*-\s*Valor\s+Desconto\s+([\d\s/]+?)\s+R\$\s*([\d.]+,\d{2})\s+R\$\s*([\d.]+,\d{2})/i);
  const bbRates = flat.match(/Taxa\s+de\s+Juros\s+Efetiva\s*:\s*2\s*-\s*Custo\s+Efetivo\s+Total\s+CET\s*:\s*([\d,.]+)\s*%\s*a\.?m\s+([\d,.]+)\s*%\s*a\.?a/i);
  const bbIssueMatch = flat.match(/Bras[ií]lia\s*\(DF\),?\s*(\d{1,2})\s+de\s+([A-Za-zçÇ]+)\s+de\s+(\d{4})/i);
  const contextoInstrumento = mergeDefined(extractContractContext(text), extractExtendedContractFields(text));
  const layout = mergeDefined(extractGenericContractLayout(text, flat), contextoInstrumento, extractBradescoConsignado(text, flat), extractFactaCartaoConsignado(text, flat));
  for (const key of ["banco", "cnpjInstituicao", "contratoNumero", "modalidade", "tipoOperacao"]) {
    if (contextoInstrumento[key]) layout[key] = contextoInstrumento[key];
  }
  if (contextoInstrumento.valorTotalEmprestimo) layout.valorContratado = contextoInstrumento.valorTotalEmprestimo;
  const ipRecords = extrairIps(text);
  const ipValues = ipRecords.map((record) => record.endereco);
  const auditTrail = extractAuditTrail(text);
  // Hash declarado só com rótulo de hash, ou em formato inequívoco de SHA-256.
  // O padrão antigo aceitava qualquer UUID, e o laudo do dossiê C6 abriu com
  // "hash informado não é criptográfico" sobre um número de protocolo que o
  // banco nunca chamou de hash: achado que cai na primeira contestação.
  const hash = firstMatch(flat, [
    /(?:\bhash\b|\bSHA-?(?:1|224|256|384|512)\b|\bMD5\b|resumo\s+criptogr[aá]fico|\bdigest\b|impress[aã]o\s+digital)[^:\n]{0,40}?[:\-]?\s*\b([a-f0-9]{32,128})\b/i,
    /\b([a-f0-9]{64})\b/i,
  ]);
  const codigoRotulado = text.match(
    /(?:N[uú]mero\s+[uú]nico|C[oó]digo\s+de\s+(?:verifica[cç][aã]o|autentica[cç][aã]o|autenticidade)|Chave\s+de\s+valida[cç][aã]o|Protocolo\s+de\s+autenticidade(?:\s+n[ºo°.]*)?)\s*:?[ \t]*([A-Za-z0-9][A-Za-z0-9-]{7,79})\b/i
  );
  const codigoAutenticacaoRotulado = codigoRotulado && !/^\d{1,7}$/.test(codigoRotulado[1]) ? codigoRotulado[1] : null;
  const urlVerificacao = firstMatch(flat, [/Verifique\s+a\s+autenticidade\s+em\s*:?\s*(https?:\/\/\S+?)[.,;]?(?:\s|$)/i]);
  // Coordenada: rótulo combinado explícito primeiro; depois o extrator do motor
  // (graus/minutos/segundos, hemisfério, URL de mapa); por fim o critério de
  // plausibilidade geográfica, que aceita três casas decimais.
  const coordenadasSaas = extrairCoordenadasPlausiveis(flat);
  const coordinates = (coordenadasSaas?.origem === "rotulo-combinado" ? coordenadasSaas : null)
    || extractCoordinates(flat)
    || coordenadasSaas;
  const declaredGeoAddressRaw = firstMatch(flat, [
    /endere[cç]o\s+(?:da\s+)?geolocaliza[cç][aã]o\s*[:\-]?\s*([^.;\n]{8,160})/i,
    /local\s+(?:declarado\s+)?da\s+assinatura\s*[:\-]?\s*([^.;\n]{8,160})/i,
    /geolocaliza[cç][aã]o\s*[:\-]\s*((?:rua|avenida|av\.?|travessa|rodovia|estrada|pra[cç]a)\s+[^.;\n]{6,150})/i,
  ]);
  const declaredGeoAddress = declaredGeoAddressRaw && !/^(?:da\s+assinatura|presente|sim|n[aã]o|latitude|longitude)\b/i.test(declaredGeoAddressRaw)
    ? declaredGeoAddressRaw
    : null;
  const hasSignature = Boolean(
    signatureText
    || structuredAcceptance
    || layout.assinaturaEletronicaTexto
    || /assinado\s+eletronicamente|assinatura\s+(?:digital|eletr[oô]nica)|certificado\s+digital|biometria\s+facial|token\s+sms|forma\s+de\s+aceite/i.test(flat)
  );
  const hasAudit = /auditoria|\blogs?\b|trilha|evid[eê]ncia\s+de\s+aceite|carimbo\s+de\s+tempo|data\s+e\s+hora\s+(?:UTC|GMT|da\s+assinatura)/i.test(flat);
  const hasGeo = Boolean(coordinates || declaredGeoAddress);
  // Hash e código de autenticação são campos distintos, com estados distintos.
  // Derivar o estado de um a partir do outro produziu no mesmo § 4 "código:
  // não identificado" e "estado do hash/código: declarado".
  const codigoAutenticacao = layout.codigoAutenticacao || codigoAutenticacaoRotulado || null;
  const codigoAutenticacaoOrigem = layout.codigoAutenticacao
    ? "bloco de autenticação do rodapé"
    : codigoRotulado
      ? `rótulo "${codigoRotulado[0].split(/\s*:|\s{2,}/)[0].replace(/\s+/g, " ").trim()}"${paginaDoIndice(text, codigoRotulado.index) ? `, pág. ${paginaDoIndice(text, codigoRotulado.index)}` : ""}`
      : null;
  const declaredAuthHashState = hash ? classifyDeclaredHash(hash) : "AUSENTE";
  const codigoAutenticacaoEstado = codigoAutenticacao ? classifyDeclaredHash(codigoAutenticacao) : "AUSENTE";
  const hasCheckableDeclaredHash = declaredAuthHashState === "DECLARADO_CONFERIVEL" || codigoAutenticacaoEstado === "DECLARADO_CONFERIVEL";
  const hasOperationalAuthRecord = Boolean(
    structuredAcceptance
    || signatureDateTime
    || acceptancePhone
    || ipValues.length > 0
    || hasCheckableDeclaredHash
  );
  const bbClientName = firstMatch(text, [/Nome\s*:\s*([^\n]{8,100})/i, /Por\s*:\s*([^\n]{8,100})/i]);
  const nomeMotor = [titleCaseName(bbClientName), titleCaseName(firstMatch(issuerBlock || flat, [
    /Nome\s*[:\-]?\s*([A-ZÁÀÂÃÉÊÍÓÔÕÚÇ][A-ZÁÀÂÃÉÊÍÓÔÕÚÇ\s]{8,80}?)(?=\s+(?:CPF|RG|Data|Nascimento|Estado Civil|Endere[cç]o)\b)/i,
    /Nome\s*\/\s*Data\s+Nasc\.?\s*[:\-]?\s*([A-ZÁÀÂÃÉÊÍÓÔÕÚÇ][A-ZÁÀÂÃÉÊÍÓÔÕÚÇ\s]{8,80}?)\s*\/\s*\d{2}\/\d{2}\/\d{4}/i,
    /Nome\s*[:\-]?\s*([A-ZÁÀÂÃÉÊÍÓÔÕÚÇ][A-ZÁÀÂÃÉÊÍÓÔÕÚÇ\s]{8,80}?)(?=\s+MCI\b)/i,
    /Por\s*[:\-]?\s*([A-ZÁÀÂÃÉÊÍÓÔÕÚÇ][A-ZÁÀÂÃÉÊÍÓÔÕÚÇ\s]{8,80}?)(?=\s+CPF\b)/i,
    /ASSINADO\s+ELETRONICAMENTE\s+POR\s*[:\-]?\s*([A-ZÁÀÂÃÉÊÍÓÔÕÚÇ][A-ZÁÀÂÃÉÊÍÓÔÕÚÇ\s]{8,80}?)(?=\s+CPF\b)/i,
    /(?:nome\s*(?:do\s+cliente|completo)?|contratante|benefici[aá]rio)\s*[:\-]?\s*([A-ZÁÀÂÃÉÊÍÓÔÕÚÇ][A-ZÁÀÂÃÉÊÍÓÔÕÚÇ\s]{8,80}?)(?=\s+(?:CPF|RG|CELULAR|BANCO|AG[ÊE]NCIA)\b)/i,
    /NOME\s+([A-ZÁÀÂÃÉÊÍÓÔÕÚÇ][A-ZÁÀÂÃÉÊÍÓÔÕÚÇ\s]{8,80})\s+(?:CPF|RG|DATA|FILIA)/i,
  ]))].find(nomePlausivel) || null;
  // O critério de forma do SaaS vem primeiro: os padrões genéricos acima usam
  // `/i` com classe de caixa alta e aceitam "do cliente" como nome.
  const name = titleCaseName(extrairNomeContratante(flat)) || nomeMotor;
  const endereco = firstMatch(issuerBlock || flat, [
    /Endere[cç]o\s*[:\-]?\s*([^.;\n]{8,160}?)(?=\s+(?:Bairro|Cidade|UF|CEP|Telefone|E-?mail)\b)/i,
    /Endere[cç]o\s+Completo\s*[:\-]?\s*([^.;\n]{8,100}?)(?=\s+2\.\s+CONDI|3\.\s+LOCAL|\s+LOCAL\s+E\s+DATA)/i,
    /endere[cç]o\s*[:\-]?\s*([^.;\n]{8,100}?)(?=\s+(?:n[uú]mero\s+do\s+endere[cç]o|numero\s+do\s+endere[cç]o|complemento|cep|promotor)\b)/i,
    /((?:rua|avenida|av\.|travessa|tv\.|rodovia|estrada)\s+[^.]{8,120})/i,
    /endere[cç]o\s*[:\-]?\s*([^.;\n]{8,140})/i,
  ]);
  const cidade = firstMatch(issuerBlock || flat, [
    /\bCidade\s*[:\-]?\s*([^.;\n]{3,60}?)(?=\s+(?:UF|Estado|CEP|Telefone|E-?mail)\b)/i,
    /LOCAL\s+E\s+DATA\s+DE\s+EMISS[ÃA]O\s*[:\-]?\s*([^.;\n]{3,60}?)\s*-\s*[A-Z]{2}\s*-\s*\d{2}\/\d{2}\/\d{4}/i,
    /cidade\s*[:\-]?\s*([^,.;\n]{3,60}?)(?=\s+(?:bairro|endere[cç]o|cep|estado)\b)/i,
    /cidade\s*[:\-]?\s*([^,.;\n]{3,60})/i,
  ]);
  const bairro = firstMatch(issuerBlock || flat, [
    /\bBairro\s*[:\-]?\s*([^.;\n]{3,60}?)(?=\s+(?:Cidade|UF|Estado|CEP|Telefone|E-?mail)\b)/i,
    /bairro\s*[:\-]?\s*([^,.;\n]{3,60}?)(?=\s+(?:endere[cç]o|cep|cidade|estado)\b)/i,
    /bairro\s*[:\-]?\s*([^,.;\n]{3,60})/i,
  ]);
  const clienteCep = firstMatch(issuerBlock || flat, [
    /\bCEP\s*[:\-]?\s*(\d{5}-?\d{3})/i,
    /2\.\s*EMITENTE[\s\S]{0,500}?\bCEP\s*[:\-]?\s*(\d{5}-?\d{3})/i,
    /Endere[cç]o\s+Completo[\s\S]{0,220}?\bCEP\s*[:\-]?\s*(\d{5}-?\d{3})/i,
    /\bCEP\s*[:\-]?\s*(\d{5}-?\d{3})/i,
  ]);
  const extractedClienteCep = layout.clienteCep || agiCep || clienteCep || cep;
  const finalClienteCep = cepLooksInstitutional(flat, extractedClienteCep) ? null : extractedClienteCep;
  const rawClienteTelefone = layout.clienteTelefone || firstMatch(issuerBlock || flat, [
    /Telefone\(s\)\s*[:\-]?\s*\/?\s*(\(?\d{2}\)?\s*9?\d{4}-?\d{4})/i,
    /\b(\(?\d{2}\)?\s*9?\d{4}-?\d{4})\b/,
  ]);
  const clienteTelefone = validPhone(rawClienteTelefone, contratoNumero, cpf);
  const originalCreditor = firstMatch(flowBlock || operationBlock || flat, [
    /(?:credor\s+original|institui[cç][aã]o\s+credora\s+original|banco\s+credor\s+original|cedente)\s*[:\-]?\s*([^.;\n]{3,90}?)(?=\s+(?:CPF|CNPJ|valor|saldo|opera[cç][aã]o|contrato|$))/i,
  ]);
  const rawClienteEmail = firstMatch(issuerBlock || "", [/\b([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})\b/i]);
  const clienteEmail = rawClienteEmail && !isInstitutionalEmail(rawClienteEmail) ? rawClienteEmail : null;
  const correspondenteEmail = firstMatch(correspondentBlock || "", [/\b([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})\b/i]);
  const correspondenteCidade = firstField(correspondentBlock, [/\bCidade\s*[:\-]?\s*([^.;\n]{3,60}?)(?=\s+(?:UF|Estado|CEP|Telefone|E-?mail)\b)/i]);
  const normalizedBank = /BB\s+SOLU|BANCO\s+DO\s+BRASIL/i.test(banco || flat) ? "Banco do Brasil S.A." : banco;
  const ptMonths = { janeiro: "01", fevereiro: "02", marco: "03", abril: "04", maio: "05", junho: "06", julho: "07", agosto: "08", setembro: "09", outubro: "10", novembro: "11", dezembro: "12" };
  const bbIssueDateFormatted = bbIssueMatch
    ? `${String(bbIssueMatch[1]).padStart(2, "0")}/${ptMonths[stripDiacritics(bbIssueMatch[2]).toLowerCase()] || bbIssueMatch[2]}/${bbIssueMatch[3]}`
    : null;
  const dataNascimentoDetectada = layout.clienteDataNascimento || agiDataNascimento || issuerBirthDate || null;
  const dataContratoEleita = extrairDataContrato(text, {
    prioritarias: [
      { valor: layout.dataContrato, rotulo: "layout dedicado do instrumento" },
      { valor: bbIssueDateFormatted, rotulo: "local e data de emissão (Banco do Brasil)" },
      { valor: agiContractStart, rotulo: "início da contratação (Agibank)" },
      { valor: firstField(ccbBlock, [/\bData\s+(?:de\s+)?(?:emiss[aã]o|contrato)\s*[:\-]?\s*(\d{2}\/\d{2}\/\d{4})/i]), rotulo: "quadro I da CCB" },
    ],
    datasProcessuais: metadadosProcessuais?.datas_do_carimbo || [],
    datasSemRotulo: [...ccbDates, ...dates],
    datasExcluidas: [issuerBirthDate, agiDataNascimento, dataNascimentoDetectada],
  });
  const dataContratoBruta = dataContratoEleita.valor;
  // Nunca aceitar a data do contrato sem checar plausibilidade contra a data
  // de nascimento: um campo solto em formato dd/mm/aaaa pode ser lido como
  // data do contrato quando na verdade é a data de nascimento do cliente,
  // o que gera um achado de proveniência absurdo (PDF "criado" décadas antes
  // do contrato). Ver relatório técnico de 09/09/2026, item 1.
  const dataContratoPlausivelParsed = parsePtDate(dataContratoBruta);
  const dataNascimentoParsed = parsePtDate(dataNascimentoDetectada);
  const dataContratoImplausivel = Boolean(
    dataContratoBruta && (
      (dataNascimentoParsed && dataContratoPlausivelParsed && dataContratoPlausivelParsed.getTime() === dataNascimentoParsed.getTime())
      || (dataNascimentoParsed && dataContratoPlausivelParsed && (dataContratoPlausivelParsed - dataNascimentoParsed) / (365.25 * 86400000) < 18)
      || (dataContratoPlausivelParsed && (dataContratoPlausivelParsed.getFullYear() < 2000 || dataContratoPlausivelParsed.getTime() > Date.now()))
    ),
  );
  const dataContrato = dataContratoImplausivel ? null : dataContratoBruta;
  const primeiroVencimento = firstField(operationBlock, [/(?:1[ºo.]?|primeiro)\s+vencimento\s*[:\-]?\s*(\d{2}\/\d{2}\/\d{4})/i])
    || firstMatch(flat, [/(?:1[ºo.]?|primeiro)\s+vencimento\s*[:\-]?\s*(\d{2}\/\d{2}\/\d{4})/i])
    || layout.primeiroVencimento || vencimentos?.[1] || operationDates[0] || null;
  const ultimoVencimento = firstField(operationBlock, [/(?:[úu]ltimo|final)\s+vencimento\s*[:\-]?\s*(\d{2}\/\d{2}\/\d{4})/i])
    || firstMatch(flat, [/(?:[úu]ltimo|final)\s+vencimento\s*[:\-]?\s*(\d{2}\/\d{2}\/\d{4})/i])
    || layout.ultimoVencimento || vencimentos?.[2] || (primeiroVencimento && Number(numeroParcelas) ? addMonths(primeiroVencimento, Number(numeroParcelas) - 1) : null) || operationDates[1] || null;

  const achados = [];
  const issueCodes = new Set();
  const addIssue = (codigo, gravidade, titulo, texto) => {
    if (issueCodes.has(codigo)) return;
    issueCodes.add(codigo);
    achados.push({ codigo, gravidade, titulo, texto });
  };
  if (lowText) addIssue("OCR1", "MÉDIA", "PDF com pouco texto pesquisável", "O PDF possui pouco texto pesquisável/OCR extraível. Para resultado completo em documento escaneado, aplique OCR prévio ao arquivo.");

  // D12: numeração do rodapé do modelo acima do denominador declarado. Sai como
  // indício, nunca como comprovado: a leitura possível é que o documento juntado
  // não corresponda ao modelo cuja numeração o rodapé declara, e isso não se
  // conclui de uma contagem de rodapé.
  for (const anomalia of detectarAnomaliaPaginacao(text)) {
    addIssue(
      "PAG1",
      "MÉDIA",
      "Numeração do rodapé acima do total declarado no próprio rodapé",
      `O rodapé "${anomalia.modelo}" numera as páginas de 1/${anomalia.denominador} até ${anomalia.maior_numerador}/${anomalia.denominador}, nas págs. ${anomalia.paginas[0]} a ${anomalia.paginas.at(-1)} do arquivo: ${anomalia.maior_numerador} páginas numeradas contra ${anomalia.denominador} declaradas no denominador. O estado é de indício e não de comprovação. A leitura possível é que o documento juntado não corresponda ao modelo cuja numeração o rodapé declara, o que deve ser esclarecido pela instituição com a apresentação do modelo vigente na data da contratação.`
    );
  }
  for (const alerta of dataContratoEleita.alertas) addIssue(alerta.codigo, alerta.gravidade, alerta.titulo, alerta.texto);
  if (!hash && codigoAutenticacaoRotulado && !layout.codigoAutenticacao) {
    // Protocolo interno conferível só no site do próprio emissor. O achado não é
    // "hash inválido": é que não há hash nenhum, e a única verificação oferecida
    // depende de quem tem interesse no resultado.
    addIssue(
      "INT1",
      "ALTA",
      "Ausência de resumo criptográfico do documento assinado",
      `O dossiê não apresenta nenhum resumo criptográfico (hash) do documento assinado. Apresenta apenas número de protocolo interno (${codigoAutenticacaoRotulado}), verificável exclusivamente no sítio da própria instituição${urlVerificacao ? ` (${urlVerificacao})` : ""}. Isso configura autoverificação, e não cadeia de custódia: o protocolo não permite a terceiro conferir, de forma independente, que o arquivo apresentado é o mesmo que foi assinado.`
    );
  } else if (!hash && !codigoAutenticacao) {
    addIssue("INT1", "MÉDIA", "Hash conferível ausente", "Não há hash de integridade declarado pelo emissor no documento.");
  }
  const normalizedClientName = stripDiacritics(titleCaseName(agiClienteNome) || name || "").toLowerCase();
  const normalizedCreditor = stripDiacritics(originalCreditor || "").toLowerCase();
  if (acceptancePhone && clienteTelefone && acceptancePhone.replace(/\D/g, "") !== clienteTelefone.replace(/\D/g, "")) {
    addIssue("AUT1", "MÉDIA", "Telefone do aceite diverge do cadastro", `Telefone do aceite (${acceptancePhone}) diverge do telefone cadastral/contratual (${clienteTelefone}).`);
  }
  if (originalCreditor && normalizedClientName && normalizedCreditor.includes(normalizedClientName)) {
    addIssue("FIN4", "MÉDIA", "Credor original preenchido com o nome do consumidor", "Credor original/cedente aparenta estar preenchido com o nome da própria consumidora, o que fragiliza a validação do refinanciamento.");
  }
  if (layout.taxaJurosAnualEmBranco) {
    addIssue("FIN1", "MÉDIA", "Taxa de juros efetiva anual em branco", "Campo de taxa de juros efetiva anual em branco, embora a taxa mensal esteja preenchida.");
  }
  if (layout.valorLiberadoClienteEmBranco) {
    addIssue("FIN2", "MÉDIA", "Valor Liberado ao Cliente e percentual em branco", "Campo Valor Liberado ao Cliente/percentual está em branco apesar de haver valor liberado/solicitado em outro quadro do contrato.");
  }
  const iofCents = moneyToCents(layout.iofTotal);
  const iofBaseValue = layout.valorContratado || layout.valorTotalEmprestimo || layout.valorNovosRecursos || layout.valorLiberadoSolicitado;
  const iofBaseCents = moneyToCents(iofBaseValue);
  if (iofCents !== null && iofBaseCents !== null) {
    const iofPercent = (iofCents / iofBaseCents) * 100;
    if (iofPercent > 3.373) {
      addIssue("TRB1", "MÉDIA", "IOF exige demonstrativo da base de cálculo", `IOF informado equivale a ${iofPercent.toFixed(2).replace(".", ",")}% sobre a base financeira localizada (${layout.iofTotal} / ${iofBaseValue}). A comparação com teto legal depende da base efetivamente tributada, prazo, data e alíquotas; o item fica como diligência técnica, sem afirmar violação isolada.`);
    }
  }
  const tributosCents = moneyToCents(layout.tributosValor);
  const tributosBaseCents = moneyToCents(layout.valorContratado || layout.valorTotalEmprestimo || layout.valorNovosRecursos || layout.valorLiberadoSolicitado);
  const declaredTributosPercent = percentToNumber(layout.tributosPercentual);
  if (tributosCents && tributosBaseCents && declaredTributosPercent === 0) {
    addIssue("TRB2", "MÉDIA", "Percentual de tributos declarado como 0,00%", `O demonstrativo declara tributos/IOF de ${layout.tributosValor} com percentual 0,00%, embora represente aproximadamente ${((tributosCents / tributosBaseCents) * 100).toFixed(2).replace(".", ",")}% da base financeira localizada.`);
  }
  if (layout.codigoAutenticacao) {
    addIssue("INT1", "MÉDIA", "Código de autenticação declarado e inverificável", "Há código de autenticação declarado no rodapé, porém sem algoritmo, payload de referência e procedimento público de conferência. Caracteres fora dos alfabetos usuais podem decorrer de fonte embutida sem mapa ToUnicode; por isso, o bloco deve ser confrontado com a renderização visual antes de conclusão sobre seu alfabeto.");
  }
  const temCet = Boolean(layout.cetMensal || layout.cetAnual || cetMensal || cetAnual);
  const percentuaisValidosCet = Boolean(tributosCents && declaredTributosPercent && declaredTributosPercent > 0);
  const confissaoTela = /(tela|meio eletr[oô]nico)[^.]{0,240}(CET|fluxos|referenciais\s+de\s+remunera)/i.test(flat);
  if (temCet && !percentuaisValidosCet) {
    addIssue("CET1", "ALTA", "Demonstrativo de cálculo do CET ausente do instrumento", `O contrato declara o CET, porém não apresenta demonstrativo com valores em reais e percentuais válidos de cada componente do fluxo, conforme dever de informação do CDC e da regulamentação do CMN sobre CET.${confissaoTela ? " O próprio instrumento registra que fluxos e referenciais foram apresentados por meio da tela do canal eletrônico, e não no corpo do contrato." : ""}`);
  }
  const enderecoIncompleto = Boolean((layout.clienteEndereco || agiEndereco || endereco) && (!agiBairro && !bairro) && !finalClienteCep);
  if (enderecoIncompleto && (layout.clienteCidade || layout.clienteEstado)) {
    addIssue("CAD1", "MÉDIA", "Qualificação incompleta do contratante", "O campo de endereço do instrumento contém apenas logradouro/número/complemento, sem bairro, município, unidade federativa e CEP. Município e UF constantes deste laudo foram inferidos de outros quadros do contrato e não do campo de endereço.");
  }
  if (!ipValues.length && !hasGeo && !hasAudit && !signatureDateTime) {
    addIssue("LOG1", "MÉDIA", "Ausência de rastros técnicos da contratação", "O documento não registra endereço IP, coordenadas GPS, carimbo de tempo nem trilha de auditoria referentes à contratação eletrônica.");
  }

  const taxaJurosMensalExtraida = layout.taxaJurosMensal || normalizePercent(bbRates?.[1]) || taxaMensal;
  const taxaJurosAnualExtraida = layout.taxaJurosAnual || taxaAnual;
  const taxaJurosMensalDecimal = percentStringToDecimal(taxaJurosMensalExtraida);
  const taxaJurosAnualCalculada = !taxaJurosAnualExtraida && layout.taxaJurosAnualEmBranco && taxaJurosMensalDecimal !== null
    ? `${(Math.pow(1 + taxaJurosMensalDecimal, 12) * 100 - 100).toFixed(2).replace(".", ",")}% (calculada pelo sistema; campo em branco no contrato)`
    : null;

  // A modalidade do layout dedicado (ex.: Facta -> "RMC") prevalece sobre a
  // detecção genérica por regex, que roda sobre o texto inteiro e pode se
  // confundir com menções a "empréstimo"/"CCB" no clausulado de um cartão.
  const finalModalidade = layout.modalidade || modalidade;
  const isCartaoConsignado = finalModalidade === "RMC" || finalModalidade === "RCC";
  // Resolver o credor pela raiz do CNPJ (tabela local, ver bankRegistry.js)
  // tem prioridade sobre qualquer regex de proximidade textual: um número
  // de 3 dígitos perto de "Banco:"/"Código:" no texto quase sempre pertence
  // a outro quadro do contrato (ex.: o banco que recebe o benefício), não
  // ao credor. Ver item 4 do relatório técnico de 09/09/2026.
  const bankByCnpj = resolveBankByCnpj(layout.cnpjInstituicao);
  // Produto antes de marco normativo: cartão consignado (RMC/RCC) é sempre de
  // benefício; nos demais, os marcadores decidem entre CLT, INSS e servidor.
  const produtoClassificado = isCartaoConsignado
    ? { codigo: "CONSIGNADO_INSS", rotulo: "Cartão consignado de benefício", marcadores: ["modalidade RMC/RCC"], confianca: "ALTA" }
    : classificarProduto(text);
  const empregador = produtoClassificado.codigo === "CONSIGNADO_CLT" ? extrairEmpregador(text) : null;
  // Layouts dedicados (Quadro V-2, "Tipo de Operação") têm precedência; o quadro
  // de caixas de seleção cobre o C6 e similares (MED-04).
  const camposOperacao = extrairCamposOperacao(text, {
    produtoCodigo: produtoClassificado.codigo,
    saldoPortado: isCartaoConsignado ? null : planilha?.componentes.saldo_portado.valor ?? null,
  });
  const contratoExtraido = {
    numero: [layout.contratoNumero, contratoNumero].find(numeroContratoPlausivel) || null,
    banco: contextoInstrumento.banco || bankByCnpj?.nome || (layout.isBradesco ? "Banco Bradesco S.A." : (layout.banco || normalizedBank || firstField(creditorBlock, [/\b(Banco\s+[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ0-9 .-]{3,80}?)(?=\s+(?:S\.?A\.?|CNPJ|Ag[êe]ncia|Endere[cç]o)\b)/i]))),
    produto: finalModalidade === "COMPRA_CARTAO" ? "Compra com cartão e cessão de crédito"
      : finalModalidade === "SAQUE_CARTAO_CONSIGNADO" ? "Saque parcelado do cartão consignado"
      : finalModalidade === "CREDITO_PESSOA_JURIDICA" ? "Crédito para pessoa jurídica"
      : finalModalidade === "CDC_COM_GARANTIA" ? "Crédito Direto ao Consumidor com garantia"
      : finalModalidade === "Renegociação CDC"
      ? "Crédito Direto ao Consumidor / Renegociação"
      : isCartaoConsignado
        ? "Cartão consignado de benefício"
        : produtoClassificado.rotulo || (finalModalidade ? "Crédito consignado" : null),
    produto_codigo: finalModalidade === "CREDITO_PESSOA_JURIDICA" ? "CREDITO_PJ" : ["Renegociação CDC", "CDC_COM_GARANTIA"].includes(finalModalidade) ? "CDC" : produtoClassificado.codigo,
    produto_marcadores: produtoClassificado.marcadores,
    empregador,
    modalidade: finalModalidade,
    // Campos de empréstimo (valor contratado/parcela/número de parcelas) não
    // se aplicam a cartão consignado — ficam null com uma nota, em vez de
    // aparecer como "Não identificado" (que sugere falha de extração) ou
    // serem preenchidos com números do cartão que descrevem outra coisa.
    valor_liberado: isCartaoConsignado ? null : (layout.valorLiberadoSolicitado || normalizeMoney(agiValueList?.[2] || firstMatch(flat, [/Valor\s+Liberado\s*[:\-]?\s*(?:R\$\s*)?([\d.]+,\d{2})/i]))),
    valor_novos_recursos: isCartaoConsignado ? null : (layout.valorNovosRecursos || layout.valorContratado || normalizeMoney(bbConditionValues?.[1] || valorContratado || agiValueList?.[1])),
    valor_total_emprestimo: isCartaoConsignado ? null : (layout.valorTotalEmprestimo || layout.valorContratado || normalizeMoney(bbConditionValues?.[1] || valorContratado || agiValueList?.[1])),
    valor_contratado: isCartaoConsignado ? null : (layout.valorContratado || normalizeMoney(bbConditionValues?.[1] || valorContratado || agiValueList?.[1])),
    iof_financiado: layout.iofTotal || normalizeMoney(bbConditionValues?.[2] || firstMatch(flat, [/IOF\s+Financiado\s*(?:R\$\s*)?([\d.]+,\d{2})/i])),
    valor_entrada: normalizeMoney(bbConditionValues?.[3] || firstMatch(flat, [/Valor\s+Entrada\s*(?:R\$\s*)?([\d.]+,\d{2})/i])),
    saldo_devedor_refinanciado: normalizeMoney(agiValueList?.[3] || firstMatch(flat, [/Saldo\s+devedor\s+de\s+opera[cç][aã]o\s+Grupo\s+Agibank\s*[:\-]?\s*(?:R\$\s*)?([\d.]+,\d{2})/i])),
    valor_parcela: isCartaoConsignado ? null : (layout.valorParcela || normalizeMoney(bbPaymentValues?.[1] || valorParcela || firstMatch(flat, [/Valor\s+da\s+parcela:\s*R\$\s*([\d.]+,\d{2})/i]))),
    numero_parcelas: isCartaoConsignado ? null : (layout.numeroParcelas || bbPaymentValues?.[2] || numeroParcelas || firstMatch(flat, [/N[uú]mero\s+de\s+parcelas:\s*(\d{1,3})/i])),
    parcelas_mensais: isCartaoConsignado ? null : (layout.numeroParcelas || bbPaymentValues?.[2] || numeroParcelas || firstMatch(flat, [/N[uú]mero\s+de\s+parcelas:\s*(\d{1,3})/i])),
    prazo_meses: layout.cartao?.prazoPrevistoLiquidacaoMeses ?? null,
    prazo_dias: layout.prazoDias || null,
    prazo_total_declarado: isCartaoConsignado ? null : planilha?.prazo_total_declarado || null,
    seguros: isCartaoConsignado ? null : planilha?.componentes.seguros.valor || null,
    tarifa_cadastro: isCartaoConsignado ? null : planilha?.componentes.tarifa_cadastro.valor || null,
    saldo_portado: isCartaoConsignado ? null : planilha?.componentes.saldo_portado.valor || null,
    valor_total_ao_final: isCartaoConsignado ? null : planilha?.valor_total_ao_final || null,
    planilha_calculo: isCartaoConsignado ? null : planilha,
    prazo_nao_se_aplica_nota: isCartaoConsignado ? "Cartão consignado de benefício: prazo é a estimativa de liquidação do saldo (ver prazo_meses), não um cronograma de parcelas fixas." : null,
    taxa_juros_mensal: taxaJurosMensalExtraida,
    taxa_juros_anual: taxaJurosAnualExtraida,
    taxa_juros_anual_calculada: taxaJurosAnualCalculada,
    cet_mensal: layout.cetMensal || cetMensal,
    cet_anual: layout.cetAnual || normalizePercent(bbRates?.[2]) || cetAnual || normalizePercent(firstMatch(flat, [/\bCET\s+a\.a:\s*([\d,.]+%?)/i])),
    // "Valor Total ao Final" da planilha é o somatório declarado das parcelas.
    // Sem ele, o § 2 dizia "não identificado" e o § 2.1 calculava o mesmo valor.
    valor_total_parcelas: layout.valorTotalParcelas || normalizeMoney(bbTotals?.[2] || firstMatch(flat, [/(?:Somat[oó]rio\s+das\s+Parcelas|Valor\s+total\s+das\s+parcelas)\s*[:\-]?\s*(?:R\$\s*)?([\d.]+,\d{2})/i])) || (isCartaoConsignado ? null : planilha?.valor_total_ao_final) || null,
    credor_original: layout.tipoOperacao === "NOVO" ? "não se aplica (operação declarada como NOVO no Quadro V-2)" : originalCreditor,
    data_contrato: dataContrato,
    data_contrato_origem: dataContrato ? dataContratoEleita.origem : null,
    data_contrato_confianca: dataContrato ? dataContratoEleita.confianca : null,
    data_contrato_candidatos: dataContratoEleita.candidatos,
    data_contrato_nota: dataContratoImplausivel
      ? `Data do contrato não determinada com segurança (valor extraído: ${dataContratoBruta}, incompatível com a data de nascimento do cliente ou fora do intervalo plausível).`
      : dataContrato && dataContratoEleita.confianca === "BAIXA"
        ? `Data do contrato lida sem rótulo de contratação no documento (${dataContratoEleita.origem}); confira no instrumento antes de usar prazos e taxas calculados a partir dela.`
        : null,
    data_primeiro_vencimento: contextoInstrumento.primeiroVencimento || (bbDueDates ? `${bbDueDates[2]}/${bbDueDates[3]}/${bbDueDates[4]}` : primeiroVencimento),
    data_ultimo_vencimento: contextoInstrumento.ultimoVencimento || (bbDueDates ? `${bbDueDates[5]}/${bbDueDates[6]}/${bbDueDates[7]}` : ultimoVencimento),
    codigo_banco_bacen: bankByCnpj ? bankByCnpj.compe : (layout.codigoBancoBacen || null),
    codigo_banco_bacen_nota: bankByCnpj?.semCompeNota || null,
    cnpj_instituicao: layout.cnpjInstituicao,
    agencia: layout.agencia,
    conta_corrente: layout.contaCorrente,
    nome_agencia: layout.nomeAgencia,
    banco_recebimento: layout.bancoRecebimento,
    modalidade_desconto_provavel: camposOperacao.modalidade_desconto_provavel,
    tipo_operacao: layout.tipoOperacao || camposOperacao.tipo_operacao,
    tipo_operacao_desmarcadas: layout.tipoOperacao ? null : camposOperacao.tipo_operacao_desmarcadas,
    operacao_portada: contextoInstrumento.tipoOperacao === "PORTABILIDADE" ? true : layout.operacaoPortada ?? camposOperacao.operacao_portada,
    cartao: isCartaoConsignado ? layout.cartao : null,
    conta_beneficio: layout.contaBeneficio || null,
    correspondente: layout.correspondente || null,
    // D3: o município de emissão é ponto próprio do confronto geográfico e não
    // se confunde com o endereço cadastral do contratante.
    local_emissao: extrairLocalEmissao(text),
    evidencias_campos: contextoInstrumento.evidenciasContexto,
    condicoes_financeiras_nota: contextoInstrumento.condicoesNota || null,
  };
  // OCR em tabela perde posições e pode ler o primeiro valor como o total.
  // Sem token íntegro na coluna correta, não alimenta cálculo financeiro.
  if (/--- OCR page-/.test(text) && /Valor\s+do[sf]\s+Novos\s+Recursos[^\n]{0,100}Valor\s+Total\s+do\s+Empr[eé]stimo/i.test(text)) {
    for (const key of ["valor_total_emprestimo", "valor_contratado", "valor_novos_recursos", "valor_liberado", "iof_financiado", "taxa_juros_mensal", "taxa_juros_anual", "cet_mensal", "cet_anual"]) contratoExtraido[key] = null;
    contratoExtraido.condicoes_financeiras_nota = "A leitura OCR não preservou integralmente as colunas de capital, IOF e taxas. Esses campos exigem conferência visual e não alimentam cálculos automáticos. Parcelas e vencimentos permanecem limitados aos rótulos reconhecidos.";
    contratoExtraido.revisao_financeira_obrigatoria = true;
  }
  const mathAudit = buildMathAudit(contratoExtraido);

  /*
   * ─── D6 · campos "não identificados" que o laudo calcula duas páginas adiante ─
   *
   * O § 2 do laudo FD-20260917 imprimiu "Taxa de juros anual calculada: Não
   * identificado", "Prazo da operação (dias): Não identificado" e "Prazo da
   * operação (meses, aprox.): Não identificado". O § 2.1, na página seguinte,
   * calculou os três. Eram dois conjuntos de campos para a mesma grandeza, um
   * alimentado pela extração e outro pela camada matemática, sem ligação.
   *
   * Um documento que declara não saber aquilo que ele mesmo calcula na página
   * seguinte convida o leitor a auditar o resto linha a linha.
   *
   * A ficha passa a ler o resultado da camada matemática quando a extração não
   * encontrou o campo, sempre com a origem declarada: extraído do instrumento
   * e calculado pelo sistema não são a mesma afirmação e não podem sair sem
   * distinção.
   */
  const ORIGEM_EXTRAIDA = "EXTRAIDO_DO_INSTRUMENTO";
  const ORIGEM_CALCULADA = "CALCULADO_PELO_SISTEMA";

  if (contratoExtraido.prazo_dias !== null && contratoExtraido.prazo_dias !== undefined && contratoExtraido.prazo_dias !== "") {
    contratoExtraido.prazo_dias_origem = ORIGEM_EXTRAIDA;
  } else if (Number.isFinite(mathAudit.prazo_calculado_dias)) {
    contratoExtraido.prazo_dias = mathAudit.prazo_calculado_dias;
    contratoExtraido.prazo_dias_origem = ORIGEM_CALCULADA;
  }

  if (contratoExtraido.taxa_juros_anual_calculada) {
    contratoExtraido.taxa_juros_anual_calculada_origem = ORIGEM_CALCULADA;
  } else if (mathAudit.juros_anual_calculado_12m || mathAudit.juros_anual_calculado_365) {
    const convencao = mathAudit.juros_anual_convencao;
    const doze = mathAudit.juros_anual_calculado_12m;
    const dias = mathAudit.juros_anual_calculado_365;
    contratoExtraido.taxa_juros_anual_calculada = doze && dias
      ? `${doze} em doze meses e ${dias} em 365 dias${convencao ? ` (convenção que confere: ${convencao})` : ""}`
      : doze || dias;
    contratoExtraido.taxa_juros_anual_calculada_origem = ORIGEM_CALCULADA;
  }

  // `prazo_operacao_meses_aprox` deriva do prazo DECLARADO. Quando o
  // instrumento não o traz, o valor que o § 2.1 publica é o prazo efetivo em
  // meses, calculado da emissão ao último vencimento. Era essa a grandeza que a
  // ficha dava como não identificada enquanto a aferição imprimia 8,3 meses.
  contratoExtraido.prazo_operacao_meses_aprox = mathAudit.prazo_operacao_meses_aprox ?? mathAudit.prazo_efetivo_meses ?? null;
  if (contratoExtraido.prazo_operacao_meses_aprox !== null && contratoExtraido.prazo_operacao_meses_aprox !== undefined) {
    contratoExtraido.prazo_operacao_meses_aprox_origem = ORIGEM_CALCULADA;
  }
  contratoExtraido.carencia_dias = mathAudit.carencia_dias;
  // Primeiro vencimento anterior à data do contrato não é carência: é sinal de
  // que uma das duas datas foi lida de outro quadro do documento.
  if (Number.isFinite(mathAudit.carencia_dias) && mathAudit.carencia_dias < 0) {
    contratoExtraido.carencia_dias = null;
    contratoExtraido.datas_nota = `O primeiro vencimento extraído (${contratoExtraido.data_primeiro_vencimento}) é anterior à data do contrato extraída (${contratoExtraido.data_contrato}). Uma das datas foi lida de outro quadro do documento; confira ambas antes de usar a aferição matemática.`;
  }
  contratoExtraido.juros_carencia = mathAudit.juros_carencia;
  contratoExtraido.prazo_efetivo_dias = mathAudit.prazo_calculado_dias;
  contratoExtraido.custo_total = mathAudit.custo_total;
  contratoExtraido.custo_total_percentual = mathAudit.custo_total_percentual;
  if (mathAudit.carencia_dias > 45) {
    addIssue("FIN3", "INFO", "Carência prolongada entre contratação e primeiro vencimento", `Decorreram ${plural(mathAudit.carencia_dias, "dia", "dias")} entre a data do contrato (${contratoExtraido.data_contrato}) e o primeiro vencimento (${contratoExtraido.data_primeiro_vencimento}).${mathAudit.juros_carencia ? ` Sob a hipótese de liberação na data de emissão e aplicação da taxa declarada nesse período, o cálculo estima ${mathAudit.juros_carencia} de juros antes do primeiro pagamento.` : ""}${contratoExtraido.valor_total_parcelas && mathAudit.somatorio_sobre_liberado_percentual ? ` O somatório das parcelas (${contratoExtraido.valor_total_parcelas}) corresponde a ${mathAudit.somatorio_sobre_liberado_percentual} do valor liberado (${contratoExtraido.valor_liberado}).` : ""} A carência não é ilícita por si e integra o placar apenas como elemento de contexto econômico.`);
  }
  // D4: informação de prazo prestada de forma condicional não é divergência de
  // prazo. O achado muda de natureza, sai com o trecho ancorado e fica pendente
  // de conferência do escritório, a quem cabe a qualificação jurídica.
  if (mathAudit.prazo_declarado_condicional && mathAudit.prazo_declarado_meses) {
    addIssue(
      "PRZ2",
      "MÉDIA",
      "Prazo informado de forma condicional no próprio campo",
      `O campo de prazo do instrumento não declara um prazo fechado: registra "${contratoExtraido.prazo_total_declarado?.texto || `${mathAudit.prazo_declarado_meses} meses`}", condicionando o término ao pagamento da última parcela. Da emissão (${contratoExtraido.data_contrato}) ao último vencimento (${contratoExtraido.data_ultimo_vencimento}) decorrem ${plural(mathAudit.prazo_calculado_dias, "dia", "dias")}, cerca de ${String(mathAudit.prazo_efetivo_meses).replace(".", ",")} meses. Não se trata de divergência entre o prazo declarado e o efetivo, porque o campo não afirma prazo fechado: trata-se de informação de prazo prestada de forma condicional, cuja suficiência diante do dever de informação é matéria de qualificação jurídica.`
    );
  }
  if (mathAudit.prazo_confere === false && mathAudit.prazo_declarado_meses) {
    addIssue("PRZ1", "MÉDIA", "Prazo efetivo diverge do prazo total declarado", `O instrumento declara prazo total de ${mathAudit.prazo_declarado_meses} meses, mas da emissão (${contratoExtraido.data_contrato}) ao último vencimento (${contratoExtraido.data_ultimo_vencimento}) decorrem ${plural(mathAudit.prazo_calculado_dias, "dia", "dias")}, cerca de ${String(mathAudit.prazo_efetivo_meses).replace(".", ",")} meses. A diferença decorre da carência até o primeiro vencimento, durante a qual correm juros, e não está refletida no prazo informado ao consumidor.`);
  }
  if (contratoExtraido.agencia && !contratoExtraido.nome_agencia) {
    addIssue("CAD1", "MÉDIA", "Qualificação incompleta do contratante", "O instrumento informa agência e conta, mas deixa o nome da agência em branco. O dado deve ser conferido com o cadastro bancário e com a modalidade de desconto aplicável.");
  }
  const beneficioMatricula = layout.matriculaInss
    || firstMatch(ccbBlock, [/(?:benef[ií]cio\/matr[ií]cula|matr[ií]cula|n[ºo.]?\s+do\s+benef[ií]cio)\s*(?:n[ºo.]?)?\s*[:\-]?\s*([0-9.\-\/]{5,30})/i])
    || firstMatch(flat, [/(?:benef[ií]cio\/matr[ií]cula|matr[ií]cula|n[ºo.]?\s+do\s+benef[ií]cio)\s*(?:n[ºo.]?)?\s*[:\-]?\s*([0-9.\-\/]{5,30})/i]);
  const numeroBeneficio = layout.numeroBeneficio || firstMatch(flat, [/(?:benef[ií]cio|NB)\s*[:\-]?\s*([0-9.\-\/]{5,30})/i]);
  const especieBeneficio = firstMatch(flat, [/(?:esp[eé]cie)\s*[:\-]?\s*([^,.;\n]{2,50})/i]);
  // Só consignado de benefício tem número de benefício a exigir. No consignado
  // CLT a ausência é esperada, e apontá-la trocaria o achado certo (empregador
  // não identificado) por um que o banco derruba.
  const exigeBeneficio = produtoClassificado.codigo === "CONSIGNADO_INSS"
    || (produtoClassificado.codigo === "INDETERMINADO" && /\bINSS\b|benef[ií]cio\s+previdenci[aá]rio/i.test(flat));
  if (exigeBeneficio && !beneficioMatricula && !numeroBeneficio) {
    addIssue("CAD2", "MÉDIA", "Benefício previdenciário não identificado", "O instrumento aparenta tratar de crédito consignado em benefício, mas não foi localizado número de benefício, matrícula ou espécie previdenciária. O dado deve ser confrontado com HISCON/INSS, autorização de averbação e cadastro da operação.");
  }
  if (empregador && !empregador.identificado) {
    addIssue("EMP1", "MÉDIA", "Empregador não identificado", `O instrumento de consignado do trabalhador registra o empregador apenas como "${empregador.literal}", sem razão social e sem CNPJ, embora seja o empregador quem realiza o desconto em folha. Sem essa identificação não é possível confirmar o vínculo que sustenta a consignação nem a averbação da margem.`);
  }
  // Campos repetidos (benefício, CPF, nome, proposta) devem coincidir em
  // todas as ocorrências do documento; quando um formulário interno (ex.:
  // Termo de Consentimento) usa o número errado, isso é achado por si.
  if (layout.numeroBeneficio && layout.beneficioNoTermoConsentimento && layout.beneficioNoTermoConsentimento !== layout.numeroBeneficio) {
    addIssue("CAD3", "MÉDIA", "Termo de Consentimento com número de benefício divergente", `O Termo de Consentimento Esclarecido identifica o benefício com o número ${layout.beneficioNoTermoConsentimento}, que corresponde ao número da proposta/contrato, não ao número do benefício (${layout.numeroBeneficio}) informado no quadro de qualificação do cliente. O documento destinado a esclarecer o consumidor está preenchido com o dado errado.`);
  }
  addIssue("CUS1", "MÉDIA", "Itens eliminatórios da cadeia de custódia não satisfeitos", "A extração não localizou hash conferível declarado pelo emissor, provedor verificável, carimbo de tempo independente nem registro de preservação do arquivo original. Em PDF reimpresso, a ausência de selfie e logs no próprio arquivo é esperada; a diligência recai sobre a exibição dos artefatos originais da plataforma.");

  // Linha do tempo do fluxo de aceite (dossiê de contratação): um fluxo
  // inteiro em poucos minutos, ou um aceite dos termos poucos segundos
  // após o acesso, é incompatível com leitura do instrumento e vira achado
  // objetivo — sem precisar de nenhuma outra evidência. Ver item 8.2.7 do
  // relatório técnico de 09/09/2026.
  const acceptanceTimeline = layout.trilha
    ? buildAcceptanceTimeline([
        { label: "Acesso ao APP/plataforma", value: layout.trilha.acessoApp },
        { label: "Aceite dos Termos e Condições", value: layout.trilha.aceiteTermos },
        { label: "Aceite e emissão da CCB", value: layout.trilha.aceiteCcb },
        { label: "Assinatura", value: layout.trilha.dataAssinatura },
      ])
    : null;
  if (acceptanceTimeline) {
    if (acceptanceTimeline.totalSeconds < 600) {
      addIssue("TML1", "MÉDIA", "Fluxo de contratação concluído em poucos minutos", `O intervalo entre "${acceptanceTimeline.firstLabel}" e "${acceptanceTimeline.lastLabel}" foi de ${formatDurationPt(acceptanceTimeline.totalSeconds)}. Isoladamente não prova vício de consentimento, mas deve ser confrontado com o tempo mínimo necessário para leitura do instrumento.`);
    }
    if (acceptanceTimeline.firstIntervalSeconds < 60) {
      addIssue("TML2", "ALTA", "Aceite dos termos poucos segundos após o acesso", `Decorreram apenas ${formatDurationPt(acceptanceTimeline.firstIntervalSeconds)} entre o acesso à plataforma e o aceite dos Termos e Condições, incompatível com a leitura do instrumento contratual.`);
    }
  }

  // Biometria: o dossiê às vezes registra um percentual de "facematch" que
  // é comparação interna da própria plataforma (selfie x foto do
  // documento, ambas colhidas na mesma sessão) — isso não é validação
  // contra uma base pública. Ver item 8.2.6.
  if (layout.trilha?.facematch && (!layout.trilha?.scoreBasePublica || /N[ÃA]O\s+LOCALIZAD/i.test(layout.trilha.scoreBasePublica))) {
    addIssue("BIO1", "ALTA", "Validação biométrica contra base pública não realizada", `A plataforma registra ${layout.trilha.facematch}% de correspondência entre a selfie e a foto do documento colhidas na mesma sessão${layout.trilha.basePublica ? `, com consulta à base pública ${layout.trilha.basePublica} retornando "${layout.trilha.scoreBasePublica || "não localizado"}"` : ""}. O percentual de facematch é comparação interna da própria plataforma, não confirmação de identidade contra registro público.`);
  }

  // CCB mencionada no dossiê (emissão registrada na trilha) mas sem número
  // de CCB localizável no corpo do documento — diligência automática.
  if (layout.trilha?.aceiteCcb && !/C[ée]dula\s+de\s+Cr[ée]dito\s+Banc[áa]ria?\s*n[ºo]?\s*[:\-]?\s*[A-Z0-9./-]+/i.test(flat)) {
    addIssue("CCB1", "MÉDIA", "CCB referida na trilha, mas ausente do arquivo", `O dossiê registra emissão da Cédula de Crédito Bancário às ${layout.trilha.aceiteCcb.split(" ")[1] || layout.trilha.aceiteCcb}, mas o número da CCB não foi localizado no corpo do documento. Exigir a CCB emitida e o comprovante de crédito correspondente.`);
  }

  // Idade do contratante na data do contrato — usa a mesma data de
  // nascimento já validada no item 1 (nunca a data-contrato-implausível).
  // Ver item 9.4 do relatório técnico de 09/09/2026 (estende a regra 5.5
  // do relatório anterior a cartão consignado).
  const idadeNaContratacaoAnos = (dataNascimentoParsed && dataContratoPlausivelParsed)
    ? Math.floor((dataContratoPlausivelParsed - dataNascimentoParsed) / (365.25 * 86400000))
    : null;
  if (isCartaoConsignado && idadeNaContratacaoAnos !== null && idadeNaContratacaoAnos >= 60 && layout.cartao?.prazoPrevistoLiquidacaoMeses >= 60) {
    const idadeAoFinal = idadeNaContratacaoAnos + Math.floor(layout.cartao.prazoPrevistoLiquidacaoMeses / 12);
    addIssue("IDA1", "INFO", "Contratante idoso com prazo de liquidação prolongado", `Contratante com ${idadeNaContratacaoAnos} anos na data do contrato; ao fim do prazo previsto de liquidação (${layout.cartao.prazoPrevistoLiquidacaoMeses} meses), terá aproximadamente ${idadeAoFinal} anos.`);
  }

  // Razão entre o desconto mensal projetado ao longo do prazo e o valor
  // efetivamente sacado — padrão comum em cartão consignado com saque. Ver
  // item 9.3.
  if (isCartaoConsignado && layout.cartao?.valorConsignadoMensal && layout.cartao?.prazoPrevistoLiquidacaoMeses && layout.cartao?.valorMaximoSaque) {
    const consignadoMensalCents = moneyToCents(layout.cartao.valorConsignadoMensal);
    const saqueCents = moneyToCents(layout.cartao.valorMaximoSaque);
    if (consignadoMensalCents && saqueCents) {
      const totalProjetadoCents = consignadoMensalCents * layout.cartao.prazoPrevistoLiquidacaoMeses;
      const razao = totalProjetadoCents / saqueCents;
      if (razao >= 2) {
        addIssue("RMC1", "ALTA", "Desconto projetado muito superior ao valor sacado", `Padrão de cartão consignado com saque: desconto mensal projetado de ${centsToMoney(totalProjetadoCents)} ao longo de ${layout.cartao.prazoPrevistoLiquidacaoMeses} meses, para um saque de ${layout.cartao.valorMaximoSaque}, razão de ${razao.toFixed(2).replace(".", ",")} vezes. A liquidação nesse prazo depende de hipóteses do Termo de Consentimento (nenhuma nova transação, margem inalterada, descontos ininterruptos, taxa inalterada), não é garantida.`);
      }
    }
  }

  // Fatura só por canal eletrônico, para idoso de domicílio rural: indício
  // de que o consumidor não teria como acompanhar o saldo devedor. Ver
  // item 9.5.
  const enderecoParaRuralidade = String(layout.clienteEndereco || agiEndereco || endereco || "").toLowerCase();
  const domicilioRural = /\bzona\s+rural\b|\bpovoado\b|\bs[ií]tio\b|\bfazenda\b|\blocalidade\b/i.test(enderecoParaRuralidade);
  if (isCartaoConsignado && domicilioRural && idadeNaContratacaoAnos !== null && idadeNaContratacaoAnos >= 60 && /eletr[ôo]nic/i.test(layout.cartao?.formaFatura || "")) {
    addIssue("FAT1", "MÉDIA", "Fatura apenas por canal eletrônico para idoso de zona rural", `A fatura foi configurada para "${layout.cartao.formaFatura}" para um contratante de ${idadeNaContratacaoAnos} anos com domicílio em zona rural, indício de que o consumidor não receberia informação acessível sobre o saldo devedor (CDC, art. 6º, III).`);
  }

  // Tarifa de emissão de cartão cobrada — INFO com referência regulatória,
  // útil quando houver questionamento sobre cobrança indevida. Item 9.8.
  if (isCartaoConsignado && moneyToCents(layout.cartao?.tarifaEmissao) > 0) {
    addIssue("TAR1", "INFO", "Tarifa de emissão do cartão cobrada", `Tarifa de emissão de ${layout.cartao.tarifaEmissao} cobrada na contratação (Res. CMN 3.919/2010 disciplina a cobrança de tarifas em cartão).`);
  }

  // Teto de juros do CNPS vigente NA DATA do contrato — tabela mínima
  // (ver cnpsRateCeiling.js); só gera achado quando a data está coberta
  // com confiança, nunca extrapola para datas não confirmadas. Item 9.2.
  if (isCartaoConsignado && dataContrato && layout.cartao?.taxaJurosMensal) {
    const ceiling = cnpsCeilingAt(dataContrato);
    const taxaMensalNum = percentToNumber(layout.cartao.taxaJurosMensal);
    const tetoFormatado = ceiling ? String(ceiling.tetoMensal).replace(".", ",") : null;
    if (ceiling && Number.isFinite(taxaMensalNum)) {
      if (taxaMensalNum > ceiling.tetoMensal + 0.01) {
        addIssue("TET1", "ALTA", "Taxa de juros acima do teto do CNPS vigente na data", `A taxa de juros mensal contratada (${layout.cartao.taxaJurosMensal}) está acima do teto de ${tetoFormatado}% a.m. vigente em ${dataContrato}${ceiling.resolucao ? ` (${ceiling.resolucao})` : ""}.`);
      } else if (Math.abs(taxaMensalNum - ceiling.tetoMensal) <= 0.01) {
        addIssue("TET2", "INFO", "Taxa de juros no teto vigente na data do contrato", `A taxa contratada (${layout.cartao.taxaJurosMensal}) corresponde exatamente ao teto de ${tetoFormatado}% a.m. vigente em ${dataContrato}${ceiling.resolucao ? ` (${ceiling.resolucao})` : ""}. A leitura do teto (sobre a taxa de juros ou sobre o CET) é controvertida; ponto a discutir, não conclusão de ilegalidade.`);
      }
    }
  }

  mathAudit.premissa_fluxo = "Cálculos de valor presente, juros e CET condicionados à hipótese de liberação na data de emissão, aos vencimentos previstos e aos valores declarados. Não comprovam desembolso, cobrança ou recolhimento de tributos efetivamente realizados.";
  mathAudit.conclusao = `${redigirConclusaoAfericao(mathAudit)} ${mathAudit.premissa_fluxo}`;

  const platformIndependence = assessPlatformIndependence(layout.trilha?.validadorUrl, contratoExtraido.banco);
  const uaParsed = parseUserAgent(layout.trilha?.dispositivoUtilizado);
  // Precisa listar pelo menos um item sempre que hasOperationalAuthRecord
  // for true — senão o § 4 (checklist) mostra "SIM" enquanto o sumário diz
  // "nenhum método operacional registrado", a mesma contradição do item
  // 8.1 do relatório técnico de 09/09/2026, só que para outro campo.
  // Etapa nominada do fluxo ("Coleta da Biometria Facial", seguida de carimbo de
  // hora) ou declaração de que o instrumento foi assinado por biometria.
  const biometriaRegistradaComoEvento = /coleta\s+da\s+biometria(?:\s+facial)?[^\n]{0,80}\n[^\n]{0,20}(?:hora|data)/i.test(text)
    || /assinad[ao]\s+eletronicamente,?\s+por\s+meio\s+da\s+coleta\s+da\s+biometria/i.test(flat);
  const metodosDaTrilha = [
    layout.trilha?.acessoApp ? `Acesso à plataforma em ${layout.trilha.acessoApp}` : null,
    layout.trilha?.aceiteTermos ? `Aceite dos Termos e Condições em ${layout.trilha.aceiteTermos}` : null,
    layout.trilha?.facematch ? `Facematch (selfie x documento, comparação interna) ${layout.trilha.facematch}%` : null,
    layout.trilha?.basePublica ? `Consulta a base pública ${layout.trilha.basePublica}: ${layout.trilha.scoreBasePublica || "sem resultado"}` : null,
    uaParsed?.resumo ? `Dispositivo: ${uaParsed.resumo}` : null,
  ].filter(Boolean);
  // Eixo distinto do de cima: aqui é o que o instrumento DESCREVE, não o que a
  // trilha registra como ocorrido. Recebe `text`, não `flat`, porque a âncora é
  // o segmento e a página, não o arquivo inteiro achatado.
  const metodosDescritos = extrairMetodosDescritos(text, { biometriaRegistradaComoEvento });
  const metodosRegistradosNaTrilha = metodosDaTrilha.length ? metodosDaTrilha : [
    structuredAcceptance,
    !structuredAcceptance && signatureDateTime ? `Carimbo de data/hora da assinatura: ${signatureDateTime}` : null,
    !structuredAcceptance && !signatureDateTime && acceptancePhone ? `Telefone de aceite: ${acceptancePhone}` : null,
    !structuredAcceptance && !signatureDateTime && !acceptancePhone && ipValues.length > 0 ? `Endereço IP registrado (${ipValues[0]})` : null,
    !structuredAcceptance && !signatureDateTime && !acceptancePhone && !ipValues.length && hasCheckableDeclaredHash ? "Código/hash de autenticação declarado pelo emissor" : null,
  ].filter(Boolean);
  // Nível legal por regra: sem certificado ICP-Brasil do contratante, com
  // aceite registrado em canal + biometria interna, é eletrônica simples ou
  // avançada (a confirmar), nunca "Indeterminado" quando há dossiê. Ver
  // item 8.2.9 do relatório técnico de 09/09/2026.
  const nivelLegalPorRegra = !hasSignature
    ? "Ausente"
    : (structuredAcceptance || layout.trilha?.facematch || acceptancePhone)
      ? "Eletrônica simples/avançada (a confirmar), MP 2.200-2, art. 10, § 2º"
      : "Indeterminado";

  const extracted = {
    tipo_documento: /contrato|c[eé]dula|proposta|termo/i.test(flat) ? "Contrato bancário / proposta de crédito" : "Documento PDF",
    qualidade_ocr: flat.length > 2500 ? "Alta" : flat.length > 600 ? "Media" : "Baixa",
    contrato: contratoExtraido,
    cliente: {
      nome: layout.clienteNome || titleCaseName(agiClienteNome) || name,
      cpf: layout.clienteCpf || cpf,
      rg: layout.clienteRg || firstMatch(issuerBlock || flat, [/Doc\.\s*Ident\.?\s*[:\-]?\s*RG\s*([0-9.\-]{5,20})/i, /RG\s*[:\-]?\s*([0-9.\-]{5,20})/i]),
      data_nascimento: layout.clienteDataNascimento || agiDataNascimento || issuerBirthDate,
      endereco: layout.clienteEndereco || agiEndereco || endereco,
      bairro: layout.clienteBairro || agiBairro || bairro,
      cidade: layout.clienteCidade || (finalModalidade === "Renegociação CDC" ? null : (agiCidadeEstado?.[1]?.trim() || cidade)),
      estado: layout.clienteEstado || agiCidadeEstado?.[2] || firstMatch(issuerBlock || flat, [/\bUF\s*[:\-]?\s*([A-Z]{2})\b/i, /LOCAL\s+E\s+DATA\s+DE\s+EMISS[ÃA]O\s*[:\-]?\s*[^.;\n]{3,60}?\s*-\s*([A-Z]{2})\s*-\s*\d{2}\/\d{2}\/\d{4}/i, /-\s*([A-Z]{2})\s*-\s*\d{2}\/\d{2}\/\d{4}/, /estado\s*[:\-]?\s*([A-Z]{2})\b/i, /\b([A-Z]{2})\b(?=\s*(?:CEP|cep|\d{5}-?\d{3}))/]),
      cep: finalClienteCep,
      telefone: clienteTelefone,
      email: clienteEmail,
      matricula_inss: beneficioMatricula,
      numero_beneficio: numeroBeneficio,
      especie_beneficio: especieBeneficio,
      banco_recepcao: contratoExtraido.banco_recebimento,
      origens: {
        cidade: layout.clienteCidade ? "INFERIDO: Quadro de praça/local de celebração" : null,
        estado: layout.clienteEstado ? "INFERIDO: UF do órgão emissor/local do contrato" : null,
        bairro: agiBairro || bairro ? "EXTRAÍDO" : "AUSENTE",
        cep: finalClienteCep ? "EXTRAÍDO" : "AUSENTE",
      },
    },
    correspondente: {
      email: correspondenteEmail,
      cidade: correspondenteCidade,
      observacoes: correspondenteEmail ? "Dado extraído do bloco de correspondente/originação; não deve ser atribuído ao contratante." : null,
    },
    assinatura: {
      presente: hasSignature,
      plataforma: platformIndependence?.dominio
        || (/Dossi[eê]\s+Probat[oó]rio\s+[–-]\s+Contrata[cç][aã]o\s+Digital\s+C6\s+Consig/i.test(flat)
          ? "Contratação Digital C6 Consig"
          : firstMatch(flat, [/(?:plataforma|provedor)\s*[:\-]?\s*([^,.;\n]{3,60})/i])),
      plataforma_independente: platformIndependence ? !platformIndependence.pertenceAoCredor : null,
      plataforma_nota: platformIndependence?.nota || null,
      tipo: hasSignature ? "Indeterminado" : "Ausente",
      nivel_legal_mp2200: nivelLegalPorRegra,
      base_legal: nivelLegalPorRegra.includes("MP 2.200-2") ? "MP 2.200-2/2001, art. 10, § 2º (assinatura eletrônica não certificada, admitida entre as partes que a aceitarem)" : null,
      certificadora_ac: firstMatch(flat, [/\bAC\s*[:\-]\s*([^,.;\n]{3,80})/, /Autoridade Certificadora\s*[:\-]?\s*([^,.;\n]{3,80})/i]),
      titular_certificado: layout.trilha?.titular || (name && !/\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}/.test(name) ? name : null),
      cpf_titular: cpf,
      data_hora_assinatura: layout.trilha?.dataAssinatura || signatureDateTime,
      validade_certificado_inicio: null,
      validade_certificado_fim: null,
      forma_aceite: structuredAcceptance || null,
      telefone_aceite: acceptancePhone,
      dispositivo: uaParsed,
      linha_do_tempo: acceptanceTimeline
        ? { ...acceptanceTimeline, duracao_total: formatDurationPt(acceptanceTimeline.totalSeconds), intervalo_primeiro_aceite: formatDurationPt(acceptanceTimeline.firstIntervalSeconds) }
        : null,
      metodos_autenticacao: [
        ...metodosRegistradosNaTrilha,
        biometriaRegistradaComoEvento ? "Biometria facial registrada como etapa do fluxo de contratação" : null,
      ].filter(Boolean),
      biometria_registrada_como_evento: biometriaRegistradaComoEvento,
      // D1: método de autenticação só é afirmado com trecho ancorado que o
      // descreva como etapa do fluxo. A regra anterior era busca por palavra
      // sobre o texto achatado e emitia "SMS Token" para dossiê sem a palavra
      // "token". O ajuste final da biometria, com o inventário de imagens, é
      // feito em analisarDocumento.js.
      metodos_descritos_no_fluxo: metodosDescritos.metodos,
      metodos_descritos_estado: metodosDescritos.estado,
      mencao_textual: layout.assinaturaEletronicaTexto || signatureText,
      assinatura_manual_textual: manualSignatureName ? `Campo "Por:" preenchido com ${manualSignatureName}. Isso não é assinatura digital/criptográfica incorporada ao PDF.` : null,
      codigo_autenticacao_declarado: codigoAutenticacao,
      codigo_autenticacao_origem: codigoAutenticacaoOrigem,
      codigo_autenticacao_estado: codigoAutenticacaoEstado,
      codigo_autenticacao_url_verificacao: codigoAutenticacao ? urlVerificacao : null,
      assinatura_criptografica: {
        estado: "AUSENTE",
        motivo: "A presença criptográfica é determinada pelos metadados/AcroForm do PDF, não por menção textual.",
      },
      hash_documento_assinado: hash,
      hash_declarado_estado: declaredAuthHashState,
      hash_declarado_conferivel: hasCheckableDeclaredHash,
      algoritmo_hash: hash?.length === 64 ? "SHA-256" : hash?.length === 40 ? "SHA-1" : hash?.length === 32 ? "MD5" : null,
      numero_serie_certificado: firstMatch(flat, [/(?:s[eé]rie\s+do\s+certificado|serial)\s*[:\-]?\s*([A-Z0-9.\-]{4,80})/i]),
      integridade_pos_assinatura: null,
      observacoes: lowText
        ? "Extração local encontrou pouco texto pesquisável. O documento aparenta depender de OCR/visão computacional para leitura completa."
        : manualSignatureName && !hasSignature
          ? "Há identificação textual no campo \"Por:\", mas não há assinatura eletrônica/digital nem assinatura criptográfica incorporada detectada no PDF."
          : "Extração local por texto do PDF. Revise manualmente os campos antes de uso em peça processual.",
    },
    geolocalizacao_assinatura: {
      presente: hasGeo || Boolean(layout.trilha?.latitude),
      latitude: coordenadaComoTexto(coordinates?.lat ?? layout.trilha?.latitude),
      longitude: coordenadaComoTexto(coordinates?.lon ?? layout.trilha?.longitude),
      endereco_declarado: declaredGeoAddress,
      precisao_metros: firstMatch(flat, [/precis[aã]o\s*[:\-]?\s*([\d,.]+)\s*m/i]),
      fonte: layout.trilha?.latitude ? "Dossiê de contratação (trilha de acesso)" : hasGeo ? "Texto extraído do PDF" : null,
      ip_associado: layout.trilha?.ipAcesso || null,
      data_hora: layout.trilha?.acessoApp || firstMatch(flat, [/(\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}(?::\d{2})?)/]),
    },
    cadeia_custodia: {
      resultado: "CADEIA DE CUSTÓDIA NÃO DEMONSTRADA",
      eliminatorios: {
        hash_declarado_emissor: hasCheckableDeclaredHash,
        provedor_assinatura_identificado: Boolean(structuredAcceptance && !/APP\s+CONSULTOR/i.test(structuredAcceptance)),
        carimbo_tempo_independente: false,
        registro_coleta_preservacao: false,
      },
      identificacao_signatario: Boolean(name || cpf),
      registro_ip: ipValues.length > 0,
      carimbo_tempo: /\d{2}\/\d{2}\/\d{4}\s+(?:às\s+)?\d{2}:\d{2}/i.test(flat),
      geolocalizacao: hasGeo,
      metodo_autenticacao: hasOperationalAuthRecord,
      hash_integridade: hasCheckableDeclaredHash,
      trilha_auditoria: hasAudit,
      evidencia_aceite: Boolean(structuredAcceptance || acceptancePhone || signatureDateTime || layout.assinaturaEletronicaTexto),
      mencao_aceite: /aceite|aceito|concordo|autoriza|autorizo|assinado\s+de\s+forma\s+eletr[oô]nica/i.test(flat),
      placar: {
        eliminatorios_presentes: [
          hasCheckableDeclaredHash,
          Boolean(structuredAcceptance && !/APP\s+CONSULTOR/i.test(structuredAcceptance)),
          false,
          false,
        ].filter(Boolean).length,
        eliminatorios_total: 4,
        auxiliares_presentes: [
          Boolean(name || cpf),
          ipValues.length > 0,
          Boolean(signatureDateTime),
          hasGeo,
          hasOperationalAuthRecord,
          hasAudit,
          /aceite|aceito|concordo|autoriza|autorizo|assinado\s+de\s+forma\s+eletr[oô]nica/i.test(flat),
        ].filter(Boolean).length,
        auxiliares_total: 7,
      },
      observacoes: "Cadeia de custódia avaliada por itens eliminatórios. Ausência de hash declarado pelo emissor, provedor verificável, carimbo de tempo independente ou registro de preservação impede conclusão técnica favorável.",
    },
    afericao_matematica: mathAudit,
    ips: ipRecords,
    trilha_acesso: auditTrail,
    achados_irregularidade: achados,
    evidencias_irregularidade: achados.map((issue) => `${issue.titulo}. ${issue.texto}`),
    observacoes_periciais: lowText
      ? "Laudo gerado em modo local, mas o PDF contém pouco texto pesquisável. Para resultado completo em documentos escaneados, aplique OCR prévio e envie novamente."
      : "Laudo gerado por extração textual local do PDF. A estrutura do relatório foi preservada, mas recomenda-se validação humana dos campos extraídos.",
  };
  extracted.rodape_pje = footer.removed;
  extracted.metadados_processuais = metadadosProcessuais;
  // Tabela "Bairro  Cidade  Estado  CEP" em colunas: corrige rótulo lido como
  // valor e preenche o que o padrão por rótulo não alcançou.
  const tabelaEndereco = enderecoPorColunas(text);
  if (tabelaEndereco && extracted.cliente) {
    for (const campo of ["bairro", "cidade", "estado", "cep"]) {
      const atual = extracted.cliente[campo];
      if (tabelaEndereco[campo] && (!atual || valorEhRotulo(atual))) {
        extracted.cliente[campo] = campo === "cidade" ? titleCaseName(tabelaEndereco[campo]) : tabelaEndereco[campo];
        extracted.cliente.origens = { ...(extracted.cliente.origens || {}), [campo]: "EXTRAÍDO: tabela em colunas do instrumento" };
      }
    }
  }
  for (const campo of ["bairro", "cidade", "estado"]) {
    if (extracted.cliente && valorEhRotulo(extracted.cliente[campo])) extracted.cliente[campo] = null;
  }
  // Credor "(iii)" e espécie de benefício com trecho de cláusula são capturas
  // soltas; ficam vazios em vez de aparecer no laudo como dado do contrato.
  if (extracted.contrato && extracted.contrato.credor_original && !/n[aã]o se aplica/i.test(extracted.contrato.credor_original) && !credorPlausivel(extracted.contrato.credor_original)) {
    extracted.contrato.credor_original = null;
  }
  if (extracted.cliente && extracted.cliente.especie_beneficio && !especieBeneficioPlausivel(extracted.cliente.especie_beneficio)) {
    extracted.cliente.especie_beneficio = null;
  }
  // Código de banco que só aparece no quadro de liberação é do banco que recebe
  // o crédito. Sem instituição resolvida pelo CNPJ, ele não pode virar código do
  // credor.
  const credito = contaDeCredito(flat);
  if (credito && extracted.contrato) {
    const c = extracted.contrato;
    if (c.codigo_banco_bacen === credito.compe && !bankByCnpj && !layout.codigoBancoBacen) {
      c.codigo_banco_bacen = null;
      c.codigo_banco_bacen_nota = `O código ${credito.compe} localizado no documento pertence ao banco da conta de crédito do valor liberado, não à instituição credora.`;
    }
    c.banco_recebimento = c.banco_recebimento || credito.banco;
    c.agencia = c.agencia || credito.agencia;
    c.conta_corrente = c.conta_corrente || credito.conta;
    if (extracted.cliente && !extracted.cliente.banco_recepcao) extracted.cliente.banco_recepcao = c.banco_recebimento;
  }
  // Endereço da sede, estipulante ou corretora não é residência do contratante:
  // usá-lo deslocaria todo o confronto geográfico para a sede do banco.
  if (extracted.cliente?.endereco && (enderecoNaoInformado(extracted.cliente.endereco) || enderecoInstitucional(flat, extracted.cliente.endereco))) {
    const motivo = enderecoNaoInformado(extracted.cliente.endereco)
      ? "DESCARTADO: o instrumento declara o endereço como não informado"
      : "DESCARTADO: endereço em contexto institucional (sede, estipulante ou corretora), não do contratante";
    extracted.cliente.endereco = null;
    extracted.cliente.origens = { ...(extracted.cliente.origens || {}), endereco: motivo };
  }
  if (extracted.cliente?.nome && /\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}/.test(extracted.cliente.nome)) {
    extracted.cliente.nome = null;
    extracted.cliente.origens = { ...(extracted.cliente.origens || {}), nome: "DESCARTADO: possível contaminação por rodapé do PJe" };
  }

  // Estado de cada campo de qualificação: não localizado, vazio no documento ou
  // suspeito. Os dois últimos são achados sobre o instrumento, não limites da
  // extração, e o laudo precisa dizer isso.
  if (extracted.cliente) {
    const estados = avaliarQualificacao(text, extracted.cliente);
    extracted.cliente.estados_campos = estados;
    if (estados.endereco?.estado === ESTADO_CAMPO.LOCALIZADO_VAZIO) {
      extracted.cliente.endereco = null;
      extracted.cliente.endereco_literal = estados.endereco.valor;
      extracted.cliente.origens = {
        ...(extracted.cliente.origens || {}),
        endereco: `LOCALIZADO E VAZIO: o instrumento registra "${estados.endereco.valor}"`,
      };
    }
    const partes = [];
    if (estados.rg?.estado === ESTADO_CAMPO.LOCALIZADO_SUSPEITO) {
      partes.push(`o documento de identidade preenchido como ${estados.rg.valor} (${estados.rg.motivo})`);
    }
    if (estados.cpf?.estado === ESTADO_CAMPO.LOCALIZADO_SUSPEITO) {
      partes.push(`o CPF preenchido como ${estados.cpf.valor} (${estados.cpf.motivo})`);
    }
    if (estados.endereco?.estado === ESTADO_CAMPO.LOCALIZADO_VAZIO) {
      partes.push(`o endereço registrado como "${estados.endereco.valor}"`);
    }
    if (partes.length) {
      const vazios = ["email", "ocupacao", "nome_social"]
        .filter((campo) => estados[campo]?.estado === ESTADO_CAMPO.LOCALIZADO_VAZIO)
        .map((campo) => ({ email: "e-mail", ocupacao: "ocupação", nome_social: "nome social" })[campo]);
      addIssue(
        "CAD4",
        "MÉDIA",
        "Qualificação do contratante com campos fictícios ou não informados",
        `A instituição formalizou a operação com ${partes.join(" e ")}${vazios.length ? `, além de ${vazios.join(", ")} em branco na proposta` : ""}. Esses campos limitam a conferência cadastral nesta cópia. Não identificam quem preencheu o cadastro nem demonstram, isoladamente, ausência de conferência ou fraude.`
      );
    }
  }

  // ── Fase 4: documentos lógicos, comprovante, seguro e trilha ──────────────
  const assinaturaPorDocumento = avaliarAssinaturaPorDocumento(segmentacao);
  extracted.documentos_logicos = segmentacao;
  if (extracted.assinatura) {
    extracted.assinatura.blocos_por_documento = assinaturaPorDocumento.resumo;
    extracted.assinatura.blocos_assinatura_total = assinaturaPorDocumento.resumo ? assinaturaPorDocumento.totalBlocos : null;
    // A menção textual sempre com o documento de origem: a legenda de uma
    // proposta de seguro não é assinatura da cédula.
    const mencao = extracted.assinatura.mencao_textual;
    if (mencao && segmentacao) {
      const bruto = text.search(new RegExp(mencao.slice(0, 30).replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+")));
      const doc = bruto >= 0 ? documentoDaPagina(segmentacao, paginaDoIndice(text, bruto)) : null;
      extracted.assinatura.mencao_textual_documento = doc ? `${doc.titulo}, pág. ${paginaDoIndice(text, bruto)}` : null;
    }
  }
  if (assinaturaPorDocumento.achado) addIssue(assinaturaPorDocumento.achado.codigo, assinaturaPorDocumento.achado.gravidade, assinaturaPorDocumento.achado.titulo, assinaturaPorDocumento.achado.texto);

  const provaDoCredito = avaliarComprovanteCredito({ texto: text, flat, segmentacao, contrato: contratoExtraido, cliente: extracted.cliente || {} });
  extracted.liberacao_credito = { declarada: provaDoCredito.liberacao, comprovante: provaDoCredito.comprovante };
  for (const a of provaDoCredito.achados) addIssue(a.codigo, a.gravidade, a.titulo, a.texto);

  const seguro = isCartaoConsignado ? null : extrairSeguroPrestamista({ texto: text, segmentacao, contrato: contratoExtraido });
  extracted.seguro_prestamista = seguro;
  for (const a of seguro?.achados || []) addIssue(a.codigo, a.gravidade, a.titulo, a.texto);

  const ufEmissao = firstMatch(flat, [/LOCAL\s+E\s+DATA\s+DE\s+EMISS[ÃA]O\s*:?\s*[^\n]{2,60}?\s-\s([A-Z]{2})\s-\s\d{2}\/\d{2}\/\d{4}/i]) || extracted.cliente?.estado || null;
  const trilhaEventos = analisarTrilhaEventos({
    texto: text,
    segmentacao,
    ufEmissao,
    dataHoraAssinatura: extracted.assinatura?.data_hora_assinatura || null,
    flat,
  });
  extracted.trilha_eventos = trilhaEventos ? { ...trilhaEventos, achados: undefined } : null;
  for (const a of trilhaEventos?.achados || []) addIssue(a.codigo, a.gravidade, a.titulo, a.texto);

  extracted.evidencias_irregularidade = achados.map((issue) => `${issue.titulo}. ${issue.texto}`);
  return extracted;
}
