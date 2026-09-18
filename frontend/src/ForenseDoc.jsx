import { useState, useRef, useCallback } from "react";

import "./styles/ForenseDoc.css";
import { API_BASE, geolocateIP, geocodeAddress, checkBackendReady } from "./utils/api.js";
import { api as apiClient } from "./lib/axios.js";
import { digestHash, classifyHashString } from "./utils/crypto.js";
import { haversineKm, riskFromDistance } from "./utils/geo.js";
import { exportReportPDF } from "./utils/pdfExport.js";
import { Row, Badge, Section } from "./components/UiComponents.jsx";
import { DistanceBanner } from "./components/DistanceBanner.jsx";
import { GeoMap } from "./components/GeoMap.jsx";
import { fichaBeneficioSeAplica } from "./laudo/produto.js";

function arrayBufferToBase64(buffer) {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

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
export default function ForenseDoc() {
  const [stage, setStage] = useState("idle");
  const [progress, setProgress] = useState({ label: "", pct: 0 });
  const [report, setReport] = useState(null);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfDownload, setPdfDownload] = useState(null);
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
      setProgress({ label: "Verificando backend local...", pct: 4 });
      const backend = await checkBackendReady();
      if (!backend.ok) {
        setError(backend.message);
        setStage("error");
        return;
      }
      let processingNotice = backend.warning || "";

      setProgress({ label: "Lendo arquivo e calculando hashes criptográficos...", pct: 8 });
      const buffer = await file.arrayBuffer();
      const [sha256, sha1] = await Promise.all([
        digestHash("SHA-256", buffer),
        digestHash("SHA-1", buffer),
      ]);
      const base64 = arrayBufferToBase64(buffer);

      setProgress({ label: "Extraindo dados do PDF e aplicando OCR local quando necessário...", pct: 18 });
      // Pelo client `api`, não por fetch cru: /api/analyze exige autenticação
      // desde a v3, e o fetch sem header Authorization levava todo upload a um
      // 401 silencioso que a tela reportava como "erro do motor de análise".
      const apiRes = await apiClient
        .post("/analyze", { pdfBase64: base64 })
        .then((r) => ({ ok: true, status: r.status, data: r.data }))
        .catch((e) => ({ ok: false, status: e.response?.status ?? 0, data: e.response?.data }));

      setProgress({ label: "Interpretando dados extraídos...", pct: 46 });
      let extracted = null;
      let pdfMetadata = null;
      let extractionError = "";
      try {
        // O axios já entrega o JSON desserializado — não há mais texto cru para
        // interpretar como havia com o fetch.
        const apiData = apiRes.data ?? null;
        if (!apiRes.ok || (apiData && apiData.error)) {
          const apiError = apiData?.error;
          extractionError = typeof apiError === "string"
            ? apiError
            : apiError?.message || `O motor de análise retornou um erro (HTTP ${apiRes.status}).`;
        } else if (!apiData) {
          extractionError = "O backend não retornou JSON válido. Verifique se o servidor backend local está ligado em http://localhost:8787.";
        } else {
          const rawText = apiData.text || "";
          extracted = parseExtraction(rawText);
          pdfMetadata = apiData.metadata || null;
          if (!extracted) {
            extractionError = "A extração automática não retornou dados estruturados válidos (resposta vazia ou JSON incompleto). O laudo foi gerado com os dados disponíveis; os campos extraídos podem ser preenchidos manualmente.";
          }
          if (apiData.warning) {
            processingNotice = processingNotice ? `${processingNotice} ${apiData.warning}` : apiData.warning;
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
      const extractedAddr = [c.endereco, c.bairro, c.cidade, c.estado, c.cep].filter(Boolean).join(", ");
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
        metadata: pdfMetadata,
        extracted,
        home: { query: homeQuery, source: homeSource, geo: homeGeo },
        contractGeo: contractGeo ? { ...contractGeo, distance: contractToHomeKm } : null,
        geoDeclaredPresent: !!(g && g.presente),
        ipAnalysis: ipWithDistance,
        processingNotice,
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
    setPdfDownload(null);
    setProgress({ label: "", pct: 0 });
    if (fileRef.current) fileRef.current.value = "";
  };

  return (
    <>
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
              <div className="card report-cover" style={{ textAlign: "center", borderColor: "rgba(79,195,232,0.3)", background: "linear-gradient(180deg, rgba(79,195,232,0.06), var(--panel))" }}>
                <div className="eyebrow" style={{ fontSize: 11 }}>Laudo técnico pericial · Análise forense digital</div>
                <div className="report-cover-title" style={{ fontFamily: "var(--display)", fontWeight: 700, fontSize: 22, color: "#fff", margin: "12px 0 8px", letterSpacing: "0.02em" }}>
                  Contrato de Crédito Consignado
                </div>
                <div style={{ fontSize: 12.5, color: "var(--muted)" }}>Emitido em {report.timestamp} · Horário de Fortaleza (BRT)</div>
                <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 3 }}>
                  {report.file.name} · {report.file.sizeKB} KB · {report.file.sizeBytes.toLocaleString("pt-BR")} bytes
                </div>
              </div>

              {report.processingNotice && (
                <div className="card report-notice" style={{ borderColor: "rgba(61,220,151,0.32)", background: "rgba(61,220,151,0.06)" }}>
                  <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                    <span style={{ color: "var(--ok)", fontSize: 18, lineHeight: 1.2 }}>✓</span>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: "var(--ok)", marginBottom: 4 }}>OCR local aplicado</div>
                      <div style={{ fontSize: 13, color: "#bfe8d6", lineHeight: 1.6 }}>{report.processingNotice}</div>
                    </div>
                  </div>
                </div>
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

              {/* §1.1 Metadados internos */}
              {report.metadata && (
                <Section title="§ 1.1 · Verificação dos metadados internos do PDF">
                  <div className="row">
                    <span className="row-label">Resultado da verificação</span>
                    <Badge
                      label={report.metadata.warnings?.length ? `${report.metadata.warnings.length} ALERTA(S)` : "SEM ALERTAS"}
                      color={report.metadata.warnings?.length ? "#f2b03d" : "#3ddc97"}
                    />
                  </div>
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
                    ["Formulário AcroForm", report.metadata.hasAcroForm ? "Presente" : "Ausente"],
                    ["Formulário XFA", report.metadata.hasXfa ? "Presente" : "Ausente"],
                    ["Assinatura digital incorporada", report.metadata.hasEmbeddedSignatures ? "Detectada" : "Não detectada"],
                  ].map(([label, value]) => <Row key={label} label={label} value={value} />)}
                  <Row label="Identificador interno do trailer" value={report.metadata.trailerFingerprint} mono />

                  {report.metadata.warnings?.length > 0 && (
                    <>
                      <div className="sub-head">Achados da auditoria de metadados</div>
                      {report.metadata.warnings.map((warning, index) => (
                        <div key={index} className="flag" style={{ color: "#d9c79a", borderBottomColor: "rgba(242,176,61,0.18)" }}>
                          <b style={{ color: "var(--warn)" }}>▸</b><span>{warning}</span>
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
                  /* D7: campos de benefício previdenciário não se imprimem em
                     modalidade que não os comporta (ex.: consignado CLT). */
                  ...(fichaBeneficioSeAplica(report.extracted.contrato?.produto_codigo) ? [
                    ["Matrícula INSS", report.extracted.cliente?.matricula_inss],
                    ["Número do benefício", report.extracted.cliente?.numero_beneficio],
                    ["Espécie do benefício", report.extracted.cliente?.especie_beneficio],
                  ] : []),

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
                      <div className="geo-visual-block">
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
                      </div>
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
                <button className="btn btn-primary" onClick={() => exportReportPDF(setPdfBusy, setPdfDownload)} disabled={pdfBusy}>
                  {pdfBusy ? "Gerando PDF..." : "Gerar relatório em PDF"}
                </button>
                <button className="btn" onClick={reset} disabled={pdfBusy}>Analisar novo contrato</button>
              </div>
              {pdfDownload && (
                <div className="card" style={{ maxWidth: 820, margin: "22px auto 0", borderColor: "rgba(61,220,151,0.32)", background: "rgba(61,220,151,0.05)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 14, flexWrap: "wrap", marginBottom: 14 }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 800, color: "var(--ok)", letterSpacing: "0.04em", textTransform: "uppercase" }}>
                        PDF pronto para salvar
                      </div>
                      <div style={{ fontSize: 12.5, color: "var(--label)", marginTop: 4 }}>
                        {pdfDownload.filename} · {pdfDownload.sizeKB} KB
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                      <a className="btn btn-primary" href={pdfDownload.url} download={pdfDownload.filename} style={{ textDecoration: "none" }}>
                        Baixar PDF
                      </a>
                      <a className="btn" href={pdfDownload.url} target="_blank" rel="noopener noreferrer" style={{ textDecoration: "none" }}>
                        Abrir PDF
                      </a>
                    </div>
                  </div>
                  <iframe
                    title="Prévia do PDF gerado"
                    src={pdfDownload.url}
                    style={{
                      width: "100%",
                      height: 520,
                      border: "1px solid var(--line)",
                      borderRadius: 8,
                      background: "#f8f6f1",
                    }}
                  />
                </div>
              )}
            </div>
          )}

        </div>
      </div>
    </>
  );
}
