import { getIpInfo } from "./apiService.js";
import { geocodeAddress } from "./geocodingService.js";
import { haversineKm } from "../utils/geoUtils.js";

/**
 * Confronto geográfico do §5 do laudo (Módulo 4, Fase A).
 *
 * Reproduz no worker o que antes o navegador calculava e descartava
 * (frontend/src/pages/Analyze.jsx:129-175): geolocaliza os IPs extraídos,
 * geocodifica o endereço residencial e o local declarado da assinatura, e
 * mede as distâncias por Haversine.
 *
 * Persistir isso é o que torna o laudo REPRODUTÍVEL — reabrir a análise não
 * refaz a geocodificação ao vivo, que poderia devolver outro resultado.
 *
 * @param {object}  extracted resultado da extração local
 * @param {string=} homeAddress endereço residencial informado na tela (tem
 *   prioridade sobre o extraído do contrato, como na regra do frontend)
 * @param {{lat:number, lon:number}=} homeCoord coordenada confirmada pelo
 *   operador — quando presente, é usada direto (precisão máxima), sem
 *   geocodificar. É o padrão-ouro forense: ponto confirmado por humano.
 */
export async function enrichGeography(extracted, homeAddress, homeCoord = null) {
  const cliente = extracted.cliente || {};

  // 1. Geolocalizar cada IP extraído do PDF.
  const ipResults = [];
  for (const ipInfo of extracted.ips || []) {
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ipInfo.endereco)) {
      const geo = await getIpInfo(ipInfo.endereco);
      ipResults.push({ ...ipInfo, geo });
    } else {
      ipResults.push({ ...ipInfo, geo: null });
    }
  }

  // 2. Ponto de referência: endereço residencial. Manual (da tela) tem
  // prioridade sobre o extraído do contrato.
  const manual = (homeAddress || "").trim();
  const extractedAddr = [cliente.endereco, cliente.bairro, cliente.cidade, cliente.estado, cliente.cep]
    .filter(Boolean)
    .join(", ");
  const homeQuery = manual || extractedAddr || null;
  const homeSource = manual
    ? "Informado manualmente"
    : extractedAddr
      ? "Extraído do contrato"
      : null;

  // Coordenada confirmada pelo operador vence a geocodificação automática.
  let homeGeo;
  if (homeCoord && Number.isFinite(homeCoord.lat) && Number.isFinite(homeCoord.lon)) {
    homeGeo = {
      lat: homeCoord.lat,
      lon: homeCoord.lon,
      display: "Coordenada confirmada pelo operador",
      precision: "manual",
      source: "manual",
      cityMatch: true,
    };
  } else {
    homeGeo = homeQuery ? await geocodeAddress(homeQuery) : null;
  }

  // 3. Geolocalização declarada da assinatura: coordenada GPS do log, senão
  // geocodificar o endereço declarado.
  let contractGeo = null;
  const g = extracted.geolocalizacao_assinatura;
  if (g && g.presente) {
    const plat = g.latitude != null ? parseFloat(String(g.latitude).replace(",", ".")) : NaN;
    const plon = g.longitude != null ? parseFloat(String(g.longitude).replace(",", ".")) : NaN;
    if (!Number.isNaN(plat) && !Number.isNaN(plon)) {
      // Coordenada GPS vinda do próprio log do contrato — precisão máxima.
      contractGeo = {
        lat: plat,
        lon: plon,
        endereco: g.endereco_declarado,
        fonte: g.fonte,
        precisao: g.precisao_metros,
        dataHora: g.data_hora,
        geocoded: false,
        precision: "gps",
        cityMatch: true,
      };
    } else if (g.endereco_declarado) {
      const gc = await geocodeAddress(g.endereco_declarado);
      if (gc) {
        contractGeo = {
          lat: gc.lat,
          lon: gc.lon,
          endereco: g.endereco_declarado,
          fonte: g.fonte,
          precisao: g.precisao_metros,
          dataHora: g.data_hora,
          geocoded: true,
          precision: gc.precision,
          geocodeSource: gc.source,
          cityMatch: gc.cityMatch,
        };
      }
    }
  }

  // 4. Distâncias por Haversine.
  const ipAnalysis = ipResults.map((ip) => {
    let distance = null;
    if (homeGeo && ip.geo?.lat != null && ip.geo?.lon != null) {
      distance = haversineKm(homeGeo.lat, homeGeo.lon, ip.geo.lat, ip.geo.lon);
    }
    return { ...ip, distance };
  });

  let contractToHomeKm = null;
  if (contractGeo && homeGeo) {
    contractToHomeKm = haversineKm(homeGeo.lat, homeGeo.lon, contractGeo.lat, contractGeo.lon);
  }

  return {
    home: { query: homeQuery, source: homeSource, geo: homeGeo },
    contractGeo: contractGeo ? { ...contractGeo, distance: contractToHomeKm } : null,
    geoDeclaredPresent: !!(g && g.presente),
    ipAnalysis,
  };
}
