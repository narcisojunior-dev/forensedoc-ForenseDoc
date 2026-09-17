// Apresentação dos documentos classificados pelo Motor de Réplicas (origem,
// páginas do caderno e resumo criptográfico). Portado do motor de geração.
const ORIGIN_LABELS = {
  "original-upload": "arquivo enviado, sem derivação",
  "pdf-text-extraction": "texto extraído do PDF enviado",
  "pje-text-split": "texto extraído e separado do caderno do PJe",
};

export function presentReplicaDocument(document, custody = {}) {
  const provenance = document?.proveniencia || {};
  const original = (custody.documents || []).find((item) => item.originalName === document?.arquivo_original);
  const pages = document?.paginas_origem || [];
  const pageLabel = pages.length
    ? `páginas ${pages.length === 1 ? pages[0] : `${Math.min(...pages)}–${Math.max(...pages)}`} do caderno original`
    : null;
  return {
    derived: provenance.derived === true,
    origin: ORIGIN_LABELS[provenance.kind] || provenance.kind || "origem não informada",
    pageLabel,
    digestLabel: provenance.derived ? "resumo do texto derivado" : "hash do arquivo enviado",
    digest: document?.sha256 || null,
    sourceDigest: provenance.derived ? original?.sha256 || null : null,
  };
}

export { ORIGIN_LABELS };
