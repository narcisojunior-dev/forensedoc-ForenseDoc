import React from "react";

export function Row({ label, value, mono = false, nullText = "Não identificado" }) {
  const isEmpty = value === null || value === undefined || value === "";
  return (
    <div className="row">
      <span className="row-label">{label}</span>
      <span className={mono ? "row-value mono" : `row-value${isEmpty ? " empty" : ""}`}>
        {isEmpty ? nullText : value}
      </span>
    </div>
  );
}

export function Badge({ label, color }) {
  return (
    <span className="badge" style={{ color, background: `${color}22`, border: `1px solid ${color}55` }}>
      {label}
    </span>
  );
}

export function Section({ title, danger = false, children }) {
  return (
    <div className="card report-section">
      <div className={`card-head${danger ? " danger" : ""}`}>{title}</div>
      {children}
    </div>
  );
}
