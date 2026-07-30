import { useState, useRef, useCallback, useEffect } from "react";
import { Link } from "react-router-dom";
import toast from "react-hot-toast";
import {
  UploadCloud, FileText, Loader2, AlertTriangle, ShieldCheck, MapPin,
  Fingerprint, Ruler, Download, RotateCcw, FileDown, CheckCircle2, Wand2,
} from "lucide-react";

import { api } from "../lib/axios.js";
import { classifyHashString } from "../utils/crypto.js";
import { exportReportPDF } from "../utils/pdfExport.js";
import { downloadReportPdf } from "../utils/reportDownload.js";
import {
  Row, Badge, Section, SubHead, Note, Flag, CompareGrid, CompareCard, Norm, TONES,
} from "../components/UiComponents.jsx";
import { GeoMap } from "../components/GeoMap.jsx";
import CadeiaCustodia from "../components/report/CadeiaCustodia.jsx";
import IpTrace from "../components/report/IpTrace.jsx";
import { useAuthStore } from "../store/authStore.js";

// Espelha o MAX_PDF_MB do backend (utils/pdfValidation.js). Checar aqui evita
// converter 100 MB para base64 na memória do navegador só para o servidor
// recusar depois — e o 413 do express não traz mensagem legível para a tela.
const MAX_PDF_MB = Number(import.meta.env.VITE_MAX_PDF_MB) || 30;
const MAX_PDF_BYTES = MAX_PDF_MB * 1024 * 1024;

/**
 * Converte o PDF para base64 em blocos.
 *
 * A versão anterior concatenava caractere por caractere numa string: para um
 * PDF de 30 MB são ~31 milhões de iterações com realocação de string a cada
 * passo, travando a interface por vários segundos sem nenhum indicador. Blocos
 * de 32 KB via `String.fromCharCode(...bloco)` fazem o mesmo trabalho em uma
 * fração do tempo, e o limite do bloco evita estourar o tamanho máximo de
 * argumentos da chamada.
 */
function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const CHUNK = 0x8000;
  const partes = [];
  for (let i = 0; i < bytes.length; i += CHUNK) {
    partes.push(String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK)));
  }
  return btoa(partes.join(""));
}

const PRECISION_LABEL = {
  manual: "confirmada pelo operador",
  gps: "GPS do log do contrato",
  rooftop: "nível de endereço (número)",
  street: "nível de rua",
  postal: "nível de CEP",
  city: "nível de cidade (aproximada)",
};

function precisionLabel(geo) {
  const p = geo?.precision;
  return p && PRECISION_LABEL[p] ? PRECISION_LABEL[p] : "precisão não determinada";
}

// Precisão apenas em nível de cidade (ou desconhecida) = residência não confiável.
function isCoarseHome(geo) {
  return !!geo && (geo.precision === "city" || !geo.precision);
}

// Interpreta "lat, lon" colado do Google Maps. Devolve {lat, lon} ou null.
export function parseLatLon(text) {
  const m = String(text || "").trim().match(/^(-?\d{1,2}(?:\.\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:\.\d+)?)$/);
  if (!m) return null;
  const lat = parseFloat(m[1]);
  const lon = parseFloat(m[2]);
  // Faixa do Brasil — evita inverter lat/lon ou colar lixo.
  if (lat < -34 || lat > 6 || lon < -74 || lon > -33) return null;
  return { lat, lon };
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

// Polling do job assíncrono (Módulo 4) — para assim que sair de PROCESSING.
/**
 * `isCancelled` interrompe o polling quando o usuário abandona a análise.
 *
 * Sem isso, sair da tela ou clicar em "Analisar novo contrato" deixava o laço
 * rodando por até 5 minutos — 150 requisições inúteis — e, ao terminar, ele
 * ainda escrevia o resultado no estado: o laudo de uma análise abandonada
 * aparecia sobre a tela que o usuário tinha acabado de abrir.
 */
async function pollAnalysisStatus(analysisId, onProgress, isCancelled) {
  const POLL_INTERVAL_MS = 2000;
  const MAX_ATTEMPTS = 150; // ~5 minutos

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (isCancelled()) return null;
    const { data } = await api.get(`/analyses/${analysisId}/status`);
    if (data.status !== "PROCESSING") return data.status;
    onProgress(Math.min(30 + attempt, 45));
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  throw new Error("Tempo limite excedido aguardando o processamento da análise.");
}

export default function Analyze() {
  const [stage, setStage] = useState("idle");
  const [progress, setProgress] = useState({ label: "", pct: 0 });
  const [report, setReport] = useState(null);
  const [error, setError] = useState("");
  const [noCredits, setNoCredits] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfDownload, setPdfDownload] = useState(null);
  const [serverPdfBusy, setServerPdfBusy] = useState(false);
  const [homeAddr, setHomeAddr] = useState("");
  const [homeCoordInput, setHomeCoordInput] = useState("");
  const [correctCoord, setCorrectCoord] = useState("");
  const [correcting, setCorrecting] = useState(false);
  const fileRef = useRef();

  /*
   * Identifica a análise vigente. Cada `analyze()` incrementa o contador, e o
   * polling só escreve no estado se o token dele ainda for o atual. É o que
   * impede uma análise abandonada (reset, ou desmontagem da tela) de sobrescrever
   * a interface minutos depois.
   */
  const runIdRef = useRef(0);
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  // Correção da coordenada da residência pelo operador — recalcula o §5 no
  // servidor e re-persiste, para o PDF refletir o ponto confirmado.
  const handleGeoCorrect = async () => {
    const coord = parseLatLon(correctCoord);
    if (!coord) {
      // `toast`, não `setError`: o bloco de erro só é renderizado no estágio
      // "error", então uma mensagem posta aqui nunca chegava à tela — o operador
      // clicava em "Aplicar coordenada" e nada acontecia.
      toast.error("Coordenada inválida. Use o formato: latitude, longitude (ex.: -5.0951, -42.8100).");
      return;
    }
    if (!report?.analysisId) return;
    setCorrecting(true);
    try {
      const { data } = await api.patch(`/analyses/${report.analysisId}/geo`, coord);
      const r = data.result || {};
      setReport((prev) => ({
        ...prev,
        home: r.home || prev.home,
        contractGeo: r.contractGeo || prev.contractGeo,
        ipAnalysis: r.ipAnalysis || prev.ipAnalysis,
      }));
      setCorrectCoord("");
      toast.success("Coordenada aplicada. As distâncias do §5 foram recalculadas.");
    } catch (err) {
      toast.error(err.response?.data?.error || "Não foi possível corrigir a coordenada.");
    } finally {
      setCorrecting(false);
    }
  };

  const handleServerPdf = async () => {
    if (!report?.analysisId) return;
    setServerPdfBusy(true);
    try {
      await downloadReportPdf(report.analysisId);
    } catch {
      toast.error("Não foi possível gerar o laudo em PDF pelo servidor.");
    } finally {
      setServerPdfBusy(false);
    }
  };

  const analyze = useCallback(async (file) => {
    if (!file) return;
    if (!/\.pdf$/i.test(file.name)) {
      setError("Formato não suportado. Envie um arquivo em PDF.");
      setStage("error");
      return;
    }

    if (file.size > MAX_PDF_BYTES) {
      setError(
        `O arquivo tem ${(file.size / 1024 / 1024).toFixed(1)} MB e o limite é ${MAX_PDF_MB} MB. ` +
          "Reduza o PDF (ex.: salve sem imagens em alta resolução) e envie novamente."
      );
      setStage("error");
      return;
    }

    const runId = ++runIdRef.current;
    const desatualizado = () => runId !== runIdRef.current || !mountedRef.current;

    setStage("processing");
    setError("");
    setNoCredits(false);

    try {
      setProgress({ label: "Lendo arquivo...", pct: 8 });
      const buffer = await file.arrayBuffer();
      const base64 = arrayBufferToBase64(buffer);

      setProgress({ label: "Enviando documento para o motor de análise...", pct: 18 });
      // Todo o processamento pesado — extração, hashes do arquivo e confronto
      // geográfico (§5) — roda no servidor e fica persistido, para o laudo ser
      // reproduzível. O cliente apenas envia o PDF e renderiza o resultado.
      const coord = parseLatLon(homeCoordInput);
      const { data: startData } = await api.post("/analyze", {
        pdfBase64: base64,
        filename: file.name,
        homeAddress: (homeAddr || "").trim(),
        ...(coord ? { homeLat: coord.lat, homeLon: coord.lon } : {}),
      });

      setProgress({ label: "Extraindo dados, calculando hashes e geolocalizando...", pct: 34 });
      const finalStatus = await pollAnalysisStatus(
        startData.analysisId,
        (pct) => {
          if (!desatualizado()) {
            setProgress({ label: "Extraindo dados, calculando hashes e geolocalizando...", pct });
          }
        },
        desatualizado
      );

      // O usuário abandonou esta análise: ela segue no servidor e aparece no
      // histórico, mas não pode mais mexer na tela.
      if (finalStatus === null || desatualizado()) return;

      if (finalStatus !== "COMPLETED") {
        setError(
          "O motor de análise não conseguiu processar o documento e o crédito foi estornado automaticamente. Tente novamente ou envie um PDF diferente."
        );
        setStage("error");
        useAuthStore.getState().fetchBalance();
        return;
      }

      setProgress({ label: "Compilando laudo técnico pericial...", pct: 88 });
      const { data: resultData } = await api.get(`/analyses/${startData.analysisId}/result`);
      const apiData = resultData.result || {};

      let extracted = parseExtraction(apiData.text || "");
      const extractionError = extracted
        ? ""
        : "A extração automática não retornou dados estruturados válidos. O laudo foi gerado com os dados disponíveis; os campos extraídos podem ser preenchidos manualmente.";
      if (!extracted) extracted = {};

      useAuthStore.getState().fetchBalance();

      // O servidor já entrega hashes, home, contractGeo e ipAnalysis prontos —
      // basta montar o report na forma que o render espera.
      setReport({
        analysisId: startData.analysisId,
        timestamp: apiData.generatedAt
          ? new Date(apiData.generatedAt).toLocaleString("pt-BR", { timeZone: "America/Fortaleza" })
          : new Date().toLocaleString("pt-BR", { timeZone: "America/Fortaleza" }),
        file: {
          name: apiData.file?.name || file.name,
          sizeKB: ((apiData.file?.sizeBytes ?? buffer.byteLength) / 1024).toFixed(2),
          sizeBytes: apiData.file?.sizeBytes ?? buffer.byteLength,
        },
        hashes: apiData.hashes || null,
        metadata: apiData.metadata || null,
        extracted,
        home: apiData.home || { query: null, source: null, geo: null },
        contractGeo: apiData.contractGeo || null,
        geoDeclaredPresent: !!apiData.geoDeclaredPresent,
        ipAnalysis: apiData.ipAnalysis || [],
        processingNotice: apiData.warning || "",
        extractionError,
      });

      setStage("done");
      setProgress({ label: "Concluído", pct: 100 });
    } catch (err) {
      if (err.response?.status === 402) {
        setError("Você não tem créditos suficientes para realizar uma análise.");
        setNoCredits(true);
        setStage("error");
        useAuthStore.getState().fetchBalance();
        return;
      }
      const apiError = err.response?.data?.error;
      setError(typeof apiError === "string" ? apiError : err.message || "Erro inesperado durante a análise.");
      setStage("error");
    }
  }, [homeAddr, homeCoordInput]);

  const handleDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) analyze(f);
  };

  const reset = () => {
    // Invalida a execução em voo: sem isto, o polling da análise anterior
    // continuava e devolvia o laudo dela sobre a tela já reiniciada.
    runIdRef.current += 1;
    setStage("idle");
    setReport(null);
    setError("");
    setNoCredits(false);
    setPdfDownload(null);
    setProgress({ label: "", pct: 0 });
    if (fileRef.current) fileRef.current.value = "";
  };

  const btnPrimary =
    "inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-white shadow-lg shadow-primary/20 transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50";
  const btnGhost =
    "inline-flex items-center justify-center gap-2 rounded-lg border border-surface-border bg-secondary px-5 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-secondary-hover disabled:cursor-not-allowed disabled:opacity-50";
  const inputBase =
    "block w-full rounded-lg border border-surface-border bg-surface px-4 py-2.5 text-sm text-foreground placeholder-zinc-500 transition-all focus:border-transparent focus:outline-none focus:ring-2 focus:ring-primary";

  return (
    <div className="animate-fade-in space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Nova análise</h1>
        <p className="text-zinc-400">
          Envie o contrato em PDF e receba o laudo técnico pericial completo.
        </p>
      </div>

      {/* ─── IDLE ─────────────────────────────────────────────────────────── */}
      {stage === "idle" && (
        <div className="mx-auto w-full max-w-3xl space-y-6">
          <div className="glass space-y-5 rounded-2xl border border-surface-border p-6">
            <div>
              <label className="mb-1 block text-sm font-medium text-zinc-300">
                Endereço residencial do cliente (conferido)
              </label>
              <input
                type="text"
                value={homeAddr}
                onChange={(e) => setHomeAddr(e.target.value)}
                placeholder="Rua, número, bairro, cidade, UF"
                className={inputBase}
              />
              <p className="mt-2 text-xs leading-relaxed text-zinc-500">
                Ponto de referência de todas as comparações de distância: a geolocalização declarada
                no contrato e cada IP serão confrontados com este endereço. Se ficar em branco, o
                sistema usa o endereço extraído do próprio contrato.
              </p>
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-zinc-300">
                Coordenada exata da residência <span className="text-zinc-500">(opcional)</span>
              </label>
              <input
                type="text"
                value={homeCoordInput}
                onChange={(e) => setHomeCoordInput(e.target.value)}
                placeholder="Ex.: -5.0951, -42.8100"
                className={inputBase}
              />
              <p className="mt-2 text-xs leading-relaxed text-zinc-500">
                Para máxima precisão do laudo, cole a coordenada exata da residência (no Google
                Maps, clique com o botão direito sobre o local → a primeira linha copia
                "latitude, longitude"). Quando informada, ela prevalece sobre a geocodificação
                automática do endereço. Você também poderá confirmar ou corrigir a coordenada
                depois, no laudo.
              </p>
            </div>
          </div>

          <button
            type="button"
            onDrop={handleDrop}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onClick={() => fileRef.current.click()}
            className={`flex w-full flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-14 text-center transition-colors ${
              dragging
                ? "border-primary bg-primary/5"
                : "border-surface-border bg-surface/30 hover:border-primary/50 hover:bg-surface/50"
            }`}
          >
            <div className="mb-4 rounded-full border border-primary/20 bg-primary/10 p-4">
              <UploadCloud className="h-7 w-7 text-primary" />
            </div>
            <span className="text-base font-bold text-foreground">Anexar contrato em PDF</span>
            <span className="mt-1 text-sm text-zinc-400">
              Arraste o arquivo aqui ou clique para selecionar
            </span>
            <span className="mt-4 text-[11px] font-medium uppercase tracking-wider text-zinc-600">
              PDF · Consignado INSS · Todos os bancos · Até {MAX_PDF_MB} MB
            </span>
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".pdf"
            className="hidden"
            onChange={(e) => analyze(e.target.files[0])}
          />

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              { icon: Fingerprint, label: "Hash SHA-256 / SHA-1" },
              { icon: MapPin, label: "Geolocalização de IP" },
              { icon: ShieldCheck, label: "GPS da assinatura" },
              { icon: Ruler, label: "Distância Haversine" },
            ].map(({ icon: Icon, label }) => (
              <div
                key={label}
                className="glass flex flex-col items-center gap-2 rounded-xl border border-surface-border px-3 py-4 text-center"
              >
                <Icon className="h-5 w-5 text-primary" />
                <span className="text-xs font-medium text-zinc-400">{label}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ─── PROCESSING ───────────────────────────────────────────────────── */}
      {stage === "processing" && (
        <div className="glass mx-auto mt-10 w-full max-w-md rounded-2xl border border-surface-border p-10 text-center">
          <Loader2 className="mx-auto mb-6 h-12 w-12 animate-spin text-primary" />
          <div className="mb-5 text-[11px] font-bold uppercase tracking-[0.14em] text-zinc-400">
            Analisando documento
          </div>
          <div className="mb-4 h-1.5 w-full overflow-hidden rounded-full bg-surface-border">
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-500 ease-out"
              style={{ width: `${progress.pct}%` }}
            />
          </div>
          <div className="text-sm text-zinc-400">{progress.label}</div>
          <div className="mt-2 text-lg font-bold tabular-nums text-primary">{progress.pct}%</div>
        </div>
      )}

      {/* ─── ERROR ────────────────────────────────────────────────────────── */}
      {stage === "error" && (
        <div className="glass mx-auto mt-10 w-full max-w-md rounded-2xl border border-surface-border p-8 text-center">
          <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full border border-red-500/20 bg-red-500/10">
            <AlertTriangle className="h-7 w-7 text-red-500" />
          </div>
          <h2 className="mb-2 text-xl font-bold text-foreground">
            {noCredits ? "Créditos insuficientes" : "Erro na análise"}
          </h2>
          <p className="mb-7 text-sm leading-relaxed text-zinc-400">{error}</p>
          <div className="flex flex-wrap justify-center gap-3">
            {noCredits && (
              <Link to="/dashboard/plans" className={btnPrimary}>
                Ver planos
              </Link>
            )}
            <button type="button" className={btnGhost} onClick={reset}>
              <RotateCcw className="h-4 w-4" /> Tentar novamente
            </button>
          </div>
        </div>
      )}

      {/* ─── LAUDO ────────────────────────────────────────────────────────── */}
      {stage === "done" && report && (
        <div className="space-y-6">
          {/* id="fd-report" é o alvo do html2canvas em utils/pdfExport.js. */}
          <div id="fd-report" className="space-y-4">
            {/* Capa */}
            <div
              data-report-block
              className="glass rounded-2xl border border-primary/25 bg-gradient-to-b from-primary/[0.07] to-transparent p-8 text-center"
            >
              <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-primary">
                Laudo técnico pericial · Análise forense digital
              </div>
              <h2 className="mt-3 text-2xl font-bold tracking-tight text-foreground">
                Contrato de Crédito Consignado
              </h2>
              <p className="mt-2 text-[12.5px] text-zinc-500">
                Emitido em {report.timestamp} · Horário de Fortaleza (BRT)
              </p>
              <p className="mt-1 text-[12.5px] text-zinc-500">
                {report.file.name} · {report.file.sizeKB} KB ·{" "}
                {report.file.sizeBytes.toLocaleString("pt-BR")} bytes
              </p>
            </div>

            {report.processingNotice && (
              <div
                data-report-block
                className="flex items-start gap-3 rounded-2xl border border-emerald-500/25 bg-emerald-500/[0.06] p-5"
              >
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-500" />
                <div>
                  <div className="text-[13px] font-bold text-emerald-500">OCR local aplicado</div>
                  <div className="mt-1 text-[13px] leading-relaxed text-zinc-300">
                    {report.processingNotice}
                  </div>
                </div>
              </div>
            )}

            {report.extractionError && (
              <div
                data-report-block
                className="flex items-start gap-3 rounded-2xl border border-accent/25 bg-accent/[0.06] p-5"
              >
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-accent" />
                <div>
                  <div className="text-[13px] font-bold text-accent">Extração automática parcial</div>
                  <div className="mt-1 text-[13px] leading-relaxed text-zinc-300">
                    {report.extractionError}
                  </div>
                </div>
              </div>
            )}

            {/* §1 */}
            <Section title="§ 1 · Identificação e integridade criptográfica">
              <Row label="Nome do arquivo" value={report.file.name} />
              <Row
                label="Tamanho"
                value={`${report.file.sizeKB} KB (${report.file.sizeBytes.toLocaleString("pt-BR")} bytes)`}
              />
              <Row label="Tipo de documento" value={report.extracted.tipo_documento} />
              <Row label="Qualidade de OCR / leitura" value={report.extracted.qualidade_ocr} />

              {(() => {
                const declared = report.extracted.assinatura?.hash_documento_assinado
                  ? String(report.extracted.assinatura.hash_documento_assinado).trim()
                  : null;
                const declaredAlgo = report.extracted.assinatura?.algoritmo_hash || null;
                const calc = report.hashes.sha256;
                const cls = classifyHashString(declared);
                const confere =
                  !!declared &&
                  cls?.format === "SHA-256" &&
                  declared.replace(/\s/g, "").toUpperCase() === calc.toUpperCase();

                if (declared) {
                  return (
                    <>
                      <SubHead>Confronto · hash informado × hash encontrado</SubHead>
                      <CompareGrid>
                        <CompareCard
                          tone="warn"
                          title="Hash informado no documento"
                          value={declared}
                        >
                          Algoritmo declarado: {declaredAlgo || "não informado"}
                          <br />
                          Formato detectado: {cls?.format}
                          {cls && !cls.isHash ? " (não é hash criptográfico)" : ""}
                        </CompareCard>
                        <CompareCard tone="info" title="Hash encontrado (calculado)" value={calc}>
                          Algoritmo: SHA-256 (NIST FIPS 180-4)
                          <br />
                          Calculado localmente sobre o arquivo original
                        </CompareCard>
                      </CompareGrid>
                      <div
                        data-report-block
                        className="mt-4 flex flex-wrap items-center justify-between gap-3"
                      >
                        <span className="text-[13px] text-zinc-400">Resultado da comparação</span>
                        <Badge
                          label={confere ? "HASHES CONFEREM" : "DIVERGÊNCIA DETECTADA"}
                          tone={confere ? "ok" : "danger"}
                        />
                      </div>
                      <Note tone={confere ? "ok" : "danger"}>
                        {!cls?.isHash
                          ? `O valor apresentado no documento como hash não corresponde a um hash criptográfico válido. ${cls?.detalhe}. A substituição do hash criptográfico por identificador dessa natureza configura defeito formal do instrumento, pois impede a verificação objetiva de integridade e autenticidade exigida para a assinatura eletrônica, nos termos da MP 2.200-2/2001.`
                          : confere
                          ? "O hash informado no documento confere integralmente com o hash calculado localmente sobre o arquivo. Integridade consistente entre o valor declarado e o conteúdo verificado."
                          : "O hash informado no documento diverge do hash calculado localmente sobre o arquivo. A divergência deve ser interpretada com cautela técnica: em PDFs assinados, o hash de assinatura refere-se ao conteúdo no instante da assinatura e pode não coincidir com o recálculo sobre o arquivo finalizado. Recomenda-se verificação pericial complementar antes de qualquer conclusão sobre adulteração."}
                      </Note>
                    </>
                  );
                }

                return (
                  <>
                    <Row label="SHA-256 (fingerprint)" value={calc} mono />
                    <Note tone="info">
                      O contrato não veio acompanhado de hash informado. Não há, no documento, valor
                      declarado de hash criptográfico disponível para conferência. O hash
                      criptográfico (SHA-256) calculado por este sistema sobre o arquivo original é o
                      indicado acima, e passa a servir como impressão digital de referência do
                      documento para fins de cadeia de custódia.
                    </Note>
                  </>
                );
              })()}

              <Row label="SHA-1 (arquivo)" value={report.hashes.sha1} mono />
            </Section>

            {/* §1.1 */}
            {report.metadata && (
              <Section title="§ 1.1 · Verificação dos metadados internos do PDF">
                <div
                  data-report-block
                  className="flex flex-wrap items-center justify-between gap-3 border-b border-surface-border/60 py-2.5"
                >
                  <span className="text-[13px] text-zinc-400">Resultado da verificação</span>
                  <Badge
                    label={
                      report.metadata.warnings?.length
                        ? `${report.metadata.warnings.length} ALERTA(S)`
                        : "SEM ALERTAS"
                    }
                    tone={report.metadata.warnings?.length ? "warn" : "ok"}
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
                  [
                    "Assinatura digital incorporada",
                    report.metadata.hasEmbeddedSignatures ? "Detectada" : "Não detectada",
                  ],
                ].map(([label, value]) => (
                  <Row key={label} label={label} value={value} />
                ))}
                <Row
                  label="Identificador interno do trailer"
                  value={report.metadata.trailerFingerprint}
                  mono
                />

                {report.metadata.warnings?.length > 0 && (
                  <>
                    <SubHead>Achados da auditoria de metadados</SubHead>
                    {report.metadata.warnings.map((warning, index) => (
                      <Flag key={index} tone="warn">{warning}</Flag>
                    ))}
                  </>
                )}
                <Note>
                  Metadados são campos declarativos e podem ser alterados por editores de PDF. Eles
                  servem como indício técnico e devem ser avaliados em conjunto com os hashes do
                  arquivo, a assinatura digital incorporada e a cadeia de custódia.
                </Note>
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
              ].map(([lbl, val]) => (
                <Row key={lbl} label={lbl} value={val} />
              ))}
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
              ].map(([lbl, val]) => (
                <Row key={lbl} label={lbl} value={val} />
              ))}

              <SubHead>Endereço de referência (ponto de origem das distâncias)</SubHead>
              <Row
                label="Endereço adotado"
                value={report.home.query}
                nullText="Nenhum endereço informado ou extraído"
              />
              <Row label="Origem do endereço" value={report.home.source} />
              {report.home.geo ? (
                <Row
                  label="Coordenadas (residencial · aprox.)"
                  value={`${report.home.geo.lat.toFixed(6)}, ${report.home.geo.lon.toFixed(6)}`}
                  mono
                />
              ) : report.home.query ? (
                <Note tone="warn">
                  Não foi possível geocodificar o endereço residencial informado. As distâncias até
                  este ponto não puderam ser calculadas. Verifique a grafia do endereço e tente
                  novamente, de preferência com cidade e UF.
                </Note>
              ) : null}
            </Section>

            {/* §4 */}
            <Section title="§ 4 · Assinatura eletrônica e cadeia de custódia">
              <div
                data-report-block
                className="flex flex-wrap items-center justify-between gap-3 border-b border-surface-border/60 py-2.5"
              >
                <span className="text-[13px] text-zinc-400">Assinatura presente</span>
                <Badge
                  label={report.extracted.assinatura?.presente ? "CONFIRMADA" : "AUSENTE"}
                  tone={report.extracted.assinatura?.presente ? "ok" : "danger"}
                />
              </div>

              <Note tone="info">
                A validade da assinatura eletrônica não depende de certificação ICP-Brasil. A MP
                2.200-2/2001 (art. 10, §2º) admite outros meios de comprovação de autoria e
                integridade, e a Lei 14.063/2020 reconhece as assinaturas simples, avançada e
                qualificada, todas com validade jurídica. O STJ consolidou esse entendimento no REsp
                2.159.442 (rel. Min. Nancy Andrighi) e o reafirmou no REsp 2.205.708. O ponto
                decisivo não é o selo ICP-Brasil, e sim a completude da cadeia de custódia:
                demonstrar quem assinou, quando, de onde e com qual integridade.
              </Note>

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
              ].map(([lbl, val]) => (
                <Row key={lbl} label={lbl} value={val} />
              ))}

              {report.extracted.assinatura?.metodos_autenticacao?.length > 0 && (
                <Row
                  label="Métodos de autenticação"
                  value={report.extracted.assinatura.metodos_autenticacao.join(" · ")}
                />
              )}
              {report.extracted.assinatura?.hash_documento_assinado && (
                <Row
                  label="Hash do doc. assinado"
                  value={report.extracted.assinatura.hash_documento_assinado}
                  mono
                />
              )}
              {report.extracted.assinatura?.integridade_pos_assinatura !== null &&
                report.extracted.assinatura?.integridade_pos_assinatura !== undefined && (
                  <div
                    data-report-block
                    className="flex flex-wrap items-center justify-between gap-3 border-b border-surface-border/60 py-2.5"
                  >
                    <span className="text-[13px] text-zinc-400">Integridade pós-assinatura</span>
                    <Badge
                      label={
                        report.extracted.assinatura.integridade_pos_assinatura
                          ? "ÍNTEGRO"
                          : "DOCUMENTO ADULTERADO"
                      }
                      tone={report.extracted.assinatura.integridade_pos_assinatura ? "ok" : "danger"}
                    />
                  </div>
                )}
              {report.extracted.assinatura?.observacoes && (
                <Note>{report.extracted.assinatura.observacoes}</Note>
              )}

              {report.cadeiaCustodia?.elementos?.length ? (
                <CadeiaCustodia cadeia={report.cadeiaCustodia} />
              ) : (
                <Note tone="warn">
                  Este laudo foi gerado antes de a cadeia de custódia passar a ser
                  avaliada com fundamento normativo por elemento. Gere uma nova análise
                  para obter o § 4.1 completo.
                </Note>
              )}
            </Section>

            {/* §5 */}
            <Section title="§ 5 · Geolocalização da assinatura · confronto geográfico">
              {report.contractGeo ? (
                <>
                  <SubHead>
                    Confronto · residência do cliente × geolocalização declarada no contrato
                  </SubHead>
                  <CompareGrid>
                    <CompareCard
                      tone="info"
                      title="Residência do cliente (referência)"
                      value={
                        report.home.geo
                          ? `${report.home.geo.lat.toFixed(6)}, ${report.home.geo.lon.toFixed(6)}`
                          : "Não geocodificada"
                      }
                    >
                      {report.home.query || "Endereço não informado"}
                      <br />
                      Origem: {report.home.source || "não disponível"}
                      <br />
                      Precisão: {precisionLabel(report.home.geo)}
                    </CompareCard>
                    <CompareCard
                      tone="warn"
                      title="Geolocalização declarada no contrato"
                      value={`${report.contractGeo.lat.toFixed(7)}, ${report.contractGeo.lon.toFixed(7)}`}
                    >
                      {report.contractGeo.endereco || "Endereço declarado não informado"}
                      <br />
                      Fonte: {report.contractGeo.fonte || "não informada"}
                      {report.contractGeo.precisao ? ` · Precisão: ${report.contractGeo.precisao} m` : ""}
                      {report.contractGeo.geocoded
                        ? " · Coordenada obtida por geocodificação do endereço declarado"
                        : " · Coordenada GPS extraída do log"}
                    </CompareCard>
                  </CompareGrid>

                  {report.contractGeo.dataHora && (
                    <Row label="Data / hora da geolocalização" value={report.contractGeo.dataHora} />
                  )}

                  {isCoarseHome(report.home.geo) && (
                    <Note tone="danger">
                      <b>Atenção:</b> a coordenada da residência foi resolvida apenas em nível de
                      cidade. A distância abaixo é aproximada. Para um laudo definitivo, confirme a
                      coordenada exata da residência no campo abaixo.
                    </Note>
                  )}

                  {/* Correção manual — padrão-ouro forense: coordenada confirmada por humano */}
                  <div className="mt-3 rounded-xl border border-primary/20 bg-primary/[0.04] p-4">
                    <div className="mb-3 flex items-start gap-2.5">
                      <Wand2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                      <p className="text-[12.5px] leading-relaxed text-zinc-400">
                        {report.home.geo?.precision === "manual"
                          ? "Coordenada da residência confirmada pelo operador."
                          : "Confirmar ou corrigir a coordenada da residência (no Google Maps, botão direito no local → clique na coordenada para copiar):"}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        type="text"
                        value={correctCoord}
                        onChange={(e) => setCorrectCoord(e.target.value)}
                        placeholder="Ex.: -5.0951, -42.8100"
                        className={`${inputBase} min-w-[200px] flex-1 py-2`}
                      />
                      <button
                        type="button"
                        className={btnPrimary}
                        onClick={handleGeoCorrect}
                        disabled={correcting}
                      >
                        {correcting && <Loader2 className="h-4 w-4 animate-spin" />}
                        {correcting ? "Aplicando..." : "Aplicar coordenada"}
                      </button>
                    </div>
                  </div>

                  {report.contractGeo.distance !== null && report.contractGeo.distance !== undefined ? (
                    <div data-geo-visual className="mt-4 space-y-3">
                      {/* A classificação vem do servidor (`contractGeo.divergencia`).
                          O `DistanceBanner` usava `riskFromDistance`, calibrada para
                          geolocalização de IP: rotulava 1,47 km como "RISCO BAIXO"
                          logo abaixo do texto que afirma o contrário, e daria o mesmo
                          rótulo a 45 km entre o local declarado e a casa do cliente. */}
                      {report.contractGeo.divergencia && (
                        <div
                          data-report-block
                          className={`rounded-xl border px-5 py-4 ${
                            (TONES[report.contractGeo.divergencia.tom] || TONES.neutral).bg
                          }`}
                          style={{
                            borderColor: `${(TONES[report.contractGeo.divergencia.tom] || TONES.neutral).hex}55`,
                          }}
                        >
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <span className="text-[12px] text-zinc-400">
                              Distância: residência do cliente → local declarado da assinatura
                            </span>
                            <div className="flex items-center gap-2">
                              <span
                                className="text-[17px] font-bold tabular-nums"
                                style={{
                                  color: (TONES[report.contractGeo.divergencia.tom] || TONES.neutral)
                                    .hex,
                                }}
                              >
                                {report.contractGeo.divergencia.km.toFixed(2)} km
                              </span>
                              <Badge
                                label={report.contractGeo.divergencia.rotulo}
                                tone={report.contractGeo.divergencia.tom}
                              />
                            </div>
                          </div>
                          <p className="mt-2 text-[12.5px] leading-relaxed text-zinc-300">
                            {report.contractGeo.divergencia.sintese}
                          </p>
                          {report.contractGeo.divergencia.ressalva && (
                            <p className="mt-1 text-[11.5px] leading-relaxed text-zinc-500">
                              {report.contractGeo.divergencia.ressalva}
                            </p>
                          )}
                        </div>
                      )}
                      {/* Confronto 2 — residência × geolocalização declarada.
                          Ambos os pontos têm precisão métrica, então a escala é
                          local e uma divergência pequena já é significativa. */}
                      <GeoMap
                        from={{
                          ...report.home.geo,
                          label: "R",
                          color: "#3b82f6",
                          titulo: "Residência informada",
                        }}
                        to={{
                          lat: report.contractGeo.lat,
                          lon: report.contractGeo.lon,
                          label: "A",
                          color: "#f59e0b",
                          titulo: "Geolocalização declarada no documento",
                        }}
                        distanceKm={report.contractGeo.distance}
                        riskColor={
                          (TONES[report.contractGeo.divergencia?.tom] || TONES.neutral).hex
                        }
                        legenda={
                          <>
                            <b className="text-foreground">Mapa 2 — residência × local declarado.</b>{" "}
                            <b className="text-primary">R</b> = residência informada ·{" "}
                            <b className="text-accent">A</b> = geolocalização declarada no documento.
                            A linha tracejada é a distância geodésica (Haversine). Ambos os pontos têm
                            precisão métrica, ao contrário do Mapa 1.
                          </>
                        }
                      />
                      <Note>
                        A distância isolada não determina fraude. Deslocamentos compatíveis com a
                        rotina do cliente, como ir da zona rural à capital do estado, podem ser
                        plenamente legítimos. Este resultado deve ser confrontado com a entrevista do
                        cliente, com a data e hora da assinatura e com a localização do
                        correspondente bancário antes de qualquer conclusão sobre irregularidade.
                      </Note>
                    </div>
                  ) : (
                    <Note tone="warn">
                      Há geolocalização declarada no contrato, mas o endereço residencial não pôde
                      ser geocodificado. Informe o endereço residencial do cliente na tela inicial
                      para que a distância seja calculada.
                    </Note>
                  )}
                </>
              ) : (
                <Note>
                  {report.geoDeclaredPresent
                    ? "O documento indica geolocalização da assinatura, mas não foi possível obter coordenadas válidas nem geocodificar o endereço declarado."
                    : "Não foi localizada geolocalização (coordenadas GPS) declarada no log de assinatura deste documento. Nada a confrontar nesta seção."}
                </Note>
              )}
            </Section>

            {/* § 5.3 — mesma numeração do PDF. */}
            <Section
              title={`§ 5.3 · Rastro de conexão · endereços IP (${report.ipAnalysis.length} encontrado(s))`}
            >
              {report.ipAnalysis.length === 0 ? (
                <p className="py-6 text-center text-[13px] text-zinc-500">
                  Nenhum endereço IP identificado no documento analisado.
                </p>
              ) : (
                <>
                  <SubHead>
                    Referência das distâncias:{" "}
                    {report.home.query
                      ? `residência do cliente (${report.home.source})`
                      : "endereço residencial não informado"}
                  </SubHead>
                  {report.contractGeo &&
                    report.ipAnalysis.some((ip) => ip.distanceToSignature != null) && (
                      <Note>
                        Cada IP é confrontado com dois pontos: a residência do cliente e a
                        geolocalização declarada da assinatura. A geolocalização por IP é de nível de
                        operadora (margem de dezenas de quilômetros; VPN/proxy podem distorcê-la),
                        então a divergência entre a origem do IP e o local declarado da assinatura é
                        indício de larga escala — GPS potencialmente forjado ou ato praticado por
                        terceiro — e não uma medida exata.
                      </Note>
                    )}
                  <IpTrace ipAnalysis={report.ipAnalysis} homeGeo={report.home?.geo} />
                </>
              )}
            </Section>

            {/* §6 */}
            <Section
              title="§ 6 · Evidências de irregularidade"
              danger={report.extracted.evidencias_irregularidade?.length > 0}
            >
              {report.extracted.evidencias_irregularidade?.length > 0 ? (
                report.extracted.evidencias_irregularidade.map((ev, i) => (
                  <Flag key={i} tone="danger">{ev}</Flag>
                ))
              ) : (
                <Note>
                  A análise dos elementos extraídos deste documento não identificou evidência
                  autônoma de irregularidade. A ausência de achado nesta seção não convalida o
                  instrumento: as ressalvas dos §§ 4 e 5 subsistem e devem ser lidas em conjunto.
                </Note>
              )}
            </Section>

            {/* §7 */}
            <Section title="§ 7 · Observações periciais complementares">
              <p className="text-[13.5px] leading-relaxed text-zinc-300">
                {report.extracted.observacoes_periciais ||
                  "Não há observação complementar além do que já consta das seções anteriores."}
              </p>
            </Section>

            {/* §8 */}
            <Section title="§ 8 · Fundamentação normativa aplicável">
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
                    <Note tone="info">
                      Achados deste laudo com maior aderência normativa: {destaques.join("; ")}.
                    </Note>
                    {groups.map(([title, entries]) => (
                      <div key={title}>
                        <SubHead>{title}</SubHead>
                        {entries.map(([disp, sint]) => (
                          <Norm key={disp} dispositivo={disp} sintese={sint} />
                        ))}
                      </div>
                    ))}
                    <Note>
                      A fundamentação acima é referencial e deve ser ajustada ao caso concreto e à
                      data da contratação. A indicação dos dispositivos não dispensa a conferência da
                      redação vigente de cada norma no momento do contrato.
                    </Note>
                  </>
                );
              })()}
            </Section>

            {/* Aviso legal */}
            <div
              data-report-block
              className="rounded-2xl border border-surface-border bg-surface/30 p-5 text-[11.5px] leading-relaxed text-zinc-500"
            >
              AVISO LEGAL: Este laudo foi gerado automaticamente pelo sistema ForenseDoc (Ronney
              Menezes Advocacia, OAB/PI 15.508 · OAB/MA 26.102-A) para fins de análise jurídica
              preliminar. Os hashes criptográficos SHA-256 e SHA-1 foram calculados pelo servidor
              sobre o arquivo original recebido (NIST FIPS 180-4). A geolocalização de IPs é
              fornecida por serviço de terceiros (ipapi.co) e possui margem de erro inerente;
              endereços de ISPs e VPNs podem não refletir a localização física real do usuário. A
              geolocalização declarada da assinatura é extraída do próprio documento e a
              geocodificação de endereços usa o serviço OpenStreetMap Nominatim. A fórmula de
              Haversine calcula a distância geodésica sobre a superfície esférica terrestre. A
              distância geográfica, isoladamente, não constitui prova de fraude e deve ser ponderada
              com o contexto fático. Este documento deve ser complementado por análise pericial
              humana qualificada antes de ser utilizado como prova técnica definitiva nos autos.
              Gerado em {report.timestamp}.
            </div>
          </div>

          {/* Ações */}
          <div className="flex flex-wrap justify-center gap-3">
            <button
              type="button"
              className={btnPrimary}
              onClick={handleServerPdf}
              disabled={serverPdfBusy || !report.analysisId}
            >
              {serverPdfBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              {serverPdfBusy ? "Gerando laudo..." : "Baixar laudo (PDF)"}
            </button>
            <button
              type="button"
              className={btnGhost}
              onClick={() => exportReportPDF(setPdfBusy, setPdfDownload)}
              disabled={pdfBusy}
            >
              {pdfBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}
              {pdfBusy ? "Gerando prévia..." : "Prévia visual (navegador)"}
            </button>
            <button type="button" className={btnGhost} onClick={reset} disabled={pdfBusy}>
              <RotateCcw className="h-4 w-4" /> Analisar novo contrato
            </button>
          </div>

          {pdfDownload && (
            <div className="mx-auto w-full max-w-4xl rounded-2xl border border-emerald-500/25 bg-emerald-500/[0.05] p-5">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <FileText className="h-5 w-5 text-emerald-500" />
                  <div>
                    <div className="text-[13px] font-bold uppercase tracking-wider text-emerald-500">
                      PDF pronto para salvar
                    </div>
                    <div className="mt-0.5 text-[12.5px] text-zinc-400">
                      {pdfDownload.filename} · {pdfDownload.sizeKB} KB
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2.5">
                  <a className={btnPrimary} href={pdfDownload.url} download={pdfDownload.filename}>
                    <Download className="h-4 w-4" /> Baixar PDF
                  </a>
                  <a
                    className={btnGhost}
                    href={pdfDownload.url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Abrir PDF
                  </a>
                </div>
              </div>
              <iframe
                title="Prévia do PDF gerado"
                src={pdfDownload.url}
                className="h-[520px] w-full rounded-lg border border-surface-border bg-zinc-100"
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
