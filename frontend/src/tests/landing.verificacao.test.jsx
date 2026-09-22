import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect } from "vitest";
import Header from "../components/Layout/Header.jsx";
import Landing from "../pages/Landing.jsx";

const renderizar = (ui) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe("Entrada para a verificação de laudo", () => {
  it("está no topo da página inicial", () => {
    renderizar(<Header />);
    expect(screen.getByRole("link", { name: /verificar laudo/i })).toHaveAttribute("href", "/verificar");
  });

  it("está também no rodapé, que é onde se procura o que não é venda", () => {
    // A Landing renderiza o Header dentro dela, então a página tem os dois
    // links. A consulta é escopada ao rodapé para provar que a entrada existe
    // TAMBÉM ali, e não só no topo que some ao rolar.
    renderizar(<Landing />);
    const rodape = within(screen.getByRole("contentinfo"));
    expect(rodape.getByRole("link", { name: /verificar laudo/i })).toHaveAttribute("href", "/verificar");
  });

  it("o link do topo e o do rodapé apontam para a mesma página", () => {
    renderizar(<Landing />);
    const links = screen.getAllByRole("link", { name: /verificar laudo/i });
    expect(links).toHaveLength(2);
    links.forEach((l) => expect(l).toHaveAttribute("href", "/verificar"));
  });
});
