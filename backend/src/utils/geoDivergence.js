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
      "A origem da conexão é geograficamente incompatível com o local informado, em ordem de grandeza que a margem de erro da geolocalização por IP não alcança. Trata-se de indício de que o ato não partiu de onde o documento sugere, a ser confrontado com a data e hora do registro e com a versão do cliente.",
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

/*
 * ─── Confronto 2 precisa da sua própria régua ─────────────────────────────────
 *
 * O § 5.2 vinha usando `riskFromDistance` (faixas de 50 / 300 / 1000 km), que
 * foi calibrada para a geolocalização por IP. Aplicada ao confronto entre a
 * residência e o GPS declarado no documento, ela contradiz o próprio texto da
 * seção: 1,47 km saía rotulado "RISCO BAIXO" ao lado da frase "uma divergência
 * de poucos quilômetros já é significativa" — e 45 km entre o local declarado da
 * assinatura e a casa do contratante também sairia como "RISCO BAIXO", quando é
 * um achado central.
 *
 * Aqui os dois pontos têm precisão métrica: o GPS do log de assinatura e a
 * coordenada confirmada pelo operador. Não existe a margem de dezenas de
 * quilômetros que justifica a régua do IP, então as faixas são uma ordem de
 * grandeza mais estreitas.
 */
const FAIXAS_DECLARADO = [
  {
    // Margem que absorve GPS de aparelho sob cobertura ruim e — quando a
    // referência veio de geocodificação — o erro do próprio geocodificador,
    // que em zona rural facilmente passa de 1 km.
    ateKm: 2,
    nivel: "compativel",
    rotulo: "COMPATÍVEL",
    tom: "ok",
    sintese:
      "O documento situa a assinatura praticamente no mesmo local da residência informada. A diferença está dentro da margem dos próprios instrumentos de medição.",
  },
  {
    ateKm: 15,
    nivel: "atencao",
    rotulo: "ATENÇÃO",
    tom: "warn",
    sintese:
      "O local declarado fica na mesma região da residência, mas não coincide com ela. É compatível com deslocamento cotidiano do contratante e, isoladamente, não sustenta conclusão.",
  },
  {
    ateKm: 60,
    nivel: "relevante",
    rotulo: "DIVERGÊNCIA RELEVANTE",
    tom: "warn",
    sintese:
      "O documento declara que o ato ocorreu em localidade distinta da residência do contratante. Como ambas as coordenadas têm precisão métrica, a diferença não se explica por imprecisão de medição e deve ser confrontada com a versão do cliente sobre onde esteve na data e hora do registro.",
  },
  {
    ateKm: Infinity,
    nivel: "grave",
    rotulo: "DIVERGÊNCIA GRAVE",
    tom: "danger",
    sintese:
      "O local que o próprio documento registra como o da assinatura é geograficamente incompatível com a residência do contratante. Diferentemente do confronto por IP, aqui não há margem de operadora a invocar: a coordenada foi registrada pelo instrumento de assinatura. Exige esclarecimento sobre as circunstâncias da contratação.",
  },
];

/**
 * Classifica a distância entre a residência informada e a geolocalização que o
 * documento declara para a assinatura (§ 5.2).
 *
 * @param {number|null|undefined} km distância Haversine entre os dois pontos
 * @param {{referenciaConfirmada?: boolean}} [opts]
 */
export function classifyDeclaredDivergence(km, { referenciaConfirmada = false } = {}) {
  if (km == null || !Number.isFinite(km)) return null;
  const faixa = FAIXAS_DECLARADO.find((f) => km <= f.ateKm);

  // Sem coordenada confirmada pelo operador, a referência é um ponto
  // geocodificado — e o laudo não pode afirmar precisão métrica dos DOIS lados.
  const ressalva = referenciaConfirmada
    ? null
    : "A referência não foi confirmada pelo operador: foi obtida por geocodificação do endereço informado, cuja imprecisão pode responder por parte da diferença acima.";

  return { ...faixa, km, ressalva };
}

/**
 * Régua de distância suprimida pelo histórico do IP (motor pericial).
 *
 * Quando o RIPEstat mostra que o bloco mudou de detentor depois do ato, ou que
 * pertence a marketplace de aluguel de IPv4, a geolocalização ATUAL não descreve
 * o acesso na data analisada. Manter "DIVERGÊNCIA GRAVE" nesse caso afirmaria uma
 * origem estrangeira que, na data do contrato, era uma operadora brasileira.
 *
 * O número em km continua visível; o que muda é o veredito, que cede lugar à
 * nota de proveniência do endereço.
 */
export function aplicarHistoricoDoIp(divergencia, historico) {
  if (!divergencia || !historico?.suppressDistanceRisk) return divergencia;
  return {
    ...divergencia,
    nivel: "suprimido",
    rotulo: historico.label || "REGISTRO ALTERADO",
    tom: "neutral",
    sintese:
      historico.note ||
      "O registro do bloco de IP foi alterado depois do ato; a geolocalização atual não descreve o acesso na data analisada.",
    ressalva:
      "A distância acima usa a geolocalização atual do bloco e não serve como indício de origem do ato.",
    suprimidoPorHistorico: true,
  };
}
