import { buildCustodyChain } from "../reports/custodyChain.js";
import { generateJudicialQuesitos } from "../reports/quesitosTemplate.js";
import { verificarCoerencia } from "./coerenciaLaudo.js";

// A decisão é recalculada com o snapshot que será efetivamente publicado.
// Flags do cliente, ambiente e validações antigas persistidas não autorizam PDF.
export function validarEmissao(result) {
  let extracted;
  try { extracted = typeof result?.text === "string" ? JSON.parse(result.text) : result?.text; } catch {}
  if (!extracted || typeof extracted !== "object" || Array.isArray(extracted)) {
    return [{ regra: "extracao-invalida", classe: "FALHA_VALIDACAO", bloqueante: true, descricao: "Extração estruturada indisponível", detalhe: "Não é possível validar a emissão sem a extração." }];
  }
  const violacoes = verificarCoerencia(result, extracted);
  const checklist = buildCustodyChain(extracted, result.ipAnalysis || [], Boolean(result.geoDeclaredPresent || result.contractGeo));
  const persistido = result.cadeiaCustodia;
  const sinteseChecklist = result.sumarioIrregularidades?.custodyChecklist;
  if ((persistido?.elementos?.length && (persistido.presentes !== checklist.presentes || persistido.total !== checklist.total)) || (sinteseChecklist && (sinteseChecklist.present !== checklist.presentes || sinteseChecklist.total !== checklist.total))) {
    violacoes.push({ regra: "checklist-divergente", classe: "CONTRADICAO_MATERIAL", bloqueante: true, descricao: "Contagem de rastreabilidade desatualizada", detalhe: `A extração atual possui ${checklist.presentes}/${checklist.total} referências. Recalcule o resultado antes de emitir.` });
  }
  const textos = [
    ...generateJudicialQuesitos({ extracted, achados: extracted.achados_irregularidade || [] }).map(q => `${q.quesito} ${q.finalidade}`),
    ...(extracted.achados_irregularidade || []).map(a => `${a.titulo || ""} ${a.texto || ""}`),
    ...(result.sumarioIrregularidades?.allFindings || []).map(a => `${a.title || ""} ${a.text || ""}`),
    ...(result.sumarioIrregularidades?.diligences || []).map(a => a.text || ""),
    result.sumarioIrregularidades?.synthesis || "",
    result.metadata?.digitalSignature?.procedencia?.mensagem || "",
  ];
  const regrasSuporte = [
    ["exif-remocao-nao-demonstrada", /(?:metadados(?: de captura)?(?: \(EXIF\))? removidos)/i],
    ["leitura-inferida-de-intervalo", /tempo incompatível com a leitura|foi o arquivo inteiro que se apresentou ao consumidor/i],
    ["autoria-cadastro-inferida", /indica cadastro feito por terceiro/i],
    ["carencia-franquia-marcos", /(?:primeira indenização só é possível|indenização possível apenas) \d+ dias após o início da vigência/i],
    ["localizacao-protocolo-fixa", /bloco impresso no rodapé da última página/i],
    ["proveniencia-nao-demonstrada", /corresponde à extração dos autos, não a uma|Exportações processuais não preservam assinatura/i],
  ];
  for (const [regra, padrao] of regrasSuporte) {
    const trecho = textos.find(t => padrao.test(t));
    if (trecho) violacoes.push({ regra, classe: "SUPORTE_INSUFICIENTE", bloqueante: true, descricao: "Afirmação exige revisão da evidência", detalhe: trecho });
  }
  const eventos = extracted.trilha_eventos?.eventos || [];
  if (eventos.length && textos.some(t => /ausência integral de trilha|não (?:há|existe) trilha|sem (?:qualquer )?trilha de (?:eventos|rede)/i.test(t))) {
    violacoes.push({ regra: "trilha-presente-x-negada", classe: "CONTRADICAO_MATERIAL", bloqueante: true, descricao: "A trilha registrada foi negada no laudo", detalhe: `${eventos.length} eventos presentes na extração.` });
  }
  const parGpsIp = (result.confronto_enderecos?.pares || []).find(p => p.id === "gps-x-ip" && Number.isFinite(p.km) && p.km >= 0);
  const distanciaGpsIp = parGpsIp?.km ?? (result.ipAnalysis || []).find(ip => Number.isFinite(ip.distanceToSignature) && ip.distanceToSignature >= 0)?.distanceToSignature;
  if (Number.isFinite(distanciaGpsIp) && /confronto entre GPS e IP[^.]*n[aã]o (?:foi )?(?:conclu[ií]do|realizado|calculado)/i.test(result.sumarioIrregularidades?.synthesis || "")) {
    violacoes.push({ regra: "gps-ip-calculado-x-negado", classe: "CONTRADICAO_MATERIAL", bloqueante: true, descricao: "O resumo nega uma comparação GPS × IP calculada", detalhe: `O resultado registra ${distanciaGpsIp} km. A atribuição do IP e a referência residencial devem ser tratadas separadamente.` });
  }
  return violacoes;
}

export function exigirEmissaoCoerente(result) {
  const coerencia = validarEmissao(result);
  const bloqueios = coerencia.filter(v => v.bloqueante);
  if (bloqueios.length) {
    const erro = new Error("Emissão suspensa: revise as inconsistências indicadas. A análise permanece disponível; exportar novamente não consome outro crédito.");
    erro.code = "COERENCIA"; erro.status = 409; erro.coerencia = coerencia;
    throw erro;
  }
  return coerencia;
}
