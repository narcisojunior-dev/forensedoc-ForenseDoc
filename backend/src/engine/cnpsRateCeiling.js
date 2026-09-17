// Teto de juros do cartão consignado de benefício (RMC), por data de
// vigência, fixado pelo CNPS (Conselho Nacional de Previdência Social).
//
// Tabela DELIBERADAMENTE mínima: contém só a transição citada no relatório
// técnico de 09/09/2026 (item 9.2) — Resolução CNPS 1.359, de 11/10/2023,
// que reduziu o teto de 2,83% para 2,73% ao mês, em vigor cinco dias úteis
// após a publicação (18/10/2023). Não inventar outras datas/resoluções
// aqui: cada nova entrada deve vir do Diário Oficial da União ou do site do
// CNPS, nunca de memória. Uma tabela incompleta que devolve
// "não determinado" é preferível a uma tabela errada que afirma um teto
// que nunca vigorou.
const RESOLUTIONS = [
  { vigenciaInicio: "2023-10-18", tetoMensal: 2.73, resolucao: "Resolução CNPS 1.359, de 11/10/2023" },
];

// Teto anterior à primeira entrada da tabela, mas SÓ confirmado para a
// data exata citada no relatório (17/10/2023) — sem data de início
// conhecida, por isso não se estende para trás indefinidamente.
const TETO_ANTERIOR_CONHECIDO = { tetoMensal: 2.83, dataConfirmada: "2023-10-17" };

function parseIsoDate(value) {
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

// Aceita "dd/mm/aaaa" (formato usado no resto do app) ou ISO.
function parseAnyDate(value) {
  const br = String(value || "").match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (br) return parseIsoDate(`${br[3]}-${br[2]}-${br[1]}`);
  return parseIsoDate(String(value || "").slice(0, 10));
}

// Retorna { tetoMensal, resolucao, confianca } ou null quando a data não é
// coberta com confiança pela tabela.
export function cnpsCeilingAt(dateValue) {
  const date = parseAnyDate(dateValue);
  if (!date) return null;

  for (let i = RESOLUTIONS.length - 1; i >= 0; i -= 1) {
    const entry = RESOLUTIONS[i];
    if (date >= parseIsoDate(entry.vigenciaInicio)) {
      return { tetoMensal: entry.tetoMensal, resolucao: entry.resolucao, confianca: "confirmado" };
    }
  }

  const confirmada = parseIsoDate(TETO_ANTERIOR_CONHECIDO.dataConfirmada);
  if (confirmada && date.getTime() === confirmada.getTime()) {
    return { tetoMensal: TETO_ANTERIOR_CONHECIDO.tetoMensal, resolucao: null, confianca: "confirmado apenas para esta data específica" };
  }

  return null;
}
