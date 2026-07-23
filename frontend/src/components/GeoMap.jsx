import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

/**
 * Mapa interativo real (Leaflet + OpenStreetMap) do §5.
 *
 * Substitui o antigo esquema abstrato por um mapa navegável (arrastar/zoom) com
 * ruas e geografia real. Mostra dois pontos — residência do cliente e local
 * declarado da assinatura — ligados por uma linha cuja cor reflete o risco da
 * distância. Mantém a mesma API de props do componente anterior.
 *
 * Marcadores usam divIcon (HTML) em vez do ícone padrão do Leaflet, que quebra
 * com bundlers por causa do caminho das imagens.
 */

function pinIcon(color, letter) {
  return L.divIcon({
    className: "",
    html: `<div style="
      width:26px;height:26px;border-radius:50% 50% 50% 0;
      background:${color};transform:rotate(-45deg);
      border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,0.5);
      display:flex;align-items:center;justify-content:center;">
      <span style="transform:rotate(45deg);color:#fff;font:700 12px/1 Inter,sans-serif;">${letter}</span>
    </div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 26],
    popupAnchor: [0, -26],
  });
}

export function GeoMap({ home, sign, distanceKm, riskColor }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current || !home || !sign) return;

    const map = L.map(containerRef.current, {
      scrollWheelZoom: false, // evita "prender" o scroll da página
      attributionControl: true,
    });
    mapRef.current = map;

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap",
    }).addTo(map);

    const homeLL = [home.lat, home.lon];
    const signLL = [sign.lat, sign.lon];

    L.marker(homeLL, { icon: pinIcon("#2563eb", "R") })
      .addTo(map)
      .bindPopup(`<b>Residência do cliente</b><br>${home.lat.toFixed(5)}, ${home.lon.toFixed(5)}`);
    L.marker(signLL, { icon: pinIcon("#f59e0b", "A") })
      .addTo(map)
      .bindPopup(`<b>Assinatura declarada</b><br>${sign.lat.toFixed(5)}, ${sign.lon.toFixed(5)}`);

    // Linha da distância, cor pelo risco.
    const line = L.polyline([homeLL, signLL], {
      color: riskColor || "#f06363",
      weight: 3,
      dashArray: "8 6",
    }).addTo(map);
    if (distanceKm != null) {
      line.bindTooltip(`${distanceKm.toFixed(2)} km`, {
        permanent: true,
        direction: "center",
        className: "geo-dist-label",
      });
    }

    // Enquadra os dois pontos com folga.
    map.fitBounds(L.latLngBounds([homeLL, signLL]).pad(0.35));
    // Pontos idênticos degeneram o bounds — garante um zoom mínimo.
    if (home.lat === sign.lat && home.lon === sign.lon) map.setView(homeLL, 14);

    // O container pode montar antes de ter tamanho definido; recalcula.
    const t = setTimeout(() => map.invalidateSize(), 120);

    return () => {
      clearTimeout(t);
      map.remove();
      mapRef.current = null;
    };
  }, [home, sign, distanceKm, riskColor]);

  if (!home || !sign) return null;

  return (
    <div className="geo-map" style={{ marginTop: 14, borderRadius: 10, overflow: "hidden", border: "1px solid #2a3647" }}>
      <div ref={containerRef} style={{ height: 380, width: "100%", background: "#0c1320" }} />
      <div style={{ fontSize: 11.5, color: "#6b7a8d", padding: "8px 12px", background: "#0f1722", lineHeight: 1.5 }}>
        Mapa real (OpenStreetMap). Marcador <b style={{ color: "#4f9cf9" }}>R</b> = residência do cliente ·
        <b style={{ color: "#f2b03d" }}> A</b> = local declarado da assinatura. A linha tracejada representa a
        distância geodésica (Haversine) entre os dois pontos. Arraste e use o zoom para explorar.
      </div>
    </div>
  );
}
