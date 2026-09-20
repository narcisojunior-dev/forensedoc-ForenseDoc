/**
 * Mascaramento para a página pública de verificação de laudo.
 *
 * A página existe para que alguém com o laudo em mãos confirme que o QR e o
 * hash não foram trocados. Para isso basta RECONHECER o titular, não é preciso
 * identificá-lo: quem já sabe de quem se trata confirma, quem não sabe não
 * descobre. É o princípio da necessidade (LGPD, art. 6º, III).
 *
 * O comprimento é preservado de propósito. "R***** M******" e "R** M*" são
 * pessoas diferentes para quem confere, e esconder o tamanho tornaria a
 * conferência inútil sem proteger mais ninguém.
 */

/** Partículas com até duas letras (de, da, do, e) não identificam e ficam. */
const TAMANHO_MINIMO_PARA_MASCARAR = 3;

export function mascararNome(nome) {
  if (typeof nome !== "string") return null;
  const palavras = nome.trim().split(/\s+/).filter(Boolean);
  if (palavras.length === 0) return null;

  return palavras
    .map((palavra) => {
      if (palavra.length < TAMANHO_MINIMO_PARA_MASCARAR) return palavra;
      return palavra[0].toUpperCase() + "*".repeat(palavra.length - 1);
    })
    .join(" ");
}

/**
 * CPF na convenção de divulgação parcial já usada por Receita Federal e CNJ:
 * ocultos os três primeiros e os dois últimos dígitos. Os seis do meio bastam
 * para conferir e não permitem reconstruir o número, porque os dois finais são
 * justamente os verificadores.
 */
export function mascararCpf(cpf) {
  if (typeof cpf !== "string") return null;
  const digitos = cpf.replace(/\D/g, "");
  if (digitos.length !== 11) return null;
  return `***.${digitos.slice(3, 6)}.${digitos.slice(6, 9)}-**`;
}
