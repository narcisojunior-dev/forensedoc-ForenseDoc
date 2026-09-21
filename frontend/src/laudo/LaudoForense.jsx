import React from "react";
import "./laudo.css";
import {
  classifyHashString, shortHash, formatCnpj, formatCpf, labelHashState, labelProvenance, labelModalidade, formatMetadataWarning,
  noteForDeclaredHashState, reportIssues, issueBucket, extractCnjFromName, labelComparisonStatus,
  comparisonStatusColor, severityColor, haversineKm, riskFromDistance, riskFromDistanceWithHistory, semPontoFinal,
} from "./laudoUtils.js";
import SumarioIrregularidades from "./SumarioIrregularidades.jsx";
import { distanciaKm } from "./distancia.js";
import { fichaBeneficioSeAplica } from "./produto.js";

/**
 * Laudo técnico pericial, portado do motor de geração.
 *
 * É o mesmo documento que o motor renderiza (§§ 1 a 10, sumário executivo em
 * duas páginas), alimentado pelo resultado persistido da análise em vez do
 * processamento no navegador. A exportação em PDF (`exportarLaudoPdf.js`)
 * captura o elemento `#fd-report` exatamente como aparece aqui.
 *
 * Acréscimos do SaaS mantidos no laudo: registro dos campos conferidos pelo
 * operador, coordenada confirmada pelo operador, nota de CGNAT, titular do bloco
 * de IP (RDAP) e anexo de quesitos judiciais.
 */

const API_BASE = `${import.meta.env.VITE_API_BASE || ""}/api`;

const referenciaRecusada = (home) => ["RECUSADO_CONFLITO", "INDISPONIVEL_NAO_INFORMADO"].includes(home?.estado_confronto);

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
    <div className="card report-section">
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

function AuditTimeline({ events }) {
  return (
    <div className="audit-timeline">
      {events.map((event, index) => (
        <div key={`${event.action}-${index}`} className={`audit-event${/Selfie|Finalizado/.test(event.action) ? " critical" : ""}`}>
          <div className="audit-event-time">{event.time || "--:--"}</div>
          <div className="audit-event-title">{event.action}</div>
          <div className="audit-event-net">{event.ip || "IP não legível"}{event.port ? `:${event.port}` : ""}</div>
        </div>
      ))}
    </div>
  );
}

function DispersionPlot({ audit }) {
  const points = audit.events.filter((event) => Number.isFinite(event.lat) && Number.isFinite(event.lon));
  if (!points.length) return <div className="note">Não houve coordenadas suficientes para calcular a dispersão dos eventos.</div>;
  const W = 320, H = 220, pad = 34;
  const lats = points.map((point) => point.lat);
  const lons = points.map((point) => point.lon);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const minLon = Math.min(...lons), maxLon = Math.max(...lons);
  const latSpan = Math.max(maxLat - minLat, 0.00001);
  const lonSpan = Math.max(maxLon - minLon, 0.00001);
  const xy = (point) => ({
    x: pad + ((point.lon - minLon) / lonSpan) * (W - pad * 2),
    y: pad + ((maxLat - point.lat) / latSpan) * (H - pad * 2),
  });
  return (
    <div className="dispersion-block">
      <div className="dispersion-title">Dispersão das coordenadas</div>
      <div className="dispersion-subtitle">Cada ponto representa o GPS de um evento. Norte para cima.</div>
      <svg className="dispersion-chart" viewBox={`0 0 ${W} ${H}`} aria-label="Dispersão das coordenadas do trilho de acesso">
        <rect x={pad} y={pad} width={W - pad * 2} height={H - pad * 2} fill="none" stroke="#52616c" strokeOpacity=".45" />
        {[1, 2, 3].map((step) => (
          <g key={step}>
            <line x1={pad + (W - pad * 2) * step / 4} y1={pad} x2={pad + (W - pad * 2) * step / 4} y2={H - pad} stroke="#52616c" strokeOpacity=".2" />
            <line x1={pad} y1={pad + (H - pad * 2) * step / 4} x2={W - pad} y2={pad + (H - pad * 2) * step / 4} stroke="#52616c" strokeOpacity=".2" />
          </g>
        ))}
        <text x={W / 2} y="18" textAnchor="middle" fontFamily="monospace" fontSize="10" fill="#6b7a8d">N</text>
        {points.map((point, index) => {
          const p = xy(point);
          const keyPoint = index === 0 || index === points.length - 1;
          return (
            <g key={`${point.lat}-${point.lon}-${index}`}>
              <circle cx={p.x} cy={p.y} r={keyPoint ? 8 : 6} fill={keyPoint ? "#b84638" : "#647b8a"} stroke="#ffffff" strokeWidth="1.5" />
              <text x={p.x} y={p.y + 3} textAnchor="middle" fontFamily="monospace" fontSize="7" fontWeight="700" fill="#ffffff">{index + 1}</text>
            </g>
          );
        })}
      </svg>
      <div className="dispersion-stats">
        <span>N-S ≈ {audit.northSouthMeters?.toFixed(1)} m</span>
        <span>L-O ≈ {audit.eastWestMeters?.toFixed(1)} m</span>
      </div>
    </div>
  );
}

function AuditFinding({ kind, tag, title, children }) {
  return (
    <div className={`audit-finding ${kind || ""}`}>
      <div>
        <span className="audit-finding-tag">{tag}</span>
        <span className="audit-finding-title">{title}</span>
      </div>
      <div className="audit-finding-text">{children}</div>
    </div>
  );
}

function GeoMap({
  home,
  sign,
  distanceKm,
  riskColor,
  targetLabel = "Assinatura declarada",
  homeLabel = "Residência",
  caption = "Cartografia real em projeção Web Mercator. Marcadores posicionados pelas coordenadas registradas; distância geodésica calculada por Haversine. A base cartográfica é contextual e não aumenta a precisão do GPS, da geocodificação ou da localização por IP.",
}) {
  const W = 660, H = 380, TILE = 256, fitPad = 92;
  const clampLat = (lat) => Math.max(-85.05112878, Math.min(85.05112878, lat));
  const project = (lat, lon, zoom) => {
    const world = TILE * (2 ** zoom);
    const sin = Math.sin((clampLat(lat) * Math.PI) / 180);
    return {
      x: ((lon + 180) / 360) * world,
      y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * world,
    };
  };

  let zoom = 2;
  for (let candidate = 18; candidate >= 2; candidate -= 1) {
    const a = project(home.lat, home.lon, candidate);
    const b = project(sign.lat, sign.lon, candidate);
    if (Math.abs(a.x - b.x) <= W - fitPad * 2 && Math.abs(a.y - b.y) <= H - fitPad * 2) {
      zoom = candidate;
      break;
    }
  }

  const homeWorld = project(home.lat, home.lon, zoom);
  const signWorld = project(sign.lat, sign.lon, zoom);
  const center = { x: (homeWorld.x + signWorld.x) / 2, y: (homeWorld.y + signWorld.y) / 2 };
  const origin = { x: center.x - W / 2, y: center.y - H / 2 };
  const A = { x: homeWorld.x - origin.x, y: homeWorld.y - origin.y };
  const B = { x: signWorld.x - origin.x, y: signWorld.y - origin.y };
  const mid = { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 };
  const tileCount = 2 ** zoom;
  const tiles = [];
  const minTileX = Math.floor(origin.x / TILE);
  const maxTileX = Math.floor((origin.x + W) / TILE);
  const minTileY = Math.floor(origin.y / TILE);
  const maxTileY = Math.floor((origin.y + H) / TILE);
  for (let ty = minTileY; ty <= maxTileY; ty += 1) {
    if (ty < 0 || ty >= tileCount) continue;
    for (let tx = minTileX; tx <= maxTileX; tx += 1) {
      const wrappedX = ((tx % tileCount) + tileCount) % tileCount;
      tiles.push({
        key: `${zoom}-${tx}-${ty}`,
        src: `${API_BASE}/map-tile/${zoom}/${wrappedX}/${ty}.png`,
        left: tx * TILE - origin.x,
        top: ty * TILE - origin.y,
      });
    }
  }

  const meanLat = (home.lat + sign.lat) / 2;
  const metersPerPixel = Math.cos((meanLat * Math.PI) / 180) * 2 * Math.PI * 6378137 / (TILE * (2 ** zoom));
  const desiredMeters = metersPerPixel * 105;
  const magnitude = 10 ** Math.floor(Math.log10(desiredMeters));
  const normalized = desiredMeters / magnitude;
  const nice = normalized >= 5 ? 5 : normalized >= 2 ? 2 : 1;
  const barMeters = nice * magnitude;
  const barPx = barMeters / metersPerPixel;
  const scaleLabel = barMeters >= 1000 ? `${barMeters / 1000} km` : `${Math.round(barMeters)} m`;

  const Pin = ({ p, color, label, sub, above }) => {
    const boxY = above ? p.y - 65 : p.y + 24;
    const boxX = Math.max(108, Math.min(W - 108, p.x));
    return (
      <g>
        <path d={`M ${p.x} ${p.y - 25} C ${p.x - 13} ${p.y - 25}, ${p.x - 14} ${p.y - 7}, ${p.x} ${p.y + 4} C ${p.x + 14} ${p.y - 7}, ${p.x + 13} ${p.y - 25}, ${p.x} ${p.y - 25} Z`} fill={color} stroke="#ffffff" strokeWidth="2" />
        <circle cx={p.x} cy={p.y - 17} r="4" fill="#ffffff" />
        <g transform={`translate(${boxX}, ${boxY})`}>
          <rect x="-105" y="0" width="210" height="36" rx="4" fill="#ffffff" stroke={color} strokeWidth="1.5" />
          <text x="0" y="14" textAnchor="middle" fontFamily="Inter, sans-serif" fontSize="10.5" fontWeight="700" fill="#23313a">{label}</text>
          <text x="0" y="27" textAnchor="middle" fontFamily="monospace" fontSize="8.5" fill="#5c6a73">{sub}</text>
        </g>
      </g>
    );
  };

  return (
    <div className="geo-map" style={{ marginTop: 14, background: "#f8fafb", border: "1px solid #cdd8de", borderRadius: 10 }}>
      <div className="geo-map-frame">
        {tiles.map((tile) => (
          <img
            key={tile.key}
            className="geo-map-tile"
            src={tile.src}
            crossOrigin="anonymous"
            alt=""
            style={{
              left: `${(tile.left / W) * 100}%`, top: `${(tile.top / H) * 100}%`,
              width: `${(TILE / W) * 100}%`, height: `${(TILE / H) * 100}%`,
            }}
          />
        ))}
        <svg className="geo-map-overlay" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-label="Mapa do confronto geográfico">
          <line x1={A.x} y1={A.y - 10} x2={B.x} y2={B.y - 10} stroke="#ffffff" strokeWidth="5" strokeOpacity="0.9" />
          <line x1={A.x} y1={A.y - 10} x2={B.x} y2={B.y - 10} stroke={riskColor} strokeWidth="2.5" strokeDasharray="8 6" />
          <g transform={`translate(${mid.x}, ${mid.y - 10})`}>
            <rect x="-52" y="-13" width="104" height="26" rx="13" fill="#ffffff" stroke={riskColor} strokeWidth="1.5" />
            <text x="0" y="4" textAnchor="middle" fontFamily="monospace" fontSize="11" fontWeight="700" fill="#263640">{distanceKm.toFixed(2)} km</text>
          </g>
          <Pin p={A} color="#087ea4" label={homeLabel} sub={`${home.lat.toFixed(5)}, ${home.lon.toFixed(5)}`} above />
          <Pin p={B} color="#c48109" label={targetLabel} sub={`${sign.lat.toFixed(5)}, ${sign.lon.toFixed(5)}`} above={false} />
          <g transform={`translate(24, ${H - 24})`}>
            <rect x="-8" y="-24" width={barPx + 16} height="32" rx="3" fill="#ffffff" fillOpacity="0.9" />
            <line x1="0" y1="0" x2={barPx} y2="0" stroke="#263640" strokeWidth="3" />
            <line x1="0" y1="-5" x2="0" y2="4" stroke="#263640" strokeWidth="2" />
            <line x1={barPx} y1="-5" x2={barPx} y2="4" stroke="#263640" strokeWidth="2" />
            <text x={barPx / 2} y="-9" textAnchor="middle" fontFamily="monospace" fontSize="9" fontWeight="700" fill="#263640">{scaleLabel}</text>
          </g>
          <g transform={`translate(${W - 28}, 34)`}>
            <circle r="19" fill="#ffffff" fillOpacity="0.92" stroke="#9eabb2" />
            <path d="M0,-13 L6,7 L0,3 L-6,7 Z" fill="#263640" />
            <text x="0" y="17" textAnchor="middle" fontFamily="Inter, sans-serif" fontSize="8" fontWeight="700" fill="#263640">N</text>
          </g>
        </svg>
        <div className="geo-map-attribution">© OpenStreetMap contributors</div>
      </div>
      <div className="geo-map-caption">
        {caption}
      </div>
    </div>
  );
}

export default function LaudoForense({ report }) {
  return (
    <div className="fd-root fd-embutido">
              <div id="fd-report" data-source-filename={report.file.name} style={{ background: "var(--ink)", padding: "2px 0" }}>
              {/* Report header */}
              <div className="card report-cover" style={{ textAlign: "center", borderColor: "rgba(79,195,232,0.3)", background: "linear-gradient(180deg, rgba(79,195,232,0.06), var(--panel))" }}>
                <div className="eyebrow" style={{ fontSize: 11 }}>Laudo técnico pericial · Análise forense digital</div>
                <div className="report-cover-title" style={{ fontFamily: "var(--display)", fontWeight: 700, fontSize: 22, color: "#fff", margin: "12px 0 8px", letterSpacing: "0.02em" }}>
                  {report.extracted.contrato?.produto || "Instrumento de crédito"}
                </div>
                <div className="cover-kicker">Exame automatizado de integridade, autoria e consistência documental</div>
                <div className="cover-meta">
                  <div className="cover-meta-item">
                    <div className="cover-meta-label">Protocolo técnico</div>
                    <div className="cover-meta-value">{report.reportId}</div>
                  </div>
                  <div className="cover-meta-item">
                    <div className="cover-meta-label">Emissão</div>
                    <div className="cover-meta-value">{report.timestamp}<br />Fortaleza (BRT)</div>
                  </div>
                  <div className="cover-meta-item">
                    <div className="cover-meta-label">Arquivo examinado</div>
                    <div className="cover-meta-value">{report.file.name}<br />{report.file.sizeKB} KB</div>
                  </div>
                  <div className="cover-meta-item">
                    <div className="cover-meta-label">Impressão digital</div>
                    <div className="cover-meta-value">SHA-256<br />{report.hashes.sha256.slice(0, 18)}…</div>
                  </div>
                </div>
                <div className="cover-scope">
                  <span>Integridade criptográfica</span>
                  <span>Metadados e OCR</span>
                  <span>Cadeia de custódia</span>
                  <span>Confronto geográfico</span>
                </div>
              </div>

              {report.processingNotice && (
                <div className="card report-notice" style={{ borderColor: "rgba(61,220,151,0.32)", background: "rgba(61,220,151,0.06)" }}>
                  <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                    <span style={{ color: "var(--ok)", fontSize: 18, lineHeight: 1.2 }}>✓</span>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: "var(--ok)", marginBottom: 4 }}>Nota de processamento</div>
                      <div style={{ fontSize: 13, color: "#bfe8d6", lineHeight: 1.6 }}>{report.processingNotice}</div>
                    </div>
                  </div>
                </div>
              )}

              {/* Acréscimo do SaaS: o laudo declara o que foi conferido por pessoa. */}
              {report.camposRevisados && Object.keys(report.camposRevisados).length > 0 && (
                <Section title="Campos conferidos pelo operador">
                  <div className="note" style={{ marginTop: 0 }}>
                    Os campos abaixo foram conferidos e corrigidos por operador identificado antes da emissão. O valor anterior é o lido automaticamente do documento.
                  </div>
                  {Object.entries(report.camposRevisados).map(([caminho, campo]) => (
                    <Row
                      key={caminho}
                      label={campo.rotulo || caminho}
                      value={`${campo.valor ?? "em branco"} (lido: ${campo.anterior ?? "não identificado"}; conferido em ${campo.em ? new Date(campo.em).toLocaleString("pt-BR", { timeZone: "America/Fortaleza" }) : "data não registrada"})`}
                    />
                  ))}
                </Section>
              )}

              {report.extractionError && (
                <div className="card report-notice" style={{ borderColor: "rgba(242,176,61,0.4)", background: "rgba(242,176,61,0.06)" }}>
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
                  const calc = String(report.hashes.sha256 || "");
                  const declaredState = report.extracted.assinatura?.hash_declarado_estado || (report.extracted.assinatura?.codigo_autenticacao_declarado ? "DECLARADO_NAO_CONFERIVEL" : "AUSENTE");
                  const cls = classifyHashString(declared);
                  const comparavel = cls?.format === "SHA-256" && /^[a-fA-F0-9]{64}$/.test(calc);
                  const confere = comparavel && !!declared && cls?.format === "SHA-256" && declared.replace(/\s/g, "").toUpperCase() === calc.toUpperCase();
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
                              Calculado pelo servidor sobre o arquivo original recebido
                            </div>
                          </div>
                        </div>
                        <div className="row" style={{ marginTop: 14 }}>
                          <span className="row-label">Resultado da comparação</span>
                          <Badge
                            label={!comparavel ? "NÃO COMPARÁVEL" : confere ? "HASHES CONFEREM" : "DIVERGÊNCIA DETECTADA"}
                            color={!comparavel ? "#f2b03d" : confere ? "#3ddc97" : "#f06363"}
                          />
                        </div>
                        <div className="note" style={{ borderLeftColor: vcolor, background: confere ? "rgba(61,220,151,0.07)" : "rgba(240,99,99,0.07)" }}>
                          {!comparavel
                            ? `Comparação não realizada: o formato declarado é ${cls?.format || "não identificado"}. São necessários hashes do mesmo algoritmo e escopo; o campo calculado pelo sistema é SHA-256. Isso não determina a validade da assinatura.`
                            : confere
                            ? "O hash informado no documento confere integralmente com o hash calculado localmente sobre o arquivo. Integridade consistente entre o valor declarado e o conteúdo verificado."
                            : "O hash informado no documento diverge do hash calculado localmente sobre o arquivo. A divergência deve ser interpretada com cautela técnica: em PDFs assinados, o hash de assinatura refere-se ao conteúdo no instante da assinatura e pode não coincidir com o recálculo sobre o arquivo finalizado. Recomenda-se verificação pericial complementar antes de qualquer conclusão sobre adulteração."}
                        </div>
                      </>
                    );
                  }

                  const codigo = report.extracted.assinatura?.codigo_autenticacao_declarado;
                  return (
                    <>
                      <Row label="SHA-256 (fingerprint)" value={calc} mono />
                      {/* Protocolo não é hash: campo próprio, sem painel de confronto. */}
                      {codigo && <Row label="Código de autenticação declarado (não é hash)" value={codigo} mono />}
                      {codigo && report.extracted.assinatura?.codigo_autenticacao_origem && (
                        <Row label="Origem do código" value={report.extracted.assinatura.codigo_autenticacao_origem} />
                      )}
                      <div className="note">
                        {noteForDeclaredHashState(declaredState, calc, report.extracted.assinatura)}
                      </div>
                    </>
                  );
                })()}

                <Row label="SHA-1 (arquivo)" value={report.hashes.sha1} mono />
              </Section>

              {/* §1.1 Metadados internos */}
              {report.metadata && (
                <Section title="§ 1.1 · Verificação dos metadados internos do PDF">
                  {(() => {
                    const warnings = report.metadata.warnings || [];
                    const onlyTraceabilityNotes = warnings.length > 0 && warnings.every((warning) =>
                      /Título interno|Autor interno|Assunto|Data de criação interna|não contém assinatura digital incorporada detectável/i.test(warning)
                    );
                    return (
                      <div className="row">
                        <span className="row-label">Resultado da verificação</span>
                        <Badge
                          label={!warnings.length ? "SEM ALERTAS" : onlyTraceabilityNotes ? `${warnings.length} NOTA(S)` : `${warnings.length} ALERTA(S)`}
                          color={!warnings.length ? "#3ddc97" : onlyTraceabilityNotes ? "#8595a8" : "#f2b03d"}
                        />
                      </div>
                    );
                  })()}
                  {[
                    ["Versão do formato PDF", report.metadata.version],
                    ["Número de páginas", report.metadata.totalPages],
                    ["Formato das páginas", report.metadata.pageFormats?.join(" · ")],
                    ["Título interno", report.metadata.title],
                    ["Autor declarado", report.metadata.author],
                    ["Assunto", report.metadata.subject],
                    ["Palavras-chave", report.metadata.keywords],
                    ["Aplicativo criador", report.metadata.creator],
                    ["Produtor / conversor", report.metadata.producer],
                    ["Data de criação interna", report.metadata.creationDate],
                    ["Data de modificação interna", report.metadata.modificationDate],
                    ["Idioma declarado", report.metadata.language],
                    ["Arquivo criptografado", report.metadata.encrypted ? "Sim" : "Não"],
                    ["PDF linearizado", report.metadata.linearized ? "Sim" : "Não"],
                    ["Procedência do arquivo", labelProvenance(report.metadata.digitalSignature?.procedencia?.procedencia, report.metadata.digitalSignature?.procedencia)],
                    ["Data da juntada nos autos", report.metadata.digitalSignature?.procedencia?.data_juntada],
                    ["Movimento processual", report.metadata.digitalSignature?.procedencia?.movimento ? [report.metadata.digitalSignature.procedencia.movimento, report.metadata.digitalSignature.procedencia.descricao_movimento].filter(Boolean).join(" · ") : null],
                    ["Juntado por (assinatura digital)", report.metadata.digitalSignature?.procedencia?.juntado_por],
                    ["Indícios de procedência", report.metadata.digitalSignature?.procedencia?.indicios?.join(" · ")],
                    ["Formulário AcroForm", report.metadata.hasAcroForm ? "Presente" : "Ausente"],
                    ["AcroForm xref", report.metadata.digitalSignature?.catalog?.acroformXref],
                    ["SigFlags", report.metadata.digitalSignature?.catalog?.sigFlags],
                    ["Atualizações incrementais", report.metadata.digitalSignature?.catalog?.incrementalUpdates],
                    ["Formulário XFA", report.metadata.hasXfa ? "Presente" : "Ausente"],
                    ["Assinatura digital incorporada", report.metadata.cryptographicSignatureStatus || (report.metadata.hasEmbeddedSignatures ? "Detectada" : "Não detectada")],
                  ].map(([label, value]) => <Row key={label} label={label} value={value} />)}
                  <Row label="Identificador interno do trailer" value={report.metadata.trailerFingerprint} mono />

                  {report.metadata.warnings?.length > 0 && (
                    <>
                      <div className="sub-head">Achados da auditoria de metadados</div>
                      {report.metadata.warnings.map((warning, index) => (
                        <div key={index} className="flag" style={{ color: "#d9c79a", borderBottomColor: "rgba(242,176,61,0.18)" }}>
                          <b style={{ color: "var(--warn)" }}>▸</b><span>{formatMetadataWarning(warning)}</span>
                        </div>
                      ))}
                    </>
                  )}
                  <div className="note">
                    Metadados são campos declarativos e podem ser alterados por editores de PDF. Eles servem como indício técnico e devem ser avaliados em conjunto com os hashes do arquivo, a assinatura digital incorporada e a cadeia de custódia.
                  </div>
                </Section>
              )}

              {/* §2 */}
              <Section title="§ 2 · Dados do instrumento contratual">
                {/* O objeto do laudo é a cadeia de custódia. Valor, taxa, CET e
                    prazo da operação não entram: o leitor precisa saber que a
                    ausência é deliberada, e não falha de extração. */}
                <div className="note">
                  Este laudo verifica e valida a cadeia de custódia do documento. As condições econômicas da
                  operação (valores, tarifas, tributos, taxas, Custo Efetivo Total e prazos) não integram o exame
                  e não foram aferidas aqui.
                </div>
                {[
                  ["Número do contrato", report.extracted.contrato?.numero],
                  ["Banco / instituição financeira", report.extracted.contrato?.banco],
                  ["CNPJ da instituição", formatCnpj(report.extracted.contrato?.cnpj_instituicao)],
                  ["Código BACEN", report.extracted.contrato?.codigo_banco_bacen],
                  ["Produto", report.extracted.contrato?.produto],
                  ["Modalidade", labelModalidade(report.extracted.contrato?.modalidade)],
                  ["Tipo de operação", report.extracted.contrato?.tipo_operacao],
                  ["Operação portada", report.extracted.contrato?.operacao_portada === true ? "Sim" : report.extracted.contrato?.operacao_portada === false ? "Não" : null],
                  ["Empregador declarado", report.extracted.contrato?.empregador ? `${report.extracted.contrato.empregador.literal}${report.extracted.contrato.empregador.identificado ? "" : " (sem razão social e sem CNPJ)"}` : null],
                  ["Credor original / cedente", report.extracted.contrato?.credor_original],
                  ["Agência", report.extracted.contrato?.agencia],
                  ["Conta-corrente", report.extracted.contrato?.conta_corrente],
                  ["Nome da agência", report.extracted.contrato?.nome_agencia],
                  ["Banco de recebimento", report.extracted.contrato?.banco_recebimento],
                  ["Modalidade de desconto provável", report.extracted.contrato?.modalidade_desconto_provavel],
                  ["Data do contrato", report.extracted.contrato?.data_contrato ? `${report.extracted.contrato.data_contrato}${report.extracted.contrato.data_contrato_origem ? ` (${report.extracted.contrato.data_contrato_origem}${report.extracted.contrato.data_contrato_confianca === "BAIXA" ? ", confiança baixa" : ""})` : ""}` : null],
                  ["Primeiro vencimento", report.extracted.contrato?.data_primeiro_vencimento],
                  ["Último vencimento", report.extracted.contrato?.data_ultimo_vencimento],
                ].map(([lbl, val]) => <Row key={lbl} label={lbl} value={val} />)}
                {/* A nota das datas é cronologia do instrumento, não preço. */}
                {report.extracted.contrato?.datas_nota && <div className="note">{report.extracted.contrato.datas_nota}</div>}
              </Section>

              {/* § 2.1 · aferição matemática do instrumento: fora do laudo.
                  Somatório, composição do financiado, valor presente, taxa
                  implícita e CET são exame econômico, não cadeia de custódia. */}

              {/* § 2.1 Liberação do crédito */}
              {report.extracted.liberacao_credito?.declarada && (
                <Section title="§ 2.1 · Liberação do crédito e comprovante" danger={!report.extracted.liberacao_credito.comprovante}>
                  {(() => {
                    const l = report.extracted.liberacao_credito;
                    return (
                      <>
                        <Row label="Forma de liberação declarada" value={l.declarada.forma} />
                        <Row label="Banco / agência / conta de crédito" value={[l.declarada.banco && `Banco ${l.declarada.banco}`, l.declarada.agencia && `agência ${l.declarada.agencia}`, l.declarada.conta && `conta ${l.declarada.conta}`].filter(Boolean).join(" · ")} />
                        <div className="row">
                          <span className="row-label">Comprovante de transferência no arquivo</span>
                          <Badge label={l.comprovante ? "LOCALIZADO" : "AUSENTE"} color={l.comprovante ? "#3ddc97" : "#f06363"} />
                        </div>
                        {l.comprovante && (
                          <Row label="Comprovante localizado" value={[l.comprovante.pagina && `pág. ${l.comprovante.pagina}`, l.comprovante.data].filter(Boolean).join(" · ")} />
                        )}
                      </>
                    );
                  })()}
                </Section>
              )}

              {/* § 2.2 Seguro prestamista */}
              {report.extracted.seguro_prestamista && (
                <Section title="§ 2.2 · Seguro prestamista vinculado à operação" danger={(report.extracted.seguro_prestamista.achados || []).some((a) => a.gravidade === "ALTA")}>
                  {(() => {
                    const sg = report.extracted.seguro_prestamista;
                    return (
                      <>
                        {[
                          ["Proposta", sg.proposta ? `nº ${sg.proposta}${sg.documento ? ` (págs. ${sg.documento.paginaInicial} a ${sg.documento.paginaFinal})` : ""}` : null],
                          ["Periodicidade / forma de pagamento", [sg.periodicidade, sg.forma_pagamento].filter(Boolean).join(" · ")],
                          ["Seguradora", sg.seguradora ? `${sg.seguradora.nome}${sg.seguradora.cnpj ? `, CNPJ ${sg.seguradora.cnpj}` : ""}` : null],
                          ["Corretora", sg.corretora ? `${sg.corretora.nome}, CNPJ ${sg.corretora.cnpj}, SUSEP ${sg.corretora.susep}` : null],
                          ["Estipulante", sg.estipulante ? `${sg.estipulante.nome}, CNPJ ${sg.estipulante.cnpj}` : null],
                          ["Beneficiário", sg.beneficiario],
                        ].map(([lbl, val]) => <Row key={lbl} label={lbl} value={val} />)}
                        {sg.coberturas?.length > 0 && (
                          <>
                            <div className="sub-head">Coberturas</div>
                            <div className="audit-table-wrap">
                              <table className="audit-table">
                                <thead><tr><th>Cobertura</th><th>Carência</th><th>Franquia</th><th>Teto</th></tr></thead>
                                <tbody>
                                  {sg.coberturas.map((c) => (
                                    <tr key={c.nome}>
                                      <td>{c.nome}</td>
                                      <td>{c.carencia_dias ? `${c.carencia_dias} dias` : "não há"}</td>
                                      <td>{c.franquia_dias ? `${c.franquia_dias} dias` : "não há"}</td>
                                      <td>{c.teto_parcelas ? `${c.teto_parcelas} parcelas` : "-"}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </>
                        )}
                      </>
                    );
                  })()}
                </Section>
              )}

              {/* §3 */}
              <Section title="§ 3 · Qualificação do contratante">
                {(() => {
                  const c = report.extracted.cliente || {};
                  const origem = c.origens || {};
                  const val = (campo, valor) => origem[campo]?.startsWith("INFERIDO") && valor ? `${valor} (inferido)` : valor;
                  // Vazio no documento e suspeito são achados sobre o instrumento,
                  // e não podem aparecer como "Não identificado".
                  const estados = c.estados_campos || {};
                  const comEstado = (campo, valor) => {
                    const e = estados[campo];
                    if (e?.estado === "LOCALIZADO_SUSPEITO") return `${valor || e.valor} (suspeito: ${e.motivo})`;
                    if (e?.estado === "LOCALIZADO_VAZIO") return e.valor ? `Localizado e vazio no instrumento: "${e.valor}"` : "Localizado e vazio no instrumento";
                    return valor;
                  };
                  return [
                  ["Nome completo", report.extracted.cliente?.nome],
                  ["CPF", formatCpf(report.extracted.cliente?.cpf)],
                  ["RG", comEstado("rg", report.extracted.cliente?.rg)],
                  ["Data de nascimento", report.extracted.cliente?.data_nascimento],
                  ["Endereço (extraído do contrato)", comEstado("endereco", report.extracted.cliente?.endereco)],
                  ["Bairro", report.extracted.cliente?.bairro],
                  ["Cidade", val("cidade", report.extracted.cliente?.cidade)],
                  ["Estado", val("estado", report.extracted.cliente?.estado)],
                  ["CEP", report.extracted.cliente?.cep],
                  ["Telefone", report.extracted.cliente?.telefone],
                  ["E-mail", comEstado("email", report.extracted.cliente?.email)],
                  ["Ocupação", estados.ocupacao?.estado === "LOCALIZADO_VAZIO" ? comEstado("ocupacao", null) : null],
                  /* D7: campos de benefício previdenciário não se imprimem em
                     modalidade que não os comporta (ex.: consignado CLT). */
                  ...(fichaBeneficioSeAplica(report.extracted.contrato?.produto_codigo) ? [
                    ["Matrícula INSS", report.extracted.cliente?.matricula_inss],
                    ["Número do benefício", report.extracted.cliente?.numero_beneficio],
                    ["Espécie do benefício", report.extracted.cliente?.especie_beneficio],
                  ] : []),

                  ["Banco de recebimento", report.extracted.cliente?.banco_recepcao],
                  ].map(([lbl, value]) => <Row key={lbl} label={lbl} value={value} />);
                })()}
                {report.extracted.cliente?.origens && (
                  <div className="note">
                    Município, UF, bairro e CEP são exibidos com controle de origem. Campos inferidos não substituem a qualificação completa no instrumento original.
                  </div>
                )}

                {/* Verificação de endereços, dois a dois: cada linha diz o que compara. */}
                {report.confrontoEnderecos?.pares?.length > 0 && (
                  <>
                    <div className="sub-head">Verificação de endereços (confrontos dois a dois)</div>
                    {report.confrontoEnderecos.pares.map((par) => (
                      <div key={par.id}>
                        <Row label={par.rotulo} value={par.texto || (par.indisponivel?.length ? "não aferido" : null)} />
                        {par.memoria_calculo && <div className="note">{par.memoria_calculo}</div>}
                      </div>
                    ))}
                    {report.confrontoEnderecos.pontos?.instrumento?.precisao === "municipio" && (
                      <div className="note">
                        O endereço do instrumento foi resolvido em nível de município ({report.confrontoEnderecos.pontos.instrumento.rotulo}), porque a instituição não registrou o endereço do contratante. As distâncias que partem dele são aproximadas.
                      </div>
                    )}
                  </>
                )}

                <div className="sub-head">Endereço de referência (ponto de origem das distâncias)</div>
                {report.home.alerta && (
                  <div className="note" style={{ borderLeftColor: "var(--crit)", background: "rgba(240,99,99,0.07)" }}>
                    {report.home.alerta}
                  </div>
                )}
                {/* MED-01: recusado o confronto, o alerta acima é o único motivo e o
                    endereço aparece como não utilizado, sem nota de geocodificação. */}
                {referenciaRecusada(report.home) ? (
                  (report.home.conflito?.manual?.texto || report.home.query) && (
                    <Row label="Endereço informado, não utilizado" value={report.home.conflito?.manual?.texto || report.home.query} />
                  )
                ) : (
                  <>
                    <Row label="Endereço adotado" value={report.home.query} nullText="Nenhum endereço informado ou extraído" />
                    <Row label="Origem do endereço" value={report.home.source} />
                    {(report.home.estado_confronto === "DIVERGENCIA_CADASTRAL" || report.home.conflito) && report.home.instrumento && (
                      <>
                        <Row
                          label="Endereço extraído do contrato"
                          value={[report.home.instrumento.cidade, report.home.instrumento.uf, report.home.instrumento.cep].filter(Boolean).join(", ") || "município do contrato"}
                        />
                        {report.home.distancia_divergencia_cadastral != null && (
                          <Row
                            label="Divergência entre os endereços"
                            value={`${report.home.distancia_divergencia_cadastral.toFixed(1).replace(".", ",")} km`}
                          />
                        )}
                      </>
                    )}
                  </>
                )}
                {referenciaRecusada(report.home) ? null : report.home.geo && (report.ipAnalysis.length > 0 || report.contractGeo) ? (
                  <Row
                    label={report.home.geo.precision === "manual" ? "Coordenadas (residencial · confirmadas pelo operador)" : "Coordenadas (residencial · aprox.)"}
                    value={`${report.home.geo.lat.toFixed(6)}, ${report.home.geo.lon.toFixed(6)}`}
                    mono
                  />
                ) : report.home.geo ? (
                  <div className="note" style={{ borderLeftColor: "var(--muted)", background: "rgba(133,149,168,0.07)" }}>
                    Coordenadas residenciais suprimidas porque o documento não contém GPS declarado nem endereço IP a confrontar.
                  </div>
                ) : report.home.warning ? (
                  <div className="note" style={{ borderLeftColor: "var(--warn)", background: "rgba(242,176,61,0.07)" }}>
                    {report.home.warning}
                  </div>
                ) : report.home.query ? (
                  <div className="note" style={{ borderLeftColor: "var(--warn)", background: "rgba(242,176,61,0.07)" }}>
                    Não foi possível geocodificar o endereço residencial informado. As distâncias até este ponto não puderam ser calculadas. Verifique a grafia do endereço e tente novamente, de preferência com cidade e UF.
                  </div>
                ) : null}
              </Section>

              {/* §4 */}
              <Section title="§ 4 · Assinatura eletrônica e cadeia de custódia">
                <div className="row">
                  <span className="row-label">Menção de assinatura eletrônica/digital no documento</span>
                  <Badge label={report.extracted.assinatura?.presente ? "LOCALIZADA" : "NÃO LOCALIZADA"} color={report.extracted.assinatura?.presente ? "#f2b03d" : "#f06363"} />
                </div>

                <div className="note">
                  Esta seção separa assinatura eletrônica/digital, menção textual no corpo do documento, forma de aceite registrada e assinatura criptográfica incorporada ao PDF. O laudo descreve evidências e ausências técnicas; a consequência jurídica depende de valoração no caso concreto.
                </div>

                {(() => {
                  const a = report.extracted.assinatura || {};
                  const cryptoSig = a.assinatura_criptografica || {};
                  const cryptoState = cryptoSig.estado || (report.metadata?.hasEmbeddedSignatures ? "PRESENTE" : "AUSENTE");
                  const cryptoColor = cryptoState === "PRESENTE" ? "#3ddc97" : "#f06363";
                  return (
                    <>
                      <div className="row">
                        <span className="row-label">Assinatura criptográfica incorporada ao PDF</span>
                        <Badge label={cryptoState} color={cryptoColor} />
                      </div>
                      {[
                        ["Motivo da verificação criptográfica", cryptoSig.motivo],
                        ["Quantidade de assinaturas/campos assinados", cryptoSig.quantidade],
                        ["Forma de aceite registrada", a.forma_aceite],
                        ["Telefone/celular do aceite", a.telefone_aceite],
                        ["Menção textual de assinatura", a.mencao_textual ? `${a.mencao_textual}${a.mencao_textual_documento ? ` (${a.mencao_textual_documento})` : ""}` : null],
                        ["Blocos de assinatura por documento", a.blocos_por_documento],
                        ["Blocos de assinatura em documentos negociais", Number.isFinite(a.blocos_assinatura_total) ? String(a.blocos_assinatura_total) : null],
                        ["Assinatura textual/manual no corpo", a.assinatura_manual_textual],
                        ["Código de autenticação declarado", a.codigo_autenticacao_declarado],
                        ["Origem do código de autenticação", a.codigo_autenticacao_origem],
                        ["Estado do código de autenticação", a.codigo_autenticacao_declarado ? labelHashState(a.codigo_autenticacao_estado || "DECLARADO_NAO_CONFERIVEL") : null],
                        ["Estado do hash declarado", labelHashState(a.hash_declarado_estado)],
                        ["Plataforma informada", a.plataforma],
                        ["Tipo declarado/extraído", a.tipo],
                        ["Titular indicado", a.titular_certificado],
                        ["CPF indicado", formatCpf(a.cpf_titular)],
                        ["Data / hora indicada", a.data_hora_assinatura],
                        ["Autoridade certificadora", a.certificadora_ac],
                        ["Nº de série do certificado", a.numero_serie_certificado],
                        ["Validade do certificado · início", a.validade_certificado_inicio],
                        ["Validade do certificado · fim", a.validade_certificado_fim],
                        ["Algoritmo de hash", a.algoritmo_hash],
                      ].map(([lbl, val]) => <Row key={lbl} label={lbl} value={val} />)}
                      {cryptoSig.catalogo?.fields?.length > 0 && (
                        <>
                          <div className="sub-head">Campos de assinatura no catálogo do PDF</div>
                          {cryptoSig.catalogo.fields.map((field, index) => (
                            <div className="ip-block" key={`${field.nome}-${field.xref}-${index}`}>
                              <Row label="Campo" value={field.nome} />
                              <Row label="xref" value={field.xref} />
                              <Row label="Retângulo" value={field.rect} mono />
                              <Row label="Visibilidade" value={field.invisivel ? "Invisível (/Rect [0 0 0 0])" : "Visível"} />
                              <Row label="Assinado" value={field.assinado ? "Sim" : "Não"} />
                              <Row label="Dicionário de assinatura" value={field.dicionario_sig} />
                              <Row label="Data declarada" value={field.data_declarada} />
                              <Row label="Subfiltro" value={field.subfilter} />
                            </div>
                          ))}
                        </>
                      )}
                      {cryptoSig.validacao?.assinaturas?.length > 0 && (
                        <>
                          <div className="sub-head">Validação criptográfica pelo pdfsig</div>
                          {cryptoSig.validacao.assinaturas.map((sig) => (
                            <div className="ip-block" key={`${sig.numero}-${sig.campo}`}>
                              <div className="ip-head">
                                <div className="ip-id">#{sig.numero} · {sig.campo}</div>
                                <Badge label={sig.validacao_assinatura || "NÃO AFERÍVEL"} color={/valid/i.test(sig.validacao_assinatura || "") && !/mismatch/i.test(sig.validacao_assinatura || "") ? "#3ddc97" : "#f06363"} />
                              </div>
                              <Row label="Data da assinatura" value={sig.data_assinatura} />
                              <Row label="Signatário CN" value={sig.signatario_cn} />
                              <Row label="DN completo" value={sig.signatario_dn} />
                              <Row label="Algoritmo de resumo" value={sig.algoritmo_resumo} />
                              <Row label="Tipo/subfiltro" value={sig.subfilter} />
                              <Row label="Bytes cobertos" value={sig.bytesCobertos} />
                              <Row label="Cobertura" value={sig.coberturaPercentual != null ? `${sig.coberturaPercentual}%` : null} />
                              <Row label="Documento integral assinado" value={sig.notTotalDocumentSigned ? "Não" : "Sim"} />
                              <Row label="Validação do certificado" value={sig.validacao_certificado} />
                            </div>
                          ))}
                        </>
                      )}
                      {cryptoSig.alertas?.length > 0 && (
                        <>
                          <div className="sub-head">Alertas da assinatura digital</div>
                          {cryptoSig.alertas.map((alert, index) => (
                            <div key={`${alert.codigo}-${index}`} className="flag" style={{ color: alert.severidade === "CRÍTICO" ? "#f2b3b3" : "#d9c79a", borderBottomColor: "rgba(242,176,61,0.18)" }}>
                              <b style={{ color: alert.severidade === "CRÍTICO" ? "var(--crit)" : "var(--warn)" }}>▸</b>
                              <span><b>{alert.codigo} · {alert.severidade} · {alert.titulo}.</b> {alert.detalhe}</span>
                            </div>
                          ))}
                        </>
                      )}
                    </>
                  );
                })()}

                {report.extracted.assinatura?.metodos_autenticacao?.length > 0 && (
                  <Row label="Métodos de autenticação registrados" value={report.extracted.assinatura.metodos_autenticacao.join(" · ")} />
                )}
                {report.extracted.assinatura?.metodos_descritos_no_fluxo?.length > 0 ? (
                  <>
                    <Row
                      label="Métodos descritos no instrumento como etapa do fluxo"
                      value={report.extracted.assinatura.metodos_descritos_no_fluxo.map((m) => m.rotulo).join(" · ")}
                    />
                    {report.extracted.assinatura.metodos_descritos_no_fluxo.map((m) => (
                      <Row
                        key={m.codigo}
                        label={`Trecho que sustenta · ${m.codigo}${m.pagina ? ` · pág. ${m.pagina}` : ""}`}
                        value={`"${m.trecho}"`}
                      />
                    ))}
                  </>
                ) : report.extracted.assinatura?.metodos_descritos_estado ? (
                  <Row label="Métodos descritos no instrumento como etapa do fluxo" value="não localizado no material examinado" />
                ) : null}
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

                <div className="sub-head">Checklist de referências documentais</div>
                {report.cadeiaCustodia ? <>
                  <Row label="Referências localizadas" value={`${report.cadeiaCustodia.presentes}/${report.cadeiaCustodia.total}`} />
                  <div className="note">Presença documental não valida autoria, integridade ou completude dos registros originais.</div>
                  {(report.cadeiaCustodia.elementos || []).map(e => <Row key={e.chave} label={e.nome} value={e.presente ? "REFERÊNCIA LOCALIZADA" : "NÃO LOCALIZADA"} />)}
                </> : <div className="note">Checklist consolidado indisponível nesta análise. Reprocesse o documento para obter a contagem atual; não é possível inferir validade desta ausência.</div>}

              </Section>

              {/* §4.1 Auditoria detalhada do trilho */}
              {report.extracted.trilha_acesso?.eventCount > 0 && (() => {
                const audit = report.extracted.trilha_acesso;
                const primaryIp = report.ipAnalysis.find((item) => item.endereco === audit.uniqueIps?.[0]) || report.ipAnalysis[0];
                const gpsIpDistance = report.contractGeo && primaryIp?.geo?.lat != null && primaryIp?.geo?.lon != null
                  ? haversineKm(report.contractGeo.lat, report.contractGeo.lon, primaryIp.geo.lat, primaryIp.geo.lon)
                  : null;
                const geoConvergent = gpsIpDistance !== null && gpsIpDistance < 50;
                return (
                  <Section title="§ 4.1 · Auditoria da assinatura e do trilho de acesso">
                    <div className="note" style={{ marginTop: 0 }}>
                      Quadro técnico consolidado a partir do Histórico de Ações do documento. IP, portas, horários, coordenadas e dispositivo são transcritos por OCR e devem ser confrontados com os logs brutos da plataforma antes do uso como prova técnica definitiva.
                    </div>

                    <div className="audit-metrics">
                      {[
                        ["Eventos detectados", audit.eventCount],
                        ["IPs únicos", audit.uniqueIps?.length || 0],
                        ["Portas de origem", audit.ports?.length || 0],
                        ["Pontos GPS legíveis", `${audit.coordinateCount || 0}/${audit.eventCount}`],
                      ].map(([label, value]) => (
                        <div className="audit-metric" key={label}>
                          <div className="audit-metric-label">{label}</div>
                          <div className="audit-metric-value">{value}</div>
                        </div>
                      ))}
                    </div>

                    <div className="audit-layout">
                      <div>
                        <div className="sub-head" style={{ marginTop: 0 }}>Linha do tempo · fuso {audit.eventTimezone || "não identificado"}</div>
                        <AuditTimeline events={audit.events} />
                      </div>
                      <DispersionPlot audit={audit} />
                    </div>

                    <div className="sub-head">Histórico de ações completo</div>
                    <div className="audit-table-wrap">
                      <table className="audit-table">
                        <colgroup>
                          <col style={{ width: "4%" }} /><col style={{ width: "18%" }} /><col style={{ width: "9%" }} />
                          <col style={{ width: "20%" }} /><col style={{ width: "14%" }} /><col style={{ width: "14%" }} /><col style={{ width: "21%" }} />
                        </colgroup>
                        <thead><tr><th>#</th><th>Ação</th><th>Hora</th><th>IP : porta</th><th>Latitude</th><th>Longitude</th><th>Dispositivo</th></tr></thead>
                        <tbody>
                          {audit.events.map((event, index) => (
                            <tr key={`${event.action}-${index}`} className={/Selfie|Finalizado/.test(event.action) ? "audit-key-row" : ""}>
                              <td>{index + 1}</td><td>{event.action}</td><td className="mono-cell">{event.time || "-"}</td>
                              <td className="mono-cell">{event.ip || "-"}{event.port ? `:${event.port}` : ""}</td>
                              <td className="mono-cell">{Number.isFinite(event.lat) ? event.lat.toFixed(6) : "-"}</td>
                              <td className="mono-cell">{Number.isFinite(event.lon) ? event.lon.toFixed(6) : "-"}</td>
                              <td>{event.device || "Não identificado"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <div className="sub-head">Leitura forense</div>
                    <div className="audit-readings">
                      {audit.chronologyInconsistent ? (
                        <AuditFinding kind="warn" tag="Inconsistência" title="Carimbos de tempo não conciliados">
                          O campo do assinante está rotulado como UTC ({audit.signatureTimestampUtc}). Convertido para o fuso -03:00, corresponde a {audit.signatureLocalTime}, antes do primeiro evento às {audit.firstTime}. Se interpretado como horário local, fica após o último evento às {audit.lastTime}. A plataforma deve apresentar os logs brutos e o fuso efetivamente aplicado.
                        </AuditFinding>
                      ) : (
                        <AuditFinding tag="A conferir" title="Cronologia sem inconsistência automática conclusiva">
                          Os horários extraídos não permitiram confirmar, de forma automática, uma contradição temporal. Recomenda-se confrontar o rótulo de fuso e os logs brutos da plataforma.
                        </AuditFinding>
                      )}
                      {!audit.deviceIdentifiable && (
                        <AuditFinding kind="warn" tag="Lacuna" title="Dispositivo sem vínculo inequívoco com hardware">
                          O trilho informa {audit.device || "sistema operacional e navegador"}, mas não apresenta fabricante, modelo ou IMEI legíveis. Esses dados identificam o ambiente de acesso, não um aparelho físico atribuído ao consumidor.
                        </AuditFinding>
                      )}
                      <AuditFinding tag="A diligenciar" title="IP público e rastreável">
                        O fluxo utiliza {audit.uniqueIps?.length === 1 ? `um único IP (${audit.uniqueIps[0]})` : `${audit.uniqueIps?.length || 0} IPs`}, com {audit.ports?.length || 0} porta(s) de origem. {primaryIp?.geo ? `A base de geolocalização aponta ${primaryIp.geo.city || "cidade não informada"}/${primaryIp.geo.region || "região não informada"}, provedor ${semPontoFinal(primaryIp.geo.isp) || "não identificado"}.` : "A localização externa do IP não estava disponível."} A identificação do assinante da conexão na data e hora depende de ordem judicial e informação da operadora.
                      </AuditFinding>
                      {audit.coordinateCount > 1 && (
                        <AuditFinding kind="ok" tag="Ponto de atenção" title="Coordenadas do trilho formam agrupamento concentrado">
                          Os pontos GPS legíveis apresentam amplitude aproximada de {audit.northSouthMeters?.toFixed(1)} m no eixo norte-sul e {audit.eastWestMeters?.toFixed(1)} m no eixo leste-oeste. {gpsIpDistance !== null ? `A distância entre o GPS da assinatura e a localização aproximada do IP é ${gpsIpDistance.toFixed(2)} km, classificada como ${geoConvergent ? "geograficamente convergente" : "geograficamente divergente"}.` : "Não foi possível confrontar o agrupamento com a localização do IP."} A concentração favorece coerência espacial, mas não comprova, isoladamente, autoria.
                        </AuditFinding>
                      )}
                    </div>

                    <div className="sub-head">Diligências sugeridas</div>
                    <div className="diligence-list">
                      <div className="diligence-item"><span>Requisitar à operadora a identificação do assinante da conexão vinculada ao IP e ao intervalo temporal registrado, mediante autorização judicial.</span></div>
                      <div className="diligence-item"><span>Exigir os logs brutos da plataforma de assinatura, com carimbos em formato técnico, fuso, identificador de sessão e política de retenção.</span></div>
                      <div className="diligence-item"><span>Solicitar fabricante, modelo, identificador do aparelho e método técnico de vinculação da selfie ao dispositivo utilizado, quando esses elementos forem declarados pela plataforma.</span></div>
                      <div className="diligence-item"><span>Confrontar o titular da conta que recebeu o crédito com o contratante e com os demais elementos de autenticação.</span></div>
                    </div>
                  </Section>
                );
              })()}

              {/* §4.2 Imagens, selfie e prova de vida */}
              {report.extracted.imagens_pdf && (() => {
                const img = report.extracted.imagens_pdf;
                const critical = (img.achados || []).some((finding) => /CR[IÍ]TICO|ALTO/i.test(finding.severidade || ""));
                // Antes cortava em 12 imagens fixas — num documento com 13
                // imagens (ex.: RG fotografado em duas fotos), a 13ª ficava
                // de fora da tabela sem nenhum aviso claro do porquê. O
                // teto agora só existe para preservar legibilidade em
                // documentos com dezenas de imagens, não para esconder a
                // penúltima/última de um inventário pequeno.
                // Corpo do laudo: só fotografia, biometria e documento. Logotipos,
                // fios e máscaras alfa ocupavam oito páginas do laudo do dossiê C6
                // com a mesma observação repetida; o detalhe vai para o Anexo II.
                const relevante = (item) => item.biometricaProvavel || item.classificacao === "imagem documental";
                const listed = (img.imagens || []).filter(relevante);
                const templates = (img.imagens || []).filter((item) => !relevante(item));
                const templatesPorClasse = templates.reduce((acc, item) => ({ ...acc, [item.classificacao || "outra"]: (acc[item.classificacao || "outra"] || 0) + 1 }), {});
                const gruposRelevantes = (img.grupos_repetidos || []).filter((group) => (group.imagens || []).some(relevante));
                const captures = (img.imagens || []).filter((item) => item.biometricaProvavel);
                // MED-03: análises gravadas antes da correção ainda trazem o IMG2 de template.
                const achadosImagem = (img.achados || []).filter((f) => !(f.codigo === "IMG2" && f.titulo === "Reuso de imagem de template"));
                return (
                  <Section title="§ 4.2 · Imagens, selfie e prova de vida" danger={critical}>
                    <div className="note" style={{ marginTop: 0 }}>
                      Auditoria automática com Poppler/pdfimages. O objetivo é verificar se o PDF contém fotos/selfies extraíveis, qual a resolução real dessas imagens e se alguma prova visual foi reutilizada byte a byte dentro do mesmo documento.
                    </div>
                    <div className="audit-metrics">
                      {[
                        ["Imagens listadas", img.total ?? 0],
                        ["Arquivos extraídos", img.extraidas ?? 0],
                        ["Hashes repetidos", img.grupos_repetidos?.length || 0],
                        ["Ferramenta", img.disponivel ? "pdfimages" : "indisponível"],
                      ].map(([label, value]) => (
                        <div className="audit-metric" key={label}>
                          <div className="audit-metric-label">{label}</div>
                          <div className="audit-metric-value">{value}</div>
                        </div>
                      ))}
                    </div>

                    {report.extracted.imagem_biometrica && (() => {
                      const b = report.extracted.imagem_biometrica;
                      return (
                        <div className="ip-block" style={{ border: "1px solid rgba(240,99,99,0.35)", background: "rgba(240,99,99,0.06)" }}>
                          <div className="ip-head">
                            <div className="ip-id" style={{ color: "#f06363" }}>Artefato biométrico · pág. {b.pagina}</div>
                            <Badge label={b.exif === false ? "SEM EXIF" : b.exif ? "COM EXIF" : "EXIF N/D"} color={b.exif ? "#3ddc97" : "#f06363"} />
                          </div>
                          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-start" }}>
                            {b.miniatura && (
                              <img src={b.miniatura} alt="Fotografia biométrica extraída do arquivo" style={{ width: 120, height: "auto", borderRadius: 6, border: "1px solid #52616c" }} />
                            )}
                            <div style={{ flex: 1, minWidth: 220 }}>
                              {[
                                ["Dimensões", `${b.largura} x ${b.altura} pixels (${String(b.megapixels).replace(".", ",")} megapixel)`],
                                ["Formato e tamanho", [b.formato, b.bytes ? `${b.bytes.toLocaleString("pt-BR")} bytes` : null].filter(Boolean).join(" · ")],
                                ["SHA-256 da imagem", b.sha256 ? shortHash(b.sha256, 18, 10) : null],
                                ["Imagens faciais no arquivo", b.contagem_faciais],
                                ["Não apresentado pelo dossiê", b.dados_do_processo_ausentes?.join(", ")],
                              ].map(([lbl, val]) => <Row key={lbl} label={lbl} value={val} mono={lbl === "SHA-256 da imagem"} />)}
                            </div>
                          </div>
                          {b.achado && <div className="note" style={{ borderLeftColor: "var(--crit)" }}>{b.achado.texto}</div>}
                        </div>
                      );
                    })()}

                    {achadosImagem.length > 0 && (
                      <>
                        <div className="sub-head">Achados de imagem</div>
                        {achadosImagem.map((finding, index) => (
                          <div key={`${finding.codigo}-${index}`} className="ip-block" style={{ border: `1px solid ${severityColor(finding.severidade)}55`, background: `${severityColor(finding.severidade)}12` }}>
                            <div className="ip-head">
                              <div className="ip-id" style={{ color: severityColor(finding.severidade) }}>{finding.codigo} · {finding.titulo}</div>
                              <Badge label={finding.severidade || "ATENÇÃO"} color={severityColor(finding.severidade)} />
                            </div>
                            <div className="ip-ctx">{finding.detalhe}</div>
                          </div>
                        ))}
                      </>
                    )}

                    {templates.length > 0 && (
                      <div className="note">
                        {(() => {
                          const repetidos = (img.grupos_repetidos?.length || 0) - gruposRelevantes.length;
                          const classes = Object.entries(templatesPorClasse).map(([classe, n]) => `${n} ${classe}`).join("; ");
                          return `${templates.length === 1 ? "1 imagem de template, sem relevância" : `${templates.length} imagens de template, sem relevância`} para a perícia (${classes})${repetidos ? `, em ${repetidos === 1 ? "1 grupo repetido" : `${repetidos} grupos repetidos`}` : ""}. Inventário completo no Anexo II.`;
                        })()}
                      </div>
                    )}

                    {gruposRelevantes.length > 0 && (
                      <>
                        <div className="sub-head">Imagens repetidas byte a byte</div>
                        {gruposRelevantes.map((group, index) => (
                          <div key={`${group.sha256}-${index}`} className="ip-block" style={{ border: "1px solid rgba(133,149,168,0.35)", background: "rgba(133,149,168,0.07)" }}>
                            <div className="ip-head">
                              <div className="ip-id" style={{ color: "#d4dfec" }}>Grupo repetido #{index + 1}</div>
                              <Badge label={`${group.ocorrencias} OCORRÊNCIAS`} color="#8595a8" />
                            </div>
                            <Row label="SHA-256 da imagem" value={shortHash(group.sha256, 18, 10)} mono />
                            <Row label="Páginas" value={group.paginas?.join(" · ")} />
                            {(group.imagens || []).map((item, i) => (
                              <Row key={`${group.sha256}-${i}`} label={`Ocorrência ${i + 1}`} value={`pág. ${item.page}, img ${item.num}, ${item.width} x ${item.height}px, ${item.size || "tamanho não informado"}`} />
                            ))}
                            <div className="note" style={{ borderLeftColor: "#8595a8", background: "rgba(133,149,168,0.07)" }}>
                              {(group.imagens || []).some((item) => item.biometricaProvavel)
                                ? "A repetição byte a byte não prova fraude isoladamente, mas impede tratar as ocorrências como capturas independentes. Se uma delas estiver rotulada como prova de vida, recomenda-se exigir logs brutos, desafio de vivacidade, score e laudo do fornecedor biométrico."
                                : "Reuso esperado de elemento gráfico do template em todas as páginas. Sem relevância forense biométrica."}
                            </div>
                          </div>
                        ))}
                      </>
                    )}

                    {listed.length > 0 && (
                      <>
                        <div className="sub-head">Imagens relevantes para a perícia</div>
                        <div className="audit-table-wrap">
                          <table className="audit-table">
                            <colgroup>
                              <col style={{ width: "7%" }} /><col style={{ width: "7%" }} /><col style={{ width: "10%" }} />
                              <col style={{ width: "13%" }} /><col style={{ width: "18%" }} /><col style={{ width: "10%" }} /><col style={{ width: "35%" }} />
                            </colgroup>
                            <thead><tr><th>Pág.</th><th>Img</th><th>Tipo</th><th>Dimensão</th><th>Classe</th><th>Tam.</th><th>SHA-256</th></tr></thead>
                            <tbody>
                              {listed.map((item, index) => (
                                <tr key={`${item.page}-${item.num}-${index}`} className={item.sha256 && img.grupos_repetidos?.some((group) => group.sha256 === item.sha256) ? "audit-key-row" : ""}>
                                  <td>{item.page}</td>
                                  <td>{item.num}</td>
                                  <td>{item.type}</td>
                                  <td className="mono-cell">{item.width} x {item.height}</td>
                                  <td>{item.classificacao || item.enc}</td>
                                  <td>{item.size}</td>
                                  <td className="mono-cell">{shortHash(item.sha256 || "-", 14, 8)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>

                      </>
                    )}

                    {captures.length > 0 && (
                      <>
                        <div className="sub-head">Leitura forense da biometria visual</div>
                        <div className="diligence-list">
                          <div className="diligence-item"><span>Exigir do banco a imagem original capturada, e não apenas a imagem reembutida no PDF.</span></div>
                          <div className="diligence-item"><span>Exigir prova de vida com desafio, score de similaridade, limiar de aceitação, base comparada e fornecedor do algoritmo.</span></div>
                          <div className="diligence-item"><span>Confrontar hashes individuais das fotos quando o dossiê apresentar “identificação” e “prova de vida” como etapas distintas.</span></div>
                        </div>
                      </>
                    )}
                  </Section>
                );
              })()}

              {/* §4.3 Trilha de eventos (formato dossiê de contratação) */}
              {report.extracted.trilha_eventos?.eventos?.length > 0 && (
                <Section title="§ 4.3 · Trilha de eventos da contratação" danger={reportIssues(report.extracted, report.sumarioIrregularidades?.projecao).some((i) => /^TRL1|^TRL5/.test(i.codigo) && i.gravidade === "ALTA")}>
                  {(() => {
                    const t = report.extracted.trilha_eventos;
                    return (
                      <>
                        <Row label="Duração total da jornada" value={`${t.duracao_total} (${t.duracao_total_s} segundos)`} />
                        {t.fuso && <Row label="Fuso declarado na trilha" value={`${t.fuso.trilha}; leitura local em ${t.fuso.local}${t.fuso.assinatura_sem_fuso ? "; bloco de assinatura sem fuso" : ""}`} />}
                        <div className="audit-table-wrap">
                          <table className="audit-table">
                            <thead><tr><th>Evento</th><th>Data/hora ({t.fuso?.trilha || "declarada"})</th><th>Hora local</th><th>Intervalo</th><th>s/página</th><th>IP : porta</th><th>Geolocalização</th></tr></thead>
                            <tbody>
                              {t.eventos.map((ev, i) => (
                                <tr key={`${ev.nome}-${i}`} className={ev.segundos_por_pagina != null && ev.segundos_por_pagina < 5 ? "audit-key-row" : ""}>
                                  <td>{ev.nome}</td>
                                  <td className="mono-cell">{ev.data_hora}</td>
                                  <td className="mono-cell">{ev.hora_local ? ev.hora_local.split(" ")[1] : "-"}</td>
                                  <td className="mono-cell">{ev.intervalo_s == null ? "referência" : `+${ev.intervalo_s} s`}</td>
                                  <td className="mono-cell">{ev.segundos_por_pagina != null ? `${String(ev.segundos_por_pagina).replace(".", ",")} (${ev.documento_aceito.paginas} págs.)` : "-"}</td>
                                  <td className="mono-cell">{ev.ip ? `${ev.ip}${ev.porta ? `:${ev.porta}` : ""}` : "ausente"}</td>
                                  <td className="mono-cell">{ev.lat != null ? `${ev.lat}, ${ev.lon}` : "ausente"}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </>
                    );
                  })()}
                </Section>
              )}

              {report.ipAnalysis.length === 0 && !report.contractGeo ? (
                <Section title="§ 5-6 · Rastros de rede e geolocalização">
                  <div className="note" style={{ borderLeftColor: "var(--warn)", background: "rgba(242,176,61,0.07)" }}>
                    O documento não registra endereço IP, coordenadas GPS, carimbo de tempo nem trilha de auditoria referentes a qualquer etapa da contratação eletrônica. Não há elemento geográfico a confrontar. A ausência integral desses registros, em contratação declaradamente eletrônica, é o achado desta seção.
                  </div>
                </Section>
              ) : (
                <>
              {/* §5 Geolocalização da assinatura · confronto geográfico */}
              <Section title="§ 5 · Geolocalização da assinatura · confronto geográfico">
                {report.contractGeo ? (
                  <>
                    <div className="sub-head">Confronto · residência do cliente × geolocalização declarada no contrato</div>
                    {report.home.distancia_divergencia_cadastral != null && (
                      <div className="note" style={{ borderLeftColor: "var(--crit)", background: "rgba(240,99,99,0.08)", marginBottom: 14 }}>
                        <strong>Divergência Cadastral Identificada:</strong> O endereço fornecido como residência do cliente ({report.home.query || report.home.conflito?.manual?.texto}) difere da qualificação cadastral extraída do contrato ({[report.home.instrumento?.cidade, report.home.instrumento?.uf].filter(Boolean).join("/") || "município do contrato"}), distantes em aproximadamente <strong>{report.home.distancia_divergencia_cadastral.toFixed(1).replace(".", ",")} km</strong>. O laudo analisa as distâncias para ambas as referências.
                      </div>
                    )}
                    <div className="grid-2">
                      <div className="geo-card" style={{ borderTopColor: "var(--accent)" }}>
                        <div className="gtitle" style={{ color: "var(--accent)" }}>Residência do cliente (referência)</div>
                        <div className="gcoord" style={{ color: "var(--accent)" }}>
                          {report.home.geo ? `${report.home.geo.lat.toFixed(6)}, ${report.home.geo.lon.toFixed(6)}` : report.home.alerta ? "Confronto não realizado" : "Não geocodificada"}
                        </div>
                        {referenciaRecusada(report.home) ? (
                          <div className="gmeta">
                            {report.home.conflito?.manual?.texto || report.home.query ? <>Endereço informado, não utilizado: {report.home.conflito?.manual?.texto || report.home.query}</> : "Endereço do contratante não informado no instrumento"}
                          </div>
                        ) : (
                          <div className="gmeta">
                            {report.home.query || "Endereço não informado"}<br />
                            Origem: {report.home.source || "não disponível"}<br />
                            {report.home.geo?.precision === "manual" ? "Coordenada confirmada pelo operador" : "Coordenada aproximada por geocodificação"}
                          </div>
                        )}
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

                    {distanciaKm(report.contractGeo.distance) !== null ? (
                      <div className="geo-visual-block">
                        <DistanceBanner label="Distância: residência do cliente → local declarado da assinatura" km={report.contractGeo.distance} />
                        {report.contractGeo.distanceToInstrumento != null && (
                          <div className="row" style={{ marginTop: 6, marginBottom: 8, padding: "6px 12px", background: "rgba(133,149,168,0.08)", borderRadius: 6 }}>
                            <span className="row-label" style={{ fontSize: 12 }}>Distância: endereço extraído do contrato → local declarado da assinatura</span>
                            <span className="row-value" style={{ fontWeight: 700, fontSize: 13, color: "var(--accent)" }}>{report.contractGeo.distanceToInstrumento.toFixed(2).replace(".", ",")} km</span>
                          </div>
                        )}
                        <GeoMap
                          home={report.home.geo}
                          sign={{ lat: report.contractGeo.lat, lon: report.contractGeo.lon }}
                          distanceKm={report.contractGeo.distance}
                          riskColor={riskFromDistance(report.contractGeo.distance).color}
                        />
                        <div className="note" style={{ borderLeftColor: "var(--label)", background: "rgba(133,149,168,0.07)" }}>
                          A distância isolada não determina fraude. Deslocamentos compatíveis com a rotina do cliente, como ir da zona rural à capital do estado, podem ser plenamente legítimos. Este resultado deve ser confrontado com a entrevista do cliente, com a data e hora da assinatura e com a localização do correspondente bancário antes de qualquer conclusão sobre irregularidade.
                        </div>
                      </div>
                    ) : report.home.alerta ? (
                      <div className="note" style={{ borderLeftColor: "var(--crit)", background: "rgba(240,99,99,0.07)" }}>
                        {/* MED-01: o motivo completo fica só no § 3; aqui, a remissão. */}
                        Distância à residência não calculada: a referência residencial foi recusada ou está indisponível (ver § 3). O confronto entre a geolocalização declarada e a origem da conexão, abaixo, não depende da residência.
                      </div>
                    ) : (
                      <div className="note" style={{ borderLeftColor: "var(--warn)", background: "rgba(242,176,61,0.07)" }}>
                        Há geolocalização declarada no contrato, mas o endereço residencial não pôde ser geocodificado. Informe o endereço residencial do cliente na tela inicial para que a distância seja calculada.
                      </div>
                    )}

                    {/* Confronto independente da residência: continua no laudo quando
                        a referência residencial é recusada ou indisponível. */}
                    {report.contractGeo.municipio && (
                      <Row label="Município do local declarado" value={`${report.contractGeo.municipio}${report.contractGeo.uf ? `/${report.contractGeo.uf}` : ""}`} />
                    )}
                    {(() => {
                      const ipRef = report.ipAnalysis.find((ip) => Number.isFinite(ip.geo?.lat) && Number.isFinite(ip.geo?.lon) && distanciaKm(ip.distanceToSignature) !== null);
                      if (!ipRef) return null;
                      const d = ipRef.divergenciaAssinatura;
                      const cor = d?.tom === "ok" ? "#3ddc97" : d?.tom === "danger" ? "#f06363" : "#f2b03d";
                      return (
                        <>
                          <div className="sub-head">Confronto · GPS declarado × consulta de geolocalização do IP</div>
                          <div className="geo-visual-block">
                            <div className="row">
                              <span className="row-label">Distância entre o local declarado e a origem do IP {ipRef.endereco}</span>
                              <span className="row-value" style={{ color: cor, fontWeight: 700 }}>{distanciaKm(ipRef.distanceToSignature).toFixed(2).replace(".", ",")} km{d?.rotulo ? ` · ${d.rotulo}` : ""}</span>
                            </div>
                            {ipRef.distanceToInstrumento != null && (
                              <div className="row" style={{ marginTop: 4, padding: "4px 8px", background: "rgba(133,149,168,0.06)", borderRadius: 4 }}>
                                <span className="row-label" style={{ fontSize: 12 }}>Distância entre a origem do IP e o endereço extraído do contrato</span>
                                <span className="row-value" style={{ fontWeight: 600, fontSize: 12, color: "var(--muted)" }}>{distanciaKm(ipRef.distanceToInstrumento).toFixed(2).replace(".", ",")} km</span>
                              </div>
                            )}
                            {d?.sintese && <div className="note" style={{ borderLeftColor: cor }}>{d.sintese}</div>}
                            <GeoMap
                              home={{ lat: report.contractGeo.lat, lon: report.contractGeo.lon }}
                              homeLabel="Assinatura declarada"
                              sign={{ lat: ipRef.geo.lat, lon: ipRef.geo.lon }}
                              distanceKm={distanciaKm(ipRef.distanceToSignature)}
                              riskColor={cor}
                              targetLabel="Localização aproximada do IP"
                              caption="Coordenada declarada no log da assinatura × localização aproximada do IP informada pelo provedor. Este confronto não usa a residência. O ponto do IP pode representar a central da operadora, CGNAT ou VPN, e não demonstra localização histórica, presença física ou autoria. A margem de erro do serviço não foi fornecida."
                            />
                          </div>
                        </>
                      );
                    })()}
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
                      const risk = riskFromDistanceWithHistory(ip.distance, ip.geo?.historico);
                      const hasIpGeoCoords = Number.isFinite(ip.geo?.lat) && Number.isFinite(ip.geo?.lon);
                      return (
                        <div key={i} className="ip-block" style={{ border: `1px solid ${risk.color}40`, background: risk.bg }}>
                          <div className="ip-head">
                            <div className="ip-id" style={{ color: risk.color }}>IP #{i + 1} · {ip.endereco}</div>
                            <Badge label={risk.label} color={risk.color} />
                          </div>
                          {ip.contexto && <div className="ip-ctx">Contexto: {ip.contexto}</div>}
                          {ip.classe && <Row label="Classe técnica" value={ip.classe} />}
                          {/* Acréscimos do SaaS: CGNAT e titular do bloco (RDAP). */}
                          {ip.classe === "CGNAT" && (
                            <div className="note" style={{ borderLeftColor: "var(--warn)", background: "rgba(242,176,61,0.07)" }}>
                              Endereço de espaço compartilhado entre assinantes (CGNAT, RFC 6598). É interno da operadora e atribuído simultaneamente a muitos clientes: não localiza o usuário. Identificar quem usava a conexão exige requisitar da operadora o conjunto endereço, porta lógica e data/hora (Marco Civil, arts. 13 e 15, c/c art. 22).{!ip.porta ? " O documento não registra a porta lógica." : ""}
                            </div>
                          )}
                          {ip.porta && <Row label="Porta lógica" value={ip.porta} mono />}
                          {ip.rdap?.owner && <Row label="Titular do bloco (RDAP)" value={`${ip.rdap.owner}${ip.rdap.asn ? ` · AS${ip.rdap.asn}` : ""}`} />}
                          {risk.suppressed && risk.nota && (
                            <div className="ip-ctx" style={{ color: risk.color }}>
                              Registro na data do ato: {risk.nota}
                            </div>
                          )}

                          {ip.geo ? (
                            <>
                              {[
                                ["País (registro atual)", ip.geo.country],
                                ["Estado / região (registro atual)", ip.geo.region],
                                ["Cidade (registro atual)", ip.geo.city],
                                ["Provedor (ISP / ASN)", ip.geo.isp],
                                ["Fuso horário", ip.geo.timezone],
                                ["Fonte da geolocalização", ip.geo.source],
                                ["Consulta externa", `${ip.geo.queryId || "ID não registrado"} · ${ip.geo.queriedAt || "data não registrada"}`],
                                ["Granularidade", ip.historico?.precisionOverride || ip.geo.granularity || "não informada"],
                              ].map(([lbl, val]) => <Row key={lbl} label={lbl} value={val} />)}
                              {hasIpGeoCoords && <Row label="Coordenadas do IP (registro atual)" value={`${ip.geo.lat.toFixed(7)}, ${ip.geo.lon.toFixed(7)}`} mono />}
                              {distanciaKm(ip.distanceToSignature) !== null && (
                                <Row label="Distância ao local declarado da assinatura" value={`${distanciaKm(ip.distanceToSignature).toFixed(2).replace(".", ",")} km${ip.divergenciaAssinatura?.rotulo ? ` · ${ip.divergenciaAssinatura.rotulo}` : ""}`} />
                              )}
                              {distanciaKm(ip.distance) !== null && hasIpGeoCoords && !risk.suppressed ? (
                                <>
                                  <div className="row">
                                    <span className="row-label">Distância à residência do cliente</span>
                                    <span className="row-value" style={{ color: risk.color, fontWeight: 700 }}>{ip.distance.toFixed(2)} km</span>
                                  </div>
                                  <GeoMap
                                    home={report.home.geo}
                                    sign={{ lat: ip.geo.lat, lon: ip.geo.lon }}
                                    distanceKm={ip.distance}
                                    riskColor={risk.color}
                                    targetLabel="Localização aproximada do IP"
                                    caption="Localização aproximada fornecida pelo provedor de geolocalização do IP. O ponto pode representar a central do provedor, CGNAT, VPN ou infraestrutura de rede e não comprova a posição física exata do usuário."
                                  />
                                </>
                              ) : (
                                <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 8 }}>
                                  {report.home.alerta
                                    ? "Distância à residência não calculada: a referência residencial foi recusada ou está indisponível (ver § 3)."
                                    : "Endereço residencial não geocodificado. Distância indisponível para este IP."}
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
                </>
              )}

              {/* §7 */}
              {!report.processComparison && (
                <Section title="§ 7 · Confronto com informações do processo">
                  <div className="note" style={{ marginTop: 0 }}>
                    Não foi anexado PDF do processo para confronto. Esta seção fica sem conteúdo até que o arquivo dos autos seja fornecido; a numeração é preservada para manter a rastreabilidade do laudo entre §§ 1 a 10.
                  </div>
                </Section>
              )}
              {report.processComparison && (
                <Section title="§ 7 · Confronto com informações do processo" danger={report.processComparison.divergences?.length > 0 || report.processComparison.status === "CONFRONTO PARCIAL"}>
                  <div className="dist-banner" style={{ borderColor: report.processComparison.divergences?.length || report.processComparison.status === "CONFRONTO PARCIAL" ? "rgba(242,176,61,0.35)" : "rgba(61,220,151,0.35)", background: report.processComparison.divergences?.length || report.processComparison.status === "CONFRONTO PARCIAL" ? "rgba(242,176,61,0.08)" : "rgba(61,220,151,0.08)", marginTop: 0 }}>
                    <div>
                      <div className="dl">Resultado do confronto automático</div>
                      <div className="dv" style={{ color: report.processComparison.divergences?.length || report.processComparison.status === "CONFRONTO PARCIAL" ? "#f2b03d" : "#3ddc97" }}>{report.processComparison.status}</div>
                    </div>
                    <Badge label={report.processComparison.divergences?.length ? `${report.processComparison.divergences.length} PONTO(S)` : report.processComparison.status === "CONFRONTO PARCIAL" ? "PARCIAL" : "SEM DIVERGÊNCIA"} color={report.processComparison.divergences?.length || report.processComparison.status === "CONFRONTO PARCIAL" ? "#f2b03d" : "#3ddc97"} />
                  </div>
                  <Row label="Processo" value={extractCnjFromName(report.processComparison.file?.name) ? `Processo nº ${extractCnjFromName(report.processComparison.file?.name)}` : null} />
                  <Row label="PDF do processo confrontado" value={report.processComparison.file?.name ? `arquivo: ${report.processComparison.file.name}` : null} />
                  <Row label="SHA-256 do processo" value={report.processComparison.file?.sha256} mono />
                  {report.processComparison.status_note && <div className="note">{report.processComparison.status_note}</div>}
                  {report.processComparison.divergences?.length > 0 && (
                    <>
                      <div className="sub-head">Divergências/pontos de atenção</div>
                      {report.processComparison.divergences.map((item, index) => (
                        <div key={`${item.label}-${index}`} className="ip-block" style={{ border: "1px solid rgba(240,99,99,0.35)", background: "rgba(240,99,99,0.07)" }}>
                          <div className="ip-head">
                            <div className="ip-id" style={{ color: "#f06363" }}>{item.label}</div>
                            <Badge label={item.severidade || "ATENÇÃO"} color="#f06363" />
                          </div>
                          <Row label="Contrato/CCB" value={item.contrato} />
                          <Row label="Processo/autos" value={item.processo} />
                          {item.detalhe && <div className="note" style={{ borderLeftColor: "#f2b03d", background: "rgba(242,176,61,0.07)" }}>{item.detalhe}</div>}
                          {item.trecho && <Row label="Trecho localizado" value={item.trecho} />}
                        </div>
                      ))}
                    </>
                  )}
                  {report.processComparison.confirmations?.length > 0 && (
                    <>
                      <div className="sub-head">Campos confrontados nos autos</div>
                      {report.processComparison.confirmations.map((item, index) => (
                        <div className="row" key={`${item.label}-${index}`}>
                          <span className="row-label">{item.label}</span>
                          <span className="row-value">
                            {item.contrato || "Não informado"} · <Badge label={labelComparisonStatus(item.status)} color={comparisonStatusColor(item.status)} />
                          </span>
                        </div>
                      ))}
                    </>
                  )}
                  {report.processComparison.observations?.length > 0 && (
                    <>
                      <div className="sub-head">Observações processuais</div>
                      {report.processComparison.observations.map((item, index) => (
                        <div className="note" key={`${item.label}-${index}`}>
                          <b>{item.label}.</b> {item.detalhe}
                          {item.trecho ? <><br />Trecho: {item.trecho}</> : null}
                        </div>
                      ))}
                    </>
                  )}
                </Section>
              )}

              {/* §8 */}
              {reportIssues(report.extracted, report.sumarioIrregularidades?.projecao).length > 0 && (
                <Section title="§ 8 · Achados técnicos e diligências" danger={reportIssues(report.extracted, report.sumarioIrregularidades?.projecao).some((issue) => issue.gravidade === "ALTA")}>
                  {(() => {
                    const issues = reportIssues(report.extracted, report.sumarioIrregularidades?.projecao);
                    const groups = [
                      ["instrumento", "Inconsistências do instrumento"],
                      ["lacunas", "Lacunas probatórias a suprir pelo banco"],
                      ["contexto", "Contexto econômico"],
                    ];
                    return groups.map(([key, title]) => {
                      const items = issues.filter((issue) => issueBucket(issue) === key);
                      if (!items.length) return null;
                      return (
                        <div key={key} className="issue-group">
                          <div className="sub-head">{title}</div>
                          {items.map((issue, i) => (
                            <div key={`${issue.codigo}-${i}`} className="flag">
                              <b>▸</b>
                              <span>
                                <strong>{issue.titulo}.</strong> {issue.texto}
                                {issue.gravidade && <span className="inline-badge-wrap"><Badge label={issue.gravidade} color={severityColor(issue.gravidade)} /></span>}
                              </span>
                            </div>
                          ))}
                        </div>
                      );
                    });
                  })()}
                </Section>
              )}

              {/* §9 */}
              {report.extracted.observacoes_periciais && (
                <Section title="§ 9 · Observações periciais complementares">
                  <div className="note">
                    Este laudo foi produzido por extração automatizada de texto, metadados e objetos gráficos do arquivo original, com verificação criptográfica local. Os campos extraídos devem ser conferidos contra o instrumento antes do uso em peça processual. As conclusões técnicas dos §§ 1 a 8 decorrem de exame direto do arquivo e independem de valoração jurídica, que compete ao juízo.
                  </div>
                </Section>
              )}

              {/* §10 Fundamentação normativa */}
              <Section title="§ 10 · Fundamentação normativa aplicável">
                {(() => {
                  const ctr = report.extracted.contrato || {};
                  const declaredHash = report.extracted.assinatura?.hash_documento_assinado;
                  const clsHash = declaredHash ? classifyHashString(declaredHash) : null;
                  const hashDefect = !!(clsHash && !clsHash.isHash);
                  const geoRisk =
                    (report.contractGeo?.distance != null && report.contractGeo.distance >= 300) ||
                    report.ipAnalysis.some((ip) => ip.distance != null && ip.distance >= 300);

                  const destaques = [];
                  if (hashDefect) destaques.push("defeito formal de integridade do documento");
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
                    // Marco do consignado escolhido pelo produto (mesma regra de
                    // backend/src/reports/laudoTexts.js). CLT não cita INSS.
                    ...(ctr.produto_codigo === "CDC" ? [] : ctr.produto_codigo === "CONSIGNADO_CLT" ? [["Crédito consignado do trabalhador (CLT)", [
                      ["Lei 10.820/2003", "Disciplina a autorização para desconto de prestações de empréstimos em folha de pagamento dos empregados regidos pela CLT, os limites da consignação e as obrigações do empregador na retenção e no repasse."],
                    ]]] : [["Crédito consignado e benefício do INSS", [
                      ["Lei 10.820/2003 e Decreto 4.840/2003", "Disciplinam a autorização e os limites do desconto de prestações de empréstimo consignado em folha de pagamento e em benefício previdenciário."],
                      ["Lei 8.213/1991, art. 115", "Define as hipóteses e os limites de desconto sobre o valor do benefício previdenciário."],
                      ["Normas do INSS sobre consignações (Instrução Normativa vigente) e Resoluções do CNPS", "Regulam margem consignável, formalização e averbação. Número da IN vigente: verificar conforme a data do contrato."],
                    ]]]),
                    ["Assinatura eletrônica e ônus da prova", [
                      ["MP 2.200-2/2001, art. 10, § 2º", "Admite outros meios de comprovação de autoria e integridade, além da certificação ICP-Brasil."],
                      ["Lei 14.063/2020", "Classifica assinaturas em simples, avançada e qualificada nas interações com entes públicos; em relações privadas, use como parâmetro técnico por analogia."],
                      ["Jurisprudência do STJ sobre assinatura eletrônica", "A ausência de certificação ICP-Brasil não invalida, por si só, a assinatura, desde que comprovadas autoria e integridade."],
                      ["STJ, Tema 1.061, CPC arts. 6º, 369 e 429, II", "Impugnada a assinatura constante em contrato bancário juntado pela instituição financeira, cabe a ela provar a autenticidade."],
                    ]],
                    ["Vícios contratuais e boa-fé", [
                      ["CC (Lei 10.406/2002), arts. 138, 145 e 157", "Erro, dolo e lesão como vícios do consentimento aptos a invalidar o negócio jurídico."],
                      ["CC, art. 422", "Dever de probidade e boa-fé objetiva na conclusão e na execução do contrato."],
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

              {/* Anexo I: acréscimo do SaaS, quesitos para a peça. */}
              {report.quesitos?.length > 0 && (
                <Section title="Anexo I · Sugestão de quesitos ao juízo e ao perito">
                  <div className="note" style={{ marginTop: 0 }}>
                    Quesitos redigidos a partir dos dados deste laudo, para fixação dos pontos controvertidos (CPC, art. 465, § 1º, III). Revise e adapte ao caso antes de protocolar.
                  </div>
                  {report.quesitos.map((q) => (
                    <div key={q.numero} className="norm">
                      <div className="norm-disp">Quesito {q.numero} · {q.titulo}</div>
                      <div className="norm-sint">{q.quesito}</div>
                      <div className="norm-sint" style={{ color: "var(--muted)", fontSize: 12 }}>Finalidade: {q.finalidade}</div>
                    </div>
                  ))}
                </Section>
              )}

              {/* Anexo II: inventário técnico completo das imagens (FEAT-09). */}
              {report.extracted.imagens_pdf?.imagens?.length > 0 && (
                <Section title="Anexo II · Inventário técnico de imagens">
                  <div className="note" style={{ marginTop: 0 }}>
                    Todas as imagens listadas por pdfimages, com classificação e SHA-256 individual. Os achados do § 4.2 consideram este conjunto completo.
                  </div>
                  <div className="audit-table-wrap">
                    <table className="audit-table">
                      <thead><tr><th>Pág.</th><th>Img</th><th>Tipo</th><th>Dimensão</th><th>Classe</th><th>Tam.</th><th>SHA-256</th></tr></thead>
                      <tbody>
                        {report.extracted.imagens_pdf.imagens.map((item, index) => (
                          <tr key={`anexo-${item.page}-${item.num}-${index}`}>
                            <td>{item.page}</td>
                            <td>{item.num}</td>
                            <td>{item.type}</td>
                            <td className="mono-cell">{item.width} x {item.height}</td>
                            <td>{item.classificacao || item.enc}</td>
                            <td>{item.size}</td>
                            <td className="mono-cell">{shortHash(item.sha256 || "-", 14, 8)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Section>
              )}

              {/* Legal */}
              <div className="legal">
                {[
                  "AVISO LEGAL: Este laudo foi gerado automaticamente pelo sistema ForenseDoc para fins de análise técnica preliminar da cadeia de custódia do documento.",
                  "Os hashes criptográficos SHA-256 e SHA-1 foram calculados pelo servidor sobre o arquivo original recebido (NIST FIPS 180-4).",
                  report.ipAnalysis.length > 0 ? "A geolocalização de IPs é fornecida por serviços de terceiros (ipapi.co, com contingência ipwho.is) e possui margem de erro inerente; endereços de ISPs, CGNAT e VPNs podem não refletir a localização física real do usuário." : null,
                  (report.home.geo || report.contractGeo?.geocoded) ? "A geocodificação de endereços usa o serviço OpenStreetMap Nominatim." : null,
                  (report.ipAnalysis.some((ip) => ip.distance != null) || report.contractGeo?.distance != null) ? "A fórmula de Haversine calcula a distância geodésica sobre a superfície esférica terrestre. A distância geográfica, isoladamente, não constitui prova de fraude e deve ser ponderada com o contexto fático." : null,
                  `Este documento deve ser complementado por análise pericial humana qualificada antes de ser utilizado como prova técnica definitiva nos autos. Gerado em ${report.timestamp}.`,
                ].filter(Boolean).join(" ")}
              </div>

              {report.sumarioIrregularidades && <SumarioIrregularidades summary={report.sumarioIrregularidades} />}

              </div>
    </div>
  );
}
