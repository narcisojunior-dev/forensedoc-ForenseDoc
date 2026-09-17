import { describe, it, expect } from "vitest";
import { usaParserProprio } from "../src/utils/uploadRoutes.js";

/**
 * O parser global de 1 MB roda antes do roteador. Rota de upload fora desta
 * lista recebe 413 antes de ser escolhida; rota comum dentro dela ganha um corpo
 * que não tem motivo para aceitar.
 */
const req = (method, path) => ({ method, path });

describe("usaParserProprio", () => {
  it("mantém /api/analyze fora do parser global", () => {
    expect(usaParserProprio(req("POST", "/api/analyze"))).toBe(true);
  });

  it("libera o upload do PDF do processo e dos autos da réplica", () => {
    expect(usaParserProprio(req("POST", "/api/analyses/abc-123/process-comparison"))).toBe(true);
    expect(usaParserProprio(req("POST", "/api/replicas"))).toBe(true);
  });

  it("não libera leitura, minuta nem outras rotas", () => {
    expect(usaParserProprio(req("GET", "/api/replicas"))).toBe(false);
    expect(usaParserProprio(req("POST", "/api/replicas/abc/draft"))).toBe(false);
    expect(usaParserProprio(req("PATCH", "/api/analyses/abc/fields"))).toBe(false);
    expect(usaParserProprio(req("POST", "/api/auth/login"))).toBe(false);
    expect(usaParserProprio(req("GET", "/api/analyses/abc/process-comparison"))).toBe(false);
  });
});
