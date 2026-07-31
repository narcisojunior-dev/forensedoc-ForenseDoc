import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Termos from "../pages/legal/Termos.jsx";
import Privacidade from "../pages/legal/Privacidade.jsx";
import Landing from "../pages/Landing.jsx";

/**
 * As duas páginas jurídicas precisam ser alcançáveis SEM sessão.
 *
 * Quem ainda não é cliente lê antes de decidir, e o titular de dado que aparece
 * num contrato analisado nunca terá conta aqui, embora a LGPD (art. 9º) lhe
 * assegure saber como o tratamento acontece.
 */
const renderizar = (ui) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe("Landing", () => {
  it("liga para os dois documentos no rodapé", () => {
    renderizar(<Landing />);
    expect(screen.getByRole("link", { name: /termos de uso/i })).toHaveAttribute("href", "/termos");
    expect(screen.getByRole("link", { name: /política de privacidade/i })).toHaveAttribute(
      "href",
      "/privacidade"
    );
  });
});

describe("Termos de Uso", () => {
  it("declara o que o laudo NÃO é", () => {
    // É a informação que mais importa: um laudo automatizado apresentado como
    // perícia definitiva cria expectativa que o produto não sustenta, e a
    // frustração dessa expectativa é problema do fornecedor (CDC, art. 30).
    renderizar(<Termos />);
    expect(screen.getByText(/não substitui perícia judicial/i)).toBeInTheDocument();
    expect(screen.getByText(/perícia judicial, que só pode ser produzida por perito/i)).toBeInTheDocument();
  });

  it("informa o direito de arrependimento de 7 dias", () => {
    renderizar(<Termos />);
    expect(screen.getByText(/7 dias corridos/i)).toBeInTheDocument();
  });

  it("condiciona o envio a fundamento legítimo sobre o documento", () => {
    renderizar(<Termos />);
    expect(screen.getByText(/fundamento legítimo para tratar/i)).toBeInTheDocument();
  });
});

describe("Política de Privacidade", () => {
  it("declara o prazo de 30 dias do documento original", () => {
    // O prazo tem que bater com o que a rotina de expurgo aplica. Política que
    // promete o que o sistema não cumpre vira prova documental contra quem a
    // publicou.
    renderizar(<Privacidade />);
    expect(screen.getAllByText(/30 dias/i).length).toBeGreaterThan(0);
  });

  it("distingue os papéis de controlador e operador", () => {
    renderizar(<Privacidade />);
    expect(screen.getByText(/Controlador \(art\. 5º, VI\)/i)).toBeInTheDocument();
    expect(screen.getByText(/Operador \(art\. 5º, VII\)/i)).toBeInTheDocument();
  });

  it("divulga a transferência internacional dos serviços de geolocalização", () => {
    // O armazenamento é nacional, mas endereços, IPs e coordenadas vão para
    // serviços operados no exterior. Omitir isso seria a omissão mais grave que
    // uma política deste sistema poderia ter.
    renderizar(<Privacidade />);
    expect(screen.getByText(/Transferência internacional/i)).toBeInTheDocument();
    expect(screen.getByText(/art\. 33, IX/i)).toBeInTheDocument();
  });

  it("explica que o laudo sobrevive ao expurgo do original", () => {
    renderizar(<Privacidade />);
    expect(screen.getByText(/SHA-256 e SHA-1 do arquivo analisado/i)).toBeInTheDocument();
  });

  it("encaminha o titular ao escritório, que é quem decide o tratamento", () => {
    renderizar(<Privacidade />);
    expect(screen.getByText(/o pedido deve ser dirigido a esse escritório/i)).toBeInTheDocument();
  });
});
