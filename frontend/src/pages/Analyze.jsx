import { useState, useRef, useCallback, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  UploadCloud, Loader2, AlertTriangle, ShieldCheck, MapPin, Fingerprint, Ruler, RotateCcw,
} from "lucide-react";

import { api } from "../lib/axios.js";
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


// Polling do job assíncrono (Módulo 4) — para assim que sair de PROCESSING.
/**
 * `isCancelled` interrompe o polling quando o usuário abandona a análise.
 *
 * Sem isso, sair da tela ou clicar em "Analisar novo contrato" deixava o laço
 * rodando por até 5 minutos — 150 requisições inúteis — e, ao terminar, ele
 * ainda escrevia o resultado no estado: o laudo de uma análise abandonada
 * aparecia sobre a tela que o usuário tinha acabado de abrir.
 */
/*
 * ─── O intervalo cresce com a espera ─────────────────────────────────────────
 *
 * Era fixo em 2 segundos, ou seja, 30 requisições por minuto POR ANÁLISE em
 * andamento. Com a concorrência agora vindo do plano, oito usuários analisando ao
 * mesmo tempo geravam cerca de 248 req/min de um tenant só, o suficiente para
 * bater no limite e o cliente ver 429 no uso normal.
 *
 * O intervalo curto só é útil no começo: um PDF digital termina em menos de um
 * segundo, e é aí que a resposta rápida importa para a percepção de velocidade.
 * Depois de alguns segundos, o que resta é um documento escaneado em OCR, que vai
 * levar dezenas de segundos, e verificar a cada 2 segundos não adianta nada.
 *
 * Numa análise de 60 segundos: 30 requisições antes, 17 agora. O limite é por
 * TEMPO decorrido e não por número de tentativas, senão aumentar o intervalo
 * encurtaria o prazo total.
 */
const POLL_INICIAL_MS = 2000;
const POLL_MAXIMO_MS = 5000;
const POLL_CRESCIMENTO = 1.25;
const POLL_PRAZO_MS = 5 * 60 * 1000;

async function pollAnalysisStatus(analysisId, onProgress, isCancelled) {
  const limite = Date.now() + POLL_PRAZO_MS;
  let intervalo = POLL_INICIAL_MS;
  let tentativa = 0;

  while (Date.now() < limite) {
    if (isCancelled()) return null;
    const { data } = await api.get(`/analyses/${analysisId}/status`);
    if (data.status !== "PROCESSING") return data.status;

    onProgress(Math.min(30 + tentativa, 45));
    tentativa++;

    await new Promise((resolve) => setTimeout(resolve, intervalo));
    intervalo = Math.min(POLL_MAXIMO_MS, Math.round(intervalo * POLL_CRESCIMENTO));
  }

  throw new Error("Tempo limite excedido aguardando o processamento da análise.");
}

export default function Analyze() {
  const [stage, setStage] = useState("idle");
  const [progress, setProgress] = useState({ label: "", pct: 0 });
  const [error, setError] = useState("");
  const [noCredits, setNoCredits] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [homeAddr, setHomeAddr] = useState("");
  const [homeCoordInput, setHomeCoordInput] = useState("");
  // Referência manual fica recolhida: o padrão é o endereço do próprio
  // instrumento. Um endereço digitado por engano (o do escritório, no dossiê
  // homologado) levou 2.111 km e um quesito errado ao laudo.
  const [mostrarReferencia, setMostrarReferencia] = useState(false);
  const [enderecoContestado, setEnderecoContestado] = useState(false);
  const [justificativaContestacao, setJustificativaContestacao] = useState("");
  const fileRef = useRef();
  const navigate = useNavigate();

  /*
   * Identifica a análise vigente. Cada `analyze()` incrementa o contador, e o
   * polling só escreve no estado se o token dele ainda for o atual. É o que
   * impede uma análise abandonada (reset, ou desmontagem da tela) de sobrescrever
   * a interface minutos depois.
   */
  const runIdRef = useRef(0);
  const mountedRef = useRef(true);
  /*
   * A marca precisa voltar a `true` na montagem, e não só cair na desmontagem.
   * Em desenvolvimento o StrictMode monta, desmonta e remonta o componente: com
   * a versão anterior a ref ficava `false` para sempre, o polling se considerava
   * abandonado já na primeira volta e a tela parava em "Extraindo dados" mesmo
   * com o laudo concluído.
   */
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

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

    if (enderecoContestado && justificativaContestacao.trim().length < 15) {
      setError("Para declarar contestado o endereço do instrumento, escreva a justificativa (pelo menos 15 caracteres). Ela é impressa no laudo.");
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

      setProgress({ label: homeAddr?.trim() ? "Lendo documento e conferindo a referência residencial..." : "Enviando documento para o motor de análise...", pct: 18 });
      // Todo o processamento pesado — extração, hashes do arquivo e confronto
      // geográfico (§5) — roda no servidor e fica persistido, para o laudo ser
      // reproduzível. O cliente apenas envia o PDF e renderiza o resultado.
      const coord = parseLatLon(homeCoordInput);
      const { data: startData } = await api.post("/analyze", {
        pdfBase64: base64,
        filename: file.name,
        homeAddress: (homeAddr || "").trim(),
        ...(coord ? { homeLat: coord.lat, homeLon: coord.lon } : {}),
        ...(enderecoContestado
          ? { homeAddressContested: true, homeAddressJustification: justificativaContestacao.trim() }
          : {}),
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

      useAuthStore.getState().fetchBalance();
      setProgress({ label: "Concluído", pct: 100 });
      // O laudo vive numa página própria, a mesma que o histórico abre: uma
      // implementação só para a tela, a revisão e o PDF.
      navigate(`/dashboard/laudo/${startData.analysisId}`);
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
  }, [homeAddr, homeCoordInput, enderecoContestado, justificativaContestacao, navigate]);

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
    setError("");
    setNoCredits(false);
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
          {!mostrarReferencia ? (
            <div className="glass flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-surface-border p-5">
              <p className="max-w-xl text-xs leading-relaxed text-zinc-500">
                As distâncias do laudo usam o endereço do próprio contrato. Informe uma referência
                manual só se o instrumento não trouxer cidade e CEP do contratante, ou se o endereço
                do contrato for justamente o dado contestado.
              </p>
              <button
                type="button"
                onClick={() => setMostrarReferencia(true)}
                className="rounded-lg border border-surface-border bg-secondary px-4 py-2 text-xs font-medium text-foreground hover:bg-secondary-hover"
              >
                Informar referência manual
              </button>
            </div>
          ) : (
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
                Ponto de referência de todas as comparações de distância. Antes de usá-lo, o sistema
                confere cidade, UF e CEP do instrumento: em outra UF, ou a mais de 100 km do município
                do contrato, o confronto é recusado e o laudo registra o conflito.
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

            <div className="rounded-lg border border-amber-500/25 bg-amber-500/[0.04] p-4">
              <label className="flex items-start gap-2.5 text-sm text-zinc-300">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={enderecoContestado}
                  onChange={(e) => setEnderecoContestado(e.target.checked)}
                />
                <span>
                  O endereço registrado no instrumento é contestado
                  <span className="mt-1 block text-xs leading-relaxed text-zinc-500">
                    Marque só quando o endereço do contrato for o dado impugnado. Com a marcação, uma
                    referência em conflito com o instrumento é usada, e a justificativa sai impressa
                    no laudo ao lado das distâncias.
                  </span>
                </span>
              </label>
              {enderecoContestado && (
                <textarea
                  value={justificativaContestacao}
                  onChange={(e) => setJustificativaContestacao(e.target.value)}
                  placeholder="Ex.: o cliente reside em Pedro II/PI desde 2019, conforme comprovante de residência juntado; o endereço do contrato foi preenchido pelo correspondente."
                  rows={3}
                  maxLength={500}
                  className={`${inputBase} mt-3`}
                />
              )}
            </div>
          </div>
          )}

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

    </div>
  );
}
