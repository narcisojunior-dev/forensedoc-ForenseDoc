import { createHash } from "node:crypto";
import { stripDiacritics } from "./stringUtils.js";

/**
 * Política de senha (N8 da auditoria).
 *
 * O único requisito era `min(8)`. "senha123" e "12345678" passavam — e são
 * exatamente as que qualquer lista de força bruta tenta primeiro.
 *
 * A abordagem segue o NIST SP 800-63B, que abandonou regras de composição
 * (exigir maiúscula, número, símbolo): elas produzem "Senha@123", previsível
 * para máquina e difícil para humano, enquanto empurram o usuário a reusar e
 * anotar senhas. O que o NIST recomenda no lugar é o que está aqui —
 * comprimento maior e recusa de senhas sabidamente comprometidas.
 */

export const MIN_LENGTH = 10;

/**
 * Senhas triviais que aparecem no topo de qualquer wordlist em português e
 * inglês. Lista curta e embutida de propósito: é a rede que pega os casos
 * óbvios sem depender da rede externa. A cobertura ampla vem do HIBP abaixo.
 */
const COMUNS = new Set([
  "senha12345", "senha123456", "1234567890", "0123456789", "123456789",
  "qwertyuiop", "password12", "password123", "senhasenha", "minhasenha",
  "12345678910", "abcd123456", "adminadmin", "administrador", "forensedoc",
  "brasil2024", "brasil2025", "brasil2026", "advogado123", "senha@123",
]);

/**
 * Consulta o Have I Been Pwned por k-anonimato.
 *
 * Só os 5 primeiros caracteres do SHA-1 saem daqui; o serviço devolve todos os
 * sufixos daquele prefixo e a comparação acontece localmente. A senha em si
 * nunca trafega, nem o hash completo.
 *
 * FAIL-OPEN e com timeout curto: se o HIBP estiver fora do ar ou lento, o
 * cadastro segue. Bloquear o registro de clientes novos porque um serviço de
 * terceiro caiu seria trocar um risco por outro pior — as demais checagens
 * (comprimento, lista local, dados pessoais) continuam valendo offline.
 */
async function foiVazada(password) {
  if (process.env.PASSWORD_BREACH_CHECK === "false") return false;

  const hash = createHash("sha1").update(password).digest("hex").toUpperCase();
  const prefixo = hash.slice(0, 5);
  const sufixo = hash.slice(5);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2500);

  try {
    const res = await fetch(`https://api.pwnedpasswords.com/range/${prefixo}`, {
      signal: controller.signal,
      headers: { "User-Agent": "ForenseDoc-PasswordPolicy" },
    });
    if (!res.ok) return false;

    const corpo = await res.text();
    return corpo
      .split("\n")
      .some((linha) => linha.split(":")[0].trim().toUpperCase() === sufixo);
  } catch (err) {
    if (err.name !== "AbortError") {
      console.error("[PasswordPolicy] HIBP indisponível:", err.message);
    }
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** Normaliza para comparar senha contra nome/e-mail sem se perder em acento. */
const canonico = (v) => stripDiacritics(String(v || "")).toLowerCase();

/**
 * @returns {Promise<{ ok: true } | { ok: false, error: string }>}
 */
export async function validatePassword(password, { email = "", name = "" } = {}) {
  const senha = String(password || "");

  if (senha.length < MIN_LENGTH) {
    return { ok: false, error: `A senha deve ter no mínimo ${MIN_LENGTH} caracteres.` };
  }

  // Teto do bcrypt: ele trunca em 72 bytes, então aceitar mais dá ao usuário a
  // falsa impressão de que a cauda da senha conta para alguma coisa.
  if (Buffer.byteLength(senha, "utf8") > 72) {
    return { ok: false, error: "A senha deve ter no máximo 72 caracteres." };
  }

  const alvo = canonico(senha);

  if (COMUNS.has(alvo)) {
    return { ok: false, error: "Esta senha é muito comum. Escolha uma menos previsível." };
  }

  // Um único caractere repetido ("aaaaaaaaaa") passa no comprimento e não está
  // em lista nenhuma, mas tem entropia perto de zero.
  if (new Set(alvo).size <= 3) {
    return { ok: false, error: "A senha tem pouca variação de caracteres. Escolha outra." };
  }

  // Senha derivada dos próprios dados é a primeira coisa que se tenta num
  // ataque direcionado — e num sistema de escritório o e-mail é público.
  const localDoEmail = canonico(email).split("@")[0];
  if (localDoEmail.length >= 4 && alvo.includes(localDoEmail)) {
    return { ok: false, error: "A senha não pode conter seu e-mail." };
  }

  for (const parte of canonico(name).split(/\s+/)) {
    if (parte.length >= 4 && alvo.includes(parte)) {
      return { ok: false, error: "A senha não pode conter seu nome." };
    }
  }

  if (await foiVazada(senha)) {
    return {
      ok: false,
      error:
        "Esta senha apareceu em vazamentos públicos de dados e não pode ser usada. Escolha outra.",
    };
  }

  return { ok: true };
}
