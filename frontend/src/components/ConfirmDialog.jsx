import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";

/**
 * Confirmação de ação destrutiva, no design system v3.
 *
 * Substitui `window.confirm` e `window.prompt`, que tinham dois problemas:
 *
 *   1. Visual: são renderizados pelo navegador, ignoram o tema do produto e
 *      quebram a consistência que o resto do sistema mantém.
 *   2. Funcional: navegadores suprimem diálogos nativos em vários contextos —
 *      política corporativa, aba em segundo plano, iframe cross-origin. Quando
 *      isso acontece, `confirm` devolve `false` e `prompt` devolve `null`, e a
 *      ação simplesmente NÃO ACONTECE sem nenhuma explicação. No painel admin
 *      isso significava não conseguir suspender uma conta.
 *
 * Com `requireReason`, pede um texto obrigatório (motivo da suspensão) — o que
 * o `prompt` fazia, agora estilizado e sem depender do navegador.
 */
export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirmar",
  cancelLabel = "Cancelar",
  tone = "danger",
  requireReason = false,
  reasonLabel = "Motivo",
  reasonPlaceholder = "",
  minReasonLength = 3,
  busy = false,
  onConfirm,
  onCancel,
}) {
  const [reason, setReason] = useState("");
  const inputRef = useRef(null);
  const confirmRef = useRef(null);

  // Reabrir precisa começar limpo: um motivo digitado e abandonado não pode
  // reaparecer na próxima suspensão, muito menos ser enviado por engano.
  useEffect(() => {
    if (open) setReason("");
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape" && !busy) onCancel();
    };
    document.addEventListener("keydown", onKey);
    // Foco no que o operador precisa preencher ou confirmar.
    const alvo = requireReason ? inputRef.current : confirmRef.current;
    alvo?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [open, busy, requireReason, onCancel]);

  if (!open) return null;

  const podeConfirmar = !busy && (!requireReason || reason.trim().length >= minReasonLength);
  const confirmClass =
    tone === "danger"
      ? "bg-red-600 hover:bg-red-500 shadow-red-600/20"
      : "bg-primary hover:bg-primary-hover shadow-primary/20";

  /*
   * O diálogo pode ser renderizado DENTRO de outro overlay que fecha ao clicar
   * fora (o modal de detalhes do tenant). Sem interromper a propagação, cancelar
   * ou confirmar aqui também fechava o modal de baixo.
   */
  const handleOverlayClick = (e) => {
    e.stopPropagation();
    if (!busy) onCancel();
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4"
      onClick={handleOverlayClick}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-surface-border bg-surface p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start gap-3">
          <div
            className={`shrink-0 rounded-full border p-2 ${
              tone === "danger"
                ? "border-red-500/20 bg-red-500/10"
                : "border-primary/20 bg-primary/10"
            }`}
          >
            <AlertTriangle className={`h-5 w-5 ${tone === "danger" ? "text-red-500" : "text-primary"}`} />
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-bold text-foreground">{title}</h2>
            {message && <p className="mt-1 text-sm leading-relaxed text-zinc-400">{message}</p>}
          </div>
        </div>

        {requireReason && (
          <div className="mb-5">
            <label className="mb-1 block text-xs font-medium text-zinc-400">{reasonLabel}</label>
            <textarea
              ref={inputRef}
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={reasonPlaceholder}
              className="block w-full resize-none rounded-lg border border-surface-border bg-background px-3 py-2 text-sm text-foreground placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-primary"
            />
            {reason.trim().length > 0 && reason.trim().length < minReasonLength && (
              <p className="mt-1 text-xs text-amber-500">
                Descreva com pelo menos {minReasonLength} caracteres.
              </p>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-lg border border-surface-border bg-secondary px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-secondary-hover disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={() => onConfirm(requireReason ? reason.trim() : undefined)}
            disabled={!podeConfirmar}
            className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-bold text-white shadow-lg transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${confirmClass}`}
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
