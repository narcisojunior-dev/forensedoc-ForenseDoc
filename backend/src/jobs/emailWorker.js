import { sendEmail } from "../utils/mailer.js";
import { renderEmail } from "../emails/templates.js";

/**
 * Processa jobs 'send-email' da fila (Módulo 7 — M7.2).
 *
 * O envio ficava inline nos controllers, o que prendia a resposta HTTP ao
 * tempo do SMTP e perdia o e-mail em qualquer falha transitória. Aqui o
 * BullMQ cuida do retry.
 */
export async function processEmail(job) {
  const { to, template, data } = job.data;

  if (!to || !template) {
    // Job malformado: falhar rápido, sem retry — retentar não conserta.
    console.error("[EmailWorker] Job inválido (falta 'to' ou 'template'):", job.data);
    return;
  }

  const { subject, html } = renderEmail(template, data || {});
  await sendEmail({ to, subject, html });
}
