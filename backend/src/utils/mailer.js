import nodemailer from "nodemailer";
import "dotenv/config";

const SMTP_PORT = Number(process.env.SMTP_PORT) || 587;

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  // Number, não string: o nodemailer usa a porta para decidir o modo de
  // conexão, e "465" como texto não casa com a checagem de TLS implícito.
  port: SMTP_PORT,
  // 465 é TLS desde o handshake; 587 e 25 começam em claro e sobem via
  // STARTTLS. Sem esta flag, configurar a porta 465 falha na conexão.
  secure: SMTP_PORT === 465,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

/** Mostra só o suficiente para identificar o destinatário: "jo***@dominio.com". */
function maskEmail(address) {
  const [local = "", dominio = ""] = String(address || "").split("@");
  if (!dominio) return "[REDACTED]";
  const visivel = local.slice(0, 2);
  return `${visivel}${"*".repeat(Math.max(local.length - 2, 1))}@${dominio}`;
}

/** Extrai os links de ação do corpo, para o mock de dev não despejar o HTML todo. */
function extractLinks(html) {
  return [...String(html).matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
}

export async function sendEmail({ to, subject, html }) {
  // Em desenvolvimento, sem SMTP configurado, o e-mail vai para o console —
  // é assim que se pega o link de verificação/convite localmente.
  //
  // O corpo HTML inteiro NÃO é mais despejado: além do ruído, ele enterrava o
  // link no meio de 40 linhas de markup. Os links continuam em claro de
  // propósito — sem eles o fluxo local não fecha — e este ramo depende de
  // NODE_ENV=development, então nunca roda em produção.
  if (process.env.NODE_ENV === "development" && !process.env.SMTP_USER) {
    const links = extractLinks(html);
    console.log("--------------------------------------------------");
    console.log(`[MAILER MOCK] Para: ${to}`);
    console.log(`[MAILER MOCK] Assunto: ${subject}`);
    for (const link of links) console.log(`[MAILER MOCK] Link: ${link}`);
    console.log("--------------------------------------------------");
    return;
  }

  const mailOptions = {
    from: process.env.EMAIL_FROM || "noreply@forensedoc.com.br",
    to,
    subject,
    html,
  };

  try {
    await transporter.sendMail(mailOptions);
    // Endereço mascarado: o log de produção vai para um agregador externo, com
    // retenção e controle de acesso próprios — não precisa da lista de e-mails
    // dos clientes.
    console.log(`[MAILER] E-mail enviado para: ${maskEmail(to)}`);
  } catch (error) {
    // Só a mensagem, nunca o objeto inteiro: o erro do nodemailer carrega as
    // credenciais SMTP e o envelope da mensagem.
    console.error(`[MAILER] Erro ao enviar e-mail para ${maskEmail(to)}: ${error.message}`);
    throw error;
  }
}
