/**
 * Verificação de endereços: os pares que o laudo confronta, dois a dois.
 *
 * ─── Por que pares, e não uma referência só ─────────────────────────────────
 *
 * O laudo media tudo a partir de uma referência única (a residência informada
 * na geração do laudo). Quando essa referência é recusada por conflito com o
 * instrumento, todas as distâncias sumiam e a verificação geográfica ficava
 * vazia, justamente no caso em que ela é mais necessária.
 *
 * Com pares, cada distância diz exatamente o que compara, e nenhuma delas
 * afirma domicílio. O endereço recusado continua sem virar referência, sem selo
 * favorável e sem quesito, mas a distância até o endereço do instrumento passa
 * a ser exibida: ela é a medida do próprio conflito.
 *
 * Os quatro pares:
 *   1. IP do dossiê        × endereço do instrumento
 *   2. endereço do laudo   × endereço do instrumento
 *   3. IP do dossiê        × endereço do laudo
 *   4. GPS da assinatura   × IP do dossiê (coordenadas do ato, sem endereço)
 */

import { haversineKm } from "./geoUtils.js";
import { distanciaKm, formatarDistancia } from "./distancia.js";

const ponto = (p) => (p && Number.isFinite(p.lat) && Number.isFinite(p.lon) ? p : null);

const PARES = [
  { id: "ip-x-instrumento", de: "ip", para: "instrumento", rotulo: "IP do dossiê × endereço do instrumento", papel: "instrumento" },
  { id: "laudo-x-instrumento", de: "laudo", para: "instrumento", rotulo: "Endereço informado no laudo × endereço do instrumento", papel: "instrumento" },
  { id: "ip-x-laudo", de: "ip", para: "laudo", rotulo: "IP do dossiê × endereço informado no laudo", papel: "laudo" },
  { id: "gps-x-ip", de: "gps", para: "ip", rotulo: "GPS da assinatura × IP do dossiê", papel: "gps" },
  // D3 · confronto B: não depende da residência e usa só o próprio instrumento.
  // Sobrevive à recusa da referência residencial, que é o ponto do defeito.
  { id: "gps-x-emissao", de: "gps", para: "emissao", rotulo: "GPS da assinatura × município de emissão declarado no instrumento", papel: "gps" },
];

/**
 * Método da distância, declarado na saída.
 *
 * O resumo anterior estimou "cerca de 38 km a leste da sede de Manaquiri", de
 * cabeça. Número sem origem não entra em laudo: ele sai do código, com a fórmula
 * e a base de coordenadas declaradas ao lado, para que qualquer um refaça a
 * conta. Foi esse tipo de número sem origem que produziu o problema do IMG3.
 */
export const METODO_DISTANCIA = {
  formula: "Haversine sobre esfera de raio 6.371 km",
  unidade: "km",
};

export function memoriaDoConfronto(metodo) {
  if (!metodo) return null;
  const ponto = (p) => `${p.rotulo || "ponto"} (${p.lat}, ${p.lon}); fonte: ${p.fonte || "não identificada no registro"}; precisão: ${p.precisao || "não informada"}`;
  return `${metodo.formula}. Origem: ${ponto(metodo.de)}. Destino: ${ponto(metodo.para)}. Referências municipais e por IP são aproximadas e não demonstram a presença física do aparelho.`;
}

/** Abaixo de 100 m entre dois geocodificados, o número exato não tem sentido. */
export function textoDistancia(km) {
  const n = distanciaKm(km);
  if (n === null) return null;
  return n < 0.1 ? "menos de 0,1 km" : formatarDistancia(n);
}

/**
 * @param {object} pontos { instrumento, laudo, ip, gps }, cada um `{lat, lon, rotulo, precisao}` ou null
 * @returns {{pontos: object, pares: object[]}}
 */
export function montarConfrontoEnderecos(pontos = {}) {
  const p = {
    instrumento: ponto(pontos.instrumento),
    laudo: ponto(pontos.laudo),
    ip: ponto(pontos.ip),
    gps: ponto(pontos.gps),
    emissao: ponto(pontos.emissao),
  };

  const pares = PARES.map((par) => {
    const a = p[par.de];
    const b = p[par.para];
    const km = a && b ? haversineKm(a.lat, a.lon, b.lat, b.lon) : null;
    const precisoes = [a?.precisao, b?.precisao].filter(Boolean);
    const metodo = km === null ? null : {
      ...METODO_DISTANCIA,
      de: { rotulo: a.rotulo || null, lat: a.lat, lon: a.lon, precisao: a.precisao || null, fonte: a.fonte || null },
      para: { rotulo: b.rotulo || null, lat: b.lat, lon: b.lon, precisao: b.precisao || null, fonte: b.fonte || null },
    };
    return {
      id: par.id,
      rotulo: par.rotulo,
      papel: par.papel,
      km: distanciaKm(km),
      texto: textoDistancia(km),
      // Sem os dois pontos, o laudo diz qual falta, em vez de omitir o par.
      indisponivel: km === null ? [!a ? par.de : null, !b ? par.para : null].filter(Boolean) : null,
      precisao: precisoes.includes("municipio") ? "municipio" : precisoes.includes("ip") ? "ip" : precisoes[0] || null,
      // A base de cada ponto viaja com a distância: quem confere o número sabe
      // de onde saíram as duas coordenadas e por qual fórmula.
      metodo,
      memoria_calculo: memoriaDoConfronto(metodo),
    };
  });

  return { pontos: p, pares };
}

const NOME_DO_PONTO = {
  instrumento: "endereço do instrumento",
  laudo: "endereço informado na geração do laudo",
  ip: "endereço do IP do dossiê",
  gps: "GPS da assinatura",
  emissao: "município de emissão declarado no instrumento",
};

/** "endereço do instrumento não localizado" para o par que não pôde ser medido. */
export function descreverIndisponibilidade(par) {
  if (!par?.indisponivel?.length) return null;
  return `${par.indisponivel.map((k) => NOME_DO_PONTO[k]).join(" e ")} não disponível para confronto`;
}
