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
  const tokens = String(texto || "").toUpperCase().match(/(?:^|[\s,\-\/])([A-Z]{2})(?=$|[\s,\-\/.])/g) || [];
  const ufs = tokens.map((t) => t.replace(/[\s,\-\/]/g, "")).filter((t) => UFS.includes(t));
  return ufs.at(-1) || null;
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
