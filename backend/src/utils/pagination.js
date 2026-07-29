/**
 * Paginação das rotas de listagem.
 *
 * Sem teto, `?limit=999999` puxa a tabela inteira numa consulta só — várias
 * dessas rotas ainda fazem `include` de relações, então o custo multiplica. E
 * `?page=-5` produzia `skip` negativo, que o Prisma rejeita com 500.
 *
 * As rotas de admin já aplicavam `Math.min(..., 100)` na mão; este helper leva
 * a mesma regra para as rotas de tenant e centraliza o limite num lugar só.
 */
const DEFAULT_MAX = 100;

export function parsePagination(query = {}, { def = 20, max = DEFAULT_MAX } = {}) {
  const rawPage = Number.parseInt(query.page, 10);
  const rawLimit = Number.parseInt(query.limit, 10);

  // `|| def` não serve para o limit: descartaria um `?limit=0` legítimo para o
  // default silenciosamente. O clamp explícito deixa o comportamento previsível.
  const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), max) : def;

  return { page, limit, skip: (page - 1) * limit };
}
