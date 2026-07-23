import { api } from "../lib/axios";

/**
 * Baixa o laudo em PDF gerado pelo servidor (Fase B).
 *
 * O endpoint exige o header de autenticação, então não dá para usar um <a href>
 * direto — busca-se o blob via axios e dispara-se o download programaticamente.
 */
export async function downloadReportPdf(analysisId) {
  const { data } = await api.get(`/analyses/${analysisId}/pdf`, { responseType: "blob" });

  const url = URL.createObjectURL(data);
  const link = document.createElement("a");
  link.href = url;
  link.download = `laudo-${analysisId.slice(0, 8)}.pdf`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
