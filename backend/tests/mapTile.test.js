import { describe, it, expect } from "vitest";
import { parametrosDoBloco } from "../src/controllers/mapTileController.js";

describe("parametrosDoBloco", () => {
  it("aceita coordenadas de bloco válidas", () => {
    expect(parametrosDoBloco({ z: "5", x: "10", y: "16" })).toEqual({ z: 5, x: 10, y: 16 });
  });

  it("recusa zoom, índice fora da grade e valores não inteiros", () => {
    expect(parametrosDoBloco({ z: "19", x: "0", y: "0" })).toBeNull();
    expect(parametrosDoBloco({ z: "2", x: "4", y: "0" })).toBeNull();
    expect(parametrosDoBloco({ z: "2", x: "-1", y: "0" })).toBeNull();
    expect(parametrosDoBloco({ z: "2", x: "1.5", y: "0" })).toBeNull();
    expect(parametrosDoBloco({ z: "a", x: "0", y: "0" })).toBeNull();
  });
});
