import { describe, it, expect } from "vitest";
import * as grausServidor from "../../src/engine/grausConclusao.js";
import * as grausTela from "../../../frontend/src/laudo/grausConclusao.js";
import * as eixosServidor from "../../src/engine/eixosAchado.js";
import * as eixosTela from "../../../frontend/src/laudo/eixosAchado.js";
import { issueBucket as bucketServidor } from "../../src/reports/laudoApresentacao.js";
import { issueBucket as bucketTela } from "../../../frontend/src/laudo/laudoUtils.js";

const CONSTATADOS = ["INS1", "INS4", "INS6", "INS9", "INS10"];
const NAO_VERIFICAVEIS = ["INS0", "INS2", "INS3", "INS5", "INS7", "INS8", "INS11"];

describe.each([
  ["servidor", grausServidor, eixosServidor, bucketServidor],
  ["tela", grausTela, eixosTela, bucketTela],
])("achados INS no %s", (_lado, graus, eixos, bucket) => {
  it.each(CONSTATADOS)("%s é constatado e vai para inconsistências do instrumento", (codigo) => {
    expect(graus.classificarGrauProcessual(codigo, "ALTA")).toBe(graus.GRAUS.CONSTATADO);
    expect(bucket({ codigo })).toBe("instrumento");
  });

  it.each(NAO_VERIFICAVEIS)("%s é não verificável e vai para lacunas", (codigo) => {
    expect(graus.classificarGrauProcessual(codigo, "MÉDIA")).toBe(graus.GRAUS.NAO_VERIFICAVEL);
    expect(bucket({ codigo })).toBe("lacunas");
  });

  it("eixo próprio, logo depois de assinatura", () => {
    expect(eixos.eixoDoAchado("INS3")).toEqual({ eixo: "autorizacao", ordem: 1 });
  });
});
