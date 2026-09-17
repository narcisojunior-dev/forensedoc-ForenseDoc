/**
 * Matemática financeira da aferição do § 2.1.
 *
 * ─── Por que saiu de extraction.js ───────────────────────────────────────────
 *
 * O solver antigo fazia bisseção entre 0,01% e 20% ao mês e devolvia o ponto
 * médio final sem conferir se aquilo era raiz. Com a data base errada do dossiê
 * C6 (posterior ao primeiro vencimento), nenhuma taxa do intervalo zerava o
 * fluxo, a bisseção encostou no teto e o laudo imprimiu "CET implícito 20,0000%,
 * indício de subdeclaração" contra um contrato cujo CET confere no centavo.
 *
 * Aqui a regra é: número só sai com raiz verificada. Sem raiz, sai o motivo.
 */

const DIA_MS = 86400000;

/** Dias corridos entre duas datas locais, sem efeito de horário de verão. */
export function diasEntre(inicio, fim) {
  const a = Date.UTC(inicio.getFullYear(), inicio.getMonth(), inicio.getDate());
  const b = Date.UTC(fim.getFullYear(), fim.getMonth(), fim.getDate());
  return Math.round((b - a) / DIA_MS);
}

/**
 * Valor presente de um fluxo, com expoente em dias/base (base 30 é a convenção
 * dos contratos de crédito consignado).
 */
export function valorPresente(taxaMensal, fluxos, dataBase, base = 30) {
  return fluxos.reduce((acc, { data, valor }) => acc + valor / Math.pow(1 + taxaMensal, diasEntre(dataBase, data) / base), 0);
}

const LIMITE_INFERIOR = -0.99;
const LIMITE_SUPERIOR = 10;
const TOLERANCIA_VPL = 0.01;

/**
 * Taxa mensal que iguala o valor presente do fluxo a `valorPresenteAlvo`.
 *
 * @returns {{status: "AFERIDO", taxa: number, vplResidual: number, memoria: object}
 *   | {status: "NAO_AFERIDO", motivo: string, memoria: object|null}}
 */
export function taxaImplicita({ valorPresenteAlvo, fluxos, dataBase, base = 30 }) {
  if (!Number.isFinite(valorPresenteAlvo) || valorPresenteAlvo <= 0) {
    return { status: "NAO_AFERIDO", motivo: "valor presente de referência ausente", memoria: null };
  }
  if (!dataBase || !Array.isArray(fluxos) || !fluxos.length) {
    return { status: "NAO_AFERIDO", motivo: "data base ou vencimentos ausentes", memoria: null };
  }

  const memoria = {
    base_dias: base,
    data_base: formatarData(dataBase),
    valor_presente: valorPresenteAlvo,
    fluxos: fluxos.map(({ data, valor }) => ({ data: formatarData(data), dias: diasEntre(dataBase, data), valor })),
  };

  const anterior = fluxos.find(({ data }) => diasEntre(dataBase, data) < 0);
  if (anterior) {
    return {
      status: "NAO_AFERIDO",
      motivo: `o vencimento ${formatarData(anterior.data)} é anterior à data base ${formatarData(dataBase)}; uma das datas foi lida de outro quadro do documento`,
      memoria,
    };
  }

  const f = (taxa) => valorPresente(taxa, fluxos, dataBase, base) - valorPresenteAlvo;
  let lo = LIMITE_INFERIOR;
  let hi = LIMITE_SUPERIOR;
  let flo = f(lo);
  const fhi = f(hi);
  if (!Number.isFinite(flo) || !Number.isFinite(fhi) || Math.sign(flo) === Math.sign(fhi)) {
    return {
      status: "NAO_AFERIDO",
      motivo: "nenhuma taxa entre -99% e 1.000% ao mês iguala o fluxo de parcelas ao valor de referência",
      memoria,
    };
  }

  for (let i = 0; i < 300; i += 1) {
    const mid = (lo + hi) / 2;
    const fm = f(mid);
    if (Math.sign(fm) === Math.sign(flo)) {
      lo = mid;
      flo = fm;
    } else {
      hi = mid;
    }
  }
  const taxa = (lo + hi) / 2;
  const vplResidual = f(taxa);

  // Encostar num extremo do intervalo é falha de convergência, nunca resposta.
  if (Math.abs(taxa - LIMITE_INFERIOR) < 1e-9 || Math.abs(taxa - LIMITE_SUPERIOR) < 1e-9) {
    return { status: "NAO_AFERIDO", motivo: "a busca encostou no limite do intervalo sem encontrar raiz", memoria };
  }
  if (Math.abs(vplResidual) > TOLERANCIA_VPL) {
    return { status: "NAO_AFERIDO", motivo: `o valor presente residual (${vplResidual.toFixed(4)}) ficou acima da tolerância de ${TOLERANCIA_VPL}`, memoria };
  }
  return { status: "AFERIDO", taxa, vplResidual, memoria: { ...memoria, taxa_mensal: taxa, vpl_residual: vplResidual } };
}

/**
 * Anualização pelas duas convenções em uso.
 *
 * O Banco Central calcula o CET anual pela taxa diária equivalente elevada a
 * 365; muitos contratos anualizam a taxa de juros por 12 capitalizações
 * mensais. Comparar o declarado com uma só delas produz divergência falsa: foi
 * o que aconteceu com o CET do dossiê C6 (143,52% declarado, 140,58% calculado
 * em 12 meses, 143,53% em 365 dias).
 */
export function anualizar(taxaMensal, base = 30) {
  if (!Number.isFinite(taxaMensal)) return null;
  return {
    dias365: Math.pow(1 + taxaMensal, 365 / base) - 1,
    meses12: Math.pow(1 + taxaMensal, 12) - 1,
  };
}

/**
 * Confere uma taxa anual declarada contra as duas anualizações.
 * @param {number} tolerancia em pontos decimais (0.001 = 0,10 p.p.)
 */
export function conferirAnualizacao(taxaMensal, taxaAnualDeclarada, tolerancia = 0.001) {
  const calc = anualizar(taxaMensal);
  if (!calc) return null;
  if (!Number.isFinite(taxaAnualDeclarada)) {
    return { ...calc, confere: null, convencao: null };
  }
  const d365 = Math.abs(calc.dias365 - taxaAnualDeclarada);
  const d12 = Math.abs(calc.meses12 - taxaAnualDeclarada);
  const melhor = d365 <= d12 ? "365 dias" : "12 meses";
  const confere = Math.min(d365, d12) <= tolerancia;
  return { ...calc, confere, convencao: confere ? melhor : null };
}

/** Vencimentos mensais a partir do primeiro, no mesmo dia do mês. */
export function vencimentosMensais(primeiro, quantidade) {
  if (!primeiro || !Number.isFinite(quantidade) || quantidade <= 0) return [];
  return Array.from({ length: quantidade }, (_, i) => new Date(primeiro.getFullYear(), primeiro.getMonth() + i, primeiro.getDate()));
}

export function formatarData(data) {
  if (!(data instanceof Date) || Number.isNaN(data.getTime())) return null;
  return `${String(data.getDate()).padStart(2, "0")}/${String(data.getMonth() + 1).padStart(2, "0")}/${data.getFullYear()}`;
}
