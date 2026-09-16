/**
 * Parser forense de User-Agent e Ambiente do Dispositivo.
 * Decompõe a string do navegador/aplicativo sem dependências pesadas,
 * isolando Sistema Operacional, Navegador, Versão e Form Factor (Mobile/Desktop).
 */

export function parseUserAgentForensic(uaString) {
  if (!uaString || typeof uaString !== "string") {
    return {
      raw: null,
      os: "Não identificado",
      osVersion: null,
      browser: "Não identificado",
      browserVersion: null,
      deviceType: "Indeterminado",
      isMobile: false,
    };
  }

  const ua = uaString.trim();
  let os = "Outro";
  let osVersion = null;
  let browser = "Outro";
  let browserVersion = null;
  let isMobile = /Mobile|Android|iPhone|iPad|iPod/i.test(ua);
  let deviceType = isMobile ? "Móvel (Smartphone / Tablet)" : "Estação de Trabalho / Desktop";

  // Identificação do SO
  if (/Android\s*([0-9.]+)?/i.test(ua)) {
    os = "Android";
    const m = ua.match(/Android\s*([0-9.]+)/i);
    if (m) osVersion = m[1];
  } else if (/iPhone\s*OS\s*([0-9_]+)/i.test(ua)) {
    os = "iOS";
    const m = ua.match(/iPhone\s*OS\s*([0-9_]+)/i);
    if (m) osVersion = m[1].replace(/_/g, ".");
  } else if (/Windows\s*NT\s*([0-9.]+)/i.test(ua)) {
    os = "Windows";
    const m = ua.match(/Windows\s*NT\s*([0-9.]+)/i);
    if (m) {
      const v = m[1];
      osVersion = v === "10.0" ? "10/11" : v;
    }
  } else if (/Mac\s*OS\s*X\s*([0-9_]+)/i.test(ua)) {
    os = "macOS";
    const m = ua.match(/Mac\s*OS\s*X\s*([0-9_]+)/i);
    if (m) osVersion = m[1].replace(/_/g, ".");
  } else if (/Linux/i.test(ua)) {
    os = "GNU/Linux";
  }

  // Identificação do Navegador
  if (/SamsungBrowser\/([0-9.]+)/i.test(ua)) {
    browser = "Samsung Internet";
    const m = ua.match(/SamsungBrowser\/([0-9.]+)/i);
    if (m) browserVersion = m[1];
  } else if (/Chrome\/([0-9.]+)/i.test(ua) && !/Edg|OPR|SamsungBrowser/i.test(ua)) {
    browser = "Google Chrome";
    const m = ua.match(/Chrome\/([0-9.]+)/i);
    if (m) browserVersion = m[1];
  } else if (/Safari\/([0-9.]+)/i.test(ua) && !/Chrome|Android/i.test(ua)) {
    browser = "Apple Safari";
    const m = ua.match(/Version\/([0-9.]+)/i);
    if (m) browserVersion = m[1];
  } else if (/Firefox\/([0-9.]+)/i.test(ua)) {
    browser = "Mozilla Firefox";
    const m = ua.match(/Firefox\/([0-9.]+)/i);
    if (m) browserVersion = m[1];
  } else if (/Edg\/([0-9.]+)/i.test(ua)) {
    browser = "Microsoft Edge";
    const m = ua.match(/Edg\/([0-9.]+)/i);
    if (m) browserVersion = m[1];
  }

  return {
    raw: ua,
    os,
    osVersion,
    browser,
    browserVersion,
    deviceType,
    isMobile,
  };
}
