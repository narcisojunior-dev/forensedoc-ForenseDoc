import React from "react";

export function GeoMap({ home, sign, distanceKm, riskColor }) {
  const W = 660, H = 380, pad = 54;
  const lats = [home.lat, sign.lat];
  const lons = [home.lon, sign.lon];
  let minLat = Math.min(...lats), maxLat = Math.max(...lats);
  let minLon = Math.min(...lons), maxLon = Math.max(...lons);
  const meanLat = (minLat + maxLat) / 2;
  const latSpan = Math.max(maxLat - minLat, 0.0008);
  const lonSpan = Math.max(maxLon - minLon, 0.0008);
  minLat -= latSpan * 0.4; maxLat += latSpan * 0.4;
  minLon -= lonSpan * 0.4; maxLon += lonSpan * 0.4;
  const kx = Math.cos((meanLat * Math.PI) / 180);
  const lonRange = (maxLon - minLon) * kx;
  const latRange = maxLat - minLat;
  const innerW = W - 2 * pad, innerH = H - 2 * pad;
  const scale = Math.min(innerW / lonRange, innerH / latRange);
  const offX = pad + (innerW - lonRange * scale) / 2;
  const offY = pad + (innerH - latRange * scale) / 2;
  const toXY = (lat, lon) => ({ x: offX + (lon - minLon) * kx * scale, y: offY + (maxLat - lat) * scale });
  const A = toXY(home.lat, home.lon);
  const B = toXY(sign.lat, sign.lon);
  const pxDist = Math.hypot(B.x - A.x, B.y - A.y) || 1;
  const kmPerPx = distanceKm / pxDist;
  const targetKm = (innerW * kmPerPx) / 4;
  const steps = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500];
  let barKm = steps[0];
  for (const s of steps) if (s <= targetKm) barKm = s;
  const barPx = barKm / kmPerPx;
  const mid = { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 };

  const grid = [];
  for (let i = 1; i < 6; i++) {
    const gx = pad + (innerW * i) / 6;
    grid.push(<line key={"vx" + i} x1={gx} y1={pad} x2={gx} y2={H - pad} stroke="#22303f" strokeWidth="1" />);
  }
  for (let i = 1; i < 4; i++) {
    const gy = pad + (innerH * i) / 4;
    grid.push(<line key={"hz" + i} x1={pad} y1={gy} x2={W - pad} y2={gy} stroke="#22303f" strokeWidth="1" />);
  }

  const Pin = ({ p, color, label, sub, up }) => (
    <g>
      <line x1={p.x} y1={p.y} x2={p.x} y2={p.y - 20} stroke={color} strokeWidth="2" />
      <circle cx={p.x} cy={p.y} r="4.5" fill={color} />
      <circle cx={p.x} cy={p.y - 24} r="6" fill={color} stroke="#0c1320" strokeWidth="1.5" />
      <g transform={`translate(${p.x}, ${up ? p.y - 40 : p.y + 14})`}>
        <rect x="-82" y={up ? -16 : 0} width="164" height="32" rx="5" fill="#0f1722" stroke={color} strokeOpacity="0.55" />
        <text x="0" y={up ? -3 : 13} textAnchor="middle" fontFamily="'Inter',sans-serif" fontSize="11" fontWeight="700" fill={color}>{label}</text>
        <text x="0" y={up ? 9 : 25} textAnchor="middle" fontFamily="'JetBrains Mono',monospace" fontSize="8.5" fill="#8595a8">{sub}</text>
      </g>
    </g>
  );

  return (
    <div className="geo-map" style={{ marginTop: 14, background: "#0f1722", border: "1px solid #2a3647", borderRadius: 10, padding: 12 }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block" }}>
        <rect x={pad} y={pad} width={innerW} height={innerH} fill="#0c1320" stroke="#2a3647" />
        {grid}
        <line x1={A.x} y1={A.y} x2={B.x} y2={B.y} stroke={riskColor} strokeWidth="2" strokeDasharray="6 5" />
        <g transform={`translate(${mid.x}, ${mid.y})`}>
          <rect x="-54" y="-13" width="108" height="26" rx="13" fill="#0f1722" stroke={riskColor} />
          <text x="0" y="5" textAnchor="middle" fontFamily="'JetBrains Mono',monospace" fontSize="12" fontWeight="600" fill={riskColor}>{distanceKm.toFixed(2)} km</text>
        </g>
        <Pin p={A} color="#4fc3e8" label="Residência" sub={`${home.lat.toFixed(5)}, ${home.lon.toFixed(5)}`} up />
        <Pin p={B} color="#f2b03d" label="Assinatura declarada" sub={`${sign.lat.toFixed(5)}, ${sign.lon.toFixed(5)}`} up={false} />
        <g transform={`translate(${W - pad - 14}, ${pad + 20})`}>
          <path d="M0,-14 L5,6 L0,1 L-5,6 Z" fill="#e7edf4" />
          <text x="0" y="20" textAnchor="middle" fontFamily="'Inter',sans-serif" fontSize="10" fontWeight="700" fill="#e7edf4">N</text>
        </g>
        <g transform={`translate(${pad + 8}, ${H - pad - 12})`}>
          <line x1="0" y1="0" x2={barPx} y2="0" stroke="#e7edf4" strokeWidth="2" />
          <line x1="0" y1="-4" x2="0" y2="4" stroke="#e7edf4" strokeWidth="2" />
          <line x1={barPx} y1="-4" x2={barPx} y2="4" stroke="#e7edf4" strokeWidth="2" />
          <text x={barPx / 2} y="-7" textAnchor="middle" fontFamily="'JetBrains Mono',monospace" fontSize="9" fill="#aeb9c7">{barKm < 1 ? `${barKm * 1000} m` : `${barKm} km`}</text>
        </g>
      </svg>
      <div style={{ fontSize: 11.5, color: "#6b7a8d", marginTop: 8, lineHeight: 1.5 }}>
        Esquema georreferenciado em projeção equirretangular. Os pontos respeitam a posição relativa real; a linha tracejada representa a distância geodésica (Haversine) entre a residência do cliente e o local declarado da assinatura.
      </div>
    </div>
  );
}
