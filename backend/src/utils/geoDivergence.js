/**
 * Classificação da divergência geográfica entre a origem do IP e o ponto de
 * referência informado/confirmado pelo operador.
 *
 * ─── O que a geolocalização por IP mede, e o que ela NÃO mede ────────────────
 *
 * Um endereço IP não carrega coordenada. A localização vem de bases que mapeiam
 * blocos de IP para o ponto de PRESENÇA da operadora — o roteador de saída, não
 * o aparelho. Em rede móvel brasileira, com CGNAT e blocos IPv6 alocados por
 * região, o ponto devolvido tende a ser a capital ou o centro de operação do
 * estado, ainda que o usuário esteja a centenas de quilômetros dali.
 *
 * A consequência prática para o laudo: uma divergência de dezenas de
 * quilômetros é ESPERADA e não indica nada. O que tem valor probatório é a
 * divergência de ordem de grandeza — outro estado, outra região —, e mesmo
 * essa é indício, nunca prova. É por isso que cada faixa abaixo vem com a
 * leitura pericial correspondente, em vez de um rótulo solto de "risco".
 *
 * A régua segue a lógica de proporcionalidade adotada na doutrina de
 * computação forense: o peso do indício cresce com a incompatibilidade
 * geográfica, e a conclusão exige confronto com data/hora, entrevista do cliente
 * e localização do correspondente bancário.
 */

/** Faixas em km, da mais branda para a mais grave. */
const FAIXAS = [
  {
    ateKm: 60,
    nivel: "compativel",
    rotulo: "COMPATÍVEL",
    tom: "ok",
    sintese:
      "A origem do IP fica dentro da margem esperada para geolocalização de operadora. Não há incompatibilidade a apontar.",
  },
  {
    ateKm: 150,
    nivel: "atencao",
    rotulo: "ATENÇÃO",
    tom: "warn",
    sintese:
      "A distância excede o raio típico de imprecisão urbana, mas ainda é explicável por roteamento de operadora ou deslocamento rotineiro. Isoladamente, não sustenta conclusão.",
  },
  {
    ateKm: 500,
    nivel: "relevante",
    rotulo: "DIVERGÊNCIA RELEVANTE",
    tom: "warn",
    sintese:
      "A conexão partiu de região distinta da informada. A imprecisão da geolocalização por IP não explica sozinha uma diferença dessa ordem, e o ponto merece esclarecimento da instituição.",
  },
  {
    ateKm: Infinity,
    nivel: "grave",
    rotulo: "DIVERGÊNCIA GRAVE",
    tom: "danger",
    sintese:
      "A origem da conexão é geograficamente incompatível com o local informado, em ordem de grandeza que a margem de erro da geolocalização por IP não alcança. Indício de que o ato não partiu de onde o documento sugere — a ser confrontado com a data/hora do registro e com a versão do cliente.",
  },
];

/**
 * @param {number|null|undefined} km distância Haversine entre os dois pontos
 * @returns {{nivel: string, rotulo: string, tom: string, sintese: string, km: number}|null}
 */
export function classifyIpDivergence(km) {
  if (km == null || !Number.isFinite(km)) return null;
  const faixa = FAIXAS.find((f) => km <= f.ateKm);
  return { ...faixa, km };
}

/**
 * Redação do confronto entre a origem do IP e o ponto de referência, para o § 6.
 *
 * `referenciaConfirmada` distingue os dois cenários que o operador pode ter
 * produzido: coordenada confirmada por ele (padrão-ouro) ou endereço
 * geocodificado automaticamente. A força do indício depende disso — comparar
 * contra um centroide de cidade não permite as mesmas afirmações que comparar
 * contra um ponto conferido por humano.
 */
export function describeIpDivergence({ km, referenciaConfirmada, referenciaRotulo }) {
  const c = classifyIpDivergence(km);
  if (!c) return null;

  const ressalva = referenciaConfirmada
    ? "A referência é coordenada confirmada pelo operador, o que dá ao confronto o maior grau de precisão disponível neste laudo."
    : `A referência (${referenciaRotulo || "endereço informado"}) foi obtida por geocodificação automática e carrega imprecisão própria, que se soma à da geolocalização por IP.`;

  return { ...c, ressalva };
}
