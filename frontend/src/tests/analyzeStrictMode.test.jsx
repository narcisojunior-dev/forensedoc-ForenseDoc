import React from "react";
import { render, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect, vi } from "vitest";

/**
 * Regressão: com o StrictMode (desenvolvimento), a tela de análise parava em
 * "Extraindo dados... 34%" mesmo com o laudo concluído no servidor.
 *
 * O StrictMode monta, desmonta e remonta o componente. A ref de "montado" só
 * era posta em `false` na desmontagem e nunca voltava a `true`, então o polling
 * se considerava abandonado e saía em silêncio.
 */
const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn() }));
const navegar = vi.hoisted(() => vi.fn());
vi.mock("react-router-dom", async (original) => ({ ...(await original()), useNavigate: () => navegar }));
vi.mock("../lib/axios.js", () => ({ api }));
vi.mock("../store/authStore.js", () => ({
  useAuthStore: Object.assign(() => ({}), { getState: () => ({ fetchBalance: vi.fn() }) }),
}));
vi.mock("react-hot-toast", () => ({ default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));

const { default: Analyze } = await import("../pages/Analyze.jsx");

describe("Analyze em StrictMode", () => {
  it("sai do processamento e abre o laudo quando a análise conclui", async () => {
    api.post.mockResolvedValue({ data: { analysisId: "a1", status: "PROCESSING" } });
    api.get.mockImplementation(async (url) => {
      if (url === "/analyses/a1/status") return { data: { status: "COMPLETED" } };
      if (url === "/analyses/a1/result") {
        return {
          data: {
            status: "COMPLETED",
            result: {
              text: JSON.stringify({ contrato: { numero: "1234567890" }, cliente: { nome: "Maria" }, assinatura: {} }),
              hashes: { sha256: "A".repeat(64), sha1: "B".repeat(40) },
              file: { name: "contrato.pdf", sizeBytes: 1024 },
              metadata: { warnings: [] },
              ipAnalysis: [],
              generatedAt: new Date().toISOString(),
            },
          },
        };
      }
      if (url === "/analyses/reviewable-fields") return { data: { campos: [] } };
      return { data: {} };
    });

    const { container } = render(
      <React.StrictMode>
        <MemoryRouter>
          <Analyze />
        </MemoryRouter>
      </React.StrictMode>
    );

    const input = container.querySelector('input[type="file"]');
    const arquivo = new File(["%PDF-1.7 conteudo"], "contrato.pdf", { type: "application/pdf" });
    fireEvent.change(input, { target: { files: [arquivo] } });

    // Concluída a análise, a tela abre a página do laudo.
    await waitFor(() => expect(navegar).toHaveBeenCalledWith("/dashboard/laudo/a1"), { timeout: 5000 });
  });
});
