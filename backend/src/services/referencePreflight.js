import { heuristicExtractionFromText } from "../engine/extraction.js";
import { compararReferenciaComInstrumento } from "../utils/referenciaResidencial.js";

/** Leitura preliminar reutilizável pelo worker, sem perícia de imagens ou rede. */
export async function preflightReference(pdfBuffer, homeAddress, extractText) {
  if (!String(homeAddress || "").trim()) return { extraction: null, conflito: null };
  const extraction = await extractText(pdfBuffer);
  const cliente = heuristicExtractionFromText(extraction.text || "").cliente || {};
  return { extraction, conflito: compararReferenciaComInstrumento(cliente, homeAddress) };
}
