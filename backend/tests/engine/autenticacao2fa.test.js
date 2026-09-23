import { describe, it, expect } from "vitest";
import { stripDiacritics } from "../../src/engine/format.js";

describe("Segundo fator de autenticação (AUT1)", () => {
  it("deve ser exigido quando assinatura eletrônica carece de 2FA", () => {
    const simularVerificacao2FA = ({ metodo, tipo, texto }) => {
      const metodoAssinatura = stripDiacritics(metodo || "").toLowerCase();
      const trilhaTexto = stripDiacritics(texto || "").toLowerCase();
      const temICP = metodoAssinatura.includes("icp") || trilhaTexto.includes("icp-brasil") || trilhaTexto.includes("certificado digital");
      const tem2FA = /\b(sms|whatsapp|token|otp|segundo fator|duplo fator|codigo de seguranca por celular|codigo enviado|chave temporaria)\b/i.test(metodoAssinatura + " " + trilhaTexto);

      if (!temICP && !tem2FA && (tipo || "").toLowerCase().includes("eletr")) {
        return {
          codigo: "AUT1",
          gravidade: "MÉDIA",
          titulo: "Segundo fator de autenticação (2FA) não comprovado no dossiê",
        };
      }
      return null;
    };

    // Caso 1: Apenas clique/biometria sem comprovação de SMS/WhatsApp/OTP
    const r1 = simularVerificacao2FA({
      metodo: "Aceite eletrônico via tela",
      tipo: "Eletrônica",
      texto: "Contrato assinado eletronicamente via plataforma web pelo signatário.",
    });
    expect(r1).not.toBeNull();
    expect(r1.codigo).toBe("AUT1");

    // Caso 2: Contrato com SMS e Token OTP
    const r2 = simularVerificacao2FA({
      metodo: "SMS com Token OTP",
      tipo: "Eletrônica",
      texto: "Código SMS enviado ao celular (11) 99999-9999 com validação de token.",
    });
    expect(r2).toBeNull();

    // Caso 3: Assinatura com Certificado Digital ICP-Brasil
    const r3 = simularVerificacao2FA({
      metodo: "Certificado Digital ICP-Brasil",
      tipo: "Digital",
      texto: "Assinatura qualificada padrão ICP-Brasil com carimbo de tempo ITI.",
    });
    expect(r3).toBeNull();
  });
});
