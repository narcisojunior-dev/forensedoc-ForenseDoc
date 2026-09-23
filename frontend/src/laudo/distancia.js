/**
 * Distância geodésica como valor opcional, e o estado único do confronto
 * geográfico que todas as seções do laudo leem.
 *
 * ─── O defeito que motivou (CRIT-01 da rodada 2) ─────────────────────────────
 *
 * Com o confronto de residência recusado, as distâncias ficavam corretamente
 * nulas. O sumário executivo fazia `Number(contractGeo.distance)`, e
 * `Number(null)` é 0: saiu em selo verde "GPS da assinatura próximo à referência
 * residencial, a 0,00 km", favorável ao banco, na mesma rodada em que os §§ 5 e
 * 6 declaravam a distância impossível de aferir. A capa do PDF fazia o mesmo com
 * o índice de incompatibilidade ("compatível com o domicílio").
 *
 * Regra: distância é número finito ou `null`. Nunca `Number()` sobre o campo.
 * Cópia de backend/src/utils/distancia.js: manter as duas iguais.
 */

/** Número finito e não negativo, ou null. `null`, `undefined` e "" são ausência. */
export function distanciaKm(valor) {
  if (valor === null || valor === undefined || valor === "") return null;
  const n = typeof valor === "number" ? valor : Number(String(valor).replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** "12,5 km" ou null. Quem recebe null suprime o item, não o formata. */
export function formatarDistancia(valor) {
  const km = distanciaKm(valor);
  if (km === null) return null;
  if (km < 1) return `${km.toFixed(2).replace(".", ",")} km`;
  return `${km.toLocaleString("pt-BR", { maximumFractionDigits: km < 100 ? 1 : 0 })} km`;
}

/**
 * Zero exato entre duas fontes independentes (geocodificador e GPS, provedor de
 * IP e geocodificador) não ocorre na prática: indica ponto copiado de uma fonte
 * para a outra, ou dado mal formado. Sinaliza, nunca vira selo.
 */
export function distanciaSuspeita(valor) {
  return distanciaKm(valor) === 0;
}

export const STATUS_CONFRONTO = {
  CALCULADO: "CALCULADO",
  RECUSADO_CONFLITO: "RECUSADO_CONFLITO",
  INDISPONIVEL_NAO_INFORMADO: "INDISPONIVEL_NAO_INFORMADO",
  SEM_REFERENCIA: "SEM_REFERENCIA",
  SEM_PONTOS: "SEM_PONTOS",
  REFERENCIA_MUNICIPAL: "REFERENCIA_MUNICIPAL",
};

const MOTIVOS = {
  RECUSADO_CONFLITO: "confronto de residência recusado: o endereço informado conflita com o do instrumento",
  INDISPONIVEL_NAO_INFORMADO: "confronto de residência indisponível: o instrumento registra o endereço do contratante como não informado",
  SEM_REFERENCIA: "sem coordenada de referência residencial",
  SEM_PONTOS: "sem coordenada de assinatura nem de IP para confrontar com a residência",
  REFERENCIA_MUNICIPAL: "referência residencial resolvida apenas em nível de município, e os pontos do ato caem nesse mesmo município: a distância até o centroide não mede nada e não é aferida",
};

/** Nomes de município iguais, sem acento, caixa ou espaço extra. (Cópia de backend/src/utils/distancia.js.) */
export function mesmoMunicipio(a, b) {
  const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
  return Boolean(a && b && norm(a) === norm(b));
}

export function referenciaMunicipal(home = {}) {
  return ["city", "municipio"].includes(String(home?.geo?.precision || ""));
}

/**
 * Estado canônico do confronto com a residência.
 *
 * `gps_ip` fica fora do status: a distância entre o GPS da assinatura e o IP não
 * depende da residência e continua válida quando ela é recusada.
 *
 * @param {object} result resultado da análise (home, contractGeo, ipAnalysis)
 */
export function montarConfrontoGeografico(result = {}) {
  const home = result.home || {};
  const ips = result.ipAnalysis || [];
  const gpsInstrumento = distanciaKm(result.contractGeo?.distanceToInstrumento);
  const ipsInstrumento = ips.map((ip) => ({ endereco: ip.endereco || null, km: distanciaKm(ip.distanceToInstrumento) }));
  const divergenciaCadastral = distanciaKm(home.distancia_divergencia_cadastral);

  const municipal = referenciaMunicipal(home);
  const cidadeReferencia = home.geo?.matchedCity || home.instrumento?.cidade || null;
  const notas = [];
  let gps = distanciaKm(result.contractGeo?.distance);
  if (municipal && gps !== null && mesmoMunicipio(result.contractGeo?.municipio, cidadeReferencia)) {
    notas.push(`GPS da assinatura no mesmo município da referência (${cidadeReferencia}); referência resolvida em nível de município, distância não aferida`);
    gps = null;
  }
  const ipsResidencia = ips.map((ip) => {
    const km = distanciaKm(ip.distance);
    if (municipal && km !== null && mesmoMunicipio(ip.geo?.city, cidadeReferencia)) {
      notas.push(`IP ${ip.endereco || ""} localizado no mesmo município da referência (${cidadeReferencia}); distância não aferida`);
      return { endereco: ip.endereco || null, km: null, mesmo_municipio: true };
    }
    return { endereco: ip.endereco || null, km };
  });

  let status;
  if (home.estado_confronto === "RECUSADO_CONFLITO" || home.estado_confronto === "INDISPONIVEL_NAO_INFORMADO") {
    status = home.estado_confronto;
  } else if (!home.geo || !Number.isFinite(home.geo.lat) || !Number.isFinite(home.geo.lon)) {
    status = STATUS_CONFRONTO.SEM_REFERENCIA;
  } else if (gps === null && ipsResidencia.every((ip) => ip.km === null)) {
    status = notas.length ? STATUS_CONFRONTO.REFERENCIA_MUNICIPAL : STATUS_CONFRONTO.SEM_PONTOS;
  } else {
    status = STATUS_CONFRONTO.CALCULADO;
  }
  const calculado = status === STATUS_CONFRONTO.CALCULADO;
  const gpsIp = ips.map((ip) => distanciaKm(ip.distanceToSignature)).find((km) => km !== null) ?? null;

  return {
    status,
    referencia_municipal: municipal,
    notas,
    motivo: calculado ? null : (status === STATUS_CONFRONTO.REFERENCIA_MUNICIPAL ? MOTIVOS[status] : home.alerta || MOTIVOS[status]),
    distancias: {
      gps_residencia: calculado ? gps : null,
      gps_instrumento: gpsInstrumento,
      ips_residencia: calculado ? ipsResidencia : ipsResidencia.map((ip) => ({ ...ip, km: null })),
      ips_instrumento: ipsInstrumento,
      divergencia_cadastral: divergenciaCadastral,
    },
    gps_ip: gpsIp,
    suspeitas: calculado
      ? [gps, ...ipsResidencia.map((ip) => ip.km)].filter((km) => distanciaSuspeita(km)).length
      : 0,
  };
}
