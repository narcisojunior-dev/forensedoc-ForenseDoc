import React from "react";
import { Badge, Flag, Note } from "../UiComponents.jsx";
import { classificarGrauProcessual } from "../../laudo/grausConclusao.js";

/**
 * § 6 — achados de irregularidade do motor pericial.
 *
 * O motor devolve cada achado com código, gravidade, título e texto
 * (`achados_irregularidade`). A lista em texto corrido
 * (`evidencias_irregularidade`) continua existindo para laudos antigos, e é o
 * que se mostra quando não há a versão estruturada.
 */

export function tomDaGravidade(gravidade) {
  const g = String(gravidade || "").toUpperCase();
  if (/CR[IÍ]TIC|ALTA|ALTO/.test(g)) return "danger";
  if (/M[ÉE]DI|ATEN/.test(g)) return "warn";
  if (/FAVOR/.test(g)) return "ok";
  return "neutral";
}

export function tomDoGrau(grau) {
  const g = String(grau || "").toUpperCase();
  if (g === "CONSTATADO") return "danger";
  if (g === "NÃO VERIFICÁVEL") return "warn";
  if (g === "INDÍCIO") return "info";
  return "neutral";
}

export default function AchadosIrregularidade({ extracted }) {
  const achados = Array.isArray(extracted?.achados_irregularidade) ? extracted.achados_irregularidade : [];
  const evidencias = extracted?.evidencias_irregularidade || [];

  if (!achados.length && !evidencias.length) {
    return (
      <Note>
        A análise dos elementos extraídos deste documento não identificou evidência autônoma de
        irregularidade. A ausência de achado nesta seção não convalida o instrumento: as ressalvas
        dos §§ 4 e 5 subsistem e devem ser lidas em conjunto.
      </Note>
    );
  }

  if (!achados.length) {
    return evidencias.map((ev, i) => (
      <Flag key={i} tone="danger">
        {ev}
      </Flag>
    ));
  }

  return (
    <div className="space-y-2.5">
      {achados.map((achado, i) => {
        const tom = tomDaGravidade(achado.gravidade);
        const grau = achado.grau || classificarGrauProcessual(achado.codigo);
        return (
          <div
            key={`${achado.codigo}-${i}`}
            data-report-block
            className="rounded-xl border border-surface-border bg-surface/30 px-4 py-3"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="font-mono text-[11px] font-bold text-zinc-500">{achado.codigo}</span>
                <span className="text-[13px] font-bold text-foreground">{achado.titulo}</span>
              </div>
              <div className="flex items-center gap-1.5">
                {grau && <Badge label={grau} tone={tomDoGrau(grau)} />}
                <Badge label={achado.gravidade || "—"} tone={tom} />
              </div>
            </div>
            {achado.texto && (
              <p className="mt-1.5 text-[12.5px] leading-relaxed text-zinc-300">{achado.texto}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}
