/**
 * Regras de senha exibidas na interface.
 *
 * ESPELHA `backend/src/utils/passwordPolicy.js`. As duas pontas precisam
 * concordar: quando o frontend prometia 8 caracteres e o backend passou a
 * exigir 10, o usuário preenchia o formulário inteiro, via o campo marcado como
 * válido e só descobria o problema no envio — no cadastro, depois de digitar
 * nome, CPF/CNPJ e OAB.
 *
 * Ao mexer na política do backend, atualize aqui também.
 *
 * O que NÃO dá para validar no cliente e portanto só o backend recusa:
 *   - senha em vazamento público (consulta ao HIBP);
 *   - lista de senhas comuns (mora no servidor).
 * Nesses casos a mensagem vem da API — por isso os formulários precisam
 * continuar exibindo o erro do backend, não só as regras locais.
 */

export const MIN_LENGTH = 10;
export const MAX_BYTES = 72; // onde o bcrypt trunca

/** Comprimento em bytes: um emoji ocupa 4, e é isso que o bcrypt conta. */
function byteLength(value) {
  return new TextEncoder().encode(value).length;
}

/** Remove acento e caixa para comparar senha contra nome/e-mail. */
function canonico(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

/**
 * Regras verificáveis no cliente, para feedback em tempo real.
 * `required: true` bloqueia o envio; as demais são orientação de força.
 */
export const passwordRules = [
  {
    id: "length",
    label: `Ao menos ${MIN_LENGTH} caracteres`,
    required: true,
    test: (senha) => senha.length >= MIN_LENGTH,
  },
  {
    id: "variety",
    label: "Ao menos 4 caracteres diferentes",
    required: true,
    test: (senha) => new Set(canonico(senha)).size > 3,
  },
  {
    id: "personal",
    label: "Não contém seu nome ou e-mail",
    required: true,
    test: (senha, { email = "", name = "" } = {}) => {
      const alvo = canonico(senha);
      if (!alvo) return false;

      const local = canonico(email).split("@")[0];
      if (local.length >= 4 && alvo.includes(local)) return false;

      return !canonico(name)
        .split(/\s+/)
        .some((parte) => parte.length >= 4 && alvo.includes(parte));
    },
  },
  {
    id: "mixed",
    label: "Misturar letras, números ou símbolos (recomendado)",
    required: false,
    test: (senha) => /[a-zA-Z]/.test(senha) && /[^a-zA-Z]/.test(senha),
  },
];

/**
 * @returns {{ ok: boolean, error: string | null }}
 */
export function checkPassword(senha, contexto = {}) {
  const valor = String(senha || "");

  if (byteLength(valor) > MAX_BYTES) {
    return { ok: false, error: `A senha deve ter no máximo ${MAX_BYTES} caracteres.` };
  }

  const falha = passwordRules.find((r) => r.required && !r.test(valor, contexto));
  return falha ? { ok: false, error: falha.label } : { ok: true, error: null };
}
