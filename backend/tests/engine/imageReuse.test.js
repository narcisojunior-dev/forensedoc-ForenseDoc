import { describe, it, expect } from "vitest";
import { localizarReusoDeImagem, montarAchadoReuso } from "../../src/services/imageReuseService.js";

const HASH = "631EDB54979F5568DD4C0000000000000000000000000000000000000000ABCD";

function dbFalso(linhas) {
  const chamadas = [];
  return {
    chamadas,
    $queryRaw: async (strings, ...valores) => {
      chamadas.push({ sql: strings.join("?"), valores });
      return linhas;
    },
  };
}

describe("localizarReusoDeImagem", () => {
  it("procura o hash só no tenant e fora da análise atual", async () => {
    const db = dbFalso([{ id: "a-anterior", createdAt: new Date("2026-08-01T12:00:00Z"), report_id: "FD-20260801-ABC", contrato: "123" }]);
    const r = await localizarReusoDeImagem({ db, tenantId: "t1", analysisId: "a-atual", hashes: [HASH.toLowerCase()] });
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ hash: HASH, analysisId: "a-anterior", reportId: "FD-20260801-ABC", contrato: "123" });
    expect(db.chamadas[0].valores).toEqual(["t1", "a-atual", "", `%${HASH}%`]);
    expect(db.chamadas[0].sql).toMatch(/"tenantId" = \?/);
  });
  it("exclui na consulta a mesma cópia do documento (mesmo SHA-256 do arquivo)", async () => {
    const db = dbFalso([]);
    const doc = "ABC18B73E5731E29D0BC4DEEDB56A132C7F9336CA8B162CD74125B3D7AB43A5E";
    await localizarReusoDeImagem({ db, tenantId: "t1", analysisId: "a", hashes: [HASH], documentoSha256: doc.toLowerCase() });
    expect(db.chamadas[0].valores).toEqual(["t1", "a", doc, `%${HASH}%`]);
    expect(db.chamadas[0].sql).toMatch(/result->'hashes'->>'sha256'/);
  });
  it("outra cópia do mesmo contrato não é reúso", async () => {
    const db = dbFalso([
      { id: "b", createdAt: new Date("2026-09-19T00:00:00Z"), report_id: "FD-20260919-ABC", contrato: "6046501059" },
      { id: "c", createdAt: new Date("2026-09-20T00:00:00Z"), report_id: "FD-20260920-XYZ", contrato: "999" },
    ]);
    const r = await localizarReusoDeImagem({ db, tenantId: "t1", analysisId: "a", hashes: [HASH], contratoAtual: "6046501059" });
    expect(r.map((o) => o.analysisId)).toEqual(["c"]);
  });
  it("ignora hash inválido e lista vazia sem consultar", async () => {
    const db = dbFalso([]);
    expect(await localizarReusoDeImagem({ db, tenantId: "t1", analysisId: "a", hashes: ["abc", null] })).toEqual([]);
    expect(db.chamadas).toHaveLength(0);
  });
});

describe("montarAchadoReuso", () => {
  it("é nulo sem ocorrências", () => {
    expect(montarAchadoReuso([])).toBeNull();
  });
  it("várias análises do mesmo laudo anterior contam uma vez", () => {
    const o = { hash: HASH, analysisId: "x", createdAt: "2026-08-01T12:00:00Z", reportId: "FD-20260801-ABC", contrato: "123" };
    const a = montarAchadoReuso([o, { ...o, analysisId: "y" }, { ...o, analysisId: "z" }], { contratoAtual: "456" });
    expect(a.texto.match(/FD-20260801-ABC/g)).toHaveLength(1);
  });
  it("monta IMG6 crítico, constatado, citando o laudo anterior", () => {
    const a = montarAchadoReuso([{ hash: HASH, analysisId: "x", createdAt: "2026-08-01T12:00:00Z", reportId: "FD-20260801-ABC", contrato: "123" }], { contratoAtual: "456" });
    expect(a).toMatchObject({ codigo: "IMG6", gravidade: "CRÍTICO", grau: "CONSTATADO" });
    expect(a.texto).toMatch(/FD-20260801-ABC \(contrato 123\)/);
    expect(a.texto).toMatch(/contrato 456/);
  });
});
