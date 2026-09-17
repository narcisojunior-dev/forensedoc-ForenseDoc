// Resolve nome do banco/financeira e código COMPE pela RAIZ do CNPJ (os 8
// primeiros dígitos), nunca por um número solto lido perto de "Banco:" ou
// "Código:" no texto — esse número quase sempre pertence a outro quadro do
// contrato (ex.: o banco que RECEBE o benefício, não o credor). Ver item 4
// do relatório técnico de 09/09/2026.
//
// Tabela local com apenas as raízes de CNPJ já confirmadas nos documentos
// tratados por este sistema (Bradesco: já usada em extractBradescoConsignado;
// Facta: CNPJ 15.581.638/0001-30 citado no relatório técnico de 09/09/2026;
// BB e Caixa: CNPJs públicos e amplamente documentados). Deliberadamente
// pequena — um dígito errado de propósito rotularia um banco errado num
// documento pericial, o que é pior do que deixar "não identificado". Para
// ampliar, use a lista pública de participantes do STR do Banco Central
// (https://www.bcb.gov.br/estabilidadefinanceira/relacaoparticipantesstr),
// nunca digite CNPJs de memória.
//
// Financeiras (SCFI) legitimamente não têm código COMPE — nesse caso
// `compe` é null e o chamador deve imprimir "sem código COMPE (sociedade
// de crédito, financiamento e investimento)" em vez de reaproveitar um
// código de outro quadro do documento.
const REGISTRY_BY_CNPJ_ROOT = new Map([
  ["60746948", { nome: "Banco Bradesco S.A.", compe: "237" }],
  ["00000000", { nome: "Banco do Brasil S.A.", compe: "001" }],
  ["00360305", { nome: "Caixa Econômica Federal", compe: "104" }],
  ["15581638", { nome: "Facta Financeira S.A. Crédito, Financiamento e Investimento", compe: null }],
]);

export function cnpjRoot(cnpj) {
  const digits = String(cnpj || "").replace(/\D/g, "");
  return digits.length >= 8 ? digits.slice(0, 8) : null;
}

// Retorna { nome, compe, semCompeNota } ou null quando a raiz não está
// cadastrada — nesse caso o chamador NÃO deve inventar um código, apenas
// registrar que a instituição não pôde ser resolvida pela tabela local.
export function resolveBankByCnpj(cnpj) {
  const root = cnpjRoot(cnpj);
  if (!root) return null;
  const entry = REGISTRY_BY_CNPJ_ROOT.get(root);
  if (!entry) return null;
  return {
    nome: entry.nome,
    compe: entry.compe,
    semCompeNota: entry.compe ? null : "sem código COMPE (sociedade de crédito, financiamento e investimento)",
  };
}
