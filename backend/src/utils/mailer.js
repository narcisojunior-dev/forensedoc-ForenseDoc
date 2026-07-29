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

export async function sendEmail({ to, subject, html }) {
  // Em desenvolvimento, se não houver SMTP configurado, apenas logar no console
  if (process.env.NODE_ENV === "development" && !process.env.SMTP_USER) {
    console.log("--------------------------------------------------");
    console.log(`[MAILER MOCK] Para: ${to}`);
    console.log(`[MAILER MOCK] Assunto: ${subject}`);
    console.log(`[MAILER MOCK] Corpo:\n${html}`);
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
    console.log(`[MAILER] E-mail enviado para: ${to}`);
  } catch (error) {
    console.error(`[MAILER] Erro ao enviar e-mail para ${to}:`, error);
    throw error;
  }
}
