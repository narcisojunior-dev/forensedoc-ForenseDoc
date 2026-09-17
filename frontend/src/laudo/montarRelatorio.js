import { generateJudicialQuesitos } from "./quesitos.js";

/**
 * Converte o resultado persistido de uma análise no formato de relatório que o
 * laudo do motor de geração consome.
 *
 * O motor montava esse objeto no navegador, consultando geocodificação e IP ao
 * vivo. No SaaS tudo já foi calculado pelo worker e está gravado, então o
 * laudo é reprodutível: reabrir a análise mostra o mesmo documento.
 */

function lerExtraido(texto) {
  if (!texto) return null;
  const t = String(texto).replace(/```json|```/g, "").trim();
  try {
    return JSON.parse(t);
  } catch {
    const i = t.indexOf("{");
    const j = t.lastIndexOf("}");
    if (i !== -1 && j > i) {
      try {
        return JSON.parse(t.slice(i, j + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

const dataHoraFortaleza = (valor) =>
  new Date(valor).toLocaleString("pt-BR", {
    timeZone: "America/Fortaleza",
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });

export function montarRelatorio({ analysisId, result, createdAt }) {
  const extraido = lerExtraido(result?.text);
  const extracted = extraido || {};
  const sizeBytes = result?.file?.sizeBytes ?? 0;
  const gerado = result?.generatedAt || createdAt || new Date().toISOString();

  // O motor lê o histórico do IP dentro de `geo`; o SaaS grava no registro.
  const ipAnalysis = (result?.ipAnalysis || []).map((ip) => ({
    ...ip,
    geo: ip.geo ? { ...ip.geo, historico: ip.historico || ip.geo.historico || null } : null,
  }));

  // O confronto com o processo só entra no laudo quando concluído. Em
  // andamento ou com erro, quem mostra o estado é a ferramenta de envio.
  const pc = result?.processComparison;
  const processComparison = pc?.status === "COMPLETED" ? { ...pc, status: pc.resultado } : null;

  const home = result?.home || { query: null, source: null, geo: null };
  const primeiroIp = ipAnalysis.find((ip) => ip.geo) || ipAnalysis[0];
  const cliente = extracted.cliente || {};

  return {
    analysisId,
    timestamp: dataHoraFortaleza(gerado),
    reportId: result?.reportId || `FD-${String(gerado).slice(0, 10).replace(/-/g, "")}-${String(result?.hashes?.sha256 || "").slice(0, 10)}`,
    file: {
      name: result?.file?.name || "documento.pdf",
      sizeKB: (sizeBytes / 1024).toFixed(2),
      sizeBytes,
    },
    hashes: result?.hashes || { sha256: "", sha1: "" },
    metadata: result?.metadata || null,
    extracted,
    home: {
      query: home.query || null,
      source: home.source || null,
      geo: home.geo || null,
      warning: null,
      // Estado da referência residencial (recusada por conflito, indisponível,
      // liberada pelo operador) e o texto que o laudo imprime sobre ela.
      estado_confronto: home.estado_confronto || null,
      alerta: home.alerta || null,
      conflito: home.conflito || null,
      justificativa: home.justificativa || null,
    },
    contractGeo: result?.contractGeo || null,
    geoDeclaredPresent: Boolean(result?.geoDeclaredPresent),
    ipAnalysis,
    processComparison,
    processingNotice: result?.warning || "",
    extractionError: extraido
      ? ""
      : "A extração automática não retornou dados estruturados válidos. O laudo foi gerado com os dados disponíveis.",
    // Acréscimos do SaaS.
    camposRevisados: result?.camposRevisados || null,
    sumarioIrregularidades: result?.sumarioIrregularidades || null,
    quesitos: extraido
      ? generateJudicialQuesitos({
          clienteNome: cliente.nome,
          clienteCpf: cliente.cpf,
          contratoNumero: extracted.contrato?.numero,
          banco: extracted.contrato?.banco,
          ip: primeiroIp?.endereco,
          porta: primeiroIp?.porta,
          gpsCoords: result?.contractGeo ? `${result.contractGeo.lat}, ${result.contractGeo.lon}` : null,
          cidadeIp: primeiroIp?.geo ? [primeiroIp.geo.city, primeiroIp.geo.region].filter(Boolean).join(" / ") : null,
          cidadeDomicilio: home.geo ? home.geo.display || home.query : null,
          distanciaKm: primeiroIp?.distance != null ? primeiroIp.distance.toFixed(1) : null,
          dataHora: primeiroIp?.data_hora || extracted.assinatura?.data_hora_assinatura,
        })
      : [],
  };
}
