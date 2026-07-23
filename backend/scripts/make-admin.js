/**
 * Promove um usuário existente a admin da plataforma.
 *
 * O `isPlatformAdmin` é atribuído no cadastro, comparando o e-mail com
 * PLATFORM_ADMIN_EMAIL. Quem já se cadastrou antes de a variável existir
 * (ou com outro e-mail) fica sem acesso ao painel e não tem como se
 * promover pela interface — daí este script.
 *
 * Uso:
 *   node scripts/make-admin.js voce@escritorio.com.br
 *   node scripts/make-admin.js voce@escritorio.com.br --revoke
 *
 * Também confirma o e-mail do usuário, já que o login exige verificação e
 * em ambiente local nem sempre há SMTP configurado.
 */
import { prisma } from "../src/utils/prisma.js";
import "dotenv/config";

const email = process.argv[2];
const revoke = process.argv.includes("--revoke");

if (!email) {
  console.error("Uso: node scripts/make-admin.js <email> [--revoke]");
  process.exit(1);
}

try {
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, name: true, isPlatformAdmin: true, emailVerified: true },
  });

  if (!user) {
    console.error(`✗ Usuário não encontrado: ${email}`);
    console.error("  Cadastre-se pela interface primeiro, depois rode este script.");
    process.exit(1);
  }

  const updated = await prisma.user.update({
    where: { email },
    data: { isPlatformAdmin: !revoke, emailVerified: true },
    select: { name: true, email: true, isPlatformAdmin: true },
  });

  console.log(
    `✓ ${updated.name} <${updated.email}> — isPlatformAdmin: ${updated.isPlatformAdmin}` +
      (user.emailVerified ? "" : " (e-mail marcado como confirmado)")
  );
  console.log("  Saia e entre novamente: a permissão vive dentro do JWT.");
} catch (err) {
  console.error("✗ Falha:", err.message);
  process.exit(1);
} finally {
  await prisma.$disconnect();
}
