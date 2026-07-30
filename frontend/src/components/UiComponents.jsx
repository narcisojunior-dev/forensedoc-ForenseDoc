import React from "react";

/**
 * Primitivas do laudo pericial, no design system v3 (Tailwind + tokens).
 *
 * Antes viviam na CSS legada da v2.2 (`styles/ForenseDoc.css`), com classes como
 * `.row`, `.card` e `.note` e cores em variáveis CSS próprias. Isso deixava a
 * tela de análise e o visualizador do histórico com um visual estranho ao resto
 * do sistema, que usa os tokens do Tailwind (`glass`, `surface-border`,
 * `foreground`, `primary`, `accent`).
 *
 * ─── data-report-block ──────────────────────────────────────────────────────
 * Cada bloco que não pode ser cortado ao meio na exportação em PDF carrega
 * `data-report-block`. O `utils/pdfExport.js` usa esse atributo para calcular as
 * quebras de página — antes ele dependia dos nomes de classe da CSS legada, o
 * que amarrava a aparência do laudo à paginação do arquivo gerado.
 */

/** Tons semânticos do laudo, mapeados para os tokens do sistema. */
export const TONES = {
  neutral: { text: "text-zinc-400", border: "border-l-zinc-600", bg: "bg-zinc-500/5", hex: "#a1a1aa" },
  info: { text: "text-primary", border: "border-l-primary", bg: "bg-primary/5", hex: "#3b82f6" },
  ok: { text: "text-emerald-500", border: "border-l-emerald-500", bg: "bg-emerald-500/5", hex: "#10b981" },
  warn: { text: "text-accent", border: "border-l-accent", bg: "bg-accent/5", hex: "#f59e0b" },
  danger: { text: "text-red-500", border: "border-l-red-500", bg: "bg-red-500/5", hex: "#ef4444" },
};

/** Par rótulo/valor — a unidade mais repetida do laudo. */
export function Row({ label, value, mono = false, nullText = "Não identificado", valueClass = "" }) {
  const isEmpty = value === null || value === undefined || value === "";
  return (
    <div
      data-report-block
      className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b border-surface-border/60 py-2.5 last:border-b-0"
    >
      <span className="shrink-0 text-[13px] text-zinc-400">{label}</span>
      <span
        className={[
          "min-w-0 break-words text-right text-[13px]",
          mono ? "font-mono text-[12px] tracking-tight" : "",
          isEmpty ? "italic text-zinc-600" : "text-foreground",
          valueClass,
        ].filter(Boolean).join(" ")}
      >
        {isEmpty ? nullText : value}
      </span>
    </div>
  );
}

/** Selo de status. `tone` é o caminho preferido; `color` cobre os casos calculados. */
export function Badge({ label, tone = "info", color }) {
  const hex = color || TONES[tone].hex;
  return (
    <span
      className="inline-flex shrink-0 items-center rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider"
      style={{ color: hex, background: `${hex}1a`, borderColor: `${hex}4d` }}
    >
      {label}
    </span>
  );
}

/** Card de seção do laudo (§ 1, § 2, …). */
export function Section({ title, danger = false, children }) {
  return (
    <section className="glass overflow-hidden rounded-2xl border border-surface-border">
      <header
        className={[
          "border-b px-5 py-3.5 text-[13px] font-bold tracking-wide",
          danger
            ? "border-red-500/25 bg-red-500/10 text-red-400"
            : "border-surface-border bg-surface/40 text-foreground",
        ].join(" ")}
      >
        {title}
      </header>
      <div className="px-5 py-4">{children}</div>
    </section>
  );
}

/**
 * Subtítulo dentro de uma seção.
 *
 * A margem superior é incondicional. Uma variante `first:mt-0` parecia elegante,
 * mas `first:` avalia por elemento-pai: no § 9 cada grupo de normas tem a
 * própria `div`, então TODO subtítulo era "o primeiro" e o espaçamento entre
 * grupos desaparecia.
 */
export function SubHead({ children }) {
  return (
    <h4 className="mb-2 mt-6 text-[11px] font-bold uppercase tracking-[0.12em] text-zinc-500">
      {children}
    </h4>
  );
}

/** Bloco explicativo, com barra lateral colorida pelo tom. */
export function Note({ tone = "neutral", children }) {
  const t = TONES[tone];
  return (
    <div
      data-report-block
      className={`mt-3 rounded-r-lg border-l-2 ${t.border} ${t.bg} px-4 py-3 text-[13px] leading-relaxed text-zinc-300`}
    >
      {children}
    </div>
  );
}

/** Item de lista de achados (evidências, alertas de metadados). */
export function Flag({ tone = "danger", children }) {
  const t = TONES[tone];
  return (
    <div className="flex gap-2.5 border-b border-surface-border/60 py-2.5 text-[13px] leading-relaxed text-zinc-300 last:border-b-0">
      <span className={`${t.text} font-bold`} aria-hidden="true">▸</span>
      <span className="min-w-0">{children}</span>
    </div>
  );
}

/** Grade de duas colunas dos confrontos (hash × hash, geo × geo). */
export function CompareGrid({ children }) {
  return <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">{children}</div>;
}

/**
 * Cartão de confronto. Serve para hash e para coordenada — os dois têm a mesma
 * anatomia: título, valor em destaque e metadados abaixo.
 */
export function CompareCard({ tone, title, value, valueClass = "", children }) {
  const t = TONES[tone];
  return (
    <div
      data-report-block
      className="rounded-xl border border-surface-border bg-background/40 p-4"
      style={{ borderTopWidth: 2, borderTopColor: t.hex }}
    >
      <div className={`mb-2 text-[11px] font-bold uppercase tracking-wider ${t.text}`}>{title}</div>
      <div className={`break-all font-mono text-[12px] leading-relaxed ${valueClass || t.text}`}>
        {value}
      </div>
      {children && <div className="mt-2.5 text-[11.5px] leading-relaxed text-zinc-500">{children}</div>}
    </div>
  );
}

/** Entrada da fundamentação normativa (§ 9). */
export function Norm({ dispositivo, sintese }) {
  return (
    <div data-report-block className="border-b border-surface-border/60 py-3 last:border-b-0">
      <div className="text-[12.5px] font-bold text-primary">{dispositivo}</div>
      <div className="mt-1 text-[12.5px] leading-relaxed text-zinc-400">{sintese}</div>
    </div>
  );
}
