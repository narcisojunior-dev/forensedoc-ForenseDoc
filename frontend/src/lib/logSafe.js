/**
 * Motivo de um erro, em texto, para ir ao console sem levar credencial junto.
 *
 * ─── Por que não se passa o erro inteiro ─────────────────────────────────────
 *
 * `console.error("...", error)` com um erro do axios NÃO imprime só a mensagem:
 * imprime o objeto, e dentro dele vai `error.config.headers`, que o interceptor
 * de `lib/axios.js` preenche com `Authorization: Bearer <access token>`.
 *
 * O token de acesso vive em memória de propósito (N3 da auditoria), justamente
 * para que um XSS não o leia em `localStorage`. Despejá-lo no console desfaz
 * parte dessa decisão: o console sobrevive à navegação, aparece em gravação de
 * tela, em print de suporte e é legível por extensão do navegador.
 *
 * Aqui se extrai apenas o que serve para diagnosticar — status HTTP e mensagem
 * da API — e nunca `config`, `headers`, `request` ou `response.data` cru.
 */
export function motivoDoErro(erro) {
  if (!erro) return "erro desconhecido";

  const status = erro.response?.status;
  // A mensagem da API vem de um campo conhecido; o corpo inteiro não entra,
  // porque uma rota futura pode devolver dado do dossiê ali.
  const daApi = erro.response?.data?.error;

  if (status && daApi) return `HTTP ${status}: ${daApi}`;
  if (status) return `HTTP ${status}`;
  if (daApi) return String(daApi);

  // Erro de rede/timeout não tem resposta: sobra o código e a mensagem do axios,
  // ambos sem credencial.
  return erro.code || erro.message || "erro desconhecido";
}
