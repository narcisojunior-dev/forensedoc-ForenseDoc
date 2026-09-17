import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import fixture from "./fixtures/replica.json";

/**
 * Renderização das telas do motor pericial v2 com dados no formato real que o
 * backend produz. O build não pega acesso a campo ausente nem `.toFixed` em
 * valor que não é número; só renderizar pega.
 */

const apiMock = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), delete: vi.fn(), patch: vi.fn() }));
vi.mock("../lib/axios.js", () => ({ api: apiMock }));
vi.mock("react-hot-toast", () => {
  const toast = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() });
  return { default: toast };
});

const { default: SumarioExecutivo } = await import("../components/report/SumarioExecutivo.jsx");
const { default: AchadosIrregularidade } = await import("../components/report/AchadosIrregularidade.jsx");
const { default: ConfrontoProcesso } = await import("../components/report/ConfrontoProcesso.jsx");
const { default: Replica } = await import("../pages/Replica.jsx");

describe("seções do laudo", () => {
  it("sumário executivo mostra grau, placar e diligências", () => {
    render(
      <SumarioExecutivo
        sumario={{
          suspicionGrade: { label: "ALTA", rationale: "1 achado de gravidade ALTA identificado." },
          intro: "Leitura crítica do exame.",
          meta: { contractDate: "28/10/2025", signatureDate: "sem data", methods: "SMS", sha256: "ABC…123", size: "10 KB", pages: "2 páginas" },
          findings: [{ severity: "ALTA", key: "k1", title: "Hash inválido.", text: "Detalhe." }],
          geo: { items: [{ label: "GPS · assinatura", distance: 41.2, role: "gps", location: "coordenada" }], description: "Distâncias." },
          ipCards: [{ endereco: "177.104.55.201", badge: "ACESSO PROVÁVEL", role: "access", text: "Operadora." }],
          synthesis: "Síntese.",
          diligences: [{ key: "d1", title: "Logs brutos", text: "Exigir eventos." }],
          disclaimer: "Aviso.",
        }}
      />
    );
    // Grau de suspeição e severidade do achado: os dois selos dizem ALTA.
    expect(screen.getAllByText("ALTA")).toHaveLength(2);
    expect(screen.getByText("Hash inválido.")).toBeInTheDocument();
    expect(screen.getByText("Logs brutos.")).toBeInTheDocument();
  });

  it("achados estruturados com código e gravidade", () => {
    render(<AchadosIrregularidade extracted={{ achados_irregularidade: [{ codigo: "CET1", gravidade: "ALTA", titulo: "Demonstrativo do CET ausente", texto: "x" }] }} />);
    expect(screen.getByText("Demonstrativo do CET ausente")).toBeInTheDocument();
  });

  it("ferramenta de confronto avisa revisão posterior ao confronto", () => {
    render(
      <ConfrontoProcesso
        analysisId="a1"
        confronto={{ status: "COMPLETED", resultado: "DIVERGÊNCIAS A CONFERIR", camposRevisadosAte: null }}
        ultimaRevisao="2026-09-16T10:00:00.000Z"
        onAtualizado={vi.fn()}
      />
    );
    expect(screen.getByText(/Houve revisão de campos depois deste confronto/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Refazer com outro PDF/ })).toBeEnabled();
  });
});

describe("página de réplica processual", () => {
  beforeEach(() => {
    apiMock.get.mockReset();
    apiMock.get.mockImplementation(async (url) => {
      if (url === "/replicas") {
        return { data: { replicas: [{ id: "r-1", status: "COMPLETED", createdAt: fixture.createdAt, files: fixture.files, signals: 5, candidates: ["N"], hasDraft: true }], retentionHours: 168 } };
      }
      if (url === "/replicas/scenarios") return { data: { scenarios: [{ letra: "N", titulo: "Contestação sem contrato" }] } };
      if (url === "/replicas/r-1") return { data: { replica: fixture } };
      throw new Error(`inesperado: ${url}`);
    });
  });

  it("abre uma réplica concluída com documentos, achados, cenário e minuta", async () => {
    render(<Replica />);
    const item = await screen.findByText(/inicial\.txt, contestacao\.txt/);
    fireEvent.click(item);

    expect(await screen.findByText("1 · Documentos classificados")).toBeInTheDocument();
    expect(screen.getByText(/2 · Achados para conferência/)).toBeInTheDocument();
    expect(screen.getByText("4 · Cenário e revisão humana")).toBeInTheDocument();
    expect(screen.getByText("5 · Minuta · cenário N")).toBeInTheDocument();
    // Sem a declaração de conferência, a minuta não pode ser montada.
    expect(screen.getByRole("button", { name: /Montar minuta revisável/ })).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: /Conferi as evidências/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Montar minuta revisável/ })).toBeEnabled());
  });
});
