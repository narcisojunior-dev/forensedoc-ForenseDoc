/**
 * Exportação do laudo em PDF, portada do motor de geração.
 *
 * Captura `#fd-report` em modo claro (html2canvas), pagina em A4 com cabeçalho e
 * rodapé, evita cortar blocos no meio, põe o confronto geográfico em folha
 * exclusiva e cada página do sumário executivo em página própria.
 */

function clearPageSpacers(el) {
  el.querySelectorAll(".fd-page-spacer").forEach((spacer) => spacer.remove());
}

async function waitForReportImages(el) {
  const images = Array.from(el.querySelectorAll("img"));
  await Promise.all(images.map((img) => {
    if (img.complete && img.naturalWidth > 0) return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => resolve();
      img.addEventListener("load", done, { once: true });
      img.addEventListener("error", done, { once: true });
      setTimeout(done, 5000);
    });
  }));
}

export function validateRenderableReport(el) {
  // jsdom não implementa innerText: sem o textContent, a higiene passava vazia
  // em todos os testes e não protegia nada.
  const text = (el?.innerText ?? el?.textContent ?? "").replace(/\s+/g, " ");
  const prohibited = [
    [/\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b/, "enum interno cru"],
    [/\b(CET1|FIN\d|IMG\d|INT\d|TRB\d|CAD\d|CUS\d|LOG\d)\s+(ALTA|MEDIA|MÉDIA|MÉDIO|INFO|CRITICO|CRÍTICO)\s*:/, "código de achado em prosa"],
    [/\b(ALTA|MEDIA|MÉDIA|MÉDIO|INFO|CRITICO|CRÍTICO):/, "gravidade em prosa"],
    [/\b(dia|ano|mes|mês|imagem|grupo|repetido|calculado|declarado)\(\w+\)/i, "plural parentético"],
    [/\.\./, "ponto duplicado"],
  ];
  const failed = prohibited.find(([pattern]) => pattern.test(text));
  if (failed) throw new Error(`Higiene do render bloqueou a geração do PDF: ${failed[1]}. Revise o laudo antes de emitir.`);
}

export async function exportarLaudoPdf(setBusy, setPdfDownload) {
  const el = document.getElementById("fd-report");
  if (!el) return;
  try {
    setBusy(true);
    setPdfDownload(null);
    document.body.classList.add("fd-exporting");
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
      import("html2canvas"),
      import("jspdf"),
    ]);

    const pageWidthMm = 210;
    const pageHeightMm = 297;
    const marginX = 12;
    const contentTop = 15;
    const contentBottom = 14;
    const imageWidthMm = pageWidthMm - marginX * 2;
    const imageHeightMm = pageHeightMm - contentTop - contentBottom;
    clearPageSpacers(el);
    await waitForReportImages(el);
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    validateRenderableReport(el);

    const canvas = await html2canvas(el, {
      scale: 2,
      backgroundColor: "#f5f7f8",
      useCORS: true,
      logging: false,
      windowWidth: 794,
      scrollX: 0,
      scrollY: -window.scrollY,
    });

    const pdf = new jsPDF("p", "mm", "a4", true);
    const pw = pdf.internal.pageSize.getWidth();
    const ph = pdf.internal.pageSize.getHeight();
    const imgW = pw - marginX * 2;
    const pageCanvas = document.createElement("canvas");
    const pageCtx = pageCanvas.getContext("2d");
    const pageHeightPx = Math.floor((canvas.width * imageHeightMm) / imgW);
    pageCanvas.width = canvas.width;
    pageCanvas.height = pageHeightPx;

    const reportRect = el.getBoundingClientRect();
    const canvasScale = canvas.width / reportRect.width;
    const geoNode = el.querySelector(".geo-visual-block");
    let geoRange = null;
    if (geoNode) {
      const rect = geoNode.getBoundingClientRect();
      geoRange = {
        start: Math.max(0, Math.floor((rect.top - reportRect.top) * canvasScale)),
        end: Math.min(canvas.height, Math.ceil((rect.bottom - reportRect.top) * canvasScale)),
      };
      if (geoRange.end <= geoRange.start) geoRange = null;
    }
    const rangeForNode = (node) => {
      const rect = node.getBoundingClientRect();
      return {
        start: Math.max(0, Math.floor((rect.top - reportRect.top) * canvasScale)),
        end: Math.min(canvas.height, Math.ceil((rect.bottom - reportRect.top) * canvasScale)),
      };
    };
    const summaryRanges = Array.from(el.querySelectorAll(".summary-page"))
      .map(rangeForNode)
      .filter((range) => range.end > range.start)
      .sort((a, b) => a.start - b.start);
    const avoidCutRanges = Array.from(el.querySelectorAll(
      ".row, .note, .flag, .grid-2, .dist-banner, .ip-block, .geo-map, .audit-layout, .audit-table-wrap, .audit-finding, .diligence-item, .norm, .report-cover, .report-notice, .hash-card, .geo-card",
    ))
      .map(rangeForNode)
      .filter((range) => range.end > range.start && range.end - range.start < pageHeightPx)
      .sort((a, b) => a.start - b.start);

    let renderedHeight = 0;
    let page = 0;

    const addPdfPage = (sliceStart, sliceHeight, centerVertically = false) => {
      pageCanvas.height = sliceHeight;
      pageCtx.fillStyle = "#f5f7f8";
      pageCtx.fillRect(0, 0, pageCanvas.width, pageCanvas.height);
      pageCtx.drawImage(canvas, 0, sliceStart, canvas.width, sliceHeight, 0, 0, canvas.width, sliceHeight);
      const imgData = pageCanvas.toDataURL("image/jpeg", 0.97);
      const naturalImgH = (sliceHeight * imgW) / canvas.width;
      const fitScale = Math.min(1, imageHeightMm / naturalImgH);
      const renderedImgW = imgW * fitScale;
      const renderedImgH = naturalImgH * fitScale;
      const imageX = (pw - renderedImgW) / 2;
      const imageY = centerVertically
        ? contentTop + (imageHeightMm - renderedImgH) / 2
        : contentTop;
      if (page > 0) pdf.addPage();
      pdf.setFillColor(255, 255, 255);
      pdf.rect(0, 0, pw, ph, "F");
      pdf.setDrawColor(11, 120, 151);
      pdf.setLineWidth(0.7);
      pdf.line(marginX, 9.5, pw - marginX, 9.5);
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(7.5);
      pdf.setTextColor(26, 55, 68);
      pdf.text("FORENSEDOC | LAUDO TÉCNICO PERICIAL", marginX, 7.2);
      pdf.setFont("helvetica", "normal");
      pdf.setTextColor(91, 105, 115);
      // O número da página é escrito uma única vez, no laço final abaixo
      // (após o total de páginas ser conhecido). Escrevê-lo aqui também
      // duplicava a camada de texto do rodapé: um retângulo branco cobre
      // visualmente o texto antigo, mas o pdftotext extrai as duas
      // ocorrências mesmo assim ("PaginaPagina 10 de 10").
      pdf.addImage(imgData, "JPEG", imageX, imageY, renderedImgW, renderedImgH, undefined, "FAST");
      pdf.setDrawColor(214, 221, 225);
      pdf.setLineWidth(0.25);
      pdf.line(marginX, ph - 9.5, pw - marginX, ph - 9.5);
      pdf.setFontSize(7);
      pdf.setTextColor(104, 115, 123);
      pdf.text("Ronney Menezes Advocacia | Documento gerado pelo ForenseDoc", marginX, ph - 6.5);
      page += 1;
    };

    while (renderedHeight < canvas.height) {
      const activeSummary = summaryRanges.find(
        (range) => renderedHeight >= range.start - 2 && renderedHeight < range.end,
      );
      if (activeSummary) {
        addPdfPage(activeSummary.start, activeSummary.end - activeSummary.start);
        renderedHeight = activeSummary === summaryRanges[summaryRanges.length - 1]
          ? canvas.height
          : activeSummary.end;
        continue;
      }

      if (geoRange && renderedHeight >= geoRange.start && renderedHeight < geoRange.end) {
        addPdfPage(geoRange.start, geoRange.end - geoRange.start, true);
        renderedHeight = geoRange.end;
        continue;
      }

      let sliceEnd = Math.min(renderedHeight + pageHeightPx, canvas.height);
      if (geoRange && renderedHeight < geoRange.start && sliceEnd > geoRange.start) {
        sliceEnd = geoRange.start;
      }
      const nextSummary = summaryRanges.find(
        (range) => range.start > renderedHeight && range.start < sliceEnd,
      );
      if (nextSummary) sliceEnd = nextSummary.start;
      const crossedRange = avoidCutRanges.find(
        (range) => range.start > renderedHeight + 12 && range.start < sliceEnd && range.end > sliceEnd,
      );
      if (crossedRange) sliceEnd = crossedRange.start;
      const sliceHeight = Math.max(1, sliceEnd - renderedHeight);
      addPdfPage(renderedHeight, sliceHeight);
      renderedHeight = sliceEnd;
    }

    if (page === 0) {
      pdf.addPage();
    }

    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    const filename = `Laudo_ForenseDoc_${stamp}.pdf`;
    const totalPages = pdf.getNumberOfPages();
    for (let currentPage = 1; currentPage <= totalPages; currentPage += 1) {
      pdf.setPage(currentPage);
      pdf.setFillColor(255, 255, 255);
      pdf.rect(pw - 48, 3.5, 36, 4.8, "F");
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(7.5);
      pdf.setTextColor(91, 105, 115);
      pdf.text(`Página ${currentPage} de ${totalPages}`, pw - marginX, 7.2, { align: "right" });
    }
    pdf.setProperties({
      title: "Laudo técnico pericial - ForenseDoc",
      subject: "Análise forense digital de contrato bancário",
      author: "Ronney Menezes Advocacia",
      creator: "ForenseDoc",
    });
    const blob = pdf.output("blob");
    const url = URL.createObjectURL(blob);
    setPdfDownload({ url, filename, sizeKB: (blob.size / 1024).toFixed(1) });
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.rel = "noopener";
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    link.remove();
    try { window.open(url, "_blank", "noopener,noreferrer"); } catch {}
  } catch (e) {
    console.error("[ForenseDoc] Falha ao gerar PDF", e);
    // Quem chama mostra a mensagem no padrão de notificação do SaaS.
    throw new Error("Não foi possível gerar o PDF automaticamente. Detalhe: " + (e.message || "erro desconhecido"));
  } finally {
    clearPageSpacers(el);
    document.body.classList.remove("fd-exporting");
    setBusy(false);
  }
}
