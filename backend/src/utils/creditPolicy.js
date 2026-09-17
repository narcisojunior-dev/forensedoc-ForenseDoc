/**
 * Crédito ilimitado do administrador da plataforma.
 *
 * O super admin é o dono do sistema: gerar laudo para ele não é venda, então
 * não passa por saldo, débito, estorno nem alerta de créditos acabando. Só os
 * usuários clientes dependem de assinatura e créditos avulsos.
 *
 * A marca vem do access token assinado (`isPlatformAdmin`, gravado a partir do
 * banco no login e em cada renovação da sessão). Não há como o cliente
 * afirmá-la no corpo da requisição.
 *
 * A isenção é do USUÁRIO administrador, não do escritório dele: outro membro do
 * mesmo tenant continua consumindo créditos normalmente.
 */
export function temCreditoIlimitado(auth) {
  return auth?.isPlatformAdmin === true;
}
