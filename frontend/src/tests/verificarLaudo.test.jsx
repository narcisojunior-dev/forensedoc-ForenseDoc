import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { describe, it, expect, vi } from "vitest";

const http = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("../lib/axios", () => ({ api: http }));

const { default: VerificarLaudo } = await import("../pages/VerificarLaudo.jsx");

const renderizar = (rota = "/verificar") =>
  render(
    <MemoryRouter initialEntries={[rota]}>
      <Routes>
        <Route path="/verificar" element={<VerificarLaudo />} />
        <Route path="/verificar/:chave" element={<VerificarLaudo />} />
      </Routes>
    </MemoryRouter>
  );

const valido = {
  data: {
    situacao: "VALIDO",
    codigo: "FD-7KQ2-9XMR-4TVB",
    protocolo: "FD-20260919-A1B2C3D4E5",
    emitidoEm: "2026-09-19T12:00:00.000Z",
    laudo: { sha256: "A".repeat(64) },
    documentoAnalisado: { sha256: "B".repeat(64), sha1: "C".repeat(40) },
    titular: { nome: "R***** M******", cpf: "***.456.789-**" },
    emissor: "ForenseDoc",
    substituidoPor: null,
    cancelamento: null,
    aviso: "O que se verifica é o conteúdo do laudo, não o arquivo.",
  },
};

/*
 * NÃO há `beforeEach` limpando o mock, e isso é deliberado.
 *
 * No vitest 4.1.10, limpar (mockClear ou mockReset) um mock que registrou uma
 * chamada rejeitada faz esse resultado ser relatado como erro do teste que o
 * produziu, mesmo quando o componente capturou a rejeição corretamente. O
 * teste do 404 passava a falhar por causa da limpeza do teste seguinte.
 *
 * O isolamento é obtido de outro jeito: cada teste define a sua própria
 * implementação na primeira linha, e as asserções olham a ÚLTIMA chamada
 * (`ultimaChamada()`) em vez de perguntar se o mock foi chamado alguma vez com
 * certos argumentos. Assim uma chamada de teste anterior não satisfaz a
 * asserção de outro.
 */
const ultimaChamada = () => http.get.mock.calls.at(-1)?.[0];

describe("VerificarLaudo", () => {
  it("consulta sozinha quando a chave vem na URL do QR", async () => {
    http.get.mockResolvedValue(valido);
    renderizar("/verificar/FD-7KQ2-9XMR-4TVB");

    await waitFor(() => expect(ultimaChamada()).toBe("/public/laudos/FD-7KQ2-9XMR-4TVB"));
    expect(await screen.findByText(/laudo aut[êe]ntico/i)).toBeInTheDocument();
  });

  it("mostra os hashes por inteiro, que é o que se compara com o papel", async () => {
    http.get.mockResolvedValue(valido);
    renderizar("/verificar/FD-7KQ2-9XMR-4TVB");

    expect(await screen.findByText("A".repeat(64))).toBeInTheDocument();
    expect(screen.getByText("B".repeat(64))).toBeInTheDocument();
  });

  it("mostra o titular mascarado e explica por quê", async () => {
    http.get.mockResolvedValue(valido);
    renderizar("/verificar/FD-7KQ2-9XMR-4TVB");

    expect(await screen.findByText("R***** M******")).toBeInTheDocument();
    expect(screen.getByText(/parcialmente ocultos/i)).toBeInTheDocument();
  });

  it("busca pelo hash colado no formulário", async () => {
    http.get.mockResolvedValue(valido);
    renderizar();

    fireEvent.change(screen.getByLabelText(/c[óo]digo ou hash/i), { target: { value: "  " + "a".repeat(64) + " " } });
    fireEvent.click(screen.getByRole("button", { name: /verificar/i }));

    await waitFor(() => expect(ultimaChamada()).toBe(`/public/laudos/${"a".repeat(64)}`));
  });

  it("diz que não encontrou sem sugerir que a chave existe", async () => {
    /*
     * O mock LANÇA em vez de devolver promessa rejeitada. Do ponto de vista de
     * `try { await api.get(...) } catch`, os dois são indistinguíveis; a
     * diferença é que o vitest 4 registra o resultado de cada chamada de mock
     * e, quando esse resultado é uma promessa rejeitada, a ramificação que ele
     * cria para o registro fica sem tratador e é relatada como erro do teste,
     * mesmo com o componente capturando corretamente.
     *
     * O erro carrega `.response` porque é assim que o axios reporta o 404, e é
     * `.response.status` que a página lê para distinguir "não existe" de
     * "serviço fora do ar".
     */
    const erro404 = Object.assign(new Error("Request failed with status code 404"), {
      response: { status: 404 },
    });
    http.get.mockImplementation(() => {
      throw erro404;
    });
    renderizar("/verificar/FD-0000-0000-0000");

    expect(await screen.findByText(/nenhum laudo/i)).toBeInTheDocument();
  });

  it("aponta o laudo novo quando este foi substituído", async () => {
    http.get.mockResolvedValue({
      data: { ...valido.data, situacao: "SUBSTITUIDO", substituidoPor: "FD-ZZZZ-YYYY-XXXX" },
    });
    renderizar("/verificar/FD-7KQ2-9XMR-4TVB");

    expect(await screen.findByText(/substitu[íi]do/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /FD-ZZZZ-YYYY-XXXX/ })).toHaveAttribute(
      "href",
      "/verificar/FD-ZZZZ-YYYY-XXXX"
    );
  });
});
