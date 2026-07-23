import { useEffect, useState } from "react";
import { FileSearch, Loader2, X, ChevronLeft, ChevronRight, Eye, Download } from "lucide-react";
import toast from "react-hot-toast";
import "../styles/ForenseDoc.css";
import { api } from "../lib/axios";
import { Row, Badge, Section } from "../components/UiComponents.jsx";
import { riskFromDistance, ipSignatureCompat } from "../utils/geo.js";
import { downloadReportPdf } from "../utils/reportDownload.js";

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

const STATUS_LABELS = {
  PROCESSING: { label: "Processando", color: "#4fc3e8" },
  COMPLETED: { label: "Concluída", color: "#3ddc97" },
  ERROR: { label: "Erro", color: "#f06363" },
  REFUNDED: { label: "Estornada", color: "#f2b03d" },
};

function AnalysisDetailModal({ analysisId, onClose }) {
  const [loading, setLoading] = useState(true);
  const [extracted, setExtracted] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const { data } = await api.get(`/analyses/${analysisId}/result`);
        const parsed = parseExtraction(data.result?.text);
        setExtracted(parsed || {});
        setResult(data.result || null);
      } catch (err) {
        setError(err.response?.data?.error || "Erro ao carregar detalhes da análise.");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [analysisId]);

  const metadata = result?.metadata || null;
  // Laudos gerados antes da Fase A não têm os artefatos forenses persistidos.
  const hasForensics = !!(result?.hashes || result?.contractGeo || result?.ipAnalysis?.length);

  const handleDownload = async () => {
    setDownloading(true);
    try {
      await downloadReportPdf(analysisId);
    } catch {
      toast.error("Não foi possível gerar o PDF do laudo.");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-background border border-surface-border rounded-2xl max-w-2xl w-full max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-background border-b border-surface-border px-6 py-4 flex items-center justify-between z-10">
          <h2 className="text-lg font-bold text-foreground">Detalhes da análise</h2>
          <div className="flex items-center gap-2">
            {!loading && !error && (
              <button
                onClick={handleDownload}
                disabled={downloading}
                className="flex items-center gap-1.5 text-xs font-medium bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 disabled:opacity-50 px-3 py-1.5 rounded-lg transition-colors"
              >
                {downloading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                Baixar PDF
              </button>
            )}
            <button onClick={onClose} className="text-zinc-400 hover:text-foreground p-1">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="p-6">
          {loading && (
            <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-zinc-500" /></div>
          )}

          {!loading && error && (
            <div className="text-center py-12 text-red-400 text-sm">{error}</div>
          )}

          {!loading && !error && extracted && (
            <div className="space-y-4">
              {!hasForensics && (
                <div className="note" style={{ borderLeftColor: "var(--muted)", background: "rgba(133,149,168,0.07)" }}>
                  Este laudo foi gerado antes do confronto geográfico e dos hashes passarem a ser
                  arquivados. Gere uma nova análise para obter o laudo completo com §5 e cadeia de custódia.
                </div>
              )}

              {result?.hashes && (
                <Section title="Integridade criptográfica do arquivo">
                  <Row label="SHA-256" value={result.hashes.sha256} mono />
                  <Row label="SHA-1" value={result.hashes.sha1} mono />
                  {result.file?.sizeBytes && (
                    <Row label="Tamanho do arquivo" value={`${(result.file.sizeBytes / 1024).toFixed(2)} KB`} />
                  )}
                </Section>
              )}

              <Section title="Documento">
                <Row label="Tipo de documento" value={extracted.tipo_documento} />
                <Row label="Qualidade de OCR / leitura" value={extracted.qualidade_ocr} />
              </Section>

              <Section title="Contrato">
                <Row label="Número do contrato" value={extracted.contrato?.numero} />
                <Row label="Banco / instituição" value={extracted.contrato?.banco} />
                <Row label="Valor contratado" value={extracted.contrato?.valor_contratado} />
                <Row label="Valor da parcela" value={extracted.contrato?.valor_parcela} />
                <Row label="Taxa de juros mensal" value={extracted.contrato?.taxa_juros_mensal} />
                <Row label="CET mensal" value={extracted.contrato?.cet_mensal} />
                <Row label="Data do contrato" value={extracted.contrato?.data_contrato} />
              </Section>

              <Section title="Contratante">
                <Row label="Nome completo" value={extracted.cliente?.nome} />
                <Row label="CPF" value={extracted.cliente?.cpf} />
                <Row label="Endereço (extraído do contrato)" value={extracted.cliente?.endereco} />
                <Row label="Cidade / Estado" value={[extracted.cliente?.cidade, extracted.cliente?.estado].filter(Boolean).join(" / ")} />
              </Section>

              <Section title="Assinatura eletrônica">
                <div className="row">
                  <span className="row-label">Assinatura presente</span>
                  <Badge label={extracted.assinatura?.presente ? "CONFIRMADA" : "AUSENTE"} color={extracted.assinatura?.presente ? "#3ddc97" : "#f06363"} />
                </div>
                <Row label="Plataforma" value={extracted.assinatura?.plataforma} />
                <Row label="Tipo" value={extracted.assinatura?.tipo} />
                <Row label="Data / hora" value={extracted.assinatura?.data_hora_assinatura} />
                <Row label="Hash do documento assinado" value={extracted.assinatura?.hash_documento_assinado} mono />
              </Section>

              {/* §5 — confronto geográfico persistido (Fase A) */}
              {result?.contractGeo && (
                <Section title="Geolocalização da assinatura · confronto geográfico">
                  <Row label="Local declarado da assinatura" value={result.contractGeo.endereco || `${result.contractGeo.lat}, ${result.contractGeo.lon}`} />
                  {result.home?.query && (
                    <Row label={`Residência (${result.home.source})`} value={result.home.query} />
                  )}
                  {result.contractGeo.distance != null && (
                    <div className="row">
                      <span className="row-label">Distância assinatura → residência</span>
                      <span className="row-value" style={{ color: riskFromDistance(result.contractGeo.distance).color, fontWeight: 700 }}>
                        {result.contractGeo.distance.toFixed(2)} km · {riskFromDistance(result.contractGeo.distance).label}
                      </span>
                    </div>
                  )}
                </Section>
              )}

              {result?.ipAnalysis?.length > 0 ? (
                <Section title={`Endereços IP · geolocalização (${result.ipAnalysis.length})`}>
                  {result.ipAnalysis.map((ip, i) => (
                    <div key={i} style={{ marginBottom: 10 }}>
                      <div className="row">
                        <span className="row-label" style={{ fontFamily: "monospace" }}>
                          {ip.endereco}{ip.geo?.city ? ` · ${ip.geo.city}/${ip.geo.region || ""}` : ""}
                        </span>
                        {ip.distance != null ? (
                          <span className="row-value" style={{ color: riskFromDistance(ip.distance).color, fontWeight: 700 }}>
                            {ip.distance.toFixed(2)} km da residência
                          </span>
                        ) : (
                          <span className="row-value" style={{ color: "var(--muted)" }}>sem distância</span>
                        )}
                      </div>
                      {ip.distanceToSignature != null && (() => {
                        const c = ipSignatureCompat(ip.distanceToSignature);
                        return (
                          <div className="row">
                            <span className="row-label" style={{ fontSize: 12 }}>IP × assinatura declarada</span>
                            <span className="row-value" style={{ color: c.color, fontWeight: 700, fontSize: 12 }}>
                              {ip.distanceToSignature.toFixed(2)} km · {c.label}
                            </span>
                          </div>
                        );
                      })()}
                    </div>
                  ))}
                </Section>
              ) : (
                extracted.ips?.length > 0 && (
                  <Section title={`Endereços IP encontrados (${extracted.ips.length})`}>
                    {extracted.ips.map((ip, i) => (
                      <Row key={i} label={`IP #${i + 1}`} value={`${ip.endereco}${ip.data_hora ? " · " + ip.data_hora : ""}`} mono />
                    ))}
                  </Section>
                )
              )}

              {metadata && (
                <Section title="Metadados do PDF">
                  <Row label="Número de páginas" value={metadata.totalPages} />
                  <Row label="Autor declarado" value={metadata.author} />
                  <Row label="Aplicativo criador" value={metadata.creator} />
                  {metadata.warnings?.length > 0 && (
                    <div className="note" style={{ borderLeftColor: "var(--warn)", background: "rgba(242,176,61,0.07)" }}>
                      {metadata.warnings.join(" ")}
                    </div>
                  )}
                </Section>
              )}

              {extracted.evidencias_irregularidade?.length > 0 && (
                <Section title="Evidências de irregularidade" danger>
                  {extracted.evidencias_irregularidade.map((ev, i) => (
                    <div key={i} className="flag"><b>▸</b><span>{ev}</span></div>
                  ))}
                </Section>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function History() {
  const [analyses, setAnalyses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [selectedId, setSelectedId] = useState(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const { data } = await api.get(`/analyses?page=${page}&limit=10`);
        setAnalyses(data.analyses);
        setTotalPages(data.pagination.totalPages || 1);
      } catch {
        toast.error("Erro ao carregar histórico de análises.");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [page]);

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Histórico de Laudos</h1>
        <p className="text-zinc-400">Todas as análises realizadas pela sua equipe.</p>
      </div>

      <div className="glass rounded-2xl border border-surface-border overflow-hidden">
        {loading ? (
          <div className="flex justify-center p-12"><Loader2 className="w-8 h-8 animate-spin text-zinc-500" /></div>
        ) : analyses.length === 0 ? (
          <div className="text-center py-16">
            <FileSearch className="w-12 h-12 text-zinc-600 mx-auto mb-4" />
            <p className="text-zinc-400">Nenhuma análise realizada ainda.</p>
          </div>
        ) : (
          <div className="divide-y divide-surface-border/50">
            {analyses.map((item) => {
              const status = STATUS_LABELS[item.status] || { label: item.status, color: "#8595a8" };
              return (
                <div key={item.id} className="flex items-center justify-between px-6 py-4">
                  <div>
                    <div className="text-sm font-medium text-zinc-200">
                      Análise {item.id.slice(0, 8)}
                    </div>
                    <div className="text-xs text-zinc-500">{new Date(item.createdAt).toLocaleString("pt-BR")}</div>
                  </div>
                  <div className="flex items-center gap-4">
                    <Badge label={status.label} color={status.color} />
                    {item.status === "COMPLETED" && (
                      <button
                        onClick={() => setSelectedId(item.id)}
                        className="text-primary hover:text-blue-400 text-sm font-medium flex items-center gap-1"
                      >
                        <Eye className="w-4 h-4" />
                        Ver detalhes
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-4 py-4 border-t border-surface-border/50">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="text-zinc-400 hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <span className="text-sm text-zinc-500">Página {page} de {totalPages}</span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="text-zinc-400 hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
        )}
      </div>

      {selectedId && <AnalysisDetailModal analysisId={selectedId} onClose={() => setSelectedId(null)} />}
    </div>
  );
}
