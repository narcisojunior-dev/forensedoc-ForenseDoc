import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  captureFounderCode,
  getFounderCode,
  clearFounderCode,
  VALIDADE_CONVITE_MS,
} from "../utils/founderInvite.js";

/**
 * Convite de fundador guardado entre abas.
 *
 * O caso que este arquivo tranca é o percurso real do convidado: ele clica no
 * link, se cadastra, e precisa confirmar o e-mail. O link de confirmação abre
 * em OUTRA aba, e era ali que o convite sumia, porque o código vivia em
 * sessionStorage, que é por aba. O convidado caía na tela de planos sem o card
 * de fundador e sem nenhum campo para digitar o código.
 */

// Aceita tanto "?x=1" quanto "verify-email?x=1": prefixar "/" numa entrada
// que já começa com "/" produziria "//verify-email", que o jsdom lê como host.
const irPara = (destino) =>
  window.history.pushState({}, "", destino.startsWith("?") || destino === "" ? `/${destino}` : `/${destino.replace(/^\/+/, "")}`);

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  irPara("");
  vi.useRealTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("captureFounderCode", () => {
  it("guarda o código da URL", () => {
    irPara("?founder=FND-ABCD-1234");
    captureFounderCode();
    expect(getFounderCode()).toBe("FND-ABCD-1234");
  });

  it("normaliza para maiúsculas, porque o código é exibido assim", () => {
    irPara("?founder=fnd-abcd-1234");
    captureFounderCode();
    expect(getFounderCode()).toBe("FND-ABCD-1234");
  });

  it("ignora URL sem o parâmetro, sem apagar o que já estava guardado", () => {
    irPara("?founder=FND-ABCD-1234");
    captureFounderCode();
    irPara("?outra=coisa");
    captureFounderCode();
    expect(getFounderCode()).toBe("FND-ABCD-1234");
  });
});

describe("sobrevivência entre abas", () => {
  it("usa localStorage, que é compartilhado entre as abas do mesmo navegador", () => {
    // É o que faz o convite sobreviver ao link de confirmação de e-mail, que
    // o cliente de e-mail abre numa aba nova.
    irPara("?founder=FND-ABCD-1234");
    captureFounderCode();
    expect(localStorage.getItem("founder_invite_code")).toBeTruthy();
  });

  it("recupera o código numa aba que nunca viu o link", () => {
    irPara("?founder=FND-ABCD-1234");
    captureFounderCode();
    // A aba nova não tem sessionStorage nenhum, e mesmo assim precisa achar.
    sessionStorage.clear();
    irPara("verify-email?token=qualquer");
    expect(getFounderCode()).toBe("FND-ABCD-1234");
  });
});

describe("validade de 7 dias", () => {
  it("expira depois do prazo", () => {
    irPara("?founder=FND-ABCD-1234");
    captureFounderCode();
    irPara("");

    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.now() + VALIDADE_CONVITE_MS + 1000));
    expect(getFounderCode()).toBeNull();
  });

  it("apaga o registro vencido em vez de deixá-lo acumulando", () => {
    irPara("?founder=FND-ABCD-1234");
    captureFounderCode();
    irPara("");

    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.now() + VALIDADE_CONVITE_MS + 1000));
    getFounderCode();
    expect(localStorage.getItem("founder_invite_code")).toBeNull();
  });

  it("continua valendo dentro do prazo", () => {
    irPara("?founder=FND-ABCD-1234");
    captureFounderCode();
    irPara("");

    const seisDias = 6 * 24 * 60 * 60 * 1000;
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.now() + seisDias));
    expect(getFounderCode()).toBe("FND-ABCD-1234");
  });

  it("o prazo é de 7 dias", () => {
    expect(VALIDADE_CONVITE_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });
});

describe("precedência e limpeza", () => {
  it("a URL vence o que está guardado: o último link clicado é o que vale", () => {
    irPara("?founder=FND-ANTIGO-01");
    captureFounderCode();
    irPara("?founder=FND-NOVO-0002");
    expect(getFounderCode()).toBe("FND-NOVO-0002");
  });

  it("clearFounderCode descarta o convite", () => {
    irPara("?founder=FND-ABCD-1234");
    captureFounderCode();
    irPara("");
    clearFounderCode();
    expect(getFounderCode()).toBeNull();
  });
});

describe("robustez", () => {
  it("registro corrompido não derruba a tela", () => {
    localStorage.setItem("founder_invite_code", "isto-nao-e-json");
    expect(getFounderCode()).toBeNull();
  });

  it("registro sem data é descartado, em vez de valer para sempre", () => {
    localStorage.setItem("founder_invite_code", JSON.stringify({ codigo: "FND-ABCD-1234" }));
    expect(getFounderCode()).toBeNull();
  });

  it("storage bloqueado não derruba a captura nem a leitura", () => {
    const originalSet = Storage.prototype.setItem;
    const originalGet = Storage.prototype.getItem;
    Storage.prototype.setItem = () => { throw new Error("bloqueado"); };
    Storage.prototype.getItem = () => { throw new Error("bloqueado"); };
    try {
      irPara("?founder=FND-ABCD-1234");
      expect(() => captureFounderCode()).not.toThrow();
      // Sem storage, o código ainda vale enquanto a URL o carregar.
      expect(getFounderCode()).toBe("FND-ABCD-1234");
    } finally {
      Storage.prototype.setItem = originalSet;
      Storage.prototype.getItem = originalGet;
    }
  });
});
