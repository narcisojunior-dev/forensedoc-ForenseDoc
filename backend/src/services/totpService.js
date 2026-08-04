import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { prisma } from "../utils/prisma.js";
import { verificarCodigo } from "../utils/totp.js";

/**
 * Regras do segundo fator, separadas do transporte HTTP.
 *
 * ─── O que o TOTP resolve aqui, e o que não resolve ──────────────────────────
 *
 * O painel administrativo concede crédito ilimitado, suspende escritórios, edita
 * preços e lê a trilha de auditoria. Até aqui, a única barreira além da senha
 * era a allowlist de IP (N2 da auditoria), que é mitigação de origem, não de
 * identidade: quem estiver na mesma origem e tiver a senha entra.
 *
 * O TOTP fecha a outra metade. As duas camadas continuam valendo juntas porque
 * falham de modos diferentes: a allowlist não protege contra senha vazada usada
 * de dentro da rede autorizada, e o TOTP não protege contra um banco vazado, já
 * que o segredo mora nele.
 */

const CODIGOS_DE_RECUPERACAO = 10;
const CUSTO_BCRYPT = 10;

/**
 * Códigos de recuperação em base32 sem vogais, para não formar palavra e não
 * confundir O com 0 nem I com 1 na leitura de um papel.
 */
const ALFABETO_RECUPERACAO = "BCDFGHJKLMNPQRSTVWXZ23456789";

function gerarCodigoDeRecuperacao() {
  const caracteres = Array.from(
    crypto.randomBytes(10),
    (byte) => ALFABETO_RECUPERACAO[byte % ALFABETO_RECUPERACAO.length]
  ).join("");
  return `${caracteres.slice(0, 5)}-${caracteres.slice(5)}`;
}

/**
 * Gera os códigos e devolve os dois lados: o texto claro (exibido UMA vez ao
 * usuário) e os hashes (o que vai para o banco).
 *
 * São hasheados porque valem tanto quanto a senha: cada um dispensa o
 * aplicativo autenticador. Guardá-los em claro transformaria o segundo fator em
 * mais uma senha guardada no mesmo banco.
 */
export async function gerarCodigosDeRecuperacao() {
  const claros = Array.from({ length: CODIGOS_DE_RECUPERACAO }, gerarCodigoDeRecuperacao);
  const hashes = await Promise.all(claros.map((codigo) => bcrypt.hash(codigo, CUSTO_BCRYPT)));
  return { claros, hashes };
}

/**
 * Consome um código de recuperação, se ele existir.
 *
 * A remoção é o ponto: código de recuperação é de uso único, e deixá-lo válido
 * depois de usado anula a razão de existirem vários.
 */
export async function consumirCodigoDeRecuperacao(user, codigoInformado) {
  const limpo = String(codigoInformado ?? "").trim().toUpperCase();
  if (!limpo) return false;

  for (const hash of user.totpRecoveryCodes || []) {
    if (await bcrypt.compare(limpo, hash)) {
      await prisma.user.update({
        where: { id: user.id },
        data: { totpRecoveryCodes: user.totpRecoveryCodes.filter((h) => h !== hash) },
      });
      return true;
    }
  }
  return false;
}

/**
 * Confere o código do aplicativo e queima o passo em que ele bateu.
 *
 * A gravação é CONDICIONAL ao passo ainda estar onde estava (`updateMany` com o
 * valor anterior no filtro). Sem isso, duas requisições paralelas com o mesmo
 * código passariam as duas: ambas leem "último passo é X", ambas validam, ambas
 * gravam. Com o filtro, a segunda não atualiza nenhuma linha e é recusada, que é
 * exatamente a proteção contra reapresentação que o passo existe para dar.
 */
export async function verificarCodigoDoApp(user, codigo) {
  if (!user?.totpSecret) return false;

  const passo = verificarCodigo(user.totpSecret, codigo);
  if (passo === null) return false;

  const anterior = user.totpLastStep === null ? null : BigInt(user.totpLastStep);
  if (anterior !== null && BigInt(passo) <= anterior) return false;

  const { count } = await prisma.user.updateMany({
    where: { id: user.id, totpLastStep: anterior },
    data: { totpLastStep: BigInt(passo) },
  });
  return count === 1;
}

/** Um único ponto de verdade para "este usuário precisa do segundo fator". */
export function totpAtivo(user) {
  return Boolean(user?.totpSecret && user?.totpEnabledAt);
}
