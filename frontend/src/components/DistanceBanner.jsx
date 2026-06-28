import React from "react";
import { riskFromDistance } from "../utils/geo.js";
import { Badge } from "./UiComponents.jsx";

export function DistanceBanner({ label, km }) {
  const risk = riskFromDistance(km);
  return (
    <div className="dist-banner" style={{ borderColor: `${risk.color}55`, background: risk.bg }}>
      <div>
        <div className="dl">{label}</div>
        <div className="dv" style={{ color: risk.color }}>{km.toFixed(2)} km</div>
      </div>
      <Badge label={risk.label} color={risk.color} />
    </div>
  );
}
