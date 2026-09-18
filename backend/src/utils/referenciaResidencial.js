import { haversineKm } from "./geoUtils.js";

/**
 * Validação do endereço de referência residencial antes do confronto do § 5.
 *
 * ─── O defeito que motivou ───────────────────────────────────────────────────
 *
 * No dossiê C6 o operador digitou o endereço do escritório (Pedro II/PI) no
 * campo da residência. O instrumento qualificava a contratante em Manaquiri/AM,
 * e o laudo extraiu isso corretamente no § 3. Ainda assim, o endereço manual
 * tinha precedência incondicional: o laudo mediu 2.111 km, deu selo de risco
 * crítico, desenhou dois mapas e escreveu no quesito ao juízo que a contratante
 * morava no Piauí. O réu derrubaria tudo exibindo a pág. 3 da própria cédula.
 *
 * ─── A regra ─────────────────────────────────────────────────────────────────
 *
 * Endereço manual em outra UF, ou a mais de `GEO_LIMIAR_CONFLITO_KM` da sede do
 * município extraído, é CONFLITO. Conflito recusa o confronto por padrão. O
 * operador pode liberar declarando que o endereço do instrumento é contestado
 * e escrevendo o motivo, porque há casos reais em que o cadastro do contrato é
 * justamente o dado fraudado. A justificativa vai impressa no laudo.
 */

export const ESTADO_CONFRONTO = {
  DISPONIVEL: "DISPONIVEL",
  RECUSADO_CONFLITO: "RECUSADO_CONFLITO",
  LIBERADO_PELO_OPERADOR: "LIBERADO_PELO_OPERADOR",
  INDISPONIVEL_NAO_INFORMADO: "INDISPONIVEL_NAO_INFORMADO",
};

const UFS = ["AC", "AL", "AM", "AP", "BA", "CE", "DF", "ES", "GO", "MA", "MG", "MS", "MT", "PA", "PB", "PE", "PI", "PR", "RJ", "RN", "RO", "RR", "RS", "SC", "SE", "SP", "TO"];

export function limiarConflitoKm() {
  const valor = Number(process.env.GEO_LIMIAR_CONFLITO_KM);
  return Number.isFinite(valor) && valor > 0 ? valor : 100;
}

/** UF escrita num endereço livre ("..., Pedro II - PI - 64255-000"). */
export function ufDoTexto(texto) {
  const { ufCandidata } = camposDaReferencia(texto);
  return UFS.includes(ufCandidata) ? ufCandidata : null;
}

/** Só interpreta UF/CEP em posição de campo, nunca palavras do logradouro. */
export function camposDaReferencia(endereco) {
  const texto = String(endereco || "").trim();
  const cepRotulado = texto.match(/\bCEP\s*[:=]?\s*([\d.\-]+)\b/i);
  const cepFinal = texto.match(/(?:^|[,;\s])((?:\d{5}|\d{2}\.\d{3})-\d+|\d{6,})\s*$/);
  const cepCandidato = cepRotulado?.[1] || cepFinal?.[1] || null;
  const semCep = texto.replace(/\bCEP\s*[:=]?\s*[\d.\-]*\s*$/i, "")
    .replace(/(?:[,;\s])(?:\d{5}|\d{2}\.\d{3})-\d+\s*$/, "")
    .replace(/(?:[,;\s])\d{6,}\s*$/, "").replace(/[,;\s–-]+$/, "");
  const ufRotulada = texto.match(/\bUF\s*[:=]?\s*([A-Za-z]{2})\b/i);
  const ufFinal = semCep.match(/(?:[,;\/–-]\s*)([A-Za-z]{2})\.?$/);
  // Formato sem vírgula: só aceita uma UF conhecida, sem presumir que "II"
  // em "Pedro II" ou "Av" no logradouro seja um campo de estado inválido.
  const ufConhecida = semCep.match(/\s+([A-Za-z]{2})\.?$/)?.[1]?.toUpperCase();
  const ufCandidata = (ufRotulada?.[1] || ufFinal?.[1] || (UFS.includes(ufConhecida) ? ufConhecida : "")).toUpperCase() || null;
  return { ufCandidata, cepCandidato, temRotuloCep: /\bCEP\b/i.test(texto), cep: cepCandidato?.replace(/\D/g, "") || null };
}

/** Comparação local, antes de perícia, consultas externas e débito de crédito. */
export function compararReferenciaComInstrumento(cliente = {}, enderecoManual) {
  const campos = camposDaReferencia(enderecoManual);
  const instrumento = { cidade: cliente.cidade || null, uf: cliente.estado?.toUpperCase() || null, cep: cliente.cep || null };
  const manual = { uf: ufDoTexto(enderecoManual), texto: enderecoManual || null, cep: campos.cep };
  if (manual.uf && instrumento.uf && manual.uf !== instrumento.uf) {
    return { motivo: "UF", manual, instrumento, km: null, descricao: `conflito entre endereço informado (${manual.uf}) e endereço extraído do instrumento (${instrumento.uf})` };
  }
  const cepInstrumento = String(instrumento.cep || "").replace(/\D/g, "");
  if (campos.cep?.length === 8 && cepInstrumento.length === 8 && campos.cep !== cepInstrumento) {
    return { motivo: "CEP", manual, instrumento, km: null, descricao: `CEP informado (${campos.cep}) diferente do CEP extraído do instrumento (${cepInstrumento}); confira qual referência deve ser usada` };
  }
  return null;
}

/** Uma linha legível para cidade/UF. */
function lugar({ cidade, uf }) {
  return [cidade, uf].filter(Boolean).join("/") || "local não identificado";
}

/**
 * @param {object} args
 * @param {object} args.cliente `extracted.cliente`
 * @param {string} [args.enderecoManual] texto digitado pelo operador
 * @param {{lat:number, lon:number}|null} args.pontoManual coordenada adotada para a referência manual
 * @param {object|null} [args.geoManual] retorno do geocodificador para o endereço manual
 * @param {{geocodeAddress: Function, reverseGeocode: Function}} args.servicos
 * @returns {Promise<object|null>} conflito, ou null quando compatível ou não verificável
 */
export async function avaliarConflitoReferencia({ cliente = {}, enderecoManual, pontoManual, geoManual = null, servicos }) {
  const preliminar = compararReferenciaComInstrumento(cliente, enderecoManual);
  if (preliminar) return preliminar;
  const instrumento = {
    cidade: cliente.cidade || null,
    uf: cliente.estado ? String(cliente.estado).toUpperCase() : null,
    cep: cliente.cep || null,
  };
  if (!instrumento.cidade && !instrumento.uf && !instrumento.cep) return null;

  let ufManual = geoManual?.matchedUf || null;
  let cidadeManual = geoManual?.matchedCity || null;
  if (!ufManual && pontoManual && servicos?.reverseGeocode) {
    const reverso = await servicos.reverseGeocode(pontoManual.lat, pontoManual.lon).catch(() => null);
    ufManual = reverso?.uf || null;
    cidadeManual = cidadeManual || reverso?.municipio || null;
  }
  ufManual = ufManual ? String(ufManual).toUpperCase() : ufDoTexto(enderecoManual);
  const manual = { cidade: cidadeManual, uf: ufManual, texto: enderecoManual || null };

  if (instrumento.uf && manual.uf && instrumento.uf !== manual.uf) {
    return {
      motivo: "UF",
      manual,
      instrumento,
      km: null,
      descricao: `conflito entre endereço informado (${manual.uf}) e endereço extraído do instrumento (${instrumento.uf})`,
    };
  }

  if (pontoManual && instrumento.cidade && servicos?.geocodeAddress) {
    const consulta = [instrumento.cidade, instrumento.uf, instrumento.cep].filter(Boolean).join(", ");
    const sede = await servicos.geocodeAddress(consulta).catch(() => null);
    if (sede && Number.isFinite(sede.lat) && Number.isFinite(sede.lon)) {
      const km = haversineKm(pontoManual.lat, pontoManual.lon, sede.lat, sede.lon);
      const limiar = limiarConflitoKm();
      if (km > limiar) {
        return {
          motivo: "DISTANCIA",
          manual,
          instrumento,
          km,
          descricao: `o endereço informado fica a ${km.toFixed(0)} km de ${lugar(instrumento)}, município que o instrumento registra para o contratante (limite de ${limiar} km)`,
        };
      }
    }
  }

  // Mesma UF e cidade nominalmente diferente não é conflito: município vizinho
  // é residência plausível. Quem decide é a distância acima.
  return null;
}

/**
 * Texto do estado do confronto, usado igualmente pelo PDF e pela tela.
 */
export function descreverEstadoConfronto(home) {
  if (!home?.estado_confronto) return null;
  const inst = home.instrumento || home.conflito?.instrumento || {};
  const instrumentoTexto = [inst.cidade, inst.uf, inst.cep].filter(Boolean).join(", ") || "não identificados";
  switch (home.estado_confronto) {
    case ESTADO_CONFRONTO.RECUSADO_CONFLITO: {
      // MED-01 (rodada 2): um único motivo. Quando o instrumento também não traz
      // o endereço, a orientação é essa lacuna, e não "corrigir a grafia".
      const semEnderecoNoInstrumento = home.endereco_nao_informado
        ? ` O instrumento registra o endereço do contratante como "${home.endereco_literal || "não informado"}", de modo que o confronto de residência não pode ser feito a partir deste arquivo; essa lacuna é atribuível à instituição.`
        : "";
      return `CONFRONTO RECUSADO: ${home.conflito?.descricao || "conflito entre o endereço informado e o do instrumento"}. Nenhuma distância, mapa ou selo de risco é calculado a partir de uma referência que o próprio instrumento contradiz. Endereço informado: ${home.conflito?.manual?.texto || "coordenada informada pelo operador"}. Cidade, UF e CEP do instrumento: ${instrumentoTexto}.${semEnderecoNoInstrumento}`;
    }
    case ESTADO_CONFRONTO.LIBERADO_PELO_OPERADOR:
      return `REFERÊNCIA LIBERADA PELO OPERADOR: ${home.conflito?.descricao || "conflito entre o endereço informado e o do instrumento"}. O operador declarou contestado o endereço do instrumento, com a seguinte justificativa: "${home.justificativa}". As distâncias abaixo usam o endereço informado e devem ser lidas com essa ressalva.`;
    case ESTADO_CONFRONTO.INDISPONIVEL_NAO_INFORMADO:
      return `CONFRONTO INDISPONÍVEL: o instrumento registra o endereço do contratante como "${home.endereco_literal || "não informado"}". Cidade, UF e CEP do instrumento: ${instrumentoTexto}. O confronto de residência não é possível porque a instituição não registrou o endereço do contratante, o que é, por si, falha de qualificação no documento.`;
    default:
      return null;
  }
}

/*
 * ─── D3 · validação da referência informada, na entrada ──────────────────────
 *
 * O dossiê C6 foi processado inteiro e só então o confronto foi recusado, porque
 * o operador digitou o endereço do escritório (Pedro II/PI) no campo da
 * residência. O custo de descobrir tarde é a seção inteira mais o tempo de
 * execução.
 *
 * A validação se divide em duas, porque as duas coisas são verificáveis em
 * momentos diferentes:
 *
 *   1. FORMA, aqui: a UF escrita existe? o CEP tem oito dígitos? Isso não
 *      depende do instrumento e roda na entrada, antes de debitar crédito.
 *   2. CONFLITO com o instrumento: depende da UF extraída do PDF, e por isso
 *      não pode acontecer antes de abrir o arquivo. Roda antes do
 *      enriquecimento, em `avaliarConflitoReferencia`.
 *
 * Confundir as duas foi o que levou a ordem a pedir "validação na entrada" para
 * algo que precisa do documento aberto. O que dá para antecipar, antecipa-se.
 */

/**
 * Confere a forma da referência informada pelo operador.
 *
 * @param {string} enderecoManual texto digitado
 * @returns {{ok: true}|{ok: false, code: string, error: string}}
 */
export function validarFormaDaReferencia(enderecoManual) {
  const texto = String(enderecoManual || "").trim();
  if (!texto) return { ok: true };

  // Sigla de dois caracteres que não é UF: quase sempre erro de digitação, e o
  // confronto inteiro depende dela.
  const { ufCandidata, cepCandidato, cep, temRotuloCep } = camposDaReferencia(texto);
  if (ufCandidata && !UFS.includes(ufCandidata)) {
    return {
      ok: false,
      code: "UF_INVALIDA",
      error: `A referência informada traz "${ufCandidata}" no campo de estado, e essa sigla não corresponde a nenhuma UF. Corrija o endereço antes de enviar.`,
    };
  }

  if ((cepCandidato || temRotuloCep) && cep?.length !== 8) {
    return {
      ok: false,
      code: "CEP_INVALIDO",
      error: `O CEP informado${cepCandidato ? ` (${cepCandidato})` : ""} deve ter oito dígitos (formato 00000-000). Corrija ou remova o campo antes de enviar.`,
    };
  }

  return { ok: true };
}
