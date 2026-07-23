import { prisma } from "../utils/prisma.js";
import { saasQueue } from "../queues.js";

/**
 * Ponto único de emissão de notificações (Módulo 7).
 *
 * Regra: quem produz o evento (credit service, webhook, worker de análise)
 * nunca fala com o mailer nem com a tabela de notificações direto — chama
 * `notify()`. Assim o canal in-app e o e-mail nunca saem de sincronia.
 */

const EMAIL_JOB = "send-email";

// Opções de retry do envio de e-mail: SMTP falha de forma transitória com
// frequência (rate limit do provedor, DNS, timeout), então vale insistir.
const EMAIL_JOB_OPTS = {
  attempts: 3,
  backoff: { type: "exponential", delay: 5000 },
  removeOnComplete: true,
  removeOnFail: 100, // mantém as últimas falhas para diagnóstico
};

/**
 * Enfileira um e-mail transacional avulso (sem notificação in-app).
 * Usado por fluxos de auth, onde não existe "caixa de entrada" ainda.
 */
export async function enqueueEmail({ to, template, data = {} }) {
  if (!to) return;
  await saasQueue.add(EMAIL_JOB, { to, template, data }, EMAIL_JOB_OPTS).catch((err) => {
    // Nunca derrubar o fluxo do usuário por falha ao enfileirar.
    console.error(`[Notification] Falha ao enfileirar e-mail '${template}':`, err.message);
  });
}

/** Destinatários do e-mail: o usuário alvo ou, na ausência dele, o OWNER do tenant. */
async function resolveRecipients(tenantId, userId) {
  if (userId) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, active: true },
    });
    return user?.active ? [user.email] : [];
  }

  const owners = await prisma.user.findMany({
    where: { tenantId, role: "OWNER", active: true },
    select: { email: true },
  });
  return owners.map((o) => o.email);
}

/**
 * Cria a notificação in-app e (opcionalmente) dispara o e-mail correspondente.
 *
 * @param {object}  params
 * @param {string}  params.tenantId
 * @param {string=} params.userId    destinatário específico; null = tenant inteiro
 * @param {string}  params.type      NotificationType do schema
 * @param {string}  params.title
 * @param {string}  params.body
 * @param {boolean} params.email     enviar e-mail além do in-app (padrão: true)
 * @param {string=} params.template  template de e-mail (padrão: igual ao `type`)
 * @param {object}  params.emailData dados do template
 */
export async function notify({
  tenantId,
  userId = null,
  type,
  title,
  body,
  email = true,
  template = null,
  emailData = {},
}) {
  try {
    await prisma.notification.create({
      data: { tenantId, userId, type, title, body },
    });
  } catch (err) {
    // A notificação in-app é secundária ao evento que a originou (um débito de
    // crédito, um pagamento). Falhar aqui não pode reverter aquilo.
    console.error(`[Notification] Falha ao criar notificação '${type}':`, err.message);
  }

  if (!email) return;

  try {
    const recipients = await resolveRecipients(tenantId, userId);
    await Promise.all(
      recipients.map((to) => enqueueEmail({ to, template: template || type, data: emailData }))
    );
  } catch (err) {
    console.error(`[Notification] Falha ao enfileirar e-mails de '${type}':`, err.message);
  }
}
