export function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function riskFromDistance(km) {
  if (km === null || km === undefined) return { label: "INDETERMINADO", color: "#8595a8", bg: "rgba(133,149,168,0.08)", score: 0 };
  if (km < 50)   return { label: "RISCO BAIXO",    color: "#3ddc97", bg: "rgba(61,220,151,0.08)",  score: 1 };
  if (km < 300)  return { label: "RISCO MODERADO", color: "#f2b03d", bg: "rgba(242,176,61,0.09)",  score: 2 };
  if (km < 1000) return { label: "RISCO ALTO",     color: "#f5853f", bg: "rgba(245,133,63,0.09)",  score: 3 };
  return             { label: "RISCO CRÍTICO", color: "#f06363", bg: "rgba(240,99,99,0.09)",   score: 4 };
}
