/**
 * Versão vigente dos documentos jurídicos.
 *
 * ─── Por que a versão, e não só um booleano ──────────────────────────────────
 *
 * Guardar apenas "o usuário aceitou" não demonstra nada. Documentos mudam, e o
 * que precisa ser comprovável é QUAL TEXTO ele aceitou: sem a versão, qualquer
 * cláusula invocada pode ser respondida com "isso não estava lá quando eu me
 * cadastrei", e não há como refutar.
 *
 * O valor é o mesmo exibido no topo das páginas `/termos` e `/privacidade`. Os
 * dois lados precisam concordar, então há teste que falha se divergirem.
 *
 * ─── Quando incrementar ──────────────────────────────────────────────────────
 *
 * A cada mudança RELEVANTE de conteúdo. Correção de digitação não conta.
 * Alteração de prazo, de limite de responsabilidade, de finalidade de tratamento
 * ou de sub-operador, sim.
 *
 * Os próprios Termos prometem aviso com 30 dias de antecedência para mudanças
 * relevantes: mudar este valor sem cumprir aquele prazo descumpre o documento
 * que ele identifica.
 */
export const TERMS_VERSION = "2026-07-31";

/** Rótulo humano, usado no audit log e em telas. */
export const TERMS_LABEL = "Termos de Uso e Política de Privacidade";
