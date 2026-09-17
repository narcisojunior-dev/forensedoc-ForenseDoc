import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect, vi } from "vitest";

/**
 * Administrador da plataforma vê créditos ilimitados, sem oferta de compra.
 * Cliente continua vendo o saldo e o botão de recarga.
 */
const estado = vi.hoisted(() => ({ balance: null }));
vi.mock("../store/authStore", () => ({ useAuthStore: () => estado }));

const { default: CreditWidget } = await import("../components/CreditWidget.jsx");

const renderizar = () => render(<MemoryRouter><CreditWidget /></MemoryRouter>);

describe("CreditWidget", () => {
  it("administrador: mostra Ilimitado e nenhuma compra", () => {
    estado.balance = { total: 0, details: { monthly: 0, avulso: 0, emergency: 0, manual: 0 }, unlimited: true };
    renderizar();
    expect(screen.getByText("Ilimitado")).toBeInTheDocument();
    expect(screen.queryByText(/Recarregar Agora|Comprar Créditos/)).not.toBeInTheDocument();
  });

  it("cliente sem saldo: mostra zero e o botão de recarga", () => {
    estado.balance = { total: 0, details: { monthly: 0, avulso: 0, emergency: 0, manual: 0 }, unlimited: false };
    renderizar();
    expect(screen.getByText("0")).toBeInTheDocument();
    expect(screen.getByText("Recarregar Agora")).toBeInTheDocument();
    expect(screen.queryByText("Ilimitado")).not.toBeInTheDocument();
  });
});
