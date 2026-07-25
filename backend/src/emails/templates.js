/**
 * Templates dos e-mails transacionais (Módulo 7 — M7.2).
 *
 * Cada template recebe os dados do job e devolve { subject, html }.
 * O HTML é inline e sem dependências externas: clientes de e-mail ignoram
 * <style> em <head> e bloqueiam CSS remoto.
 */

const BRAND = "ForenseDoc";
const COLOR_BG = "#f4f4f5";
const COLOR_SURFACE = "#ffffff";
const COLOR_TEXT = "#18181b";
const COLOR_MUTED = "#52525b";
const COLOR_ACCENT = "#0f766e";
const COLOR_BORDER = "#e4e4e7";

function frontendUrl(path = "") {
  const base = (process.env.FRONTEND_URL || "http://localhost:5173").replace(/\/+$/, "");
  return `${base}${path}`;
}

function escapeHtml(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]
  );
}

function button(label, url) {
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0;">
      <tr>
        <td style="background:${COLOR_ACCENT};border-radius:6px;">
          <a href="${escapeHtml(url)}"
             style="display:inline-block;padding:12px 24px;color:#ffffff;font-weight:600;
                    font-size:15px;text-decoration:none;font-family:Arial,Helvetica,sans-serif;">
            ${escapeHtml(label)}
          </a>
        </td>
      </tr>
    </table>`;
}

/** Envelope visual compartilhado por todos os e-mails. */
function layout({ heading, bodyHtml, footerNote }) {
  return `
<div style="background:${COLOR_BG};padding:32px 16px;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:560px;margin:0 auto;">
    <tr>
      <td style="background:${COLOR_SURFACE};border:1px solid ${COLOR_BORDER};border-radius:10px;padding:32px;">
        <p style="margin:0 0 24px;font-size:13px;letter-spacing:1.5px;text-transform:uppercase;color:${COLOR_ACCENT};font-weight:700;">
          ${BRAND}
        </p>
        <h1 style="margin:0 0 16px;font-size:20px;line-height:1.35;color:${COLOR_TEXT};">
          ${heading}
        </h1>
        <div style="font-size:15px;line-height:1.6;color:${COLOR_MUTED};">
          ${bodyHtml}
        </div>
      </td>
    </tr>
    <tr>
      <td style="padding:20px 8px;font-size:12px;line-height:1.5;color:${COLOR_MUTED};text-align:center;">
        ${footerNote ? `${footerNote}<br><br>` : ""}
        ${BRAND} — análise forense de contratos de consignado.<br>
        Este é um e-mail automático, não responda.
      </td>
    </tr>
  </table>
</div>`;
}

const p = (text) => `<p style="margin:0 0 14px;">${text}</p>`;

// ─────────────────────────────────────────────────────────────
// Templates
// ─────────────────────────────────────────────────────────────

export const EMAIL_TEMPLATES = {
  // ── Auth ────────────────────────────────────────────────────
  EMAIL_VERIFICATION: ({ name, verifyUrl }) => ({
    subject: "✉️ Confirme seu e-mail — ForenseDoc",
    html: layout({
      heading: `Bem-vindo ao ForenseDoc, ${escapeHtml(name)}.`,
      bodyHtml:
        p("Confirme seu e-mail para ativar sua conta e liberar seus 3 laudos de teste.") +
        button("Confirmar e-mail", verifyUrl) +
        p("O link expira em 24 horas."),
      footerNote: "Se você não criou esta conta, ignore este e-mail.",
    }),
  }),

  PASSWORD_RESET: ({ name, resetUrl }) => ({
    subject: "🔑 Redefinição de senha — ForenseDoc",
    html: layout({
      heading: `Redefinir sua senha, ${escapeHtml(name)}`,
      bodyHtml:
        p("Recebemos um pedido para redefinir a senha da sua conta.") +
        button("Criar nova senha", resetUrl) +
        p("O link expira em 1 hora e só pode ser usado uma vez."),
      footerNote: "Se você não pediu isso, ignore este e-mail — sua senha continua a mesma.",
    }),
  }),

  INVITE_RECEIVED: ({ tenantName, inviterName, inviteUrl }) => ({
    subject: `👥 Você foi convidado para a equipe ${tenantName} — ForenseDoc`,
    html: layout({
      heading: `${escapeHtml(inviterName)} convidou você para o ForenseDoc`,
      bodyHtml:
        p(`Você foi adicionado à equipe <strong>${escapeHtml(tenantName)}</strong> e passará a usar os laudos do plano do escritório.`) +
        button("Aceitar convite", inviteUrl) +
        p("O convite expira em 72 horas."),
    }),
  }),

  // ── Créditos ────────────────────────────────────────────────
  CREDITS_80PCT: ({ remaining, total }) => ({
    subject: "⚠️ Você já usou 80% dos seus laudos este mês",
    html: layout({
      heading: "80% dos laudos do ciclo já foram usados",
      bodyHtml:
        p(`Restam <strong>${remaining} de ${total}</strong> laudos no seu ciclo atual.`) +
        p("Se precisar de mais antes da renovação, você pode comprar laudos avulsos a qualquer momento — eles não expiram.") +
        button("Ver meu saldo", frontendUrl("/dashboard")),
    }),
  }),

  CREDITS_95PCT: ({ remaining, total }) => ({
    subject: "🔴 Atenção: restam poucos laudos disponíveis",
    html: layout({
      heading: "Seus laudos estão acabando",
      bodyHtml:
        p(`Restam apenas <strong>${remaining} de ${total}</strong> laudos neste ciclo.`) +
        p("Para não interromper suas análises, considere um laudo avulso ou o upgrade de plano.") +
        button("Comprar laudos", frontendUrl("/dashboard/plans")),
    }),
  }),

  CREDITS_EXHAUSTED: () => ({
    subject: "🚫 Seus créditos acabaram — recarregue agora",
    html: layout({
      heading: "Seus laudos do ciclo acabaram",
      bodyHtml:
        p("Você usou todos os laudos mensais do seu plano. Novas análises ficam bloqueadas até a renovação do ciclo.") +
        // Sem preço fixo no corpo: quem recebe este aviso é assinante, e
        // assinante paga o avulso com desconto (valor varia por plano e pelo
        // limite do ciclo). O valor real aparece na tela de planos.
        p("Precisa continuar hoje? Um laudo avulso fica disponível na hora, não expira, e como assinante você paga menos que o preço de balcão.") +
        button("Ver meu preço e recarregar", frontendUrl("/dashboard/plans")),
    }),
  }),

  // ── Pagamento ───────────────────────────────────────────────
  PAYMENT_CONFIRMED: ({ planName, credits }) => ({
    subject: "✅ Pagamento confirmado — créditos renovados",
    html: layout({
      heading: "Pagamento confirmado",
      bodyHtml:
        p(`Recebemos o pagamento do plano <strong>${escapeHtml(planName)}</strong>.`) +
        p(`Seus <strong>${credits} laudos</strong> do novo ciclo já estão disponíveis.`) +
        button("Ir para o painel", frontendUrl("/dashboard")),
    }),
  }),

  PAYMENT_FAILED: ({ invoiceUrl }) => ({
    subject: "❗ Pagamento não aprovado — 2 créditos de emergência concedidos",
    html: layout({
      heading: "Não conseguimos confirmar seu pagamento",
      bodyHtml:
        p("Sua cobrança está em atraso. Para você não ficar sem trabalhar, liberamos <strong>2 laudos de emergência</strong> — eles expiram assim que o pagamento for regularizado.") +
        p("Regularize em até 7 dias para evitar a suspensão da conta.") +
        button("Regularizar pagamento", invoiceUrl || frontendUrl("/dashboard/plans")),
    }),
  }),

  PAYMENT_OVERDUE_URGENT: ({ daysOverdue, invoiceUrl }) => ({
    subject: "🔴 Urgente: sua conta será suspensa em breve",
    html: layout({
      heading: `Pagamento em atraso há ${daysOverdue} dias`,
      bodyHtml:
        p("Ainda não identificamos o pagamento da sua assinatura.") +
        p("Contas com mais de <strong>7 dias</strong> de atraso são suspensas automaticamente e perdem o acesso às análises.") +
        button("Regularizar agora", invoiceUrl || frontendUrl("/dashboard/plans")),
    }),
  }),

  RENEWAL_REMINDER: ({ planName, renewalDate, amount }) => ({
    subject: "📅 Sua assinatura renova em 3 dias",
    html: layout({
      heading: "Renovação da sua assinatura",
      bodyHtml:
        p(`Seu plano <strong>${escapeHtml(planName)}</strong> renova em <strong>${escapeHtml(renewalDate)}</strong>${amount ? ` no valor de <strong>R$ ${escapeHtml(amount)}</strong>` : ""}.`) +
        p("Lembrando: laudos mensais não utilizados expiram na virada do ciclo. Laudos avulsos não expiram.") +
        button("Ver assinatura", frontendUrl("/dashboard/plans")),
    }),
  }),

  ACCOUNT_SUSPENDED: () => ({
    subject: "⛔ Sua conta foi suspensa",
    html: layout({
      heading: "Conta suspensa por falta de pagamento",
      bodyHtml:
        p("Sua conta foi suspensa após 7 dias de atraso no pagamento. As análises ficam indisponíveis até a regularização.") +
        p("Seus laudos já gerados continuam salvos e voltam a ficar acessíveis assim que a conta for reativada.") +
        button("Regularizar e reativar", frontendUrl("/dashboard/plans")),
    }),
  }),

  // ── Análise ─────────────────────────────────────────────────
  ANALYSIS_ERROR: ({ reason }) => ({
    subject: "⚠️ Sua análise falhou — crédito estornado",
    html: layout({
      heading: "Não foi possível concluir a análise",
      bodyHtml:
        p("A análise do seu documento falhou e o crédito foi <strong>estornado automaticamente</strong> — você não perdeu nada.") +
        (reason ? p(`Motivo técnico: <em>${escapeHtml(reason)}</em>`) : "") +
        p("PDFs digitalizados em baixa qualidade ou protegidos por senha são as causas mais comuns.") +
        button("Tentar novamente", frontendUrl("/dashboard/analyze")),
    }),
  }),
};

/**
 * Renderiza um template. Lança se o template não existir — assim um typo
 * aparece no job falhado em vez de enviar um e-mail vazio.
 */
export function renderEmail(template, data = {}) {
  const build = EMAIL_TEMPLATES[template];
  if (!build) throw new Error(`EMAIL_TEMPLATE_NOT_FOUND: ${template}`);
  return build(data);
}
