const ACTION_PATTERN = /\b(Link\s+aberto|Termo\s+de|Resumo\s+Aberto|Resumo\s+Aceito|Selfie|Processo)\b/gi;

function canonicalAction(value) {
  if (/^link/i.test(value)) return "Link aberto";
  if (/^termo/i.test(value)) return "Termo de Privacidade Aceito";
  if (/^resumo\s+aberto/i.test(value)) return "Resumo Aberto";
  if (/^resumo\s+aceito/i.test(value)) return "Resumo Aceito";
  if (/^selfie/i.test(value)) return "Selfie Capturada";
  return "Processo Finalizado";
}

function timeToMinutes(value) {
  const match = String(value || "").match(/(\d{1,2}):(\d{2})/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

function extractIpPort(block) {
  const normalized = String(block || "").replace(/(\d)\s*[.·]\s*(?=\d)/g, "$1.");
  const match = normalized.match(/\b((?:\d{1,3}\.){3}\d{1,3})\s*:\s*(\d{4,5})\b/);
  return match ? { ip: match[1], port: match[2] } : null;
}

function detectDevice(text) {
  const os = String(text || "").match(/\b(Android|iOS)\s+(\d+(?:\.\d+)*)/i);
  const browserName = String(text || "").match(/\b(Chrome|Firefox|Safari|Edge)\b/i)?.[1];
  const browserVersion = browserName
    ? String(text || "").match(new RegExp(`${browserName}(?:(?!Android|Chrome|Firefox|Safari|Edge)[\\s\\S]){0,120}?(\\d{2,3})\\.\\d+\\.\\d+\\.\\d+`, "i"))?.[1]
    : null;
  return [os ? `${os[1]} ${os[2]}` : null, browserName && browserVersion ? `${browserName} ${browserVersion}` : null]
    .filter(Boolean)
    .join(" · ") || null;
}

function parseHistorySection(section, fallbackIp) {
  const matches = Array.from(section.matchAll(ACTION_PATTERN));
  const events = matches.map((match, index) => {
    const block = section.slice(match.index, matches[index + 1]?.index ?? section.length);
    const direct = extractIpPort(block);
    const date = block.match(/\b(\d{1,2}\/\d{1,2}\/\d{4})\b/)?.[1] || null;
    const time = block.match(/\b(\d{1,2}:\d{2})\b/)?.[1] || null;
    const decimalValues = Array.from(block.matchAll(/([+\-]?\d{1,3}\.\d{5,})/g)).map((item) => Number(item[1]));
    let lat = decimalValues.find((value) => Math.abs(value) <= 30) ?? null;
    let lon = decimalValues.find((value) => Math.abs(value) > 30 && Math.abs(value) <= 180) ?? null;
    if (lat !== null && /Lat\s*:\s*-/i.test(block)) lat = -Math.abs(lat);
    if (lon !== null && /Lon\s*:\s*-/i.test(block)) lon = -Math.abs(lon);
    const os = block.match(/\b(Android|iOS)\s+([\d.]+)/i);
    const browser = block.match(/\b(Chrome|Firefox|Safari|Edge)\s+([\d.]+)/i);
    const device = [os ? `${os[1]} ${os[2]}` : null, browser ? `${browser[1]} ${browser[2].split(".")[0]}` : null]
      .filter(Boolean)
      .join(" · ") || null;
    return {
      action: canonicalAction(match[1]), date, time,
      ip: direct?.ip || fallbackIp || null,
      ipDirect: Boolean(direct?.ip), port: direct?.port || null, lat, lon, device,
    };
  }).filter((event) => event.port || event.time || (event.lat !== null && event.lon !== null));

  const longitudeValues = Array.from(section.matchAll(/\bLo[nm]\s*:\s*(-?\d{2,3}\.\d{5,})/gi)).map((match) => Number(match[1]));
  const latitudeValues = Array.from(section.matchAll(/\bLat\s*:\s*-(?:(?!\bLo[nm]\s*:)[\s\S]){0,180}?(\d{1,2}\.\d{5,})/gi)).map((match) => -Math.abs(Number(match[1])));
  if (longitudeValues.length >= events.length) events.forEach((event, index) => { event.lon = longitudeValues[index]; });
  if (latitudeValues.length >= events.length) events.forEach((event, index) => { event.lat = latitudeValues[index]; });
  return events;
}

function mergeEvents(sections) {
  const longest = sections.reduce((best, current) => current.length > best.length ? current : best, []);
  return longest.map((base, index) => {
    const candidates = sections.map((events) => events[index]).filter((event) => event?.action === base.action);
    const direct = candidates.find((event) => event.ipDirect) || base;
    const coordinate = candidates.find((event) => event.lat !== null && event.lon !== null) || base;
    return {
      action: base.action,
      date: candidates.find((event) => event.date)?.date || base.date,
      time: candidates.find((event) => event.time)?.time || base.time,
      ip: direct.ip || base.ip,
      port: direct.port || candidates.find((event) => event.port)?.port || base.port,
      lat: coordinate.lat,
      lon: coordinate.lon,
      device: candidates.find((event) => event.device)?.device || base.device,
    };
  });
}

function calculateDispersion(events) {
  const points = events.filter((event) => Number.isFinite(event.lat) && Number.isFinite(event.lon));
  if (!points.length) return { coordinateCount: 0, northSouthMeters: null, eastWestMeters: null };
  const lats = points.map((point) => point.lat);
  const lons = points.map((point) => point.lon);
  const meanLat = lats.reduce((sum, value) => sum + value, 0) / lats.length;
  return {
    coordinateCount: points.length,
    northSouthMeters: (Math.max(...lats) - Math.min(...lats)) * 111320,
    eastWestMeters: (Math.max(...lons) - Math.min(...lons)) * 111320 * Math.cos(meanLat * Math.PI / 180),
  };
}

export function extractAuditTrail(rawText) {
  const text = String(rawText || "");
  const markerMatches = Array.from(text.matchAll(/Hist[oó]rico\s+de\s+A[cç][oõ]es\s*:/gi));
  if (!markerMatches.length) return null;
  const uniqueIps = Array.from(new Set(Array.from(text.matchAll(/\b((?:\d{1,3}\.){3}\d{1,3})\s*:\s*\d{4,5}\b/g)).map((match) => match[1])));
  const fallbackIp = uniqueIps[0] || null;
  const sections = markerMatches
    .map((marker, index) => text.slice(marker.index, markerMatches[index + 1]?.index ?? text.length))
    .map((section) => parseHistorySection(section, fallbackIp))
    .filter((events) => events.length > 0);
  const events = mergeEvents(sections);
  if (!events.length) return null;

  const signerTimestamp = text.match(/DATA\s+E\s+HORA\s*\(UTC\)\s*(\d{1,2}\/\d{1,2}\/\d{4})\s+(\d{1,2}:\d{2}(?::\d{2})?)/i);
  const defaultDate = signerTimestamp?.[1] || events.find((event) => event.date)?.date || null;
  events.forEach((event) => { if (!event.date && defaultDate) event.date = defaultDate; });
  const dispersion = calculateDispersion(events);
  const firstTime = events.find((event) => event.time)?.time || null;
  const lastTime = [...events].reverse().find((event) => event.time)?.time || null;
  const signatureTime = signerTimestamp?.[2] || null;
  const signatureMinutes = timeToMinutes(signatureTime);
  const firstMinutes = timeToMinutes(firstTime);
  const lastMinutes = timeToMinutes(lastTime);
  const signatureLocalMinutes = signatureMinutes === null ? null : (signatureMinutes - 180 + 1440) % 1440;
  const chronologyInconsistent = signatureMinutes !== null && firstMinutes !== null && lastMinutes !== null
    ? signatureLocalMinutes < firstMinutes && signatureMinutes > lastMinutes
    : false;
  const device = events.find((event) => event.device)?.device || null;
  const normalizedDevice = detectDevice(text) || device;
  if (normalizedDevice) events.forEach((event) => { event.device = normalizedDevice; });

  const validDates = events.map((event) => event.date).filter((date) => {
    const match = date?.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    return match && Number(match[1]) <= 31 && Number(match[2]) <= 12 && Number(match[3]) >= 2000 && Number(match[3]) <= 2100;
  });
  const majorityDate = defaultDate || validDates.sort((a, b) => validDates.filter((value) => value === b).length - validDates.filter((value) => value === a).length)[0] || null;
  if (majorityDate) events.forEach((event) => { if (!validDates.includes(event.date) || event.date !== majorityDate) event.date = majorityDate; });

  return {
    events,
    eventCount: events.length,
    uniqueIps,
    ports: Array.from(new Set(events.map((event) => event.port).filter(Boolean))),
    signatureTimestampUtc: signerTimestamp ? `${signerTimestamp[1]} ${signerTimestamp[2]}` : null,
    eventDate: defaultDate,
    firstTime,
    lastTime,
    eventTimezone: "-03:00",
    device: normalizedDevice,
    deviceIdentifiable: /(?:IMEI|iPhone|Samsung|Motorola|Xiaomi|Pixel)/i.test(text),
    chronologyInconsistent,
    signatureLocalTime: signatureLocalMinutes === null
      ? null
      : `${String(Math.floor(signatureLocalMinutes / 60)).padStart(2, "0")}:${String(signatureLocalMinutes % 60).padStart(2, "0")}`,
    ...dispersion,
  };
}
