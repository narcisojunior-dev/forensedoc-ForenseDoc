import React from "react";
import { riskFromDistance } from "../utils/geo.js";
import { Badge } from "./UiComponents.jsx";

/**
 * Destaque numérico de uma distância, com o risco associado.
 *
 * A cor vem de `riskFromDistance`, então continua sendo aplicada inline: ela é
 * calculada em tempo de execução e o Tailwind não gera classes dinâmicas.
 */
export function DistanceBanner({ label, km }) {
  const risk = riskFromDistance(km);
  return (
    <div
      data-report-block
      className="flex flex-wrap items-center justify-between gap-4 rounded-xl border px-5 py-4"
      style={{ borderColor: `${risk.color}55`, background: risk.bg }}
    >
      <div className="min-w-0">
        <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">{label}</div>
        <div className="mt-1 text-2xl font-bold tabular-nums" style={{ color: risk.color }}>
          {km.toFixed(2)} km
        </div>
      </div>
      <Badge label={risk.label} color={risk.color} />
    </div>
  );
}
