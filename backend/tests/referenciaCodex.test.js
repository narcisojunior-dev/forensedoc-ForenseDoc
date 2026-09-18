import { describe, it, expect } from "vitest";
import { compararReferenciaComInstrumento, validarFormaDaReferencia } from "../src/utils/referenciaResidencial.js";
import { recomputeDerived } from "../src/services/analysisRecompute.js";
import { montarConfrontoEnderecos } from "../src/utils/confrontoEnderecos.js";

describe("referência: regressões independentes", () => {
  it.each(["Rua do Sol, 10", "Av Brasil, 10", "Rua das Flores, Pedro II", "Rua X, 10, Manaus, AM, 69000-000"])("não confunde logradouro com UF: %s", (s) => expect(validarFormaDaReferencia(s).ok).toBe(true));
  it.each(["69000-00", "69000-0000", "690000", "690000000"])("recusa CEP malformado: %s", (cep) => expect(validarFormaDaReferencia(`Rua X, Manaus, AM, CEP ${cep}`).code).toBe("CEP_INVALIDO"));
  it("recusa UF explicitamente inválida", () => expect(validarFormaDaReferencia("Rua X, Manaus, XY, 69000-000").code).toBe("UF_INVALIDA"));
  it("detecta UF antes de qualquer consulta externa", () => expect(compararReferenciaComInstrumento({ estado: "AM" }, "Rua X, Pedro II, PI").motivo).toBe("UF"));
  it("confere CEP contra o instrumento", () => expect(compararReferenciaComInstrumento({ estado: "AM", cep: "69435-000" }, "Rua X, Manaus, AM, 69000-000").motivo).toBe("CEP"));
  it("ausência de CEP não vira divergência", () => expect(compararReferenciaComInstrumento({ estado: "AM", cep: "69435-000" }, "Rua X, Manaus, AM")).toBeNull());
  it("preserva B e C no recálculo com residência recusada", () => {
    const input = { home: { estado_confronto: "RECUSADO_CONFLITO", geo: null, emissao_geo: { lat: 0, lon: 1, precisao: "municipio", fonte: "base municipal de teste" } }, contractGeo: { lat: 0, lon: 0, fonte: "log de teste", precision: "gps" }, ipAnalysis: [{ endereco: "192.0.2.1", geo: { lat: 1, lon: 0, source: "provedor de teste" } }] };
    const r = recomputeDerived(input, { cliente: {}, assinatura: {}, ips: [] });
    for (const id of ["gps-x-emissao", "gps-x-ip"]) {
      const par = r.confronto_enderecos.pares.find(p => p.id === id);
      expect(par.km).toBeCloseTo(111.1949266, 5);
      expect(par.memoria_calculo).toContain("Haversine");
      expect(par.metodo.para.fonte).toBeTruthy();
    }
    expect(r.contractGeo.distance).toBeNull();
  });
  it("não inventa coordenada para emissão ausente", () => {
    const par = montarConfrontoEnderecos({ gps: { lat: 0, lon: 0 } }).pares.find(p => p.id === "gps-x-emissao");
    expect(par.km).toBeNull(); expect(par.indisponivel).toContain("emissao"); expect(par.metodo).toBeNull();
  });
});
