import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import toast from "react-hot-toast";
import { Loader2, Download, FileSearch, Wand2, FileText, AlertTriangle } from "lucide-react";

import { api } from "../lib/axios.js";
import RevisaoCampos from "../components/report/RevisaoCampos.jsx";
import ConfrontoProcesso from "../components/report/ConfrontoProcesso.jsx";
import LaudoForense from "../laudo/LaudoForense.jsx";
import { montarRelatorio } from "../laudo/montarRelatorio.js";
import { exportarLaudoPdf } from "../laudo/exportarLaudoPdf.js";
import { parseLatLon } from "./Analyze.jsx";

/**
 * Laudo técnico pericial de uma análise concluída.
 *
 * Acima do documento ficam as ferramentas do SaaS (revisão de campos, coordenada
 * confirmada pelo operador, confronto com o processo), fora da captura do PDF.
 * O documento é o laudo do motor de geração, renderizado a partir do resultado
 * persistido, e é exatamente ele que o botão de PDF exporta.
 */
export default function Laudo() {
  const { id } = useParams();
  const [analise, setAnalise] = useState(null);
  const [erro, setErro] = useState("");
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfDownload, setPdfDownload] = useState(null);
  const [coordenada, setCoordenada] = useState("");
  const [corrigindo, setCorrigindo] = useState(false);

  const carregar = useCallback(async () => {
    try {
      const { data } = await api.get(`/analyses/${id}/result`);
      setAnalise({ result: data.result });
      setErro("");
    } catch (err) {
      setErro(
        err.response?.status === 409
          ? "A análise ainda não foi concluída. Aguarde e recarregue a página."
          : err.response?.data?.error || "Não foi possível carregar o laudo."
      );
    }
  }, [id]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  // Libera a URL do PDF gerado quando ele é substituído ou a tela é fechada.
  useEffect(() => () => { if (pdfDownload?.url) URL.revokeObjectURL(pdfDownload.url); }, [pdfDownload]);

  const report = useMemo(
    () => (analise?.result ? montarRelatorio({ analysisId: id, result: analise.result }) : null),
    [analise, id]
  );

  const atualizarResultado = (novo) => setAnalise((atual) => ({ result: { ...atual.result, ...novo } }));

  const aplicarCoordenada = async () => {
    const coord = parseLatLon(coordenada);
    if (!coord) {
      toast.error("Coordenada inválida. Use o formato: latitude, longitude (ex.: -5.0951, -42.8100).");
      return;
    }
    setCorrigindo(true);
    try {
      const { data } = await api.patch(`/analyses/${id}/geo`, coord);
      atualizarResultado(data.result);
      setCoordenada("");
      toast.success("Coordenada aplicada. Distâncias, classificações e sumário foram recalculados.");
    } catch (err) {
      toast.error(err.response?.data?.error || "Não foi possível corrigir a coordenada.");
    } finally {
      setCorrigindo(false);
    }
  };

  const gerarPdf = async () => {
    try {
      await exportarLaudoPdf(setPdfBusy, setPdfDownload);
    } catch (err) {
      toast.error(err.message);
    }
  };

  const btnPrimary =
    "inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-white shadow-lg shadow-primary/20 transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50";
  const btnGhost =
    "inline-flex items-center justify-center gap-2 rounded-lg border border-surface-border bg-secondary px-5 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-secondary-hover disabled:cursor-not-allowed disabled:opacity-50";

  if (erro) {
    return (
      <div className="glass mx-auto mt-10 w-full max-w-md rounded-2xl border border-surface-border p-8 text-center">
        <AlertTriangle className="mx-auto mb-4 h-8 w-8 text-amber-500" />
        <p className="text-sm text-zinc-300">{erro}</p>
        <Link to="/dashboard/history" className={`${btnGhost} mt-6`}>Ir para o histórico</Link>
      </div>
    );
  }

  if (!report) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-zinc-500" />
      </div>
    );
  }

  const ultimaRevisao =
    Object.values(analise.result.camposRevisados || {}).map((c) => c?.em).filter(Boolean).sort().at(-1) || null;

  return (
    <div className="animate-fade-in space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Laudo técnico pericial</h1>
          <p className="text-zinc-400">
            {report.file.name} · protocolo {report.reportId}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={btnPrimary} onClick={gerarPdf} disabled={pdfBusy}>
            {pdfBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            {pdfBusy ? "Gerando PDF..." : "Gerar relatório em PDF"}
          </button>
          <Link to="/dashboard/analyze" className={btnGhost}>
            <FileSearch className="h-4 w-4" /> Analisar novo contrato
          </Link>
        </div>
      </div>

      {pdfDownload && (
        <div className="rounded-2xl border border-emerald-500/25 bg-emerald-500/[0.05] p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <FileText className="h-5 w-5 text-emerald-500" />
              <div>
                <div className="text-[13px] font-bold uppercase tracking-wider text-emerald-500">PDF pronto para salvar</div>
                <div className="mt-0.5 text-[12.5px] text-zinc-400">
                  {pdfDownload.filename} · {pdfDownload.sizeKB} KB
                </div>
              </div>
            </div>
            <div className="flex flex-wrap gap-2.5">
              <a className={btnPrimary} href={pdfDownload.url} download={pdfDownload.filename}>
                <Download className="h-4 w-4" /> Baixar PDF
              </a>
              <a className={btnGhost} href={pdfDownload.url} target="_blank" rel="noopener noreferrer">
                Abrir PDF
              </a>
            </div>
          </div>
          <iframe title="Prévia do PDF gerado" src={pdfDownload.url} className="h-[520px] w-full rounded-lg border border-surface-border bg-zinc-100" />
        </div>
      )}

      {/* Ferramentas do operador: fora da captura do PDF. */}
      <div className="space-y-4" data-html2canvas-ignore="true">
        <RevisaoCampos
          analysisId={id}
          extracted={report.extracted}
          revisados={analise.result.camposRevisados}
          onAtualizado={(novo) => atualizarResultado(novo)}
        />

        {(report.contractGeo || report.ipAnalysis.length > 0) && (
          <div className="rounded-xl border border-primary/20 bg-primary/[0.04] p-4">
            <div className="mb-3 flex items-start gap-2.5">
              <Wand2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <p className="text-[12.5px] leading-relaxed text-zinc-400">
                {report.home.geo?.precision === "manual"
                  ? "Coordenada da residência confirmada pelo operador. Informe outra para substituí-la."
                  : "Confirme a coordenada exata da residência para máxima precisão das distâncias (Google Maps: botão direito no local e clique na coordenada para copiar)."}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                value={coordenada}
                onChange={(e) => setCoordenada(e.target.value)}
                placeholder="Ex.: -5.0951, -42.8100"
                className="block min-w-[200px] flex-1 rounded-lg border border-surface-border bg-surface px-4 py-2 text-sm text-foreground placeholder-zinc-500 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-primary"
              />
              <button type="button" className={btnPrimary} onClick={aplicarCoordenada} disabled={corrigindo}>
                {corrigindo && <Loader2 className="h-4 w-4 animate-spin" />}
                {corrigindo ? "Aplicando..." : "Aplicar coordenada"}
              </button>
            </div>
          </div>
        )}

        <ConfrontoProcesso
          analysisId={id}
          confronto={analise.result.processComparison}
          ultimaRevisao={ultimaRevisao}
          onAtualizado={(processComparison) => atualizarResultado({ processComparison })}
        />
      </div>

      <LaudoForense report={report} />
    </div>
  );
}
