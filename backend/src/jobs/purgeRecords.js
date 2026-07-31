import { prisma } from "../utils/prisma.js";

/**
 * Retenção das tabelas que crescem sem parar.
 *
 * ─── Por que isto faltava ────────────────────────────────────────────────────
 *
 * A retenção do PDF original foi resolvida quando ele saiu para o R2, mas o
 * mesmo raciocínio não tinha sido aplicado ao banco. `audit_logs` e
 * `notifications` cresciam indefinidamente, e as duas guardam dado pessoal.
 *
 * O audit log é o caso mais sensível: além de crescer com TODA ação de TODO
 * tenant, ele registra endereço IP e user-agent. Isso é dado pessoal sob a LGPD,
 * e mantê-lo para sempre é o mesmo problema que motivou a política de 90 dias no
 * PDF, só que passou despercebido porque a atenção estava no upload.
 *
 * ─── Prazos diferentes, motivos diferentes ───────────────────────────────────
 *
 * AUDITORIA: 12 meses. É prazo mais longo porque a trilha serve exatamente para
 * responder ao que se questiona depois — contestação de cobrança, apuração de
 * acesso indevido, pedido do titular sobre o tratamento dos seus dados
 * (LGPD art. 18, II). Um ano cobre o ciclo de faturamento inteiro e o Marco
 * Civil, art. 15, cujo piso de 6 meses para registros de acesso a aplicação é
 * obrigação legal e não pode ser encurtado por conveniência.
 *
 * NOTIFICAÇÕES: 6 meses, e só as já LIDAS. Notificação é aviso de interface, não
 * prova: cumprida a função, o valor dela é zero. As não lidas ficam, porque
 * apagá-las esconderia do usuário algo que ele nunca viu.
 */

const LOTE = 1000;

export const RETENCAO_AUDITORIA_DIAS = Number(process.env.AUDIT_RETENTION_DAYS) || 365;
export const RETENCAO_NOTIFICACAO_DIAS = Number(process.env.NOTIFICATION_RETENTION_DAYS) || 180;

/** Piso legal: Marco Civil art. 15 exige 6 meses de registros de acesso. */
const PISO_AUDITORIA_DIAS = 180;

function limite(dias) {
  return new Date(Date.now() - dias * 24 * 60 * 60 * 1000);
}

/**
 * Apaga em lotes até esgotar.
 *
 * `deleteMany` sem limite numa tabela grande trava a linha por muito tempo e
 * pode estourar o WAL. Lotes mantêm cada transação curta, ao custo de mais
 * viagens ao banco, o que é irrelevante numa rotina que roda de madrugada.
 */
async function apagarEmLotes(rotulo, apagar) {
  let total = 0;
  for (;;) {
    const { count } = await apagar();
    total += count;
    if (count < LOTE) break;
  }
  if (total > 0) console.log(`[Purge] ${total} registro(s) de ${rotulo} expurgado(s).`);
  return total;
}

export async function processRecordPurge() {
  // Encurtar abaixo do piso do Marco Civil seria descumprir obrigação legal por
  // configuração. O valor é corrigido e o desvio, registrado.
  const diasAuditoria = Math.max(PISO_AUDITORIA_DIAS, RETENCAO_AUDITORIA_DIAS);
  if (diasAuditoria !== RETENCAO_AUDITORIA_DIAS) {
    console.warn(
      `[Purge] AUDIT_RETENTION_DAYS=${RETENCAO_AUDITORIA_DIAS} está abaixo do piso legal ` +
        `de ${PISO_AUDITORIA_DIAS} dias (Marco Civil, art. 15). Usando ${diasAuditoria}.`
    );
  }

  const auditoria = await apagarEmLotes("auditoria", () =>
    prisma.auditLog.deleteMany({
      where: { createdAt: { lt: limite(diasAuditoria) } },
      limit: LOTE,
    })
  );

  const notificacoes = await apagarEmLotes("notificação", () =>
    prisma.notification.deleteMany({
      // Só as lidas: apagar uma não lida esconderia do usuário um aviso que ele
      // nunca chegou a ver.
      where: { read: true, createdAt: { lt: limite(RETENCAO_NOTIFICACAO_DIAS) } },
      limit: LOTE,
    })
  );

  return { auditoria, notificacoes };
}
