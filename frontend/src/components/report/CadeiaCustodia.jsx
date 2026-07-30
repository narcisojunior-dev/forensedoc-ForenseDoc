import React from "react";
import { CheckCircle2, AlertTriangle, Scale } from "lucide-react";
import { Badge, Note, SubHead, TONES } from "../UiComponents.jsx";

/**
 * § 4.1 — cadeia de custódia com fundamento normativo por elemento.
 *
 * A avaliação vem PRONTA do servidor (`result.cadeiaCustodia`, produzida por
 * `backend/src/reports/custodyChain.js`). Recalcular aqui era o que fazia a tela
 * e o PDF divergirem: cada lado tinha sua própria régua de completude e seu
 * próprio texto jurídico, e bastava alterar um para as duas versões do laudo
 * discordarem sobre o mesmo documento.
 */
export default function CadeiaCustodia({ cadeia }) {
  const { elementos, presentes, total, faltantes, avaliacao, definicao, efeitoProcessual } = cadeia;
  const tom = TONES[avaliacao.tom] || TONES.neutral;

  return (
    <>
      <SubHead>§ 4.1 · Cadeia de custódia do ato de assinatura</SubHead>

      <Note tone="info">{definicao}</Note>

      {/* Placar primeiro: quem lê em diagonal precisa do veredito; o
          detalhamento abaixo sustenta a conclusão. */}
      <div
        data-report-block
        className={`mt-3 flex flex-wrap items-center justify-between gap-4 rounded-xl border px-5 py-4 ${tom.bg}`}
        style={{ borderColor: `${tom.hex}55` }}
      >
        <div>
          <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">
            Completude da cadeia de custódia
          </div>
          <div className="mt-1 text-2xl font-bold tabular-nums" style={{ color: tom.hex }}>
            {presentes}/{total} · {avaliacao.pct}%
          </div>
        </div>
        <Badge label={avaliacao.rotulo} tone={avaliacao.tom} />
      </div>

      <Note tone={avaliacao.tom}>{avaliacao.leitura}</Note>

      <div className="mt-4 space-y-2.5">
        {elementos.map((e) => (
          <div
            key={e.chave}
            data-report-block
            className={`rounded-xl border px-4 py-3 ${
              e.presente
                ? "border-surface-border bg-surface/30"
                : "border-red-500/25 bg-red-500/[0.04]"
            }`}
          >
            <div className="flex items-start gap-2.5">
              {e.presente ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
              ) : (
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span
                    className={`text-[13px] font-bold ${
                      e.presente ? "text-foreground" : "text-red-400"
                    }`}
                  >
                    {e.nome}
                  </span>
                  <span
                    className={`text-[10px] font-bold uppercase tracking-wider ${
                      e.presente ? "text-emerald-500" : "text-red-500"
                    }`}
                  >
                    {e.presente ? "Presente" : "Ausente"}
                  </span>
                </div>

                <p className="mt-1.5 text-[12.5px] leading-relaxed text-zinc-400">
                  <span className="text-zinc-500">Função probatória: </span>
                  {e.comprova}
                </p>

                <p className="mt-1 flex items-start gap-1.5 text-[11.5px] leading-relaxed text-zinc-500">
                  <Scale className="mt-0.5 h-3 w-3 shrink-0" />
                  <span>{e.norma}</span>
                </p>

                {/* O efeito da ausência só aparece quando o elemento falta: no
                    laudo interessa a consequência concreta, não a hipótese. */}
                {!e.presente && (
                  <p className="mt-1.5 text-[12.5px] leading-relaxed text-red-400/90">
                    <span className="font-medium">Efeito da ausência: </span>
                    {e.ausencia}
                  </p>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {faltantes.length > 0 && (
        <Note tone="danger">
          <strong>Elementos ausentes ({faltantes.length}):</strong>{" "}
          {faltantes.map((e) => e.nome.toLowerCase()).join("; ")}.
        </Note>
      )}

      <Note tone="info">{efeitoProcessual}</Note>
    </>
  );
}
