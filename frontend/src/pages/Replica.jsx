import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import {
  UploadCloud, Loader2, FileText, Trash2, Scale, AlertTriangle, CheckCircle2, Copy, Download, RotateCcw, X,
} from "lucide-react";

import { api } from "../lib/axios.js";
import { Row, Badge, Section, SubHead, Note } from "../components/UiComponents.jsx";
import { presentReplicaDocument } from "../utils/replicaPresentation.js";

/**
 * Réplica processual (Motor de Réplicas).
 *
 * Três etapas, na ordem em que o advogado trabalha: enviar os autos, conferir os
 * achados (cada um com arquivo, página e trecho) e montar a minuta do cenário
 * escolhido. A minuta só é montada depois da declaração expressa de conferência
 * humana, e sai sempre marcada como não liberada para protocolo.
 */

const EXTENSOES = /\.(pdf|png|jpe?g|txt)$/i;
const MAX_FILES = Number(import.meta.env.VITE_REPLICA_MAX_FILES) || 30;
const MAX_TOTAL_MB = Number(import.meta.env.VITE_REPLICA_MAX_TOTAL_MB) || 80;
const POLL_INICIAL_MS = 2500;
const POLL_MAXIMO_MS = 6000;
const POLL_PRAZO_MS = 15 * 60 * 1000;

const TOM_DO_SINAL = { critico: "danger", alto: "warn", medio: "info", nota: "neutral" };
const ROTULO_DO_SINAL = { critico: "CRÍTICO", alto: "ALTO", medio: "MÉDIO", nota: "NOTA" };
const TOM_DA_CONFIANCA = { alta: "ok", media: "warn", baixa: "danger" };

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const partes = [];
  for (let i = 0; i < bytes.length; i += 0x8000) {
    partes.push(String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)));
  }
  return btoa(partes.join(""));
}

const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
const dataHora = (iso) => (iso ? new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Fortaleza" }) : "—");

function textoDaMinuta(draft) {
  return (draft?.paragraphs || []).map((p) => p.t).join("\n\n");
}

/** .doc em HTML: abre no Word e no LibreOffice sem dependência no navegador. */
function baixarDoc(draft, nome) {
  const escapar = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const corpo = (draft.paragraphs || [])
    .map((p) =>
      p.tipo === "capitulo" || p.tipo === "rotulo"
        ? `<h3 style="font-family:'Times New Roman';font-size:12pt;margin-top:18pt">${escapar(p.t)}</h3>`
        : `<p style="font-family:'Times New Roman';font-size:12pt;text-align:justify;line-height:1.5">${escapar(p.t)}</p>`
    )
    .join("");
  const html = `<html><head><meta charset="utf-8"><title>${escapar(nome)}</title></head><body>${corpo}</body></html>`;
  const url = URL.createObjectURL(new Blob(["﻿", html], { type: "application/msword" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `${nome}.doc`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function Sinal({ sinal }) {
  return (
    <div data-report-block className="rounded-xl border border-surface-border bg-surface/30 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[11px] font-bold text-zinc-500">{sinal.codigo}</span>
          <span className="text-[13px] font-bold text-foreground">{sinal.titulo}</span>
        </div>
        <Badge label={ROTULO_DO_SINAL[sinal.gravidade] || sinal.gravidade} tone={TOM_DO_SINAL[sinal.gravidade] || "neutral"} />
      </div>
      {sinal.detalhe && <p className="mt-1.5 text-[12.5px] leading-relaxed text-zinc-300">{sinal.detalhe}</p>}
      {(sinal.arquivo || sinal.dado) && (
        <p className="mt-1 text-[11.5px] text-primary/80">
          {sinal.arquivo ? `${sinal.arquivo} · ` : ""}
          <span className="italic text-zinc-500">{sinal.dado}</span>
        </p>
      )}
      {sinal.pedido && (
        <p className="mt-1 text-[11.5px] text-zinc-400">
          <b>Pedido cabível:</b> {sinal.pedido}
        </p>
      )}
    </div>
  );
}

function Evidencia({ ev }) {
  if (!ev) return null;
  return (
    <p className="mt-1 text-[11.5px] leading-relaxed text-zinc-500">
      <span className="text-primary/80">
        {ev.arquivo}
        {ev.pagina_origem || ev.pagina ? ` · pág. ${ev.pagina_origem || ev.pagina}` : ""}
        {ev.fonte === "ocr" ? " · OCR" : ""}
      </span>{" "}
      <span className="italic">“{ev.trecho}”</span>
    </p>
  );
}

export default function Replica() {
  const [recentes, setRecentes] = useState([]);
  const [retencaoHoras, setRetencaoHoras] = useState(null);
  const [arquivos, setArquivos] = useState([]);
  const [ocr, setOcr] = useState(true);
  const [enviando, setEnviando] = useState(false);
  const [replica, setReplica] = useState(null);
  const [cenarios, setCenarios] = useState([]);
  const [letra, setLetra] = useState("");
  const [conferido, setConferido] = useState(false);
  const [dadosDoCaso, setDadosDoCaso] = useState({});
  const [montando, setMontando] = useState(false);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef(null);
  const execucaoRef = useRef(0);
  const montadoRef = useRef(true);
  // Volta a `true` na montagem: o StrictMode desmonta e remonta em desenvolvimento.
  useEffect(() => {
    montadoRef.current = true;
    return () => { montadoRef.current = false; };
  }, []);

  const carregarRecentes = useCallback(async () => {
    try {
      const { data } = await api.get("/replicas");
      setRecentes(data.replicas || []);
      setRetencaoHoras(data.retentionHours || null);
    } catch {
      // A lista é auxiliar: falha aqui não impede a réplica.
    }
  }, []);

  useEffect(() => {
    carregarRecentes();
    api.get("/replicas/scenarios").then(({ data }) => setCenarios(data.scenarios || [])).catch(() => {});
  }, [carregarRecentes]);

  const aplicarRegistro = useCallback((registro) => {
    setReplica(registro);
    if (registro?.status === "COMPLETED") {
      setLetra((atual) => atual || registro.draft?.letter || registro.result?.candidates?.[0]?.letra || "");
      setDadosDoCaso((atual) => (Object.keys(atual).length ? atual : { ...(registro.result?.analysis?.dados || {}) }));
    }
  }, []);

  const acompanhar = useCallback(
    async (id) => {
      const execucao = ++execucaoRef.current;
      const desatualizado = () => execucao !== execucaoRef.current || !montadoRef.current;
      const limite = Date.now() + POLL_PRAZO_MS;
      let intervalo = POLL_INICIAL_MS;
      while (Date.now() < limite) {
        if (desatualizado()) return;
        try {
          const { data } = await api.get(`/replicas/${id}`);
          if (desatualizado()) return;
          aplicarRegistro(data.replica);
          if (data.replica.status !== "PROCESSING") {
            carregarRecentes();
            return;
          }
        } catch (err) {
          if (err.response?.status === 404) {
            toast.error("A réplica expirou ou foi apagada.");
            setReplica(null);
            return;
          }
        }
        await new Promise((r) => setTimeout(r, intervalo));
        intervalo = Math.min(POLL_MAXIMO_MS, Math.round(intervalo * 1.25));
      }
      toast.error("A leitura dos autos está demorando mais que o esperado. Consulte a réplica na lista em instantes.");
    },
    [aplicarRegistro, carregarRecentes]
  );

  const adicionar = (lista) => {
    const novos = Array.from(lista || []).filter((f) => EXTENSOES.test(f.name));
    const recusados = Array.from(lista || []).length - novos.length;
    if (recusados) toast.error("Só são aceitos PDF, PNG, JPG e TXT.");
    setArquivos((atual) => {
      const chaves = new Set(atual.map((f) => `${f.name}-${f.size}`));
      return [...atual, ...novos.filter((f) => !chaves.has(`${f.name}-${f.size}`))].slice(0, MAX_FILES);
    });
  };

  const totalBytes = arquivos.reduce((soma, f) => soma + f.size, 0);
  const excedeTotal = totalBytes > MAX_TOTAL_MB * 1024 * 1024;

  const enviar = async () => {
    if (!arquivos.length || excedeTotal) return;
    setEnviando(true);
    try {
      const documents = [];
      for (const file of arquivos) {
        documents.push({ name: file.name, base64: arrayBufferToBase64(await file.arrayBuffer()) });
      }
      const { data } = await api.post("/replicas", { documents, ocr });
      setArquivos([]);
      setLetra("");
      setConferido(false);
      setDadosDoCaso({});
      setReplica({ id: data.replicaId, status: "PROCESSING", createdAt: new Date().toISOString(), files: [] });
      carregarRecentes();
      acompanhar(data.replicaId);
    } catch (err) {
      const d = err.response?.data;
      toast.error(d?.detalhes?.length ? `${d.error} ${d.detalhes.join(" ")}` : d?.error || "Não foi possível enviar os autos.");
    } finally {
      setEnviando(false);
    }
  };

  const abrir = async (id) => {
    setLetra("");
    setConferido(false);
    setDadosDoCaso({});
    try {
      const { data } = await api.get(`/replicas/${id}`);
      aplicarRegistro(data.replica);
      if (data.replica.status === "PROCESSING") acompanhar(id);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      toast.error(err.response?.data?.error || "Não foi possível abrir a réplica.");
      carregarRecentes();
    }
  };

  const apagar = async (id) => {
    if (!window.confirm("Apagar esta réplica e todos os dados da leitura dos autos? A ação não pode ser desfeita.")) return;
    try {
      await api.delete(`/replicas/${id}`);
      if (replica?.id === id) {
        execucaoRef.current += 1;
        setReplica(null);
      }
      toast.success("Réplica apagada.");
      carregarRecentes();
    } catch (err) {
      toast.error(err.response?.data?.error || "Não foi possível apagar.");
    }
  };

  const montarMinuta = async () => {
    if (!replica?.id || !letra || !conferido) return;
    setMontando(true);
    try {
      const { data } = await api.post(`/replicas/${replica.id}/draft`, {
        letter: letra,
        reviewConfirmed: true,
        caseData: dadosDoCaso,
      });
      setReplica((atual) => ({ ...atual, draft: data.draft }));
      carregarRecentes();
      toast.success("Minuta montada para revisão.");
    } catch (err) {
      toast.error(err.response?.data?.error || "Não foi possível montar a minuta.");
    } finally {
      setMontando(false);
    }
  };

  const resultado = replica?.status === "COMPLETED" ? replica.result : null;
  const contagem = useMemo(
    () => (resultado?.signals || []).reduce((acc, s) => ({ ...acc, [s.gravidade]: (acc[s.gravidade] || 0) + 1 }), {}),
    [resultado]
  );
  const candidatas = new Set((resultado?.candidates || []).map((c) => c.letra));
  const tituloDoCenario = (l) => cenarios.find((c) => c.letra === l)?.titulo || "";

  const btnPrimary =
    "inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-white shadow-lg shadow-primary/20 transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50";
  const btnGhost =
    "inline-flex items-center justify-center gap-2 rounded-lg border border-surface-border bg-secondary px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-secondary-hover disabled:cursor-not-allowed disabled:opacity-50";
  const inputBase =
    "block w-full rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm text-foreground placeholder-zinc-500 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-primary";

  return (
    <div className="animate-fade-in space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Réplica processual</h1>
          <p className="text-zinc-400">
            Cotejo da inicial, da contestação e dos documentos com evidência rastreável, e minuta revisável pelo
            Caderno de Réplicas.
          </p>
        </div>
        {replica && (
          <button type="button" className={btnGhost} onClick={() => { execucaoRef.current += 1; setReplica(null); }}>
            <RotateCcw className="h-4 w-4" /> Nova réplica
          </button>
        )}
      </div>

      {/* ─── 1. Envio dos autos ─────────────────────────────────────────── */}
      {!replica && (
        <div className="mx-auto w-full max-w-3xl space-y-4">
          <button
            type="button"
            onDrop={(e) => { e.preventDefault(); setDragging(false); adicionar(e.dataTransfer.files); }}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onClick={() => inputRef.current?.click()}
            className={`flex w-full flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-12 text-center transition-colors ${
              dragging ? "border-primary bg-primary/5" : "border-surface-border bg-surface/30 hover:border-primary/50 hover:bg-surface/50"
            }`}
          >
            <div className="mb-4 rounded-full border border-primary/20 bg-primary/10 p-4">
              <UploadCloud className="h-7 w-7 text-primary" />
            </div>
            <span className="text-base font-bold text-foreground">Anexar os autos</span>
            <span className="mt-1 text-sm text-zinc-400">
              Petição inicial, contestação e documentos juntados. O caderno completo do PJe também é aceito.
            </span>
            <span className="mt-4 text-[11px] font-medium uppercase tracking-wider text-zinc-600">
              PDF · PNG · JPG · TXT · até {MAX_FILES} arquivos e {MAX_TOTAL_MB} MB no total
            </span>
          </button>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept=".pdf,.png,.jpg,.jpeg,.txt"
            className="hidden"
            onChange={(e) => { adicionar(e.target.files); e.target.value = ""; }}
          />

          {arquivos.length > 0 && (
            <div className="glass rounded-2xl border border-surface-border p-4">
              <div className="space-y-1.5">
                {arquivos.map((f) => (
                  <div key={`${f.name}-${f.size}`} className="flex items-center justify-between gap-3 rounded-lg bg-surface/40 px-3 py-2">
                    <span className="flex min-w-0 items-center gap-2 text-[13px] text-zinc-300">
                      <FileText className="h-4 w-4 shrink-0 text-primary" />
                      <span className="truncate">{f.name}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-3 text-[12px] text-zinc-500">
                      {mb(f.size)}
                      <button
                        type="button"
                        aria-label={`Remover ${f.name}`}
                        onClick={() => setArquivos((atual) => atual.filter((x) => x !== f))}
                        className="text-zinc-500 hover:text-red-400"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </span>
                  </div>
                ))}
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                <label className="flex items-center gap-2 text-[12.5px] text-zinc-400">
                  <input type="checkbox" checked={ocr} onChange={(e) => setOcr(e.target.checked)} />
                  Aplicar OCR em documentos escaneados
                </label>
                <span className={`text-[12px] ${excedeTotal ? "text-red-400" : "text-zinc-500"}`}>
                  {arquivos.length} arquivo(s) · {mb(totalBytes)}
                </span>
              </div>
              <div className="mt-4 flex justify-end">
                <button type="button" className={btnPrimary} disabled={enviando || excedeTotal} onClick={enviar}>
                  {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Scale className="h-4 w-4" />}
                  {enviando ? "Enviando autos..." : "Analisar processo"}
                </button>
              </div>
            </div>
          )}

          <Note tone="info">
            Os originais não são alterados. As cópias enviadas são apagadas ao fim da leitura; ficam guardados apenas
            os achados, os trechos de evidência e o SHA-256 de cada documento
            {retencaoHoras ? `, por até ${Math.round(retencaoHoras / 24)} dia(s)` : ""}. A réplica não consome crédito.
          </Note>

          {recentes.length > 0 && (
            <Section title="Réplicas recentes">
              {recentes.map((r) => (
                <div
                  key={r.id}
                  className="flex flex-wrap items-center justify-between gap-3 border-b border-surface-border/60 py-2.5 last:border-b-0"
                >
                  <button type="button" onClick={() => abrir(r.id)} className="min-w-0 text-left">
                    <span className="block truncate text-[13px] text-foreground hover:text-primary">
                      {(r.files || []).map((f) => f.name).join(", ") || r.id}
                    </span>
                    <span className="text-[11.5px] text-zinc-500">
                      {dataHora(r.createdAt)}
                      {r.signals != null ? ` · ${r.signals} achado(s)` : ""}
                      {r.candidates?.length ? ` · cenário(s) ${r.candidates.join(", ")}` : ""}
                      {r.hasDraft ? " · minuta montada" : ""}
                    </span>
                  </button>
                  <span className="flex items-center gap-2">
                    <Badge
                      label={r.status === "COMPLETED" ? "CONCLUÍDA" : r.status === "ERROR" ? "ERRO" : "PROCESSANDO"}
                      tone={r.status === "COMPLETED" ? "ok" : r.status === "ERROR" ? "danger" : "info"}
                    />
                    <button type="button" aria-label="Apagar réplica" onClick={() => apagar(r.id)} className="text-zinc-500 hover:text-red-400">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </span>
                </div>
              ))}
            </Section>
          )}
        </div>
      )}

      {/* ─── Processando / erro ─────────────────────────────────────────── */}
      {replica?.status === "PROCESSING" && (
        <div className="glass mx-auto mt-6 w-full max-w-md rounded-2xl border border-surface-border p-10 text-center">
          <Loader2 className="mx-auto mb-6 h-12 w-12 animate-spin text-primary" />
          <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-zinc-400">Lendo e cruzando os autos</div>
          <p className="text-sm text-zinc-400">
            Classificação das peças, OCR quando necessário e cotejo com o Caderno de Réplicas. Processos longos levam
            alguns minutos; você pode sair desta tela e voltar pela lista de réplicas recentes.
          </p>
        </div>
      )}

      {replica?.status === "ERROR" && (
        <div className="glass mx-auto mt-6 w-full max-w-md rounded-2xl border border-surface-border p-8 text-center">
          <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full border border-red-500/20 bg-red-500/10">
            <AlertTriangle className="h-7 w-7 text-red-500" />
          </div>
          <h2 className="mb-2 text-xl font-bold text-foreground">Não foi possível ler os autos</h2>
          <p className="text-sm leading-relaxed text-zinc-400">{replica.error}</p>
        </div>
      )}

      {/* ─── 2. Resultado ───────────────────────────────────────────────── */}
      {resultado && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              ["documentos", resultado.analysis?.documentos?.length ?? 0],
              ["achados", resultado.signals?.length ?? 0],
              ["críticos", contagem.critico || 0],
              ["baixa confiança", resultado.review?.lowConfidenceFields?.length ?? 0],
            ].map(([rotulo, valor]) => (
              <div key={rotulo} className="glass rounded-xl border border-surface-border px-3 py-4 text-center">
                <div className="text-2xl font-bold tabular-nums text-primary">{valor}</div>
                <div className="text-xs font-medium text-zinc-400">{rotulo}</div>
              </div>
            ))}
          </div>

          <Section title="1 · Documentos classificados">
            {(resultado.analysis?.documentos || []).map((doc) => {
              const view = presentReplicaDocument(doc, resultado.custody);
              return (
                <div key={`${doc.nome}-${doc.sha256}`} className="border-b border-surface-border/60 py-2.5 last:border-b-0">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[13px] font-medium text-foreground">{doc.nome}</span>
                    <span className="flex items-center gap-2">
                      {view.derived && <Badge label="derivado" tone="info" />}
                      <Badge label={doc.tipo || "não classificado"} tone="neutral" />
                    </span>
                  </div>
                  <p className="mt-1 text-[11.5px] text-zinc-500">
                    {doc.paginas} pág. · {view.origin}
                    {view.pageLabel ? ` · ${view.pageLabel}` : ""}
                    {doc.ocr ? ` · ${doc.ocr} pág. por OCR` : ""}
                  </p>
                  <p className="font-mono text-[11px] text-zinc-600">
                    {view.digestLabel}: {view.digest}
                    {view.sourceDigest ? ` · hash do arquivo enviado: ${view.sourceDigest}` : ""}
                  </p>
                </div>
              );
            })}
            {resultado.nativeDocumentSelection?.selected && (
              <Note tone="info">
                Instrumento bancário identificado: <b>{resultado.nativeDocumentSelection.selected.originalName}</b>.
              </Note>
            )}
          </Section>

          {resultado.suppressedChecks?.length > 0 && (
            <Section title="Verificações não executadas nesta modalidade de leitura">
              <Note>
                Estes itens não são irregularidades encontradas. Eles exigem o arquivo bancário nativo para uma
                conclusão técnica.
              </Note>
              {resultado.suppressedChecks.map((c) => (
                <Row key={c.codigo} label={`${c.codigo} · ${c.titulo}`} value={(c.arquivos || []).join(", ")} />
              ))}
            </Section>
          )}

          <Section title={`2 · Achados para conferência (${resultado.signals?.length || 0})`}>
            <Note tone="warn">
              “Não localizado” significa ponto a reler; não equivale automaticamente a silêncio ou ausência jurídica.
            </Note>
            <div className="mt-3 space-y-2.5">
              {(resultado.signals || []).map((s, i) => (
                <Sinal key={`${s.codigo}-${i}`} sinal={s} />
              ))}
            </div>
          </Section>

          <Section title="3 · Leitura dos autos">
            {Object.entries(resultado.analysis?.achados || {}).map(([chave, item]) => (
              <div key={chave} className="border-b border-surface-border/60 py-2.5 last:border-b-0">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[13px] text-zinc-400">{item.campo || chave}</span>
                  <span className="flex items-center gap-2">
                    <span className="text-[13px] font-medium text-foreground">{String(item.valor ?? "indeterminado")}</span>
                    {item.confianca && <Badge label={item.confianca} tone={TOM_DA_CONFIANCA[item.confianca] || "neutral"} />}
                  </span>
                </div>
                {item.nota && <p className="mt-1 text-[12px] text-zinc-500">{item.nota}</p>}
                {(item.evidencias || []).slice(0, 2).map((ev, i) => (
                  <Evidencia key={i} ev={ev} />
                ))}
              </div>
            ))}
            {resultado.analysis?.preliminares?.length > 0 && (
              <>
                <SubHead>Preliminares suscitadas na contestação</SubHead>
                {resultado.analysis.preliminares.map((p, i) => (
                  <div key={`${p.cod}-${i}`} className="border-b border-surface-border/60 py-2 last:border-b-0">
                    <span className="font-mono text-[12px] text-foreground">{p.cod}</span>
                    <Evidencia ev={p.evidencia} />
                  </div>
                ))}
              </>
            )}
            {(resultado.analysis?.avisos || []).map((aviso, i) => (
              <Note key={i} tone="warn">{typeof aviso === "string" ? aviso : JSON.stringify(aviso)}</Note>
            ))}
          </Section>

          {/* ─── 3. Cenário, revisão e minuta ─────────────────────────────── */}
          <Section title="4 · Cenário e revisão humana">
            {resultado.candidates?.length ? (
              <div className="space-y-2">
                {resultado.candidates.map((c) => (
                  <button
                    key={c.letra}
                    type="button"
                    onClick={() => setLetra(c.letra)}
                    className={`flex w-full gap-4 rounded-xl border px-4 py-3 text-left transition-colors ${
                      letra === c.letra ? "border-primary bg-primary/10" : "border-surface-border bg-surface/30 hover:border-primary/40"
                    }`}
                  >
                    <span className="text-2xl font-bold text-primary">{c.letra}</span>
                    <span>
                      <span className="block text-[13px] font-medium text-foreground">{tituloDoCenario(c.letra)}</span>
                      <span className="block text-[12.5px] text-zinc-400">{c.motivo}</span>
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <Note tone="warn">
                Nenhum cenário foi indicado automaticamente. Revise os achados e escolha o cenário abaixo.
              </Note>
            )}

            {cenarios.length > 0 && (
              <div className="mt-4">
                <label className="mb-1 block text-[12.5px] text-zinc-400">Cenário do Caderno de Réplicas</label>
                <select className={inputBase} value={letra} onChange={(e) => setLetra(e.target.value)}>
                  <option value="">Selecione</option>
                  {cenarios.map((c) => (
                    <option key={c.letra} value={c.letra}>
                      {c.letra} · {c.titulo}
                      {candidatas.has(c.letra) ? " (indicado)" : ""}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {Object.keys(dadosDoCaso).length > 0 && (
              <>
                <SubHead>Dados do caso usados na minuta</SubHead>
                <div className="grid gap-3 md:grid-cols-2">
                  {Object.entries(dadosDoCaso).map(([chave, valor]) => (
                    <label key={chave} className="block">
                      <span className="mb-1 block text-[12px] text-zinc-500">{chave}</span>
                      <input
                        className={inputBase}
                        value={valor ?? ""}
                        onChange={(e) => setDadosDoCaso((atual) => ({ ...atual, [chave]: e.target.value }))}
                      />
                    </label>
                  ))}
                </div>
              </>
            )}

            <ul className="mt-4 list-disc space-y-1 pl-5 text-[12.5px] text-zinc-400">
              {(resultado.review?.checklist || []).map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            <label className="mt-4 flex items-start gap-2 rounded-lg border border-surface-border bg-surface/30 p-3 text-[13px] text-zinc-300">
              <input type="checkbox" className="mt-1" checked={conferido} onChange={(e) => setConferido(e.target.checked)} />
              Conferi as evidências nos documentos e assumo a seleção do cenário.
            </label>
            <div className="mt-4 flex justify-end">
              <button type="button" className={btnPrimary} disabled={!conferido || !letra || montando} onClick={montarMinuta}>
                {montando ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                {montando ? "Montando..." : "Montar minuta revisável"}
              </button>
            </div>
          </Section>

          {replica.draft && (
            <Section title={`5 · Minuta · cenário ${replica.draft.letter}`}>
              <Note tone="warn">
                {replica.draft.warning} Pendências entre colchetes: {replica.draft.pendingPlaceholders}.
              </Note>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  className={btnGhost}
                  onClick={() =>
                    navigator.clipboard
                      .writeText(textoDaMinuta(replica.draft))
                      .then(() => toast.success("Minuta copiada."))
                      .catch(() => toast.error("Não foi possível copiar."))
                  }
                >
                  <Copy className="h-4 w-4" /> Copiar texto
                </button>
                <button
                  type="button"
                  className={btnGhost}
                  onClick={() => baixarDoc(replica.draft, `replica-cenario-${replica.draft.letter}`)}
                >
                  <Download className="h-4 w-4" /> Baixar .doc
                </button>
              </div>
              <article className="mt-4 space-y-3 rounded-xl border border-surface-border bg-surface/20 p-6 font-serif">
                {(replica.draft.paragraphs || []).map((p, i) =>
                  p.tipo === "capitulo" || p.tipo === "rotulo" ? (
                    <h3 key={i} className="pt-3 text-[14px] font-bold text-foreground">
                      {p.t}
                    </h3>
                  ) : (
                    <p key={i} className="text-justify text-[13.5px] leading-relaxed text-zinc-300">
                      {p.t}
                    </p>
                  )
                )}
              </article>
            </Section>
          )}
        </div>
      )}
    </div>
  );
}
