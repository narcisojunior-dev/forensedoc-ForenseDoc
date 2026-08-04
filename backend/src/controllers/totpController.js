import bcrypt from "bcryptjs";
import QRCode from "qrcode-svg";
import { prisma } from "../utils/prisma.js";
import { verifyTotpChallenge } from "../utils/jwt.js";
import { gerarSegredo, montarOtpauthUrl, formatarParaDigitacao } from "../utils/totp.js";
import {
  gerarCodigosDeRecuperacao,
  consumirCodigoDeRecuperacao,
  verificarCodigoDoApp,
  totpAtivo,
} from "../services/totpService.js";
import { emitirSessao } from "./authController.js";
import { registerLoginFailure, applyLoginBackoff, clearLoginFailures } from "../utils/loginBackoff.js";

/**
 * Cadastro e verificação do segundo fator.
 *
 * ─── Por que toda operação de escrita pede a senha ───────────────────────────
 *
 * Cadastrar, desligar ou regerar códigos são ações que MUDAM quem consegue
 * entrar. Sem pedir a senha, bastaria uma sessão sequestrada (aba aberta em
 * máquina compartilhada, XSS que roubasse o token) para o atacante trocar o
 * segundo fator pelo dele e trancar o dono para fora usando a própria defesa.
 *
 * Isso não fecha o caso do atacante que já tem a SENHA e cadastra o TOTP antes
 * do dono legítimo. Contra esse, o que vale é a allowlist de IP do painel, que
 * continua ativa: as duas camadas cobrem falhas diferentes.
 */

function respostaGenericaDeErro(res) {
  return res.status(400).json({ error: "Código inválido.", code: "TOTP_INVALID" });
}

/** Estado do segundo fator, para a tela decidir o que mostrar. */
export async function statusTotp(req, res) {
  const user = await prisma.user.findUnique({ where: { id: req.auth.userId } });
  if (!user) return res.status(404).json({ error: "Usuário não encontrado." });

  return res.json({
    ativo: totpAtivo(user),
    // Um cadastro começado e não confirmado: a tela oferece retomar.
    pendente: Boolean(user.totpSecret && !user.totpEnabledAt),
    codigosDeRecuperacaoRestantes: (user.totpRecoveryCodes || []).length,
    // Só o platform admin é OBRIGADO. Para os demais o segundo fator existe e é
    // opcional, e a tela precisa saber a diferença para não ameaçar quem não
    // será bloqueado.
    obrigatorio: Boolean(user.isPlatformAdmin),
  });
}

/**
 * Passo 1: gera o segredo e devolve o QR.
 *
 * O segredo é gravado já, com `totpEnabledAt` nulo. Guardá-lo apenas na tela
 * (ou em memória do servidor) faria o cadastro morrer a cada recarga de página
 * e a cada reinício, e um cadastro que se perde no meio é um cadastro que o
 * usuário desiste de fazer. Enquanto `totpEnabledAt` for nulo, o segredo não
 * exige nada de ninguém: o login segue como antes.
 */
export async function iniciarCadastroTotp(req, res) {
  try {
    const { senha } = req.body || {};
    const user = await prisma.user.findUnique({ where: { id: req.auth.userId } });
    if (!user) return res.status(404).json({ error: "Usuário não encontrado." });

    if (!(await bcrypt.compare(String(senha ?? ""), user.passwordHash))) {
      return res.status(401).json({ error: "Senha incorreta.", code: "INVALID_PASSWORD" });
    }

    if (totpAtivo(user)) {
      return res.status(409).json({
        error: "O segundo fator já está ativo. Desative antes de cadastrar outro aplicativo.",
        code: "TOTP_ALREADY_ENABLED",
      });
    }

    const segredo = gerarSegredo();
    await prisma.user.update({
      where: { id: user.id },
      data: { totpSecret: segredo, totpEnabledAt: null, totpLastStep: null },
    });

    const otpauthUrl = montarOtpauthUrl({ segredo, email: user.email });

    // SVG, e não imagem binária: escala sem borrar, não precisa de canvas no
    // servidor e vai direto para o HTML da tela.
    const qrSvg = new QRCode({
      content: otpauthUrl,
      padding: 2,
      width: 220,
      height: 220,
      ecl: "M",
      join: true,
    }).svg();

    return res.json({
      qrSvg,
      otpauthUrl,
      // Para quem não consegue ler o QR e prefere digitar no aplicativo.
      segredoParaDigitacao: formatarParaDigitacao(segredo),
    });
  } catch (error) {
    console.error("[TOTP] Erro ao iniciar cadastro:", error);
    return res.status(500).json({ error: "Erro interno no servidor." });
  }
}

/**
 * Passo 2: confirma que o aplicativo está gerando os códigos certos e ativa.
 *
 * A confirmação com um código real é o que impede o modo de falha mais cruel do
 * segundo fator: ativar sem que o aplicativo tenha guardado o segredo, e só
 * descobrir no próximo login, já trancado do lado de fora.
 */
export async function confirmarCadastroTotp(req, res) {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.auth.userId } });
    if (!user) return res.status(404).json({ error: "Usuário não encontrado." });
    if (!user.totpSecret) {
      return res.status(409).json({ error: "Nenhum cadastro em andamento.", code: "TOTP_NO_SETUP" });
    }
    if (user.totpEnabledAt) {
      return res.status(409).json({ error: "Segundo fator já ativo.", code: "TOTP_ALREADY_ENABLED" });
    }

    if (!(await verificarCodigoDoApp(user, req.body?.codigo))) {
      return respostaGenericaDeErro(res);
    }

    const { claros, hashes } = await gerarCodigosDeRecuperacao();
    await prisma.user.update({
      where: { id: user.id },
      data: { totpEnabledAt: new Date(), totpRecoveryCodes: hashes },
    });

    await prisma.auditLog
      .create({
        data: {
          tenantId: user.tenantId,
          userId: user.id,
          action: "totp_enabled",
          ipAddress: req.ip,
          userAgent: req.headers["user-agent"],
        },
      })
      .catch(() => {});

    /*
     * Única vez em que os códigos existem em texto claro fora do papel de quem
     * os guardará. O banco tem só os hashes, então nem o suporte pode recuperá-
     * los depois: perder todos significa desativar o segundo fator com a senha.
     */
    return res.json({ ativo: true, codigosDeRecuperacao: claros });
  } catch (error) {
    console.error("[TOTP] Erro ao confirmar cadastro:", error);
    return res.status(500).json({ error: "Erro interno no servidor." });
  }
}

/** Desligar exige senha E um código válido: as duas provas que ele representa. */
export async function desativarTotp(req, res) {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.auth.userId } });
    if (!user) return res.status(404).json({ error: "Usuário não encontrado." });

    if (!(await bcrypt.compare(String(req.body?.senha ?? ""), user.passwordHash))) {
      return res.status(401).json({ error: "Senha incorreta.", code: "INVALID_PASSWORD" });
    }

    if (totpAtivo(user)) {
      const okApp = await verificarCodigoDoApp(user, req.body?.codigo);
      const okRecuperacao = okApp ? false : await consumirCodigoDeRecuperacao(user, req.body?.codigo);
      if (!okApp && !okRecuperacao) return respostaGenericaDeErro(res);
    }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        totpSecret: null,
        totpEnabledAt: null,
        totpLastStep: null,
        totpRecoveryCodes: [],
      },
    });

    /*
     * As outras sessões caem.
     *
     * Desativar o segundo fator rebaixa o nível de verificação da conta, e
     * sessões abertas antes disso continuariam marcadas como `mfaVerified` até
     * expirarem em 30 dias. Se o motivo de desativar foi suspeita de acesso
     * indevido, manter essas sessões vivas anula o gesto.
     */
    await prisma.refreshToken.updateMany({
      where: { userId: user.id, revoked: false },
      data: { revoked: true },
    });

    await prisma.auditLog
      .create({
        data: {
          tenantId: user.tenantId,
          userId: user.id,
          action: "totp_disabled",
          ipAddress: req.ip,
          userAgent: req.headers["user-agent"],
        },
      })
      .catch(() => {});

    return res.json({ ativo: false });
  } catch (error) {
    console.error("[TOTP] Erro ao desativar:", error);
    return res.status(500).json({ error: "Erro interno no servidor." });
  }
}

/** Gera um lote novo e invalida o anterior por inteiro. */
export async function regerarCodigosDeRecuperacao(req, res) {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.auth.userId } });
    if (!user) return res.status(404).json({ error: "Usuário não encontrado." });
    if (!totpAtivo(user)) {
      return res.status(409).json({ error: "Segundo fator não está ativo.", code: "TOTP_NOT_ENABLED" });
    }

    if (!(await bcrypt.compare(String(req.body?.senha ?? ""), user.passwordHash))) {
      return res.status(401).json({ error: "Senha incorreta.", code: "INVALID_PASSWORD" });
    }
    if (!(await verificarCodigoDoApp(user, req.body?.codigo))) {
      return respostaGenericaDeErro(res);
    }

    const { claros, hashes } = await gerarCodigosDeRecuperacao();
    await prisma.user.update({ where: { id: user.id }, data: { totpRecoveryCodes: hashes } });

    return res.json({ codigosDeRecuperacao: claros });
  } catch (error) {
    console.error("[TOTP] Erro ao regerar códigos:", error);
    return res.status(500).json({ error: "Erro interno no servidor." });
  }
}

/**
 * Segundo passo do login.
 *
 * O desafio prova que a senha já foi apresentada; o código prova a posse do
 * aplicativo. Só aqui a sessão nasce, e ela nasce marcada como verificada.
 */
export async function verificarLoginTotp(req, res) {
  try {
    const { challenge, codigo } = req.body || {};

    let payload;
    try {
      payload = verifyTotpChallenge(String(challenge ?? ""));
    } catch {
      return res.status(401).json({
        error: "Sessão de verificação expirada. Faça login novamente.",
        code: "TOTP_CHALLENGE_EXPIRED",
      });
    }

    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      include: { tenant: true },
    });
    if (!user || !totpAtivo(user)) {
      return res.status(401).json({ error: "Verificação indisponível.", code: "TOTP_INVALID" });
    }

    // As mesmas revalidações do login: o desafio dura 5 minutos, mas uma conta
    // pode ter sido desativada ou suspensa nesse intervalo.
    if (!user.active) return res.status(403).json({ error: "Conta desativada.", code: "ACCOUNT_DEACTIVATED" });
    if (user.tenant.status === "SUSPENDED") {
      return res.status(403).json({ error: "Conta suspensa.", code: "ACCOUNT_SUSPENDED" });
    }

    const okApp = await verificarCodigoDoApp(user, codigo);
    const okRecuperacao = okApp ? false : await consumirCodigoDeRecuperacao(user, codigo);

    if (!okApp && !okRecuperacao) {
      /*
       * O código errado conta como falha de login da conta.
       *
       * São seis dígitos, ou seja, um milhão de combinações, e a janela aceita
       * três passos por vez. Sem contador, um atacante que já tenha a senha
       * chega ao código por força bruta: o desafio pode ser reemitido à vontade
       * refazendo o login. O backoff e o bloqueio por conta são o que tornam
       * isso inviável.
       */
      await registerLoginFailure(user.email);
      await applyLoginBackoff(user.email);
      return respostaGenericaDeErro(res);
    }

    await clearLoginFailures(user.email);

    const accessToken = await emitirSessao(res, user, { mfaVerified: true });

    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await prisma.auditLog
      .create({
        data: {
          tenantId: user.tenantId,
          userId: user.id,
          action: okRecuperacao ? "login_totp_recovery" : "login_totp",
          ipAddress: req.ip,
          userAgent: req.headers["user-agent"],
        },
      })
      .catch(() => {});

    return res.json({
      accessToken,
      // Usar um código de recuperação é sinal de que o aplicativo se perdeu. A
      // tela avisa quantos sobraram, para o operador não descobrir que acabaram
      // no dia em que precisar do último.
      codigosDeRecuperacaoRestantes: okRecuperacao
        ? (await prisma.user.findUnique({ where: { id: user.id } })).totpRecoveryCodes.length
        : undefined,
    });
  } catch (error) {
    console.error("[TOTP] Erro na verificação de login:", error);
    return res.status(500).json({ error: "Erro interno no servidor." });
  }
}
