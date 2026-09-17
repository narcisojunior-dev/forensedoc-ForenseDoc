import { generateJudicialQuesitos } from "./quesitos.js";
import { distanciaKm, distanciaSuspeita } from "./distancia.js";

// Achados e itens do sumário que dependem de distância à residência.
const CHAVES_DISTANCIA_RESIDENCIA = new Set(["gps-near-home", "gps-home-distance"]);

/**
 * Sumário persistido por versões anteriores do motor pode trazer distância à
 * residência calculada a partir de nulo ("0,00 km" em selo favorável). Sem
 * confronto válido, a tela retira esses itens em vez de exibi-los.
 */
function sanearSumario(sumario, home, ipAnalysis, contractGeo) {
  if (!sumario) return sumario;
  const recusado = ["RECUSADO_CONFLITO", "INDISPONIVEL_NAO_INFORMADO"].includes(home?.estado_confronto);
  const semDistancia = distanciaKm(contractGeo?.distance) === null && ipAnalysis.every((ip) => distanciaKm(ip.distance) === null);
  const valida = (km) => distanciaKm(km) !== null && !distanciaSuspeita(km);
  if (!recusado && !semDistancia) {
    return { ...sumario, geo: sumario.geo ? { ...sumario.geo, items: (sumario.geo.items || []).filter((i) => valida(i.distance)) } : sumario.geo };
  }
  const semResidencia = (lista = []) => lista.filter((f) => !CHAVES_DISTANCIA_RESIDENCIA.has(f.key));
  return {
    ...sumario,
    findings: semResidencia(sumario.findings),
    allFindings: semResidencia(sumario.allFindings),
    favorable: semResidencia(sumario.favorable),
    checks: (sumario.checks || []).map((c) => (c.key === "gps-residencia" ? { ...c, status: "INDETERMINADO", detail: "Distância à residência não calculada." } : c)),
    geo: sumario.geo ? { ...sumario.geo, items: [], description: home?.alerta || "Distâncias à residência não calculadas." } : sumario.geo,
    ipCards: (sumario.ipCards || []).map((card) => ({
      ...card,
      distance: null,
      text: String(card.text || "").replace(/, [\d.,]+ km da referência residencial/, ""),
    })),
  };
}

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
    sumarioIrregularidades: sanearSumario(result?.sumarioIrregularidades || null, home, ipAnalysis, result?.contractGeo),
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
          distanciaKm: distanciaKm(primeiroIp?.distance) !== null ? distanciaKm(primeiroIp.distance).toFixed(1) : null,
          dataHora: primeiroIp?.data_hora || extracted.assinatura?.data_hora_assinatura,
          achados: extracted.achados_irregularidade || [],
          extracted,
        })
      : [],
  };
}
