import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryRouter } from "react-router-dom";

/**
 * Segundo passo do login.
 *
 * O que precisa ficar preso aqui é o comportamento da TELA diante de um login
 * que não devolveu token: ela tem que trocar para o passo do código em vez de
 * tratar a resposta como falha e mandar o usuário tentar a senha de novo.
 *
 * E o inverso: desafio vencido precisa devolver o usuário ao passo da senha,
 * porque insistir no código não resolve nada depois dos 5 minutos.
 */

const navigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const real = await vi.importActual("react-router-dom");
  return { ...real, useNavigate: () => navigate };
});

const login = vi.fn();
const verifyTotp = vi.fn();
const estado = { user: { id: "u1" }, login, verifyTotp };

vi.mock("../store/authStore", () => ({
  useAuthStore: Object.assign(
    (seletor) => seletor(estado),
    { getState: () => estado }
  ),
}));

vi.mock("react-hot-toast", () => {
  const toast = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() });
  return { default: toast, __esModule: true };
});

const { default: Login } = await import("../pages/Login.jsx");
const { default: toast } = await import("react-hot-toast");

function renderizar() {
  return render(
    <MemoryRouter>
      <Login />
    </MemoryRouter>
  );
}

async function entrarComSenha() {
  fireEvent.change(screen.getByPlaceholderText("voce@escritorio.com.br"), {
    target: { value: "admin@forensedoc.test" },
  });
  fireEvent.change(screen.getByPlaceholderText("••••••••"), {
    target: { value: "senha-muito-boa-123" },
  });
  fireEvent.click(screen.getByRole("button", { name: /entrar/i }));
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

describe("Login com segundo fator", () => {
  it("troca para o passo do código quando o servidor pede TOTP", async () => {
    login.mockResolvedValue({ success: false, totpRequired: true, challenge: "ch-1" });

    renderizar();
    await entrarComSenha();

    expect(await screen.findByText(/verificação em duas etapas/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/código de verificação/i)).toBeInTheDocument();
    // O erro genérico de credencial não pode aparecer: nada falhou.
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("não anuncia códigos de recuperação para quem não tem", async () => {
    login.mockResolvedValue({
      success: false,
      totpRequired: true,
      challenge: "ch-1",
      recuperacaoDisponivel: false,
    });

    renderizar();
    await entrarComSenha();
    await screen.findByLabelText(/código de verificação/i);

    expect(screen.queryByText(/códigos de recuperação/i)).not.toBeInTheDocument();
  });

  it("verifica o código e entra", async () => {
    login.mockResolvedValue({ success: false, totpRequired: true, challenge: "ch-1" });
    verifyTotp.mockResolvedValue({ success: true });

    renderizar();
    await entrarComSenha();

    fireEvent.change(await screen.findByLabelText(/código de verificação/i), {
      target: { value: "123456" },
    });
    fireEvent.click(screen.getByRole("button", { name: /verificar e entrar/i }));

    await waitFor(() => expect(verifyTotp).toHaveBeenCalledWith("ch-1", "123456"));
    await waitFor(() => expect(navigate).toHaveBeenCalled());
  });

  it("código errado mantém a tela no passo do código e limpa o campo", async () => {
    login.mockResolvedValue({ success: false, totpRequired: true, challenge: "ch-1" });
    verifyTotp.mockResolvedValue({ success: false, error: "Código inválido." });

    renderizar();
    await entrarComSenha();

    const campo = await screen.findByLabelText(/código de verificação/i);
    fireEvent.change(campo, { target: { value: "000000" } });
    fireEvent.click(screen.getByRole("button", { name: /verificar e entrar/i }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Código inválido."));
    expect(screen.getByLabelText(/código de verificação/i)).toHaveValue("");
    expect(navigate).not.toHaveBeenCalled();
  });

  it("desafio vencido devolve o usuário ao passo da senha", async () => {
    login.mockResolvedValue({ success: false, totpRequired: true, challenge: "ch-1" });
    verifyTotp.mockResolvedValue({
      success: false,
      expirado: true,
      error: "Sessão de verificação expirada. Faça login novamente.",
    });

    renderizar();
    await entrarComSenha();

    fireEvent.change(await screen.findByLabelText(/código de verificação/i), {
      target: { value: "123456" },
    });
    fireEvent.click(screen.getByRole("button", { name: /verificar e entrar/i }));

    // Insistir no código não adianta depois dos 5 minutos: a senha precisa ser
    // reapresentada para um desafio novo ser emitido.
    expect(await screen.findByPlaceholderText("voce@escritorio.com.br")).toBeInTheDocument();
    expect(screen.queryByLabelText(/código de verificação/i)).not.toBeInTheDocument();
  });

  it("login normal, sem TOTP, segue direto", async () => {
    login.mockResolvedValue({ success: true });

    renderizar();
    await entrarComSenha();

    await waitFor(() => expect(navigate).toHaveBeenCalled());
    expect(screen.queryByLabelText(/código de verificação/i)).not.toBeInTheDocument();
  });
});
