import React, { useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import { Loader2, FileUp, RotateCcw, AlertTriangle } from "lucide-react";
import { api } from "../../lib/axios.js";

/**
 * Ferramenta de envio do PDF do processo judicial para confronto com o contrato.
 *
 * O resultado aparece no § 7 do laudo. Aqui fica só o envio e o acompanhamento:
 * o confronto roda na fila, como a análise, e a tela consulta o resultado da
 * análise até o estado sair de PROCESSING.
 */

const MAX_PDF_MB = Number(import.meta.env.VITE_MAX_PDF_MB) || 30;
const POLL_MS = 4000;
const POLL_PRAZO_MS = 10 * 60 * 1000;

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const partes = [];
  for (let i = 0; i < bytes.length; i += 0x8000) {
    partes.push(String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)));
  }
  return btoa(partes.join(""));
}

export default function ConfrontoProcesso({ analysisId, confronto, ultimaRevisao, onAtualizado }) {
  const [enviando, setEnviando] = useState(false);
  const inputRef = useRef(null);
  const montado = useRef(true);
  // Volta a `true` na montagem: o StrictMode desmonta e remonta em desenvolvimento.
  useEffect(() => {
    montado.current = true;
    return () => { montado.current = false; };
  }, []);
  // Em ref: com o callback nas dependências do efeito, cada render do pai
  // reiniciaria o acompanhamento e acumularia laços de consulta.
  const aoAtualizar = useRef(onAtualizado);
  aoAtualizar.current = onAtualizado;

  const processando = confronto?.status === "PROCESSING";

  useEffect(() => {
    if (!processando || !analysisId) return undefined;
    let cancelado = false;
    const limite = Date.now() + POLL_PRAZO_MS;
    (async () => {
      while (!cancelado && montado.current && Date.now() < limite) {
        await new Promise((r) => setTimeout(r, POLL_MS));
        try {
          const { data } = await api.get(`/analyses/${analysisId}/result`);
          const novo = data.result?.processComparison;
          if (novo && novo.status !== "PROCESSING") {
            if (!cancelado && montado.current) aoAtualizar.current(novo);
            return;
          }
        } catch {
          // Falha transitória de rede: tenta de novo no próximo ciclo.
        }
      }
    })();
    return () => { cancelado = true; };
  }, [processando, analysisId]);

  const enviar = async (file) => {
    if (!file || !analysisId) return;
    if (!/\.pdf$/i.test(file.name)) {
      toast.error("Envie o processo em PDF.");
      return;
    }
    if (file.size > MAX_PDF_MB * 1024 * 1024) {
      toast.error(`O PDF do processo excede ${MAX_PDF_MB} MB.`);
      return;
    }
    setEnviando(true);
    try {
      const base64 = arrayBufferToBase64(await file.arrayBuffer());
      await api.post(`/analyses/${analysisId}/process-comparison`, { pdfBase64: base64, filename: file.name });
      aoAtualizar.current({ status: "PROCESSING", file: { name: file.name, sizeBytes: file.size } });
      toast.success("Processo enviado. O confronto roda em segundo plano e aparece no § 7 do laudo.");
    } catch (err) {
      toast.error(err.response?.data?.error || "Não foi possível enviar o processo.");
    } finally {
      setEnviando(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const revisaoPosterior =
    confronto?.status === "COMPLETED" &&
    ultimaRevisao &&
    (!confronto.camposRevisadosAte || ultimaRevisao > confronto.camposRevisadosAte);

  return (
    <div className="rounded-xl border border-primary/20 bg-primary/[0.04] p-4">
      <div className="text-[13px] font-bold text-foreground">Confronto com o processo judicial (§ 7)</div>
      <p className="mt-1 text-[12.5px] leading-relaxed text-zinc-400">
        Anexe o PDF do processo (petição inicial, contestação ou autos) para confirmar nele os dados lidos deste
        contrato e apontar divergências. Não consome crédito, e o arquivo do processo é apagado ao fim da leitura.
      </p>
      {confronto?.status === "ERROR" && (
        <p className="mt-2 flex items-start gap-2 text-[12.5px] text-red-400">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {confronto.error}
        </p>
      )}
      {revisaoPosterior && (
        <p className="mt-2 flex items-start gap-2 text-[12.5px] text-amber-400">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> Houve revisão de campos depois deste confronto. Refaça o
          envio para confrontar os valores corrigidos.
        </p>
      )}
      <div className="mt-3">
        <button
          type="button"
          disabled={enviando || processando}
          onClick={() => inputRef.current?.click()}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          {enviando || processando ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : confronto?.status ? (
            <RotateCcw className="h-4 w-4" />
          ) : (
            <FileUp className="h-4 w-4" />
          )}
          {processando
            ? "Lendo o processo..."
            : enviando
              ? "Enviando..."
              : confronto?.status
                ? "Refazer com outro PDF"
                : "Anexar PDF do processo"}
        </button>
        <input ref={inputRef} type="file" accept=".pdf" className="hidden" onChange={(e) => enviar(e.target.files[0])} />
      </div>
    </div>
  );
}
