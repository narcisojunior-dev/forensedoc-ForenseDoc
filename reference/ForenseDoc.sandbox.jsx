import { useState, useRef, useCallback } from "react";

// ─── Utils ──────────────────────────────────────────────────────────────────

function arrayBufferToBase64(buffer) {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

async function digestHash(algorithm, buffer) {
  const hash = await crypto.subtle.digest(algorithm, buffer);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

function classifyHashString(s) {
  if (!s || typeof s !== "string") return null;
  const v = s.trim();
  const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const uuidAny = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (uuidV4.test(v)) return { format: "UUID v4", isHash: false, detalhe: "Identificador UUID versão 4, gerado aleatoriamente, sem relação criptográfica com o conteúdo do documento" };
  if (uuidAny.test(v)) return { format: "UUID", isHash: false, detalhe: "Identificador UUID, sem relação criptográfica com o conteúdo do documento" };
  if (/^[0-9a-fA-F]{64}$/.test(v)) return { format: "SHA-256", isHash: true, detalhe: "Cadeia hexadecimal de 64 caracteres, compatível com SHA-256" };
  if (/^[0-9a-fA-F]{40}$/.test(v)) return { format: "SHA-1", isHash: true, detalhe: "Cadeia hexadecimal de 40 caracteres, compatível com SHA-1" };
  if (/^[0-9a-fA-F]{32}$/.test(v)) return { format: "MD5", isHash: true, detalhe: "Cadeia hexadecimal de 32 caracteres, compatível com MD5" };
  return { format: "Formato não reconhecido", isHash: false, detalhe: "Cadeia não corresponde a nenhum formato de hash criptográfico conhecido" };
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function riskFromDistance(km) {
  if (km === null || km === undefined) return { label: "INDETERMINADO", color: "#8595a8", bg: "rgba(133,149,168,0.08)", score: 0 };
  if (km < 50)   return { label: "RISCO BAIXO",    color: "#3ddc97", bg: "rgba(61,220,151,0.08)",  score: 1 };
  if (km < 300)  return { label: "RISCO MODERADO", color: "#f2b03d", bg: "rgba(242,176,61,0.09)",  score: 2 };
  if (km < 1000) return { label: "RISCO ALTO",     color: "#f5853f", bg: "rgba(245,133,63,0.09)",  score: 3 };
  return             { label: "RISCO CRÍTICO", color: "#f06363", bg: "rgba(240,99,99,0.09)",   score: 4 };
}

async function geolocateIP(ip) {
  try {
    const r = await fetch(`https://ipapi.co/${ip}/json/`);
    const d = await r.json();
    if (d.error) return null;
    return {
      ip: d.ip,
      city: d.city,
      region: d.region,
      country: d.country_name,
      lat: d.latitude,
      lon: d.longitude,
      isp: d.org || d.asn,
      timezone: d.timezone,
      currency: d.currency,
    };
  } catch {
    return null;
  }
}

async function geocodeAddress(address) {
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 300,
        system:
          "Você é um serviço de geocodificação para endereços no Brasil. Dado um endereço, retorne APENAS um JSON, sem markdown e sem texto extra, no formato {\"lat\": number, \"lon\": number, \"display\": string}, com as coordenadas decimais aproximadas (datum WGS84) do ponto mais provável, na melhor resolução possível (rua, bairro ou cidade). Se não for possível estimar, retorne {\"lat\": null, \"lon\": null, \"display\": null}.",
        messages: [{ role: "user", content: `Endereço: ${address}` }],
      }),
    });
    const d = await r.json();
    const txt = (d.content || []).map((b) => b.text || "").join("").replace(/```json|```/g, "").trim();
    const obj = JSON.parse(txt);
    const lat = typeof obj.lat === "string" ? parseFloat(obj.lat.replace(",", ".")) : obj.lat;
    const lon = typeof obj.lon === "string" ? parseFloat(obj.lon.replace(",", ".")) : obj.lon;
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      return { lat, lon, display: obj.display || address, approx: true };
    }
  } catch {}
  return null;
}

const SYSTEM_PROMPT = `Você é um perito forense digital especializado em contratos bancários de crédito consignado no Brasil. Sua função é extrair e estruturar todas as informações jurídica e tecnicamente relevantes do documento fornecido.

Retorne APENAS um JSON válido, sem markdown, sem backticks, sem texto adicional. Use null para campos não encontrados.

JSON obrigatório:
{
  "tipo_documento": string,
  "qualidade_ocr": "Alta" | "Media" | "Baixa",
  "contrato": {
    "numero": string | null,
    "banco": string | null,
    "produto": string | null,
    "modalidade": "RMC" | "RCC" | "Emprestimo Pessoal" | "Cartao Consignado" | "FGTS" | "Outro" | null,
    "valor_contratado": string | null,
    "valor_parcela": string | null,
    "numero_parcelas": string | null,
    "prazo_meses": string | null,
    "taxa_juros_mensal": string | null,
    "taxa_juros_anual": string | null,
    "cet_mensal": string | null,
    "cet_anual": string | null,
    "data_contrato": string | null,
    "data_primeiro_vencimento": string | null,
    "data_ultimo_vencimento": string | null,
    "codigo_banco_bacen": string | null
  },
  "cliente": {
    "nome": string | null,
    "cpf": string | null,
    "rg": string | null,
    "data_nascimento": string | null,
    "endereco": string | null,
    "bairro": string | null,
    "cidade": string | null,
    "estado": string | null,
    "cep": string | null,
    "telefone": string | null,
    "email": string | null,
    "matricula_inss": string | null,
    "numero_beneficio": string | null,
    "especie_beneficio": string | null,
    "banco_recepcao": string | null
  },
  "assinatura": {
    "presente": boolean,
    "plataforma": string | null,
    "tipo": "ICP-Brasil A1" | "ICP-Brasil A3" | "Avancada" | "Simples" | "Biometrica" | "SMS Token" | "Ausente" | "Indeterminado",
    "nivel_legal_mp2200": "Qualificada" | "Avancada" | "Simples" | "Ausente" | "Indeterminado",
    "base_legal": string | null,
    "certificadora_ac": string | null,
    "titular_certificado": string | null,
    "cpf_titular": string | null,
    "data_hora_assinatura": string | null,
    "validade_certificado_inicio": string | null,
    "validade_certificado_fim": string | null,
    "metodos_autenticacao": [string],
    "hash_documento_assinado": string | null,
    "algoritmo_hash": string | null,
    "numero_serie_certificado": string | null,
    "integridade_pos_assinatura": boolean | null,
    "observacoes": string | null
  },
  "geolocalizacao_assinatura": {
    "presente": boolean,
    "latitude": string | null,
    "longitude": string | null,
    "endereco_declarado": string | null,
    "precisao_metros": string | null,
    "fonte": string | null,
    "data_hora": string | null
  },
  "cadeia_custodia": {
    "identificacao_signatario": boolean,
    "registro_ip": boolean,
    "carimbo_tempo": boolean,
    "geolocalizacao": boolean,
    "metodo_autenticacao": boolean,
    "hash_integridade": boolean,
    "trilha_auditoria": boolean,
    "evidencia_aceite": boolean,
    "observacoes": string | null
  },
  "ips": [
    {
      "endereco": string,
      "contexto": string,
      "data_hora": string | null,
      "user_agent": string | null
    }
  ],
  "evidencias_irregularidade": [string],
  "observacoes_periciais": string | null
}

Sobre a geolocalizacao_assinatura: extraia quaisquer coordenadas GPS (latitude e longitude), endereço de geolocalização, precisão e fonte presentes no log de assinatura, log de auditoria ou comprovante de assinatura eletrônica do documento. Esses dados indicam o local físico onde a assinatura eletrônica teria sido capturada. Use ponto decimal nas coordenadas. Se não houver coordenadas no documento, defina presente como false.

Sobre a cadeia_custodia: avalie a presença efetiva de cada elemento probatório no documento e marque true apenas quando houver evidência concreta. identificacao_signatario: nome ou CPF do signatário vinculados ao ato. registro_ip: endereço IP registrado no ato. carimbo_tempo: data e hora confiáveis do ato. geolocalizacao: coordenadas ou localização do ato de assinatura. metodo_autenticacao: token SMS, biometria, selfie, e-mail, senha, etc. hash_integridade: hash criptográfico do documento assinado. trilha_auditoria: log ou trilha de auditoria do processo de assinatura. evidencia_aceite: manifestação de vontade do signatário, como selfie, envio de documentos ou aceite expresso.

IMPORTANTE: a ausência de certificação ICP-Brasil NÃO constitui, por si só, irregularidade, vício ou nulidade, e NÃO deve ser incluída em evidencias_irregularidade. A assinatura eletrônica sem ICP-Brasil é válida desde que a cadeia de custódia comprove autoria e integridade (MP 2.200-2/2001, art. 10, §2º; Lei 14.063/2020; STJ, REsp 2.159.442, rel. Min. Nancy Andrighi). O que deve ser apontado como irregularidade é a INCOMPLETUDE da cadeia de custódia: ausência de registro de IP, de carimbo de tempo, de geolocalização, de método de autenticação, de hash de integridade ou de trilha de auditoria.

Sobre os IPs: extraia TODOS os endereços IPv4 e IPv6 presentes, incluindo os do log de auditoria. Para as evidencias_irregularidade, aponte divergencias entre dados do documento, inconsistencias, ausencia de elementos obrigatorios legais, etc.`;

// ─── Styles ──────────────────────────────────────────────────────────────────

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&family=Syne:wght@700;800&display=swap');

  * { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --ink: #0c1118;
    --panel: #141c27;
    --panel-2: #1b2533;
    --line: #2a3647;
    --line-soft: #1f2937;
    --accent: #4fc3e8;
    --accent-soft: rgba(79,195,232,0.12);
    --text: #e7edf4;
    --label: #94a3b6;
    --muted: #6b7a8d;
    --ok: #3ddc97;
    --warn: #f2b03d;
    --high: #f5853f;
    --crit: #f06363;
    --sans: 'Inter', system-ui, -apple-system, sans-serif;
    --mono: 'JetBrains Mono', 'SF Mono', 'Courier New', monospace;
    --display: 'Syne', var(--sans);
  }

  .fd-root {
    min-height: 100vh;
    background:
      radial-gradient(1200px 600px at 18% -8%, #122236 0%, transparent 55%),
      var(--ink);
    color: var(--text);
    font-family: var(--sans);
    font-size: 14px;
    line-height: 1.55;
    padding: 36px 22px 72px;
    -webkit-font-smoothing: antialiased;
  }

  .fd-shell { max-width: 940px; margin: 0 auto; }

  @keyframes fd-pulse  { 0%,100%{opacity:1} 50%{opacity:0.4} }
  @keyframes fd-fadeUp { from{opacity:0;transform:translateY(12px)} to{opacity:1;transform:translateY(0)} }
  @keyframes fd-spin   { to{transform:rotate(360deg)} }

  .eyebrow {
    font-family: var(--mono);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.34em;
    color: var(--accent);
    text-transform: uppercase;
  }

  .wordmark {
    font-family: var(--display);
    font-weight: 800;
    font-size: 34px;
    letter-spacing: 0.04em;
    color: #fff;
    margin: 10px 0 6px;
  }

  .subtitle { font-size: 13px; color: var(--muted); }

  .rule {
    width: 64px; height: 2px; border-radius: 2px;
    background: linear-gradient(90deg, var(--accent), transparent);
    margin: 22px auto 0;
  }

  .card {
    background: var(--panel);
    border: 1px solid var(--line-soft);
    border-radius: 12px;
    padding: 24px 26px;
    margin-bottom: 16px;
    animation: fd-fadeUp 0.45s ease both;
  }

  .card-head {
    display: flex; align-items: center; gap: 10px;
    font-size: 13px; font-weight: 700; letter-spacing: 0.05em;
    color: var(--accent);
    text-transform: uppercase;
    padding-bottom: 14px; margin-bottom: 6px;
    border-bottom: 1px solid var(--line);
  }
  .card-head::before {
    content: ''; width: 7px; height: 7px; border-radius: 50%;
    background: var(--accent); box-shadow: 0 0 10px var(--accent); flex-shrink: 0;
  }
  .card-head.danger { color: var(--crit); }
  .card-head.danger::before { background: var(--crit); box-shadow: 0 0 10px var(--crit); }

  .sub-head {
    font-family: var(--mono); font-size: 11px; letter-spacing: 0.12em;
    text-transform: uppercase; color: var(--muted); margin: 18px 0 10px;
  }
  .sub-head:first-child { margin-top: 4px; }

  .row {
    display: flex; justify-content: space-between; align-items: baseline;
    gap: 24px; padding: 11px 0;
    border-bottom: 1px solid var(--line-soft);
  }
  .row:last-child { border-bottom: none; }

  .row-label {
    font-size: 12.5px; font-weight: 500; color: var(--label);
    min-width: 230px; flex-shrink: 0; line-height: 1.45;
  }
  .row-value {
    font-size: 13.5px; font-weight: 500; color: var(--text);
    text-align: right; line-height: 1.5; word-break: break-word;
  }
  .row-value.empty { color: var(--muted); font-weight: 400; font-style: italic; }
  .row-value.mono {
    font-family: var(--mono); font-size: 12px; color: var(--accent);
    word-break: break-all; line-height: 1.6;
  }

  .badge {
    display: inline-block; padding: 4px 12px; border-radius: 999px;
    font-size: 11px; font-weight: 700; letter-spacing: 0.03em; white-space: nowrap;
  }

  .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }

  .geo-card {
    background: var(--panel-2); border: 1px solid var(--line);
    border-top-width: 2px; border-radius: 8px; padding: 16px;
  }
  .geo-card .gtitle {
    font-size: 11px; font-weight: 700; letter-spacing: 0.08em;
    text-transform: uppercase; margin-bottom: 10px;
  }
  .geo-card .gcoord {
    font-family: var(--mono); font-size: 12.5px; line-height: 1.6;
    word-break: break-all; margin-bottom: 10px;
  }
  .geo-card .gmeta { font-size: 12px; color: var(--muted); line-height: 1.7; }

  .hash-card {
    background: var(--panel-2); border: 1px solid var(--line);
    border-top-width: 2px; border-radius: 8px; padding: 16px;
  }
  .hash-card .htitle {
    font-size: 11px; font-weight: 700; letter-spacing: 0.08em;
    text-transform: uppercase; margin-bottom: 10px;
  }
  .hash-card .hvalue {
    font-family: var(--mono); font-size: 12px; line-height: 1.65;
    word-break: break-all; margin-bottom: 12px;
  }
  .hash-card .hmeta { font-size: 12px; color: var(--muted); line-height: 1.7; }

  .note {
    margin-top: 14px; padding: 14px 16px; border-radius: 8px;
    border-left: 3px solid var(--accent);
    background: var(--accent-soft);
    font-size: 13px; line-height: 1.65; color: #c8d3df;
  }

  .dist-banner {
    display: flex; justify-content: space-between; align-items: center; gap: 16px;
    margin-top: 14px; padding: 16px 18px; border-radius: 10px; border: 1px solid;
  }
  .dist-banner .dl { font-size: 12.5px; color: var(--label); }
  .dist-banner .dv { font-family: var(--mono); font-size: 22px; font-weight: 600; }

  .ip-block { border-radius: 10px; padding: 18px; margin-bottom: 14px; }
  .ip-block:last-child { margin-bottom: 0; }
  .ip-head {
    display: flex; justify-content: space-between; align-items: center;
    gap: 14px; margin-bottom: 6px;
  }
  .ip-id { font-family: var(--mono); font-size: 14px; font-weight: 600; }
  .ip-ctx { font-size: 12.5px; color: var(--muted); margin-bottom: 12px; }

  .flag {
    display: flex; gap: 12px; padding: 11px 0;
    border-bottom: 1px solid rgba(240,99,99,0.12);
    font-size: 13px; color: #e3b9bd; line-height: 1.6;
  }
  .flag:last-child { border-bottom: none; }
  .flag b { color: var(--crit); flex-shrink: 0; }

  .field { margin: 0 0 18px; text-align: left; }
  .field label { display: block; font-size: 13px; font-weight: 600; color: var(--text); margin-bottom: 8px; }
  .field input {
    width: 100%; padding: 13px 15px; background: var(--panel);
    border: 1px solid var(--line); border-radius: 10px; color: var(--text);
    font-family: var(--sans); font-size: 14px; outline: none; transition: border-color .2s;
  }
  .field input:focus { border-color: var(--accent); }
  .field input::placeholder { color: var(--muted); }
  .field .hint { display: block; font-size: 12px; color: var(--muted); margin-top: 8px; line-height: 1.55; }

  .dropzone {
    border: 1.5px dashed rgba(79,195,232,0.4);
    border-radius: 16px; padding: 56px 40px; text-align: center;
    cursor: pointer; transition: border-color .2s, background .2s;
    background: rgba(79,195,232,0.03);
  }
  .dropzone:hover { border-color: var(--accent); background: rgba(79,195,232,0.06); }
  .dropzone .dz-icon { font-size: 38px; color: var(--accent); margin-bottom: 16px; }
  .dropzone .dz-title { font-family: var(--display); font-weight: 700; font-size: 18px; color: #fff; letter-spacing: 0.02em; margin-bottom: 8px; }
  .dropzone .dz-sub { font-size: 13.5px; color: var(--label); }
  .dropzone .dz-foot { margin-top: 20px; font-family: var(--mono); font-size: 11px; letter-spacing: 0.12em; color: var(--muted); }

  .features { display: grid; grid-template-columns: repeat(4,1fr); gap: 10px; margin-top: 14px; }
  .feature {
    text-align: center; padding: 18px 10px; border-radius: 10px;
    border: 1px solid var(--line-soft); background: var(--panel);
  }
  .feature .f-icon { font-size: 22px; color: var(--accent); margin-bottom: 9px; }
  .feature .f-label { font-size: 12px; color: var(--label); line-height: 1.4; }

  .track { height: 4px; background: var(--panel-2); border-radius: 3px; overflow: hidden; margin: 18px 0; }
  .fill { height: 100%; border-radius: 3px; background: linear-gradient(90deg, #2f9fd6, var(--accent)); transition: width .8s cubic-bezier(.4,0,.2,1); }

  .btn {
    padding: 12px 30px; background: transparent; border: 1px solid rgba(79,195,232,0.5);
    color: var(--accent); cursor: pointer; font-family: var(--sans);
    font-size: 13px; font-weight: 600; letter-spacing: 0.04em; border-radius: 9px;
    transition: background .2s, border-color .2s;
  }
  .btn:hover { background: rgba(79,195,232,0.1); border-color: var(--accent); }
  .btn-primary { background: var(--accent); color: #06222e; border-color: var(--accent); }
  .btn-primary:hover { background: #6fd0ef; border-color: #6fd0ef; }
  .btn:disabled { opacity: 0.55; cursor: default; }

  .norm { padding: 11px 0; border-bottom: 1px solid var(--line-soft); }
  .norm:last-child { border-bottom: none; }
  .norm-disp { font-size: 13px; font-weight: 700; color: var(--accent); margin-bottom: 3px; }
  .norm-sint { font-size: 13px; color: var(--text); line-height: 1.6; }

  .legal {
    margin-top: 24px; padding: 18px 20px; border: 1px solid var(--line-soft);
    border-radius: 10px; font-size: 11.5px; line-height: 1.85; color: var(--muted);
  }

  @media (max-width: 640px) {
    .row { flex-direction: column; gap: 4px; }
    .row-label { min-width: 0; }
    .row-value { text-align: left; }
    .grid-2 { grid-template-columns: 1fr; }
    .features { grid-template-columns: 1fr 1fr; }
    .wordmark { font-size: 28px; }
    .dist-banner { flex-direction: column; align-items: flex-start; gap: 8px; }
  }
`;

// ─── Sub-components ──────────────────────────────────────────────────────────

function Row({ label, value, mono = false, nullText = "Não identificado" }) {
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

function Badge({ label, color }) {
  return (
    <span className="badge" style={{ color, background: `${color}22`, border: `1px solid ${color}55` }}>
      {label}
    </span>
  );
}

function Section({ title, danger = false, children }) {
  return (
    <div className="card">
      <div className={`card-head${danger ? " danger" : ""}`}>{title}</div>
      {children}
    </div>
  );
}

function DistanceBanner({ label, km }) {
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

// ─── Main App ────────────────────────────────────────────────────────────────

function parseExtraction(raw) {
  if (!raw) return null;
  const t = raw.replace(/```json|```/g, "").trim();
  try { return JSON.parse(t); } catch {}
  const i = t.indexOf("{");
  const j = t.lastIndexOf("}");
  if (i !== -1 && j !== -1 && j > i) {
    try { return JSON.parse(t.slice(i, j + 1)); } catch {}
  }
  return null;
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[data-src="${src}"]`)) return resolve();
    const s = document.createElement("script");
    s.src = src;
    s.setAttribute("data-src", src);
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("falha ao carregar " + src));
    document.head.appendChild(s);
  });
}

async function exportReportPDF(setBusy) {
  const el = document.getElementById("fd-report");
  if (!el) return;
  try {
    setBusy(true);
    await loadScript("https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js");
    await loadScript("https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js");
    const canvas = await window.html2canvas(el, { scale: 2, backgroundColor: "#0c1118", useCORS: true, logging: false });
    const jsPDFCtor = (window.jspdf && window.jspdf.jsPDF) || window.jsPDF;
    const pdf = new jsPDFCtor("p", "mm", "a4");
    const pw = pdf.internal.pageSize.getWidth();
    const ph = pdf.internal.pageSize.getHeight();
    const imgW = pw;
    const imgH = (canvas.height * imgW) / canvas.width;
    const img = canvas.toDataURL("image/jpeg", 0.92);
    let heightLeft = imgH;
    let position = 0;
    pdf.addImage(img, "JPEG", 0, position, imgW, imgH);
    heightLeft -= ph;
    while (heightLeft > 0) {
      position -= ph;
      pdf.addPage();
      pdf.addImage(img, "JPEG", 0, position, imgW, imgH);
      heightLeft -= ph;
    }
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    pdf.save(`Laudo_ForenseDoc_${stamp}.pdf`);
  } catch (e) {
    try { window.print(); } catch {}
  } finally {
    setBusy(false);
  }
}

function GeoMap({ home, sign, distanceKm, riskColor }) {
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
    <div style={{ marginTop: 14, background: "#0f1722", border: "1px solid #2a3647", borderRadius: 10, padding: 12 }}>
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

export default function ForenseDoc() {
  const [stage, setStage] = useState("idle");
  const [progress, setProgress] = useState({ label: "", pct: 0 });
  const [report, setReport] = useState(null);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [homeAddr, setHomeAddr] = useState("");
  const fileRef = useRef();

  const analyze = useCallback(async (file) => {
    if (!file) return;
    if (!file.name.match(/\.(pdf|PDF)$/)) {
      setError("Formato não suportado. Envie um arquivo em PDF.");
      setStage("error");
      return;
    }

    setStage("processing");
    setError("");

    try {
      setProgress({ label: "Lendo arquivo e calculando hashes criptográficos...", pct: 8 });
      const buffer = await file.arrayBuffer();
      const [sha256, sha1] = await Promise.all([
        digestHash("SHA-256", buffer),
        digestHash("SHA-1", buffer),
      ]);
      const base64 = arrayBufferToBase64(buffer);

      setProgress({ label: "Enviando ao motor de análise (IA)...", pct: 18 });
      const apiRes = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 4096,
          system: SYSTEM_PROMPT,
          messages: [
            {
              role: "user",
              content: [
                { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } },
                { type: "text", text: "Analise este contrato bancário e retorne o JSON estruturado conforme solicitado." },
              ],
            },
          ],
        }),
      });

      setProgress({ label: "Interpretando dados extraídos...", pct: 46 });
      let extracted = null;
      let extractionError = "";
      try {
        const apiData = await apiRes.json();
        if (apiData && apiData.error) {
          extractionError = apiData.error.message || "O motor de análise retornou um erro.";
        } else {
          const rawText = (apiData.content || []).map((b) => b.text || "").join("");
          extracted = parseExtraction(rawText);
          if (!extracted) {
            extractionError = "A extração automática não retornou dados estruturados válidos (resposta vazia ou JSON incompleto). O laudo foi gerado com os dados disponíveis; os campos extraídos podem ser preenchidos manualmente.";
          }
        }
      } catch (e) {
        extractionError = "Falha ao consultar o motor de análise: " + (e.message || "erro de rede.") + " O laudo foi gerado com os dados disponíveis.";
      }
      if (!extracted) extracted = {};

      setProgress({ label: "Geolocalizando endereços IP...", pct: 58 });
      const ipResults = [];
      for (const ipInfo of extracted.ips || []) {
        if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ipInfo.endereco)) {
          const geo = await geolocateIP(ipInfo.endereco);
          ipResults.push({ ...ipInfo, geo });
        }
      }

      // Ponto de referência: endereço residencial (o informado manualmente tem prioridade)
      setProgress({ label: "Geocodificando endereço residencial do cliente...", pct: 70 });
      const manual = (homeAddr || "").trim();
      const c = extracted.cliente || {};
      const extractedAddr = [c.endereco, c.bairro, c.cidade, c.estado].filter(Boolean).join(", ");
      const homeQuery = manual || extractedAddr || null;
      const homeSource = manual ? "Informado manualmente" : (extractedAddr ? "Extraído do contrato" : null);
      let homeGeo = null;
      if (homeQuery) homeGeo = await geocodeAddress(homeQuery);

      // Geolocalização declarada da assinatura (coordenadas GPS no log do contrato)
      setProgress({ label: "Analisando geolocalização declarada da assinatura...", pct: 80 });
      let contractGeo = null;
      const g = extracted.geolocalizacao_assinatura;
      if (g && g.presente) {
        const plat = g.latitude != null ? parseFloat(String(g.latitude).replace(",", ".")) : NaN;
        const plon = g.longitude != null ? parseFloat(String(g.longitude).replace(",", ".")) : NaN;
        if (!isNaN(plat) && !isNaN(plon)) {
          contractGeo = { lat: plat, lon: plon, endereco: g.endereco_declarado, fonte: g.fonte, precisao: g.precisao_metros, dataHora: g.data_hora, geocoded: false };
        } else if (g.endereco_declarado) {
          const gc = await geocodeAddress(g.endereco_declarado);
          if (gc) contractGeo = { lat: gc.lat, lon: gc.lon, endereco: g.endereco_declarado, fonte: g.fonte, precisao: g.precisao_metros, dataHora: g.data_hora, geocoded: true };
        }
      }

      setProgress({ label: "Calculando distâncias geográficas (Haversine)...", pct: 90 });
      const ipWithDistance = ipResults.map((ip) => {
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

      setProgress({ label: "Compilando laudo técnico pericial...", pct: 96 });
      const timestamp = new Date().toLocaleString("pt-BR", {
        timeZone: "America/Fortaleza",
        day: "2-digit", month: "2-digit", year: "numeric",
        hour: "2-digit", minute: "2-digit", second: "2-digit",
      });

      setReport({
        timestamp,
        file: { name: file.name, sizeKB: (buffer.byteLength / 1024).toFixed(2), sizeBytes: buffer.byteLength },
        hashes: { sha256, sha1 },
        extracted,
        home: { query: homeQuery, source: homeSource, geo: homeGeo },
        contractGeo: contractGeo ? { ...contractGeo, distance: contractToHomeKm } : null,
        geoDeclaredPresent: !!(g && g.presente),
        ipAnalysis: ipWithDistance,
        extractionError,
      });

      setStage("done");
      setProgress({ label: "Concluído", pct: 100 });
    } catch (err) {
      setError(err.message || "Erro inesperado durante a análise.");
      setStage("error");
    }
  }, [homeAddr]);

  const handleDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) analyze(f);
  };

  const reset = () => {
    setStage("idle");
    setReport(null);
    setError("");
    setProgress({ label: "", pct: 0 });
    if (fileRef.current) fileRef.current.value = "";
  };

  return (
    <>
      <style>{CSS}</style>
      <div className="fd-root">
        <div className="fd-shell">

          {/* Header */}
          <div style={{ textAlign: "center", marginBottom: 40 }}>
            <div className="eyebrow">Ronney Menezes Advocacia</div>
            <div className="wordmark">FORENSEDOC</div>
            <div className="subtitle">Sistema de Análise Forense de Contratos Bancários · v2.2</div>
            <div className="rule" />
          </div>

          {/* IDLE */}
          {stage === "idle" && (
            <div style={{ maxWidth: 660, margin: "0 auto" }}>
              <div className="field">
                <label>Endereço residencial do cliente (conferido)</label>
                <input
                  type="text"
                  value={homeAddr}
                  onChange={(e) => setHomeAddr(e.target.value)}
                  placeholder="Rua, número, bairro, cidade, UF"
                />
                <span className="hint">
                  Ponto de referência de todas as comparações de distância: a geolocalização declarada no contrato e cada IP serão confrontados com este endereço. Se ficar em branco, o sistema usa o endereço extraído do próprio contrato.
                </span>
              </div>

              <div
                className="dropzone"
                style={{ borderColor: dragging ? "var(--accent)" : undefined }}
                onDrop={handleDrop}
                onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onClick={() => fileRef.current.click()}
              >
                <div className="dz-icon">◈</div>
                <div className="dz-title">Anexar contrato em PDF</div>
                <div className="dz-sub">Arraste o arquivo aqui ou clique para selecionar</div>
                <div className="dz-foot">PDF · CONSIGNADO INSS · TODOS OS BANCOS</div>
              </div>
              <input ref={fileRef} type="file" accept=".pdf" style={{ display: "none" }} onChange={(e) => analyze(e.target.files[0])} />

              <div className="features">
                {[
                  { icon: "⬡", label: "Hash SHA-256 / SHA-1" },
                  { icon: "◉", label: "Geolocalização de IP" },
                  { icon: "⬢", label: "GPS da assinatura" },
                  { icon: "◈", label: "Distância Haversine" },
                ].map((f) => (
                  <div key={f.label} className="feature">
                    <div className="f-icon">{f.icon}</div>
                    <div className="f-label">{f.label}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* PROCESSING */}
          {stage === "processing" && (
            <div style={{ maxWidth: 520, margin: "70px auto", textAlign: "center" }}>
              <div style={{ width: 50, height: 50, border: "3px solid var(--panel-2)", borderTopColor: "var(--accent)", borderRadius: "50%", margin: "0 auto 26px", animation: "fd-spin 1s linear infinite" }} />
              <div className="eyebrow" style={{ animation: "fd-pulse 1.8s infinite", display: "block", marginBottom: 18 }}>Analisando documento</div>
              <div className="track"><div className="fill" style={{ width: `${progress.pct}%` }} /></div>
              <div style={{ fontSize: 13, color: "var(--label)", marginBottom: 8 }}>{progress.label}</div>
              <div style={{ fontSize: 16, color: "var(--accent)", fontWeight: 700 }}>{progress.pct}%</div>
            </div>
          )}

          {/* ERROR */}
          {stage === "error" && (
            <div style={{ maxWidth: 500, margin: "70px auto", textAlign: "center" }}>
              <div style={{ fontSize: 40, color: "var(--crit)", marginBottom: 16 }}>⚠</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: "var(--crit)", marginBottom: 10, letterSpacing: "0.04em" }}>Erro na análise</div>
              <div style={{ fontSize: 14, color: "var(--label)", marginBottom: 28 }}>{error}</div>
              <button className="btn" onClick={reset}>Tentar novamente</button>
            </div>
          )}

          {/* REPORT */}
          {stage === "done" && report && (
            <div>
              <div id="fd-report" style={{ background: "var(--ink)", padding: "2px 0" }}>
              {/* Report header */}
              <div className="card" style={{ textAlign: "center", borderColor: "rgba(79,195,232,0.3)", background: "linear-gradient(180deg, rgba(79,195,232,0.06), var(--panel))" }}>
                <div className="eyebrow" style={{ fontSize: 11 }}>Laudo técnico pericial · Análise forense digital</div>
                <div style={{ fontFamily: "var(--display)", fontWeight: 700, fontSize: 22, color: "#fff", margin: "12px 0 8px", letterSpacing: "0.02em" }}>
                  Contrato de Crédito Consignado
                </div>
                <div style={{ fontSize: 12.5, color: "var(--muted)" }}>Emitido em {report.timestamp} · Horário de Fortaleza (BRT)</div>
                <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 3 }}>
                  {report.file.name} · {report.file.sizeKB} KB · {report.file.sizeBytes.toLocaleString("pt-BR")} bytes
                </div>
              </div>

              {report.extractionError && (
                <div className="card" style={{ borderColor: "rgba(242,176,61,0.4)", background: "rgba(242,176,61,0.06)" }}>
                  <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                    <span style={{ color: "var(--warn)", fontSize: 18, lineHeight: 1.2 }}>⚠</span>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: "var(--warn)", marginBottom: 4 }}>Extração automática parcial</div>
                      <div style={{ fontSize: 13, color: "#d9c79a", lineHeight: 1.6 }}>{report.extractionError}</div>
                    </div>
                  </div>
                </div>
              )}

              {/* §1 */}
              <Section title="§ 1 · Identificação e integridade criptográfica">
                <Row label="Nome do arquivo" value={report.file.name} />
                <Row label="Tamanho" value={`${report.file.sizeKB} KB (${report.file.sizeBytes.toLocaleString("pt-BR")} bytes)`} />
                <Row label="Tipo de documento" value={report.extracted.tipo_documento} />
                <Row label="Qualidade de OCR / leitura" value={report.extracted.qualidade_ocr} />

                {(() => {
                  const declared = report.extracted.assinatura?.hash_documento_assinado
                    ? String(report.extracted.assinatura.hash_documento_assinado).trim()
                    : null;
                  const declaredAlgo = report.extracted.assinatura?.algoritmo_hash || null;
                  const calc = report.hashes.sha256;
                  const cls = classifyHashString(declared);
                  const confere = !!declared && cls?.format === "SHA-256" && declared.replace(/\s/g, "").toUpperCase() === calc.toUpperCase();
                  const vcolor = confere ? "var(--ok)" : "var(--crit)";

                  if (declared) {
                    return (
                      <>
                        <div className="sub-head">Confronto · hash informado × hash encontrado</div>
                        <div className="grid-2">
                          <div className="hash-card" style={{ borderTopColor: "var(--warn)" }}>
                            <div className="htitle" style={{ color: "var(--warn)" }}>Hash informado no documento</div>
                            <div className="hvalue" style={{ color: "#f4cd86" }}>{declared}</div>
                            <div className="hmeta">
                              Algoritmo declarado: {declaredAlgo || "não informado"}<br />
                              Formato detectado: {cls?.format}{cls && !cls.isHash ? " (não é hash criptográfico)" : ""}
                            </div>
                          </div>
                          <div className="hash-card" style={{ borderTopColor: "var(--accent)" }}>
                            <div className="htitle" style={{ color: "var(--accent)" }}>Hash encontrado (calculado)</div>
                            <div className="hvalue" style={{ color: "var(--accent)" }}>{calc}</div>
                            <div className="hmeta">
                              Algoritmo: SHA-256 (NIST FIPS 180-4)<br />
                              Calculado localmente sobre o arquivo original
                            </div>
                          </div>
                        </div>
                        <div className="row" style={{ marginTop: 14 }}>
                          <span className="row-label">Resultado da comparação</span>
                          <Badge label={confere ? "HASHES CONFEREM" : "DIVERGÊNCIA DETECTADA"} color={confere ? "#3ddc97" : "#f06363"} />
                        </div>
                        <div className="note" style={{ borderLeftColor: vcolor, background: confere ? "rgba(61,220,151,0.07)" : "rgba(240,99,99,0.07)" }}>
                          {!cls?.isHash
                            ? `O valor apresentado no documento como hash não corresponde a um hash criptográfico válido. ${cls?.detalhe}. A substituição do hash criptográfico por identificador dessa natureza configura defeito formal do instrumento, pois impede a verificação objetiva de integridade e autenticidade exigida para a assinatura eletrônica, nos termos da MP 2.200-2/2001.`
                            : confere
                            ? "O hash informado no documento confere integralmente com o hash calculado localmente sobre o arquivo. Integridade consistente entre o valor declarado e o conteúdo verificado."
                            : "O hash informado no documento diverge do hash calculado localmente sobre o arquivo. A divergência deve ser interpretada com cautela técnica: em PDFs assinados, o hash de assinatura refere-se ao conteúdo no instante da assinatura e pode não coincidir com o recálculo sobre o arquivo finalizado. Recomenda-se verificação pericial complementar antes de qualquer conclusão sobre adulteração."}
                        </div>
                      </>
                    );
                  }

                  return (
                    <>
                      <Row label="SHA-256 (fingerprint)" value={calc} mono />
                      <div className="note">
                        O contrato não veio acompanhado de hash informado. Não há, no documento, valor declarado de hash criptográfico disponível para conferência. O hash criptográfico (SHA-256) calculado por este sistema sobre o arquivo original é o indicado acima, e passa a servir como impressão digital de referência do documento para fins de cadeia de custódia.
                      </div>
                    </>
                  );
                })()}

                <Row label="SHA-1 (arquivo)" value={report.hashes.sha1} mono />
              </Section>

              {/* §2 */}
              <Section title="§ 2 · Dados do instrumento contratual">
                {[
                  ["Número do contrato", report.extracted.contrato?.numero],
                  ["Banco / instituição financeira", report.extracted.contrato?.banco],
                  ["Código BACEN", report.extracted.contrato?.codigo_banco_bacen],
                  ["Produto", report.extracted.contrato?.produto],
                  ["Modalidade", report.extracted.contrato?.modalidade],
                  ["Valor contratado", report.extracted.contrato?.valor_contratado],
                  ["Valor da parcela", report.extracted.contrato?.valor_parcela],
                  ["Número de parcelas", report.extracted.contrato?.numero_parcelas],
                  ["Prazo (meses)", report.extracted.contrato?.prazo_meses],
                  ["Taxa de juros mensal", report.extracted.contrato?.taxa_juros_mensal],
                  ["Taxa de juros anual", report.extracted.contrato?.taxa_juros_anual],
                  ["CET mensal", report.extracted.contrato?.cet_mensal],
                  ["CET anual", report.extracted.contrato?.cet_anual],
                  ["Data do contrato", report.extracted.contrato?.data_contrato],
                  ["Primeiro vencimento", report.extracted.contrato?.data_primeiro_vencimento],
                  ["Último vencimento", report.extracted.contrato?.data_ultimo_vencimento],
                ].map(([lbl, val]) => <Row key={lbl} label={lbl} value={val} />)}
              </Section>

              {/* §3 */}
              <Section title="§ 3 · Qualificação do contratante">
                {[
                  ["Nome completo", report.extracted.cliente?.nome],
                  ["CPF", report.extracted.cliente?.cpf],
                  ["RG", report.extracted.cliente?.rg],
                  ["Data de nascimento", report.extracted.cliente?.data_nascimento],
                  ["Endereço (extraído do contrato)", report.extracted.cliente?.endereco],
                  ["Bairro", report.extracted.cliente?.bairro],
                  ["Cidade", report.extracted.cliente?.cidade],
                  ["Estado", report.extracted.cliente?.estado],
                  ["CEP", report.extracted.cliente?.cep],
                  ["Telefone", report.extracted.cliente?.telefone],
                  ["E-mail", report.extracted.cliente?.email],
                  ["Matrícula INSS", report.extracted.cliente?.matricula_inss],
                  ["Número do benefício", report.extracted.cliente?.numero_beneficio],
                  ["Espécie do benefício", report.extracted.cliente?.especie_beneficio],
                  ["Banco de recebimento", report.extracted.cliente?.banco_recepcao],
                ].map(([lbl, val]) => <Row key={lbl} label={lbl} value={val} />)}

                <div className="sub-head">Endereço de referência (ponto de origem das distâncias)</div>
                <Row label="Endereço adotado" value={report.home.query} nullText="Nenhum endereço informado ou extraído" />
                <Row label="Origem do endereço" value={report.home.source} />
                {report.home.geo ? (
                  <Row label="Coordenadas (residencial · aprox.)" value={`${report.home.geo.lat.toFixed(6)}, ${report.home.geo.lon.toFixed(6)}`} mono />
                ) : report.home.query ? (
                  <div className="note" style={{ borderLeftColor: "var(--warn)", background: "rgba(242,176,61,0.07)" }}>
                    Não foi possível geocodificar o endereço residencial informado. As distâncias até este ponto não puderam ser calculadas. Verifique a grafia do endereço e tente novamente, de preferência com cidade e UF.
                  </div>
                ) : null}
              </Section>

              {/* §4 */}
              <Section title="§ 4 · Assinatura eletrônica e cadeia de custódia">
                <div className="row">
                  <span className="row-label">Assinatura presente</span>
                  <Badge label={report.extracted.assinatura?.presente ? "CONFIRMADA" : "AUSENTE"} color={report.extracted.assinatura?.presente ? "#3ddc97" : "#f06363"} />
                </div>

                <div className="note">
                  A validade da assinatura eletrônica não depende de certificação ICP-Brasil. A MP 2.200-2/2001 (art. 10, §2º) admite outros meios de comprovação de autoria e integridade, e a Lei 14.063/2020 reconhece as assinaturas simples, avançada e qualificada, todas com validade jurídica. O STJ consolidou esse entendimento no REsp 2.159.442 (rel. Min. Nancy Andrighi) e o reafirmou no REsp 2.205.708. O ponto decisivo não é o selo ICP-Brasil, e sim a completude da cadeia de custódia: demonstrar quem assinou, quando, de onde e com qual integridade.
                </div>

                {[
                  ["Plataforma de assinatura", report.extracted.assinatura?.plataforma],
                  ["Tipo de assinatura", report.extracted.assinatura?.tipo],
                  ["Nível (Lei 14.063/2020)", report.extracted.assinatura?.nivel_legal_mp2200],
                  ["Base legal aplicável", report.extracted.assinatura?.base_legal],
                  ["Titular do signatário", report.extracted.assinatura?.titular_certificado],
                  ["CPF do titular", report.extracted.assinatura?.cpf_titular],
                  ["Data / hora da assinatura", report.extracted.assinatura?.data_hora_assinatura],
                  ["Autoridade certificadora (se ICP-Brasil)", report.extracted.assinatura?.certificadora_ac],
                  ["Nº de série do certificado (se ICP-Brasil)", report.extracted.assinatura?.numero_serie_certificado],
                  ["Validade do certificado · início (se ICP-Brasil)", report.extracted.assinatura?.validade_certificado_inicio],
                  ["Validade do certificado · fim (se ICP-Brasil)", report.extracted.assinatura?.validade_certificado_fim],
                  ["Algoritmo de hash", report.extracted.assinatura?.algoritmo_hash],
                ].map(([lbl, val]) => <Row key={lbl} label={lbl} value={val} />)}

                {report.extracted.assinatura?.metodos_autenticacao?.length > 0 && (
                  <Row label="Métodos de autenticação" value={report.extracted.assinatura.metodos_autenticacao.join(" · ")} />
                )}
                {report.extracted.assinatura?.hash_documento_assinado && (
                  <Row label="Hash do doc. assinado" value={report.extracted.assinatura.hash_documento_assinado} mono />
                )}
                {report.extracted.assinatura?.integridade_pos_assinatura !== null && report.extracted.assinatura?.integridade_pos_assinatura !== undefined && (
                  <div className="row">
                    <span className="row-label">Integridade pós-assinatura</span>
                    <Badge label={report.extracted.assinatura.integridade_pos_assinatura ? "ÍNTEGRO" : "DOCUMENTO ADULTERADO"} color={report.extracted.assinatura.integridade_pos_assinatura ? "#3ddc97" : "#f06363"} />
                  </div>
                )}
                {report.extracted.assinatura?.observacoes && (
                  <div className="note">{report.extracted.assinatura.observacoes}</div>
                )}

                {(() => {
                  const a = report.extracted.assinatura || {};
                  const cc = report.extracted.cadeia_custodia || {};
                  const items = [
                    ["Identificação do signatário", !!(cc.identificacao_signatario || a.titular_certificado || a.cpf_titular || report.extracted.cliente?.nome)],
                    ["Registro de IP", !!(cc.registro_ip || report.ipAnalysis.length > 0)],
                    ["Carimbo de data e hora", !!(cc.carimbo_tempo || a.data_hora_assinatura)],
                    ["Geolocalização do ato", !!(cc.geolocalizacao || report.geoDeclaredPresent || report.contractGeo)],
                    ["Método de autenticação", !!(cc.metodo_autenticacao || (a.metodos_autenticacao && a.metodos_autenticacao.length > 0) || (a.tipo && a.tipo !== "Ausente" && a.tipo !== "Indeterminado"))],
                    ["Hash de integridade", !!(cc.hash_integridade || a.hash_documento_assinado)],
                    ["Trilha de auditoria", !!cc.trilha_auditoria],
                    ["Evidência de aceite / vontade", !!cc.evidencia_aceite],
                  ];
                  const present = items.filter((it) => it[1]).length;
                  const total = items.length;
                  const pct = Math.round((present / total) * 100);
                  const completo = present >= 6;
                  const parcial = present >= 4 && present < 6;
                  const vcolor = completo ? "#3ddc97" : parcial ? "#f2b03d" : "#f06363";
                  const missing = items.filter((it) => !it[1]).map((it) => it[0].toLowerCase());

                  return (
                    <>
                      <div className="sub-head">Cadeia de custódia da assinatura</div>
                      <div className="dist-banner" style={{ borderColor: `${vcolor}55`, background: `${vcolor}14`, marginTop: 16 }}>
                        <div>
                          <div className="dl">Completude da cadeia de custódia</div>
                          <div className="dv" style={{ color: vcolor }}>{present}/{total} · {pct}%</div>
                        </div>
                        <Badge label={completo ? "SUBSTANCIALMENTE COMPLETA" : parcial ? "PARCIAL" : "INCOMPLETA"} color={vcolor} />
                      </div>
                      <div className="note" style={{ borderLeftColor: vcolor, background: `${vcolor}12` }}>
                        {completo
                          ? "A assinatura eletrônica é juridicamente válida ainda que sem certificação ICP-Brasil, e a cadeia de custódia reúne os elementos necessários para que a instituição comprove autoria e integridade (MP 2.200-2/2001, art. 10, §2º; Lei 14.063/2020; STJ, REsp 2.159.442, rel. Min. Nancy Andrighi)."
                          : `A ausência de certificação ICP-Brasil não invalida, por si só, a assinatura. Contudo, a cadeia de custódia está ${parcial ? "parcial" : "incompleta"}: faltam ${missing.join(", ")}. Quando o consumidor contesta a assinatura em contrato bancário, o ônus de comprovar a autenticidade e a integridade recai sobre a instituição financeira (STJ, Tema 1.061). A incompletude da cadeia de custódia fragiliza essa prova e sustenta a impugnação do documento.`}
                      </div>
                    </>
                  );
                })()}
              </Section>

              {/* §5 Geolocalização da assinatura · confronto geográfico */}
              <Section title="§ 5 · Geolocalização da assinatura · confronto geográfico">
                {report.contractGeo ? (
                  <>
                    <div className="sub-head">Confronto · residência do cliente × geolocalização declarada no contrato</div>
                    <div className="grid-2">
                      <div className="geo-card" style={{ borderTopColor: "var(--accent)" }}>
                        <div className="gtitle" style={{ color: "var(--accent)" }}>Residência do cliente (referência)</div>
                        <div className="gcoord" style={{ color: "var(--accent)" }}>
                          {report.home.geo ? `${report.home.geo.lat.toFixed(6)}, ${report.home.geo.lon.toFixed(6)}` : "Não geocodificada"}
                        </div>
                        <div className="gmeta">
                          {report.home.query || "Endereço não informado"}<br />
                          Origem: {report.home.source || "não disponível"}<br />
                          Coordenada aproximada por geocodificação
                        </div>
                      </div>
                      <div className="geo-card" style={{ borderTopColor: "var(--warn)" }}>
                        <div className="gtitle" style={{ color: "var(--warn)" }}>Geolocalização declarada no contrato</div>
                        <div className="gcoord" style={{ color: "#f4cd86" }}>
                          {report.contractGeo.lat.toFixed(7)}, {report.contractGeo.lon.toFixed(7)}
                        </div>
                        <div className="gmeta">
                          {report.contractGeo.endereco || "Endereço declarado não informado"}<br />
                          Fonte: {report.contractGeo.fonte || "não informada"}
                          {report.contractGeo.precisao ? ` · Precisão: ${report.contractGeo.precisao} m` : ""}
                          {report.contractGeo.geocoded ? " · Coordenada obtida por geocodificação do endereço declarado" : " · Coordenada GPS extraída do log"}
                        </div>
                      </div>
                    </div>

                    {report.contractGeo.dataHora && <Row label="Data / hora da geolocalização" value={report.contractGeo.dataHora} />}

                    {report.contractGeo.distance !== null && report.contractGeo.distance !== undefined ? (
                      <>
                        <DistanceBanner label="Distância: residência do cliente → local declarado da assinatura" km={report.contractGeo.distance} />
                        <GeoMap
                          home={report.home.geo}
                          sign={{ lat: report.contractGeo.lat, lon: report.contractGeo.lon }}
                          distanceKm={report.contractGeo.distance}
                          riskColor={riskFromDistance(report.contractGeo.distance).color}
                        />
                        <div className="note" style={{ borderLeftColor: "var(--label)", background: "rgba(133,149,168,0.07)" }}>
                          A distância isolada não determina fraude. Deslocamentos compatíveis com a rotina do cliente, como ir da zona rural à capital do estado, podem ser plenamente legítimos. Este resultado deve ser confrontado com a entrevista do cliente, com a data e hora da assinatura e com a localização do correspondente bancário antes de qualquer conclusão sobre irregularidade.
                        </div>
                      </>
                    ) : (
                      <div className="note" style={{ borderLeftColor: "var(--warn)", background: "rgba(242,176,61,0.07)" }}>
                        Há geolocalização declarada no contrato, mas o endereço residencial não pôde ser geocodificado. Informe o endereço residencial do cliente na tela inicial para que a distância seja calculada.
                      </div>
                    )}
                  </>
                ) : (
                  <div className="note" style={{ borderLeftColor: "var(--muted)", background: "rgba(133,149,168,0.07)" }}>
                    {report.geoDeclaredPresent
                      ? "O documento indica geolocalização da assinatura, mas não foi possível obter coordenadas válidas nem geocodificar o endereço declarado."
                      : "Não foi localizada geolocalização (coordenadas GPS) declarada no log de assinatura deste documento. Nada a confrontar nesta seção."}
                  </div>
                )}
              </Section>

              {/* §6 IP */}
              <Section title={`§ 6 · Endereços IP e geolocalização (${report.ipAnalysis.length} encontrado(s))`}>
                {report.ipAnalysis.length === 0 ? (
                  <div style={{ fontSize: 13, color: "var(--muted)", textAlign: "center", padding: 18 }}>
                    Nenhum endereço IP identificado no documento analisado.
                  </div>
                ) : (
                  <>
                    <div className="sub-head">
                      Referência das distâncias: {report.home.query ? `residência do cliente (${report.home.source})` : "endereço residencial não informado"}
                    </div>
                    {report.ipAnalysis.map((ip, i) => {
                      const risk = riskFromDistance(ip.distance);
                      return (
                        <div key={i} className="ip-block" style={{ border: `1px solid ${risk.color}40`, background: risk.bg }}>
                          <div className="ip-head">
                            <div className="ip-id" style={{ color: risk.color }}>IP #{i + 1} · {ip.endereco}</div>
                            <Badge label={risk.label} color={risk.color} />
                          </div>
                          {ip.contexto && <div className="ip-ctx">Contexto: {ip.contexto}</div>}

                          {ip.geo ? (
                            <>
                              {[
                                ["País", ip.geo.country],
                                ["Estado / região", ip.geo.region],
                                ["Cidade", ip.geo.city],
                                ["Provedor (ISP / ASN)", ip.geo.isp],
                                ["Fuso horário", ip.geo.timezone],
                              ].map(([lbl, val]) => <Row key={lbl} label={lbl} value={val} />)}
                              <Row label="Coordenadas do IP" value={`${ip.geo.lat?.toFixed(7)}, ${ip.geo.lon?.toFixed(7)}`} mono />
                              {ip.distance !== null ? (
                                <div className="row">
                                  <span className="row-label">Distância à residência do cliente</span>
                                  <span className="row-value" style={{ color: risk.color, fontWeight: 700 }}>{ip.distance.toFixed(2)} km</span>
                                </div>
                              ) : (
                                <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 8 }}>
                                  Endereço residencial não geocodificado. Distância indisponível para este IP.
                                </div>
                              )}
                            </>
                          ) : (
                            <div style={{ fontSize: 13, color: "var(--muted)", padding: "6px 0" }}>
                              Geolocalização indisponível para este endereço IP.
                            </div>
                          )}

                          {ip.data_hora && <Row label="Data / hora registrada" value={ip.data_hora} />}
                          {ip.user_agent && <Row label="User-Agent" value={ip.user_agent} />}
                        </div>
                      );
                    })}
                  </>
                )}
              </Section>

              {/* §7 */}
              {report.extracted.evidencias_irregularidade?.length > 0 && (
                <Section title="§ 7 · Evidências de irregularidade" danger>
                  {report.extracted.evidencias_irregularidade.map((ev, i) => (
                    <div key={i} className="flag"><b>▸</b><span>{ev}</span></div>
                  ))}
                </Section>
              )}

              {/* §8 */}
              {report.extracted.observacoes_periciais && (
                <Section title="§ 8 · Observações periciais complementares">
                  <div style={{ fontSize: 13.5, color: "#c2cedb", lineHeight: 1.75 }}>{report.extracted.observacoes_periciais}</div>
                </Section>
              )}

              {/* §9 Fundamentação normativa */}
              <Section title="§ 9 · Fundamentação normativa aplicável">
                {(() => {
                  const ctr = report.extracted.contrato || {};
                  const declaredHash = report.extracted.assinatura?.hash_documento_assinado;
                  const clsHash = declaredHash ? classifyHashString(declaredHash) : null;
                  const hashDefect = !!(clsHash && !clsHash.isHash);
                  const cetPresent = !!(ctr.cet_mensal || ctr.cet_anual);
                  const geoRisk =
                    (report.contractGeo?.distance != null && report.contractGeo.distance >= 300) ||
                    report.ipAnalysis.some((ip) => ip.distance != null && ip.distance >= 300);

                  const destaques = [];
                  if (hashDefect) destaques.push("defeito formal de integridade do documento");
                  if (cetPresent) destaques.push("informação e consistência do CET");
                  destaques.push("validade da assinatura eletrônica e ônus da prova");
                  if (geoRisk) destaques.push("incompatibilidade geográfica do ato");

                  const groups = [
                    ["Relação de consumo e dever de informação", [
                      ["CDC (Lei 8.078/1990), art. 6º, III", "Direito do consumidor à informação adequada, clara e ostensiva sobre o produto de crédito, seus riscos e seu preço."],
                      ["CDC, art. 46", "O contrato não obriga o consumidor que não teve conhecimento prévio de seu conteúdo ou cujos termos sejam de difícil compreensão."],
                      ["CDC, art. 52", "No fornecimento de crédito, a instituição deve informar previamente preço, montante dos juros, acréscimos, número e periodicidade das prestações e a soma total a pagar."],
                      ["CDC, art. 51, IV e § 1º", "Nulidade de cláusulas que coloquem o consumidor em desvantagem exagerada ou incompatíveis com a boa-fé."],
                      ["Súmula 297 do STJ", "O Código de Defesa do Consumidor é aplicável às instituições financeiras."],
                    ]],
                    ["Crédito consignado e benefício do INSS", [
                      ["Lei 10.820/2003 e Decreto 4.840/2003", "Disciplinam a autorização e os limites do desconto de prestações de empréstimo consignado em folha de pagamento e em benefício previdenciário."],
                      ["Lei 8.213/1991, art. 115", "Define as hipóteses e os limites de desconto sobre o valor do benefício previdenciário."],
                      ["Normas do INSS sobre consignações (Instrução Normativa vigente) e Resoluções do CNPS", "Regulam margem consignável, formalização e averbação. Número da IN vigente: verificar conforme a data do contrato."],
                    ]],
                    ["Custo Efetivo Total (CET)", [
                      ["Resolução CMN 4.881/2020, art. 2º", "Define o CET como a taxa que representa, de forma consolidada, todos os encargos e despesas da operação."],
                      ["Resolução CMN 4.881/2020, art. 7º", "Obriga a instituição a informar o CET previamente à contratação e a apresentar o demonstrativo de cálculo ao tomador."],
                      ["CDC, art. 52, c/c Resolução CMN 4.881/2020", "A ausência, a incorreção ou a inconsistência do CET frente à taxa de juros caracteriza falha no dever de informação."],
                    ]],
                    ["Assinatura eletrônica e ônus da prova", [
                      ["MP 2.200-2/2001, art. 10, § 2º", "Admite outros meios de comprovação de autoria e integridade, além da certificação ICP-Brasil."],
                      ["Lei 14.063/2020", "Classifica as assinaturas em simples, avançada e qualificada, todas com validade jurídica conforme o grau de segurança."],
                      ["STJ, REsp 2.159.442 e REsp 2.205.708", "A ausência de certificação ICP-Brasil não invalida, por si só, a assinatura, desde que comprovadas autoria e integridade."],
                      ["STJ, Tema 1.061, c/c CPC, art. 373", "Impugnada a assinatura em contrato bancário, cabe à instituição financeira comprovar a autenticidade e a integridade do documento."],
                    ]],
                    ["Vícios contratuais e boa-fé", [
                      ["CC (Lei 10.406/2002), arts. 138, 145 e 157", "Erro, dolo e lesão como vícios do consentimento aptos a invalidar o negócio jurídico."],
                      ["CC, art. 422", "Dever de probidade e boa-fé objetiva na conclusão e na execução do contrato."],
                      ["CDC, arts. 54-A a 54-G (Lei 14.181/2021)", "Prevenção e tratamento do superendividamento e do crédito responsável."],
                      ["Súmula 479 do STJ", "Responsabilidade objetiva da instituição por fraudes e delitos de terceiros no âmbito das operações bancárias."],
                    ]],
                    ["Proteção de dados (geolocalização e logs)", [
                      ["LGPD (Lei 13.709/2018), arts. 5º e 7º", "Coordenadas de geolocalização e registros de IP são dados pessoais; seu tratamento exige base legal e pode ser objeto de verificação probatória."],
                    ]],
                  ];

                  return (
                    <>
                      <div className="note" style={{ marginTop: 0 }}>
                        Achados deste laudo com maior aderência normativa: {destaques.join("; ")}.
                      </div>
                      {groups.map(([title, entries]) => (
                        <div key={title}>
                          <div className="sub-head">{title}</div>
                          {entries.map(([disp, sint]) => (
                            <div key={disp} className="norm">
                              <div className="norm-disp">{disp}</div>
                              <div className="norm-sint">{sint}</div>
                            </div>
                          ))}
                        </div>
                      ))}
                      <div className="note" style={{ borderLeftColor: "var(--muted)", background: "rgba(133,149,168,0.07)" }}>
                        A fundamentação acima é referencial e deve ser ajustada ao caso concreto e à data da contratação. A indicação dos dispositivos não dispensa a conferência da redação vigente de cada norma no momento do contrato.
                      </div>
                    </>
                  );
                })()}
              </Section>

              {/* Legal */}
              <div className="legal">
                AVISO LEGAL: Este laudo foi gerado automaticamente pelo sistema ForenseDoc (Ronney Menezes Advocacia, OAB/PI 15.508 · OAB/MA 26.102-A) para fins de análise jurídica preliminar. Os hashes criptográficos SHA-256 e SHA-1 foram calculados localmente sobre o arquivo original via Web Crypto API (NIST FIPS 180-4). A geolocalização de IPs é fornecida por serviço de terceiros (ipapi.co) e possui margem de erro inerente; endereços de ISPs e VPNs podem não refletir a localização física real do usuário. A geolocalização declarada da assinatura é extraída do próprio documento e a geocodificação de endereços usa o serviço OpenStreetMap Nominatim. A fórmula de Haversine calcula a distância geodésica sobre a superfície esférica terrestre. A distância geográfica, isoladamente, não constitui prova de fraude e deve ser ponderada com o contexto fático. Este documento deve ser complementado por análise pericial humana qualificada antes de ser utilizado como prova técnica definitiva nos autos. Gerado em {report.timestamp}.
              </div>

              </div>

              <div style={{ display: "flex", justifyContent: "center", gap: 12, flexWrap: "wrap", marginTop: 36 }}>
                <button className="btn btn-primary" onClick={() => exportReportPDF(setPdfBusy)} disabled={pdfBusy}>
                  {pdfBusy ? "Gerando PDF..." : "Gerar relatório em PDF"}
                </button>
                <button className="btn" onClick={reset} disabled={pdfBusy}>Analisar novo contrato</button>
              </div>
            </div>
          )}

        </div>
      </div>
    </>
  );
}
