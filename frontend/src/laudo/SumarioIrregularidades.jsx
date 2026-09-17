import React from "react";

/**
 * Sumário executivo de irregularidades em duas páginas, portado do motor de
 * geração. Recebe o sumário já calculado e persistido pelo servidor
 * (`result.sumarioIrregularidades`), recalculado a cada correção do operador.
 */

function formatKm(value) {
  if (!Number.isFinite(Number(value))) return null;
  const km = Number(value);
  if (km < 1) return `${km.toFixed(2).replace(".", ",")} km`;
  return `${km.toLocaleString("pt-BR", { maximumFractionDigits: km < 100 ? 1 : 0 })} km`;
}

function SummaryHeader({ summary, pageLabel }) {
  return (
    <div className="summary-header">
      <div>
        <div className="summary-brand">RONNEY MENEZES ADVOCACIA</div>
        <div className="summary-brand-sub">DIREITO BANCÁRIO E DO CONSUMIDOR</div>
      </div>
      <div className="summary-header-meta">
        <div>{pageLabel}</div>
        <div>Laudo <b>{summary.reportId}</b></div>
        <div>{summary.bank} <b>{summary.contractNumber}</b> · CPF {summary.cpf}</div>
      </div>
    </div>
  );
}

function SeverityRow({ finding }) {
  const className = finding.severity === "ALTA" ? "high" : finding.severity === "MÉDIA" ? "medium" : finding.severity === "INFO" ? "info" : "favorable";
  return (
    <div className="summary-gravity-row">
      <div className={`summary-gravity-label ${className}`}>{finding.severity}</div>
      <div className="summary-gravity-text"><b>{finding.title}</b> {finding.text}</div>
    </div>
  );
}

function GeoScale({ geo }) {
  const items = geo.items || [];
  if (!items.length) return <div className="summary-empty-geo">{geo.description}</div>;
  const minLog = -1;
  const maxLog = 4;
  const xFor = (distance) => 48 + ((Math.log10(Math.max(0.1, Math.min(10000, distance))) - minLog) / (maxLog - minLog)) * 604;
  const ticks = [0.1, 1, 10, 100, 1000, 10000];
  const colorFor = (role) => role === "gps" ? "#2f6846" : role === "access" ? "#bc631e" : "#203f52";
  return (
    <svg className="summary-geo-chart" viewBox="0 0 700 205" aria-label="Confronto de distâncias entre GPS e endereços IP">
      <line x1="48" y1="144" x2="652" y2="144" stroke="#d8d0c3" strokeWidth="2" />
      {ticks.map((tick) => {
        const x = xFor(tick);
        return (
          <g key={tick}>
            <line x1={x} y1="138" x2={x} y2="151" stroke="#bdb3a4" />
            <text x={x} y="169" textAnchor="middle" fontFamily="monospace" fontSize="10" fill="#405060">{tick.toLocaleString("pt-BR")} km</text>
          </g>
        );
      })}
      {items.map((item, index) => {
        const x = xFor(item.distance);
        const labelY = 25 + (index % 3) * 34;
        return (
          <g key={`${item.role}-${item.label}-${index}`}>
            <line x1={x} y1={labelY + 12} x2={x} y2="136" stroke={colorFor(item.role)} strokeWidth="2" />
            <circle cx={x} cy="144" r="7" fill={colorFor(item.role)} stroke="#fff" strokeWidth="3" />
            <text x={x} y={labelY} textAnchor="middle" fontFamily="monospace" fontSize="10" fontWeight="700" fill={colorFor(item.role)}>{item.label}</text>
            <text x={x} y={labelY + 12} textAnchor="middle" fontFamily="monospace" fontSize="9" fill="#405060">{formatKm(item.distance)}</text>
          </g>
        );
      })}
      <g transform="translate(48 195)">
        <circle cx="0" cy="0" r="5" fill="#2f6846" /><text x="10" y="4" fontSize="10" fill="#405060">GPS da assinatura</text>
        <circle cx="150" cy="0" r="5" fill="#bc631e" /><text x="160" y="4" fontSize="10" fill="#405060">IP de acesso</text>
        <circle cx="275" cy="0" r="5" fill="#203f52" /><text x="285" y="4" fontSize="10" fill="#405060">Infraestrutura</text>
      </g>
    </svg>
  );
}

export default function SumarioIrregularidades({ summary }) {
  return (
    <div className="irregularity-summary">
      <div className="summary-page summary-page-one">
        <SummaryHeader summary={summary} pageLabel="SUMÁRIO EXECUTIVO" />
        <h2>Irregularidades do laudo ForenseDoc, em síntese</h2>
        <p className="summary-intro">{summary.intro}</p>
        <div className="summary-meta-line">
          Contrato <b>{summary.meta.contractDate}</b> · assinatura {summary.meta.signatureDate} ({summary.meta.methods}) · SHA-256 <b>{summary.meta.sha256}</b> · {summary.meta.size} · {summary.meta.pages}
        </div>

        <div className="summary-section-title">PLACAR DE GRAVIDADE</div>
        <div className="summary-gravity-table">
          {summary.findings.map((finding) => <SeverityRow key={finding.key} finding={finding} />)}
        </div>

        {summary.geo.items.length > 0 && (
          <>
            <div className="summary-section-title summary-section-title-line">GPS CONTRA IP: O CONFRONTO QUE IMPORTA</div>
            <div className="summary-geo-box">
              <h3>Onde o documento diz que o ato ocorreu</h3>
              <p>{summary.geo.description}</p>
              <GeoScale geo={summary.geo} />
            </div>
          </>
        )}
      </div>

      <div className="summary-page summary-page-two">
        <SummaryHeader summary={summary} pageLabel="SUMÁRIO EXECUTIVO · CONTINUAÇÃO" />
        {summary.ipCards.length > 0 && (
          <div className="summary-ip-grid">
            {summary.ipCards.map((ip) => (
            <div className="summary-ip-card" key={ip.endereco}>
              <div className="summary-ip-top">
                <b>{ip.endereco}</b>
                <span>{ip.badge}</span>
              </div>
              <p>{ip.text}</p>
            </div>
            ))}
          </div>
        )}

        <div className="summary-synthesis">{summary.synthesis}</div>

        <div className="summary-section-title summary-section-title-line">DILIGÊNCIAS RECOMENDADAS</div>
        <div className="summary-diligence-grid">
          {summary.diligences.map((item, index) => (
            <div className="summary-diligence-item" key={item.key}>
              <div className="summary-diligence-number">{String(index + 1).padStart(2, "0")}</div>
              <div><b>{item.title}.</b> {item.text}</div>
            </div>
          ))}
        </div>

        <div className="summary-footer">
          <div>{summary.disclaimer}</div>
          <div>Ronney Menezes<br />Advocacia</div>
        </div>
      </div>
    </div>
  );
}
