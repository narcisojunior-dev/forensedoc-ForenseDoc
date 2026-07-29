import { describe, it, expect } from "vitest";
import { parsePagination } from "../src/utils/pagination.js";

/**
 * Regressão da falha H2 da auditoria.
 *
 * As rotas de listagem usavam `parseInt(req.query.limit) || 20` sem teto:
 * `?limit=999999` puxava a tabela inteira numa consulta só, e `?page=-5`
 * produzia `skip` negativo, que o Prisma rejeita com 500.
 */
describe("parsePagination", () => {
  it("usa os padrões quando não há query", () => {
    expect(parsePagination({})).toEqual({ page: 1, limit: 20, skip: 0 });
  });

  it("limita o take ao teto mesmo com valores absurdos", () => {
    expect(parsePagination({ limit: "999999" }).limit).toBe(100);
    expect(parsePagination({ limit: "999999" }, { max: 50 }).limit).toBe(50);
  });

  it("nunca produz skip negativo", () => {
    expect(parsePagination({ page: "-5" }).skip).toBe(0);
    expect(parsePagination({ page: "0" }).page).toBe(1);
  });

  it("ignora valores não numéricos e cai no padrão", () => {
    expect(parsePagination({ page: "abc", limit: "xyz" })).toEqual({
      page: 1,
      limit: 20,
      skip: 0,
    });
  });

  it("recusa limit menor que 1 em vez de zerar a consulta", () => {
    expect(parsePagination({ limit: "0" }).limit).toBe(1);
    expect(parsePagination({ limit: "-10" }).limit).toBe(1);
  });

  it("calcula o skip a partir da página pedida", () => {
    expect(parsePagination({ page: "3", limit: "10" })).toEqual({
      page: 3,
      limit: 10,
      skip: 20,
    });
  });

  it("respeita um default diferente por rota", () => {
    expect(parsePagination({}, { def: 30 }).limit).toBe(30);
  });
});
