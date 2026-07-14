import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import { prisma } from "../utils/prisma.js";
import { sendEmail } from "../utils/mailer.js";

const inviteSchema = z.object({
  email: z.string().email(),
});

export async function inviteMember(req, res) {
  try {
    const { email } = inviteSchema.parse(req.body);
    const tenantId = req.tenantId; // Injetado pelo requireAuth

    // Verificar se usuário logado é OWNER
    if (req.auth.role !== "OWNER") {
      return res.status(403).json({ error: "Apenas o proprietário pode convidar membros." });
    }

    // Verificar limite de usuários do plano
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      include: {
        users: true,
        subscription: { include: { plan: true } },
      },
    });

    // Se estiver em TRIAL (sem assinatura ativa), o limite padrão é 1 (apenas o owner)
    // Para simplificar: checagem de limite pode ser aprimorada
    const maxUsers = tenant.subscription ? tenant.subscription.plan.maxUsers : 1;
    if (tenant.users.length >= maxUsers) {
      return res.status(403).json({ error: "Limite de membros do plano atingido." });
    }

    // Verifica se já existe
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return res.status(400).json({ error: "E-mail já cadastrado." });
    }

    // Em vez de enviar convite, já podemos criar a conta (ou criar um registro de Convite pendente).
    // O PRD prevê um token. Como não temos uma tabela TenantInvite, vamos gerar uma senha padrão temporária,
    // ou apenas enviar o link para o usuário se cadastrar vinculado ao tenant (que exige token no PRD).
    // Para v3.0 inicial: simplificaremos exigindo que o owner defina uma senha inicial (ou enviar recuperação).

    return res.status(501).json({ message: "Rota de convites será implementada na gestão de equipe do painel." });
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: "E-mail inválido." });
    console.error("[Tenant] Erro ao convidar membro:", error);
    return res.status(500).json({ error: "Erro interno no servidor." });
  }
}

export async function getMembers(req, res) {
  try {
    const users = await prisma.user.findMany({
      where: { tenantId: req.tenantId },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        lastLoginAt: true,
      },
    });

    return res.json({ members: users });
  } catch (error) {
    console.error("[Tenant] Erro ao listar membros:", error);
    return res.status(500).json({ error: "Erro interno no servidor." });
  }
}
