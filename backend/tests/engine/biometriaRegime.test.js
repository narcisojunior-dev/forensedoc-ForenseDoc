import { describe, it, expect } from "vitest";
import { analisarBiometria } from "../../src/engine/biometria.js";

const imagens = {
  imagens: [{ biometricaProvavel: true, page: 3, num: 7, width: 400, height: 500, megapixels: 0.2, exif: false, classificacao: "fotografia/biometria provável" }],
};
const base = { imagens, flat: "", alegaBiometria: true };

describe("BIO2 conforme o regime de autorização", () => {
  it("fora do INSS o BIO2 continua ALTA e sem nota", () => {
    const b = analisarBiometria(base);
    expect(b.achado.gravidade).toBe("ALTA");
    expect(b.nota_regime).toBeNull();
  });

  it("regime da IN 138 cobra também o hash da captura", () => {
    const b = analisarBiometria({ ...base, regime: { codigo: "IN_138_SELFIE_BANCO" } });
    expect(b.dados_do_processo_ausentes).toContain("hash da captura biométrica");
    expect(b.achado.gravidade).toBe("ALTA");
  });

  it("regime Meu INSS rebaixa o BIO2 e diz que a selfie é complementar", () => {
    const b = analisarBiometria({ ...base, regime: { codigo: "MEU_INSS_BIOMETRIA", via: "FACIAL" } });
    expect(b.achado.gravidade).toBe("MÉDIA");
    expect(b.achado.texto).toMatch(/elemento complementar/);
    expect(b.nota_regime).toMatch(/registro da autorização no Meu INSS/);
  });

  it("via gov.br tira a fotografia do objeto e não gera BIO2", () => {
    const b = analisarBiometria({ ...base, regime: { codigo: "IN_213_VIA_DUPLA", via: "GOVBR" } });
    expect(b.achado).toBeNull();
    expect(b.nota_regime).toMatch(/deixam de ser o objeto do exame/);
  });
});
