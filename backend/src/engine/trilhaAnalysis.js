// Leitura da trilha de auditoria de um dossiê de contratação: user-agent,
// independência da plataforma de assinatura e linha do tempo do aceite.
// Ver item 8 do relatório técnico de 09/09/2026.

export function parseUserAgent(ua) {
  if (!ua) return null;
  const androidMatch = ua.match(/Android\s+([\d.]+)/i);
  const chromeMatch = ua.match(/(?:Chrome|CriOS)\/([\d.]+)/i);
  const model = ua.match(/Android[^;]*;\s*([^)]+)\)/i)?.[1]?.trim();
  // "K" e "wv" são placeholders que o próprio Chrome usa para reduzir a
  // string de user-agent (redução de fingerprinting) — não são modelo real.
  const modelKnown = Boolean(model) && !/^k$/i.test(model) && !/\bwv\b/i.test(model);
  const chromeVersion = chromeMatch?.[1]?.split(".")[0] || null;
  const resumoPartes = [
    chromeVersion ? `Chrome Mobile ${chromeVersion}` : (chromeMatch ? "navegador Chrome" : null),
    androidMatch ? `em Android ${androidMatch[1]}` : null,
    modelKnown ? `(${model})` : androidMatch ? "(modelo não identificado: string reduzida do Chrome)" : null,
  ].filter(Boolean);
  return {
    android: androidMatch?.[1] || null,
    chrome: chromeMatch?.[1] || null,
    modelo: modelKnown ? model : null,
    resumo: resumoPartes.length ? resumoPartes.join(" ") : null,
  };
}

// Decide se o domínio do validador/plataforma de assinatura pertence ao
// próprio credor (não é um terceiro independente) — comparando os
// "tokens" significativos do nome do credor contra o hostname.
export function assessPlatformIndependence(validadorUrl, credorNome) {
  if (!validadorUrl) return null;
  let host;
  try {
    host = new URL(validadorUrl).hostname.toLowerCase();
  } catch {
    return null;
  }
  const stopWords = new Set(["banco", "financeira", "credito", "financiamento", "investimento", "sociedade", "consignado"]);
  const credorTokens = String(credorNome || "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 3 && !stopWords.has(token));
  const belongsToCredor = credorTokens.some((token) => host.includes(token));
  return {
    dominio: host,
    pertenceAoCredor: belongsToCredor,
    nota: belongsToCredor
      ? `Provedor de assinatura identificado (${host}), mas pertence ao próprio credor: não é um terceiro independente da relação contratual.`
      : `Provedor de assinatura identificado (${host}).`,
  };
}

function parseBrDateTime(value) {
  const m = String(value || "").match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})$/);
  if (!m) return null;
  const [, dd, mm, yyyy, hh, min, ss] = m;
  return new Date(Number(yyyy), Number(mm) - 1, Number(dd), Number(hh), Number(min), Number(ss));
}

// steps: [{label, value}] com value em "dd/mm/aaaa hh:mm:ss". Ordena por
// data, calcula a duração total do fluxo e o intervalo entre as duas
// primeiras etapas (tipicamente acesso -> primeiro aceite).
export function buildAcceptanceTimeline(steps) {
  const parsed = (steps || [])
    .filter((step) => step?.value)
    .map((step) => ({ ...step, date: parseBrDateTime(step.value) }))
    .filter((step) => step.date instanceof Date && !Number.isNaN(step.date.getTime()));
  if (parsed.length < 2) return null;
  parsed.sort((a, b) => a.date - b.date);
  const first = parsed[0];
  const last = parsed[parsed.length - 1];
  const totalSeconds = Math.round((last.date.getTime() - first.date.getTime()) / 1000);
  const firstIntervalSeconds = Math.round((parsed[1].date.getTime() - parsed[0].date.getTime()) / 1000);
  return {
    steps: parsed.map(({ label, value }) => ({ label, value })),
    totalSeconds,
    firstIntervalSeconds,
    firstLabel: first.label,
    lastLabel: last.label,
  };
}

export function formatDurationPt(totalSeconds) {
  if (!Number.isFinite(totalSeconds)) return null;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes <= 0) return `${seconds} s`;
  return `${minutes} min ${seconds} s`;
}
