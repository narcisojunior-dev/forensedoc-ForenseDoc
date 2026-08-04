import { parseCidrList, matchesCidrList } from "../utils/ipAllowlist.js";

/**
 * Allowlist de origem dos webhooks da Asaas (Seção 2.6 do plano).
 *
 * Segunda camada, depois do `asaas-access-token`: mesmo que o token vaze,
 * a requisição precisa vir da faixa de IPs da Asaas.
 *
 * Os CIDRs vêm de ASAAS_WEBHOOK_IPS (lista separada por vírgula) porque a
 * Asaas pode alterá-los — deixá-los fixos no código transformaria uma mudança
 * de infra deles numa interrupção de cobrança aqui. A lista oficial está em
 * docs.asaas.com/docs/official-asaas-ips.
 *
 * Sem a variável configurada, o middleware apenas registra a origem e libera
 * a passagem: a proteção por token continua valendo e é melhor logar do que
 * derrubar o faturamento por uma allowlist vazia.
 */

const ALLOWED = parseCidrList(process.env.ASAAS_WEBHOOK_IPS, "ASAAS_WEBHOOK_IPS");

if (ALLOWED.length === 0) {
  // Em produção isso é um risco concreto, não um aviso de configuração: o
  // endpoint credita pagamentos e ficaria com uma única camada de defesa.
  // Sobe para console.error para aparecer no monitoramento, mas não derruba o
  // boot — uma allowlist vazia não pode interromper o faturamento.
  const log = process.env.NODE_ENV === "production" ? console.error : console.warn;
  log(
    "[Webhook] ASAAS_WEBHOOK_IPS não configurada — allowlist de IP desativada. " +
      "Os webhooks continuam protegidos apenas pelo asaas-access-token."
  );
}

export function isIpAllowed(ip) {
  // Fail-open deliberado: allowlist vazia libera (ver comentário acima).
  if (ALLOWED.length === 0) return true;
  return matchesCidrList(ip, ALLOWED);
}

export function asaasIpAllowlist(req, res, next) {
  if (isIpAllowed(req.ip)) return next();

  console.warn(`[Webhook] Requisição rejeitada — IP fora da allowlist: ${req.ip}`);
  return res.status(403).end();
}
