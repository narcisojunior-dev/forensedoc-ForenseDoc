import { separarCarimboProcessual } from "./carimboProcessual.js";

/**
 * Compatibilidade: a remoção de rodapé do PJe passou a fazer parte da separação
 * de carimbos processuais (PJe e PROJUDI), em `carimboProcessual.js`.
 */
export function stripPjeFooter(value) {
  const { text, removed } = separarCarimboProcessual(value);
  return { text, removed };
}
