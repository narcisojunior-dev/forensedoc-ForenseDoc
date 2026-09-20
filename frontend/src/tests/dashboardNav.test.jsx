import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Ordem e visibilidade do menu lateral.
 *
 * A posição de "Administração" não é preferência estética: o item dá acesso a
 * suspender conta, conceder crédito e ler auditoria de toda a base. Se ele
 * escorregar de volta para o fim da lista numa refatoração, o operador perde o
 * caminho mais curto para a tela que usa em incidente — e ninguém percebe,
 * porque o link continua funcionando.
 */
const estado = vi.hoisted(() => ({ user: null, logout: vi.fn(), balance: null }));
vi.mock("../store/authStore", () => ({ useAuthStore: () => estado }));

const { default: DashboardLayout } = await import("../components/Layout/DashboardLayout.jsx");

const renderizar = () => render(<MemoryRouter><DashboardLayout /></MemoryRouter>);

// Só os itens de navegação: o rodapé jurídico vive em outro <nav>.
const itensDoMenu = () =>
  Array.from(document.querySelectorAll('nav[aria-label="Navegação principal"] a')).map((a) =>
    a.textContent.trim()
  );

beforeEach(() => {
  estado.user = null;
  estado.balance = null;
  localStorage.clear();
});

afterEach(cleanup);

describe("Menu lateral do dashboard", () => {
  it("operador da plataforma: Administração vem antes de Visão Geral", () => {
    estado.user = { name: "Ana", isPlatformAdmin: true };
    renderizar();

    const itens = itensDoMenu();
    expect(itens.indexOf("Administração")).toBe(0);
    expect(itens.indexOf("Administração")).toBeLessThan(itens.indexOf("Visão Geral"));
  });

  it("usuário comum não recebe o item de Administração", () => {
    estado.user = { name: "Bruno", isPlatformAdmin: false };
    renderizar();

    expect(itensDoMenu()).not.toContain("Administração");
    expect(screen.getByRole("link", { name: "Visão Geral" })).toBeInTheDocument();
  });

  it("recolher o menu guarda a preferência para a próxima sessão", () => {
    estado.user = { name: "Ana", isPlatformAdmin: true };
    renderizar();

    fireEvent.click(screen.getByRole("button", { name: "Recolher menu" }));

    expect(localStorage.getItem("forensedoc:sidebar-colapsada")).toBe("1");
    expect(screen.getByRole("button", { name: "Expandir menu" })).toBeInTheDocument();
  });

  it("volta recolhido quando a preferência já está gravada", () => {
    localStorage.setItem("forensedoc:sidebar-colapsada", "1");
    estado.user = { name: "Ana", isPlatformAdmin: true };
    renderizar();

    expect(screen.getByRole("button", { name: "Expandir menu" })).toBeInTheDocument();
  });
});
