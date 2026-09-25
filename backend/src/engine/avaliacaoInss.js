import {
  citarDispositivo, citarMarco, diasEntre, paraDia, DISPOSITIVOS_IN138, MARCOS_INSS, REGRA_DIB, REGIMES_COM_IN138, REGIMES_MEU_INSS,
} from "./regimeInss.js";

/**
 * Achados da autorização do consignado INSS, conforme o regime da data do
 * contrato (regimeInss.js) e o que o dossiê traz (evidenciasAutorizacao.js).
 *
 * INS1 (correspondente de outra UF) não mora aqui: depende do domicílio de
 * referência do § 5 e é produzido em irregularitySummary.js.
 */

const normalizarConta = (c) => String(c || "").replace(/\D/g, "");
const lista = (itens) => (itens.length <= 1 ? itens.join("") : `${itens.slice(0, -1).join(", ")} e ${itens.at(-1)}`);
const dataHora = (x) => `${x.data}${x.hora ? ` ${x.hora}` : ""}`;

/** `a` é anterior a `b`? Mesmo dia só conta com as duas horas. */
function anterior(a, b) {
  const d = diasEntre(b.data, a.data);
  if (d === null) return false;
  if (d !== 0) return d < 0;
  return Boolean(a.hora && b.hora && a.hora < b.hora);
}

export function avaliarAutorizacaoInss({ regime, evidencias, contrato = {}, liberacao = {} }) {
  const achados = [];
  const diligencias = [];
  if (!regime) return { achados, diligencias };
  const add = (codigo, gravidade, titulo, texto) => achados.push({ codigo, gravidade, titulo, texto });
  const e = evidencias || {};

  if (regime.codigo === "INDETERMINADO") {
    add("INS0", "MÉDIA", "Regime de autorização do benefício não determinado", "A data do contrato não foi localizada no instrumento. No consignado em benefício do INSS a régua de exame depende dessa data: até 30/11/2022 vale a IN INSS/PRES nº 28/2008; de 1º/12/2022 em diante, a IN PRES/INSS nº 138/2022, com selfie colhida pela instituição; a partir de maio de 2026, a autorização no Meu INSS com biometria facial; e a partir de 17/08/2026, também a via gov.br. A data deve ser confirmada antes de qualquer conclusão sobre a biometria.");
    return { achados, diligencias };
  }

  if (REGIMES_COM_IN138.has(regime.codigo) && !e.demonstrativo_previo) {
    // O laudo não afirma exigência normativa que o escritório ainda não
    // conferiu no DOU (regra do cérebro: nunca inventar norma). Enquanto o
    // dispositivo não estiver conferido, a ausência entra como diligência.
    if (DISPOSITIVOS_IN138.DEMONSTRATIVO_PREVIO.conferido) {
      add("INS2", "MÉDIA", "Demonstrativo prévio da operação não localizado", `O dossiê não traz o demonstrativo prévio exigido pela ${citarDispositivo("DEMONSTRATIVO_PREVIO")}, documento próprio e anterior ao contrato. Sem ele não se verifica o que foi informado ao beneficiário antes da contratação.`);
    } else {
      diligencias.push({
        chave: "demonstrativo-previo",
        titulo: "Demonstrativo prévio da operação",
        texto: "Solicitar à instituição o demonstrativo prévio da operação, documento anterior ao contrato com as condições informadas ao beneficiário; o dossiê não o traz. A exigência normativa desse documento (IN PRES/INSS nº 138/2022) ainda não foi conferida no DOU pelo escritório e por isso não fundamenta achado neste laudo.",
      });
    }
  }

  if (REGIMES_MEU_INSS.has(regime.codigo)) {
    diligencias.push({
      chave: "oficio-inss-dataprev",
      titulo: "Ofício ao INSS e à Dataprev",
      texto: `Requisitar ao INSS e à Dataprev, por ofício, o registro da autorização da operação no Meu INSS${contrato.numero ? ` referente ao contrato ${contrato.numero}` : ""}, com data, hora, método de validação (biometria facial ou conta gov.br), base oficial usada no confronto facial, resultado da validação de vivacidade e, na via gov.br, nível da conta, IP, dispositivo e conta bancária validada. O que a instituição juntar sozinha não substitui esse registro.`,
    });

    if (regime.via !== "GOVBR") {
      const m = e.meu_inss || {};
      const ausentes = [];
      if (!m.autorizacao) ausentes.push("o registro da autorização no Meu INSS com data e hora");
      else if (!m.autorizacao.hora) ausentes.push("a hora da autorização no Meu INSS");
      if (!m.via_facial) ausentes.push("o método de validação usado");
      if (!m.vivacidade) ausentes.push("o resultado da validação de vivacidade");
      if (!(m.bases_oficiais || []).length) ausentes.push("a base oficial usada no confronto facial (CNH ou Justiça Eleitoral)");
      if (ausentes.length) {
        add("INS3", "ALTA", "Autorização no Meu INSS não demonstrada", `No regime aplicável à data do contrato (${regime.rotulo}), a prova central da manifestação do beneficiário é o registro da autorização no Meu INSS, mantido pelo INSS e pela Dataprev, e não a fotografia colhida pela instituição. O dossiê não traz ${lista(ausentes)}.`);
      }
    }

    const autorizacao = e.meu_inss?.autorizacao;
    if (autorizacao) {
      const credito = liberacao?.comprovante?.data ? { data: liberacao.comprovante.data, hora: null } : null;
      const anteriores = [
        e.averbacao && anterior(e.averbacao, autorizacao) ? `a averbação (${dataHora(e.averbacao)})` : null,
        credito && anterior(credito, autorizacao) ? `o crédito comprovado (${credito.data})` : null,
      ].filter(Boolean);
      if (anteriores.length) {
        add("INS4", "ALTA", "Averbação ou crédito anterior à autorização no Meu INSS", `O dossiê registra a autorização no Meu INSS em ${dataHora(autorizacao)}, mas ${lista(anteriores)} ${anteriores.length > 1 ? "são anteriores" : "é anterior"} a ela. A sequência esperada é proposta na instituição, autorização no Meu INSS, averbação e liberação.`);
      }
    }
  }

  if (regime.codigo === "IN_213_VIA_DUPLA") {
    const via = regime.via;
    if (!via || via === "AMBIGUA") {
      add("INS5", "MÉDIA", "Via de autorização não identificada", via === "AMBIGUA"
        ? "O dossiê menciona tanto a biometria facial quanto o acesso pela conta gov.br, sem indicar qual via autorizou a operação. As duas vias têm requisitos e provas diferentes, e a via usada deve ser informada pelo INSS."
        : "O dossiê não indica se a operação foi autorizada no Meu INSS por biometria facial ou pela conta gov.br. As duas vias têm requisitos e provas diferentes, e a via usada deve ser informada pelo INSS.");
    }
    if (via === "GOVBR") {
      if (e.biometria_cadastrada === true) {
        add("INS6", "ALTA", "Via gov.br usada por beneficiário com biometria cadastrada", `O dossiê indica que o beneficiário tinha biometria facial nas bases oficiais e, ainda assim, a operação foi autorizada pela conta gov.br. Pela ${citarMarco("IN_213")}, quem tem foto cadastrada continua obrigado à validação facial, e a via gov.br não era cabível.`);
      }
      if (e.biometria_cadastrada === null) {
        add("INS7", "ALTA", "Cabimento da via gov.br não demonstrado", `A operação foi autorizada pela conta gov.br, via que a ${citarMarco("IN_213")} reserva ao beneficiário sem biometria nas bases oficiais. O dossiê não demonstra essa condição, que deve ser confirmada pelo INSS.`);
      }
      const faltas = [
        e.govbr?.nivel ? null : "o nível da conta gov.br",
        e.govbr?.ip ? null : "o IP de acesso",
        e.govbr?.dispositivo ? null : "o dispositivo de acesso",
        e.conta_validada ? null : "a conta bancária validada",
      ].filter(Boolean);
      if (faltas.length) {
        add("INS8", "ALTA", "Registro de acesso gov.br incompleto", `Na via gov.br, a fotografia e a prova de vida deixam de ser o objeto do exame; entram o registro de acesso à conta gov.br e a conta bancária validada. O dossiê não traz ${lista(faltas)}.`);
      }
      const validada = e.conta_validada;
      const beneficio = e.conta_beneficio;
      if (validada && beneficio && normalizarConta(validada.conta) !== normalizarConta(beneficio.conta)) {
        add("INS9", "ALTA", "Conta validada diverge da conta do benefício", `A conta validada na autorização gov.br (agência ${validada.agencia}, conta ${validada.conta}) não é a conta de recebimento do benefício (agência ${beneficio.agencia}, conta ${beneficio.conta}). Na via gov.br, a conta validada deve ser a de recebimento do benefício.`);
      }
    }
  }

  if (paraDia(regime.data_contrato) >= paraDia(MARCOS_INSS[REGRA_DIB.marco].inicio)) {
    const norma = citarMarco(REGRA_DIB.marco);
    if (!e.dib) {
      add("INS11", "MÉDIA", "Data de início do benefício não localizada", `A ${norma} vedou a contratação de consignado nos primeiros ${REGRA_DIB.dias} dias do benefício. O dossiê não traz a data de início do benefício (DIB), e o confronto com a data do contrato fica pendente.`);
      diligencias.push({ chave: "dib-beneficio", titulo: "Data de início do benefício", texto: "Juntar a carta de concessão ou o extrato HISCRE com a data de início do benefício (DIB), para confronto com a data do contrato." });
    } else {
      const decorridos = diasEntre(e.dib, regime.data_contrato);
      if (decorridos !== null && decorridos >= 0 && decorridos < REGRA_DIB.dias) {
        add("INS10", "ALTA", `Contrato nos primeiros ${REGRA_DIB.dias} dias do benefício`, `O contrato (${regime.data_contrato}) foi celebrado ${decorridos} ${decorridos === 1 ? "dia" : "dias"} depois da data de início do benefício (${e.dib}). A ${norma} vedou a contratação de consignado nos primeiros ${REGRA_DIB.dias} dias do benefício.`);
      }
    }
  }

  return { achados, diligencias };
}
