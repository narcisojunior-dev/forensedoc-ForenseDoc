/**
 * Regime de autorização do consignado em benefício do INSS.
 *
 * A régua da perícia muda com a data do contrato. Até 30/11/2022 vale a IN
 * INSS/PRES 28/2008. De 1º/12/2022 em diante, a IN PRES/INSS 138/2022, em que a
 * selfie é colhida e guardada pela própria instituição, sem validação estatal. A
 * partir de maio de 2026 a autorização passou a ser dada no Meu INSS, com
 * biometria facial e validação de vivacidade, em etapa distinta da assinatura
 * com o banco. A partir da IN PRES/INSS 213/2026 o beneficiário sem biometria
 * nas bases oficiais pode autorizar pela conta gov.br.
 *
 * Marcos e dispositivos com `conferido: false` vieram de fonte secundária. O
 * laudo enquadra o contrato, avisa que o enquadramento depende da conferência
 * no DOU e não cita artigo que o jurídico não confirmou.
 */

export const MARCOS_INSS = {
  IN_138: { inicio: "2022-12-01", norma: "IN PRES/INSS nº 138/2022", conferido: true },
  MEU_INSS: {
    inicio: "2026-05-01",
    norma: null,
    descricao: "Norma do INSS de maio de 2026 sobre autorização no Meu INSS (número a confirmar no DOU)",
    conferido: false,
  },
  IN_213: { inicio: "2026-08-17", norma: "IN PRES/INSS nº 213/2026", conferido: false },
};

export const REGIMES = {
  IN_28_2008: "Regime anterior à IN PRES/INSS nº 138/2022 (IN INSS/PRES nº 28/2008)",
  IN_138_SELFIE_BANCO: "Selfie colhida e guardada pela instituição, sem validação estatal (IN PRES/INSS nº 138/2022)",
  MEU_INSS_BIOMETRIA: "Autorização no Meu INSS com biometria facial e validação de vivacidade",
  IN_213_VIA_DUPLA: "Autorização no Meu INSS por biometria facial ou, sem biometria nas bases oficiais, pela conta gov.br",
  INDETERMINADO: "Regime não determinável: data do contrato não localizada",
};

/** Dispositivos da IN 138 que o laudo só cita pelo número depois de conferidos. */
export const DISPOSITIVOS_IN138 = {
  LOCAL_DOMICILIO: { artigo: "art. 5º, VIII", conferido: false },
  DEMONSTRATIVO_PREVIO: { artigo: "art. 5º, § 9º", conferido: false },
};

/** Vedação de consignado nos primeiros dias do benefício, a partir do marco indicado. */
export const REGRA_DIB = { dias: 90, marco: "IN_213" };

export const REGIMES_COM_IN138 = new Set(["IN_138_SELFIE_BANCO", "MEU_INSS_BIOMETRIA", "IN_213_VIA_DUPLA"]);
export const REGIMES_MEU_INSS = new Set(["MEU_INSS_BIOMETRIA", "IN_213_VIA_DUPLA"]);

export const ROTULOS_VIA = {
  FACIAL: "Biometria facial no Meu INSS",
  GOVBR: "Conta gov.br com validação dos dados bancários",
  AMBIGUA: "Não identificada: o dossiê menciona as duas vias",
};

export const NOTA_OFICIO_INSS =
  "O registro da autorização no Meu INSS é mantido pelo INSS e pela Dataprev e deve ser requisitado por ofício. O que a instituição juntar sozinha não o substitui.";

const JANELA_FRONTEIRA_DIAS = 31;
const DIA_MS = 86400000;

const ORDEM = [
  ["IN_213_VIA_DUPLA", "IN_213"],
  ["MEU_INSS_BIOMETRIA", "MEU_INSS"],
  ["IN_138_SELFIE_BANCO", "IN_138"],
];

const dataBr = (iso) => iso.split("-").reverse().join("/");
const dias = (n) => `${n} ${n === 1 ? "dia" : "dias"}`;

/** "dd/mm/aaaa" ou "aaaa-mm-dd" em milissegundos UTC do dia; null se ilegível. */
export function paraDia(valor) {
  const texto = String(valor || "");
  const br = texto.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (br) return Date.UTC(Number(br[3]), Number(br[2]) - 1, Number(br[1]));
  const iso = texto.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  return null;
}

/** Dias corridos de `inicio` até `fim` (negativo se `fim` for anterior). */
export function diasEntre(inicio, fim) {
  const a = paraDia(inicio);
  const b = paraDia(fim);
  return a === null || b === null ? null : Math.round((b - a) / DIA_MS);
}

export function citarMarco(chave) {
  const marco = MARCOS_INSS[chave];
  if (!marco) return null;
  if (marco.norma && marco.conferido) return marco.norma;
  if (marco.norma) return `${marco.norma} (texto e vigência a conferir no DOU)`;
  return marco.descricao;
}

export function citarDispositivo(chave) {
  const d = DISPOSITIVOS_IN138[chave];
  return d?.conferido ? `${d.artigo}, da IN PRES/INSS nº 138/2022` : "IN PRES/INSS nº 138/2022";
}

export function classificarRegimeInss({ produtoCodigo, dataContrato, confiancaData = "ALTA" } = {}) {
  if (produtoCodigo !== "CONSIGNADO_INSS") return null;
  const dia = paraDia(dataContrato);
  if (dia === null) {
    return { codigo: "INDETERMINADO", rotulo: REGIMES.INDETERMINADO, marco: null, norma: null, data_contrato: null, ressalvas: [] };
  }

  const [codigo, marco] = ORDEM.find(([, chave]) => dia >= paraDia(MARCOS_INSS[chave].inicio)) || ["IN_28_2008", null];
  const ressalvas = [];
  if (marco && !MARCOS_INSS[marco].conferido) {
    ressalvas.push(`O início deste regime (${dataBr(MARCOS_INSS[marco].inicio)}) foi informado por fonte secundária e ainda não foi conferido no Diário Oficial da União.`);
  }
  for (const [chave, m] of Object.entries(MARCOS_INSS)) {
    if (m.conferido) continue;
    const distancia = Math.round(Math.abs(dia - paraDia(m.inicio)) / DIA_MS);
    if (distancia > JANELA_FRONTEIRA_DIAS) continue;
    const relacao = distancia === 0 ? "coincide com o início presumido" : `dista ${dias(distancia)} do início presumido`;
    ressalvas.push(`O contrato ${relacao} de ${citarMarco(chave)} (${dataBr(m.inicio)}). Se a vigência conferida for outra, o regime aplicável muda.`);
  }
  if (confiancaData === "BAIXA") {
    ressalvas.push("A data do contrato foi lida sem rótulo de contratação; o enquadramento no regime depende da confirmação dessa data no instrumento.");
  }

  return {
    codigo,
    rotulo: REGIMES[codigo],
    marco,
    norma: marco ? citarMarco(marco) : "IN INSS/PRES nº 28/2008",
    data_contrato: dataContrato,
    ressalvas,
  };
}

/** Itens de fundamentação do regime, no formato [dispositivo, texto] do § 9. */
export function fundamentacaoDoRegime(regime) {
  if (!regime || regime.codigo === "INDETERMINADO") return [];
  if (regime.codigo === "IN_28_2008") {
    return [["IN INSS/PRES nº 28/2008", "Regime de consignação vigente até 30/11/2022, revogado pelo art. 39 da IN PRES/INSS nº 138/2022 e aplicável ao contrato por direito intertemporal."]];
  }
  const itens = [[
    "IN PRES/INSS nº 138/2022, art. 4º, VIII, e art. 5º, II, III e § 5º",
    "Reconhecimento biométrico como rotina que confirma a operação feita pelo beneficiário; autorização expressa com biometria, vedadas a autorização por telefone e a gravação de voz como prova; documento oficial com foto.",
  ]];
  if (REGIMES_MEU_INSS.has(regime.codigo)) {
    itens.push([citarMarco("MEU_INSS"), "Autorização da operação no aplicativo Meu INSS com biometria facial e validação de vivacidade, em etapa distinta da assinatura com a instituição."]);
  }
  if (regime.codigo === "IN_213_VIA_DUPLA") {
    itens.push([citarMarco("IN_213"), `Autorização por biometria facial ou, para o beneficiário sem biometria nas bases oficiais, pela conta gov.br com validação dos dados bancários; vedação de consignado nos primeiros ${REGRA_DIB.dias} dias do benefício.`]);
  }
  return itens;
}
