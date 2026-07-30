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

  /*
   * As dependências são PRIMITIVAS, não os objetos `home`/`sign`.
   *
   * O chamador monta `sign={{ lat: ..., lon: ... }}` — um objeto novo a cada
   * render. Com o objeto na lista de dependências, qualquer re-render do pai
   * derrubava e reconstruía o mapa inteiro: digitar no campo de correção de
   * coordenada, logo abaixo do mapa, fazia o Leaflet piscar a cada tecla.
   *
   * Comparar por valor mantém o mapa vivo enquanto as coordenadas não mudam.
   */
  const homeLat = home?.lat;
  const homeLon = home?.lon;
  const signLat = sign?.lat;
  const signLon = sign?.lon;

  useEffect(() => {
    if (!containerRef.current || homeLat == null || signLat == null) return;

    const home = { lat: homeLat, lon: homeLon };
    const sign = { lat: signLat, lon: signLon };

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

    L.marker(homeLL, { icon: pinIcon("#3b82f6", "R") })
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
  }, [homeLat, homeLon, signLat, signLon, distanceKm, riskColor]);

  if (!home || !sign) return null;

  return (
    <div className="overflow-hidden rounded-xl border border-surface-border">
      <div ref={containerRef} className="h-[380px] w-full bg-background" />
      <p className="border-t border-surface-border bg-surface/40 px-3 py-2 text-[11.5px] leading-relaxed text-zinc-500">
        Mapa real (OpenStreetMap). Marcador <b className="text-primary">R</b> = residência do cliente ·
        <b className="text-accent"> A</b> = local declarado da assinatura. A linha tracejada representa a
        distância geodésica (Haversine) entre os dois pontos. Arraste e use o zoom para explorar.
      </p>
    </div>
  );
}
