import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import ConfirmDialog from "../components/ConfirmDialog.jsx";

/**
 * O ConfirmDialog substituiu `window.confirm` e `window.prompt`, que os
 * navegadores suprimem em vários contextos (política corporativa, aba em
 * segundo plano) — quando isso acontece o `confirm` devolve `false` e a ação
 * simplesmente não ocorre, sem explicação.
 *
 * O ponto delicado testado aqui é o ANINHAMENTO: no painel admin o diálogo é
 * renderizado DENTRO do modal de detalhes do tenant, que fecha ao clicar fora.
 * Sem interromper a propagação, confirmar ou cancelar fechava os dois de uma vez.
 */

function setup(props = {}) {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  const utils = render(
    <ConfirmDialog
      open
      title="Suspender esta conta?"
      message="O escritório perde acesso imediatamente."
      confirmLabel="Suspender"
      onConfirm={onConfirm}
      onCancel={onCancel}
      {...props}
    />
  );
  return { onConfirm, onCancel, ...utils };
}

describe("ConfirmDialog", () => {
  it("não renderiza nada quando fechado", () => {
    const { container } = render(
      <ConfirmDialog open={false} title="x" onConfirm={vi.fn()} onCancel={vi.fn()} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("confirma e cancela pelos botões", () => {
    const { onConfirm, onCancel } = setup();

    fireEvent.click(screen.getByRole("button", { name: "Suspender" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("cancela ao clicar no overlay e ao apertar Escape", () => {
    const { onCancel } = setup();

    fireEvent.click(screen.getByRole("dialog"));
    expect(onCancel).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(2);
  });

  it("não deixa o clique escapar para um overlay ancestral", () => {
    // Réplica do arranjo do painel admin: o diálogo vive dentro de um modal que
    // fecha ao clicar fora. É o cenário que motivou o stopPropagation.
    const fecharModalDeBaixo = vi.fn();
    const onCancel = vi.fn();
    render(
      <div onClick={fecharModalDeBaixo}>
        <ConfirmDialog open title="x" onConfirm={vi.fn()} onCancel={onCancel} />
      </div>
    );

    fireEvent.click(screen.getByRole("dialog"));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(fecharModalDeBaixo).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    expect(fecharModalDeBaixo).not.toHaveBeenCalled();
  });

  describe("com motivo obrigatório (substitui o window.prompt)", () => {
    it("mantém a confirmação desabilitada até o motivo ter tamanho mínimo", () => {
      setup({ requireReason: true, minReasonLength: 3 });
      const confirmar = screen.getByRole("button", { name: "Suspender" });
      const campo = screen.getByRole("textbox");

      expect(confirmar).toBeDisabled();

      fireEvent.change(campo, { target: { value: "ab" } });
      expect(confirmar).toBeDisabled();
      expect(screen.getByText(/pelo menos 3 caracteres/i)).toBeInTheDocument();

      fireEvent.change(campo, { target: { value: "inadimplência" } });
      expect(confirmar).toBeEnabled();
    });

    it("entrega o motivo já sem espaços nas pontas", () => {
      const { onConfirm } = setup({ requireReason: true });
      fireEvent.change(screen.getByRole("textbox"), { target: { value: "  motivo real  " } });
      fireEvent.click(screen.getByRole("button", { name: "Suspender" }));

      expect(onConfirm).toHaveBeenCalledWith("motivo real");
    });

    it("recusa motivo só de espaços", () => {
      setup({ requireReason: true });
      fireEvent.change(screen.getByRole("textbox"), { target: { value: "      " } });
      expect(screen.getByRole("button", { name: "Suspender" })).toBeDisabled();
    });

    it("limpa o motivo ao reabrir, para não reenviar o texto abandonado", () => {
      const { rerender } = setup({ requireReason: true });
      fireEvent.change(screen.getByRole("textbox"), { target: { value: "rascunho abandonado" } });

      rerender(
        <ConfirmDialog open={false} title="x" requireReason onConfirm={vi.fn()} onCancel={vi.fn()} />
      );
      rerender(
        <ConfirmDialog open title="x" requireReason onConfirm={vi.fn()} onCancel={vi.fn()} />
      );

      expect(screen.getByRole("textbox")).toHaveValue("");
    });
  });

  describe("estado ocupado", () => {
    it("bloqueia confirmar, cancelar, overlay e Escape durante a operação", () => {
      const { onConfirm, onCancel } = setup({ busy: true });

      expect(screen.getByRole("button", { name: /Suspender/ })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Cancelar" })).toBeDisabled();

      fireEvent.click(screen.getByRole("dialog"));
      fireEvent.keyDown(document, { key: "Escape" });

      // Fechar no meio de uma suspensão deixaria o operador sem saber se a ação
      // foi aplicada.
      expect(onCancel).not.toHaveBeenCalled();
      expect(onConfirm).not.toHaveBeenCalled();
    });
  });
});
