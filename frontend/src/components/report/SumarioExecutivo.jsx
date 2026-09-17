import React from "react";
import { Badge, SubHead, Note } from "../UiComponents.jsx";
import { distanciaKm, distanciaSuspeita, formatarDistancia } from "../../laudo/distancia.js";

/**
 * Sumário executivo de irregularidades (motor pericial v2): placar de
 * gravidade, confronto GPS × IP, triagem dos IPs e diligências recomendadas.
 *
 * Calculado e persistido no servidor (`engine/irregularitySummary.js`), e
 * recalculado a cada correção do operador, para a tela e o PDF lerem a mesma
 * síntese.
 */

const TOM_DA_SEVERIDADE = { ALTA: "danger", "MÉDIA": "warn", INFO: "neutral", "FAVORÁVEL": "ok" };
const TOM_DO_GRAU = { "CRÍTICA": "danger", ALTA: "danger", MODERADA: "warn", BAIXA: "ok" };

// Nulo é ausência: "não calculada", nunca "0,00 km".
const formatKm = (km) => formatarDistancia(km) || "não calculada";

/** Escala logarítmica de 0,1 a 10.000 km: GPS e IP cabem na mesma régua. */
function posicaoNaEscala(km) {
  const v = Math.log10(Math.max(0.1, Math.min(10000, distanciaKm(km) ?? 0.1)));
  return ((v + 1) / 5) * 100;
}

export default function SumarioExecutivo({ sumario: bruto }) {
  if (!bruto) return null;
  // Sumários gravados por versões anteriores podem trazer ponto sem distância
  // válida (nulo convertido em zero). Esses pontos não são desenhados.
  const sumario = bruto.geo
    ? { ...bruto, geo: { ...bruto.geo, items: (bruto.geo.items || []).filter((i) => distanciaKm(i.distance) !== null && !distanciaSuspeita(i.distance)) } }
    : bruto;
  const grau = sumario.suspicionGrade;

  return (
    <div className="space-y-4">
      <div
        data-report-block
        className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-surface-border bg-surface/30 px-4 py-3"
      >
        <div>
          <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-zinc-500">
            Grau de suspeição técnica
          </div>
          {grau?.rationale && <div className="mt-0.5 text-[12.5px] text-zinc-400">{grau.rationale}</div>}
        </div>
        {grau && <Badge label={grau.label} tone={TOM_DO_GRAU[grau.label] || "neutral"} />}
      </div>

      <p data-report-block className="text-[13px] leading-relaxed text-zinc-300">
        {sumario.intro}
      </p>
      {sumario.meta && (
        <p data-report-block className="text-[12px] leading-relaxed text-zinc-500">
          Contrato {sumario.meta.contractDate} · assinatura {sumario.meta.signatureDate} ({sumario.meta.methods}) ·
          SHA-256 {sumario.meta.sha256} · {sumario.meta.size} · {sumario.meta.pages}
        </p>
      )}

      <SubHead>Placar de gravidade</SubHead>
      <div className="space-y-2">
        {(sumario.findings || []).map((f) => (
          <div
            key={f.key}
            data-report-block
            className="flex gap-3 rounded-lg border border-surface-border bg-surface/20 px-3 py-2.5"
          >
            <div className="w-[92px] shrink-0">
              <Badge label={f.severity} tone={TOM_DA_SEVERIDADE[f.severity] || "neutral"} />
            </div>
            <p className="text-[12.5px] leading-relaxed text-zinc-300">
              <b className="text-foreground">{f.title}</b> {f.text}
            </p>
          </div>
        ))}
      </div>

      {sumario.geo?.items?.length > 0 && (
        <>
          <SubHead>GPS × IP: onde o documento diz que o ato ocorreu</SubHead>
          <p className="text-[12.5px] leading-relaxed text-zinc-400">{sumario.geo.description}</p>
          <div data-report-block className="rounded-xl border border-surface-border bg-surface/20 px-4 pb-4 pt-6">
            <div className="relative h-2 rounded-full bg-surface-border">
              {sumario.geo.items.map((item, i) => (
                <div
                  key={`${item.label}-${i}`}
                  className="absolute -top-1.5 h-5 w-5 -translate-x-1/2 rounded-full border-2 border-background"
                  style={{
                    left: `${posicaoNaEscala(item.distance)}%`,
                    background: item.role === "gps" ? "#10b981" : item.role === "access" ? "#f59e0b" : "#3b82f6",
                  }}
                  title={`${item.label}: ${formatKm(item.distance)}`}
                />
              ))}
            </div>
            <div className="mt-2 flex justify-between font-mono text-[10px] text-zinc-500">
              {["0,1 km", "1 km", "10 km", "100 km", "1.000 km", "10.000 km"].map((t) => (
                <span key={t}>{t}</span>
              ))}
            </div>
            <ul className="mt-3 space-y-1 text-[12px] text-zinc-400">
              {sumario.geo.items.map((item, i) => (
                <li key={`${item.label}-l-${i}`}>
                  <b className="text-foreground">{item.label}</b> · {formatKm(item.distance)} da referência ·{" "}
                  {item.location}
                </li>
              ))}
            </ul>
          </div>
        </>
      )}

      {sumario.ipCards?.length > 0 && (
        <>
          <SubHead>Triagem dos endereços IP</SubHead>
          <div className="grid gap-2 md:grid-cols-3">
            {sumario.ipCards.map((ip) => (
              <div
                key={ip.endereco}
                data-report-block
                className="rounded-lg border border-surface-border bg-surface/20 p-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="break-all font-mono text-[12px] font-bold text-foreground">{ip.endereco}</span>
                  <Badge label={ip.badge} tone={ip.role === "access" ? "warn" : "info"} />
                </div>
                <p className="mt-1.5 text-[12px] leading-relaxed text-zinc-400">{ip.text}</p>
              </div>
            ))}
          </div>
        </>
      )}

      {sumario.synthesis && <Note tone="info">{sumario.synthesis}</Note>}

      {sumario.diligences?.length > 0 && (
        <>
          <SubHead>Diligências recomendadas</SubHead>
          <ol className="space-y-2">
            {sumario.diligences.map((d, i) => (
              <li key={d.key} data-report-block className="flex gap-3 text-[12.5px] leading-relaxed text-zinc-300">
                <span className="font-mono text-[12px] font-bold text-primary">{String(i + 1).padStart(2, "0")}</span>
                <span>
                  <b className="text-foreground">{d.title}.</b> {d.text}
                </span>
              </li>
            ))}
          </ol>
        </>
      )}

      {sumario.disclaimer && <Note>{sumario.disclaimer}</Note>}
    </div>
  );
}
