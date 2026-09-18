/**
 * Validação cruzada do resultado antes da renderização.
 *
 * ─── Por que existe ──────────────────────────────────────────────────────────
 *
 * O laudo do dossiê C6 afirmava e negava o mesmo fato em seções diferentes:
 * contratante em Manaquiri/AM no § 3 e domicílio em Pedro II/PI no sumário;
 * biometria "apenas mencionada no clausulado" no § 4 e selfie inventariada no
 * § 4.2; código de autenticação "não identificado" e, três linhas abaixo,
 * "declarado, porém não conferível". Cada seção lia o dado por um caminho
 * próprio, e nada conferia o conjunto.
 *
 * Cada regra aqui descreve uma contradição que já apareceu num laudo real ou um
 * valor que não pode sair (o CET travado no extremo do solver). A correção de
 * cada defeito vive no módulo que o produziu; este validador existe para que
 * uma regressão futura não volte a sair calada.
 *
 * Contradições materiais e falhas de validação bloqueiam a emissão.
 * Coincidências heurísticas ficam como alertas, independentemente do ambiente.
 */
export function coerenciaBloqueante() { return true; }

const HEURISTICAS = new Set(["data-contrato-x-juntada", "cet-implicito-no-extremo"]);
const coordenadaValida = (p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lon) && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180;

const normalizar = (valor) =>
  String(valor || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .trim();

// Texto que o sumário executivo efetivamente imprime.
function textosDoSumario(sumario) {
  if (!sumario) return [];
  return [
    ...(sumario.allFindings || sumario.findings || []).map((f) => `${f.title || ""} ${f.text || ""}`),
    ...(sumario.favorable || []).map((f) => `${f.title || ""} ${f.text || ""}`),
    ...(sumario.checks || []).map((c) => String(c.detail || "")),
    ...(sumario.ipCards || []).map((c) => String(c.text || "")),
    ...(sumario.geo?.items || []).map((i) => `${i.label || ""} ${i.distance ?? ""}`),
    String(sumario.geo?.description || ""),
    String(sumario.synthesis || ""),
  ];
}

const CHAVES_DISTANCIA_RESIDENCIA = new Set(["gps-near-home", "gps-home-distance"]);

const REGRAS = [
  {
    id: "distancia-no-sumario-sem-confronto",
    nivel: "CRITICA",
    descricao: "Sumário executivo com distância, selo ou ponto de gráfico à residência sem confronto calculado",
    verificar(result) {
      const status = result.confronto_geografico?.status;
      const recusado = status ? status !== "CALCULADO" : ["RECUSADO_CONFLITO", "INDISPONIVEL_NAO_INFORMADO"].includes(result.home?.estado_confronto);
      if (!recusado) return null;
      const sumario = result.sumarioIrregularidades;
      if (!sumario) return null;
      const achados = [...(sumario.allFindings || sumario.findings || []), ...(sumario.favorable || [])].filter((f) => CHAVES_DISTANCIA_RESIDENCIA.has(f.key));
      // Pontos medidos até o GPS da assinatura, e pares de endereços que dizem
      // o que comparam, não afirmam domicílio: não dependem da residência.
      const pontos = (sumario.geo?.items || []).filter((i) => !["gps", "par"].includes(i.referencia)).length;
      const cards = (sumario.ipCards || []).filter((c) => /km da refer[êe]ncia residencial/i.test(c.text || "")).length;
      const partes = [
        achados.length ? `achado(s) ${achados.map((f) => f.key).join(", ")}` : null,
        pontos ? `${pontos} ponto(s) no gráfico` : null,
        cards ? `${cards} card(s) de IP com distância à residência` : null,
      ].filter(Boolean);
      return partes.length ? `confronto ${status || result.home?.estado_confronto} e sumário com ${partes.join("; ")}` : null;
    },
  },
  {
    id: "distancia-sem-coordenadas",
    nivel: "CRITICA",
    descricao: "Distância publicada sem os dois pontos válidos que a sustentam",
    verificar(result) {
      if (result.contractGeo?.distance != null && (!coordenadaValida(result.home?.geo) || !coordenadaValida(result.contractGeo))) return "distância à residência sem coordenadas completas e válidas";
      for (const ip of result.ipAnalysis || []) {
        if (ip.distance != null && (!coordenadaValida(result.home?.geo) || !coordenadaValida(ip.geo))) return "distância IP/residência sem coordenadas completas e válidas";
        if (ip.distanceToSignature != null && (!coordenadaValida(result.contractGeo) || !coordenadaValida(ip.geo))) return "distância IP/assinatura sem coordenadas completas e válidas";
      }
      return null;
    },
  },
  {
    id: "bloco-assinatura-x-afirmacao",
    nivel: "CRITICA",
    descricao: "Documento com bloco de assinatura dado como sem assinatura, ou o inverso",
    verificar(result, extracted) {
      const docs = extracted.documentos_logicos?.documentos || [];
      const principal = docs.find((d) => d.tipo === "INSTRUMENTO_PRINCIPAL");
      if (!principal) return null;
      const textos = [
        ...(extracted.achados_irregularidade || []).map((a) => `${a.titulo || ""} ${a.texto || ""}`),
        ...textosDoSumario(result.sumarioIrregularidades),
      ];
      const negaAssinatura = textos.find((t) => /sem bloco de assinatura|n[ãa]o exibe bloco de assinatura/i.test(t) && /c[ée]dula|instrumento principal/i.test(t));
      if (principal.blocosAssinatura?.length && negaAssinatura) {
        return `a ${principal.titulo} tem bloco na pág. ${principal.blocosAssinatura[0].pagina}, e o laudo afirma: ${negaAssinatura.slice(0, 120)}`;
      }
      const resumo = extracted.assinatura?.blocos_por_documento || "";
      const faixa = principal.paginaInicial === principal.paginaFinal ? `pág. ${principal.paginaInicial}` : `págs. ${principal.paginaInicial} a ${principal.paginaFinal}`;
      const resumoDoPrincipal = docs.filter((d) => d.titulo === principal.titulo).length > 1
        ? resumo.split(";").filter((parte) => parte.includes(`${principal.titulo} (${faixa})`)).join(";")
        : resumo.split(";").filter((parte) => parte.includes(principal.titulo)).join(";");
      const afirmaBloco = /bloco de assinatura na p[áa]g/i.test(resumoDoPrincipal);
      if (!principal.blocosAssinatura?.length && afirmaBloco) return `resumo de blocos afirma assinatura na ${principal.titulo}, que não tem bloco`;
      return null;
    },
  },
  {
    id: "booleano-x-texto",
    nivel: "ALERTA",
    descricao: "Veredito da aferição e texto derivado saem de fontes diferentes",
    verificar(_result, extracted) {
      const m = extracted.afericao_matematica || {};
      const problemas = [];
      if (m.composicao_confere === true && /difere/i.test(m.composicao_nota || "")) problemas.push("composição confere e a nota diz que difere");
      if (m.composicao_confere === false && !m.composicao_nota) problemas.push("composição diverge sem nota");
      if (m.cet_anual_confere === true && m.cet_anual_calculado && !m.cet_anual_convencao) problemas.push("CET anual confere sem convenção identificada");
      const algumDiverge = [m.prazo_confere, m.somatorio_confere, m.composicao_confere, m.vp_confere, m.cet_anual_confere].some((v) => v === false);
      if (algumDiverge && /N[ãa]o se identificou inconsist[êe]ncia aritm[ée]tica/i.test(m.conclusao || "")) problemas.push("conclusão afirma consistência com item divergente");
      return problemas.length ? problemas.join("; ") : null;
    },
  },
  {
    id: "domicilio-sumario-x-qualificacao",
    descricao: "Município do domicílio citado no sumário difere do § 3 sem referência manual válida",
    verificar(result, extracted) {
      const cidade = extracted.cliente?.cidade;
      const achado = (result.sumarioIrregularidades?.allFindings || result.sumarioIrregularidades?.findings || [])
        .find((f) => f.key === "gps-outro-municipio");
      if (!achado || !cidade) return null;
      const citado = achado.text?.match(/domic[ií]lio do cliente \(([^/)]+)/i)?.[1];
      if (!citado || normalizar(citado) === normalizar(cidade)) return null;
      const referenciaValida = ["DISPONIVEL", "LIBERADO_PELO_OPERADOR"].includes(result.home?.estado_confronto || "DISPONIVEL")
        && normalizar(result.home?.geo?.matchedCity) === normalizar(citado);
      return referenciaValida ? null : `sumário cita domicílio em ${citado}; § 3 registra ${cidade}`;
    },
  },
  {
    id: "biometria-clausulado-x-artefato",
    descricao: "Biometria dada como apenas mencionada no clausulado, com evento ou imagem biométrica no arquivo",
    verificar(_result, extracted) {
      const a = extracted.assinatura || {};
      const soClausulado = (a.metodos_descritos_no_fluxo || []).some((m) => /apenas|somente/i.test(m.rotulo || "") && /biometr/i.test(m.rotulo || ""));
      if (!soClausulado) return null;
      const imagens = (extracted.imagens_pdf?.imagens || []).filter((i) => i.biometricaProvavel).length;
      if (a.biometria_registrada_como_evento || imagens) {
        return `"apenas no clausulado" com ${a.biometria_registrada_como_evento ? "evento de biometria na trilha" : ""}${a.biometria_registrada_como_evento && imagens ? " e " : ""}${imagens ? `${imagens} imagem(ns) biométrica(s)` : ""}`;
      }
      return null;
    },
  },
  {
    id: "codigo-autenticacao-x-estado",
    descricao: "Estado de hash ou código declarado sem o valor correspondente",
    verificar(_result, extracted) {
      const a = extracted.assinatura || {};
      if (!a.codigo_autenticacao_declarado && /^DECLARADO/.test(a.codigo_autenticacao_estado || "")) {
        return "código de autenticação ausente com estado declarado";
      }
      if (!a.hash_documento_assinado && a.hash_declarado_estado === "DECLARADO_CONFERIVEL") {
        return "hash ausente com estado declarado e conferível";
      }
      // Forma antiga: estado do código gravado no campo do hash, sem código.
      if (!a.hash_documento_assinado && !a.codigo_autenticacao_declarado && a.hash_declarado_estado === "DECLARADO_NAO_CONFERIVEL") {
        return "estado declarado sem hash nem código";
      }
      return null;
    },
  },
  {
    id: "cet-implicito-no-extremo",
    descricao: "CET implícito coincide com extremo do intervalo de busca",
    verificar(_result, extracted) {
      const taxa = extracted.afericao_matematica?.cet_implicito_mensal_numero;
      if (!Number.isFinite(taxa)) return null;
      return [0.2, 0.0001, -0.99, 10].some((extremo) => Math.abs(taxa - extremo) < 1e-6)
        ? `CET implícito ${taxa} igual a extremo de busca`
        : null;
    },
  },
  {
    id: "data-contrato-x-juntada",
    descricao: "Data do contrato igual à data de juntada do carimbo processual",
    verificar(_result, extracted) {
      const data = extracted.contrato?.data_contrato;
      const juntada = extracted.metadados_processuais?.data_juntada;
      return data && juntada && data === juntada ? `data do contrato ${data} é a data da juntada` : null;
    },
  },
  {
    id: "distancia-com-referencia-recusada",
    descricao: "Distância calculada a partir de referência residencial recusada ou indisponível",
    verificar(result) {
      if (!["RECUSADO_CONFLITO", "INDISPONIVEL_NAO_INFORMADO"].includes(result.home?.estado_confronto)) return null;
      const comDistancia = result.contractGeo?.distance != null || (result.ipAnalysis || []).some((ip) => ip.distance != null);
      return comDistancia ? `estado ${result.home.estado_confronto} com distância à residência calculada` : null;
    },
  },
  {
    id: "produto-clt-x-beneficio-inss",
    descricao: "Consignado CLT com achado de benefício previdenciário",
    verificar(_result, extracted) {
      if (extracted.contrato?.produto_codigo !== "CONSIGNADO_CLT") return null;
      return (extracted.achados_irregularidade || []).some((a) => a.codigo === "CAD2")
        ? "achado CAD2 (benefício do INSS) em consignado CLT"
        : null;
    },
  },
  {
    id: "seguro-planilha-x-bloco",
    descricao: "Seguro cobrado na planilha sem bloco de seguro prestamista no laudo",
    verificar(_result, extracted) {
      const seguros = String(extracted.contrato?.seguros || "").replace(/\D/g, "");
      if (!seguros || Number(seguros) === 0) return null;
      const temProposta = (extracted.documentos_logicos?.documentos || []).some((d) => d.tipo === "SEGURO");
      return temProposta && !extracted.seguro_prestamista ? `planilha cobra ${extracted.contrato.seguros} de seguro e o arquivo tem proposta, mas não há bloco de seguro` : null;
    },
  },
  {
    id: "ass1-x-bloco-no-instrumento",
    descricao: "Achado de instrumento sem assinatura com bloco de assinatura localizado no instrumento",
    verificar(_result, extracted) {
      if (!(extracted.achados_irregularidade || []).some((a) => a.codigo === "ASS1")) return null;
      const principal = (extracted.documentos_logicos?.documentos || []).find((d) => d.tipo === "INSTRUMENTO_PRINCIPAL");
      return principal?.blocosAssinatura?.length ? `ASS1 emitido com bloco de assinatura na pág. ${principal.blocosAssinatura[0].pagina} do instrumento` : null;
    },
  },
  {
    id: "biometria-achado-x-bloco",
    descricao: "Achado biométrico sem o bloco do artefato que o fundamenta",
    verificar(_result, extracted) {
      const temAchado = (extracted.achados_irregularidade || []).some((a) => a.codigo === "BIO2");
      return temAchado && !extracted.imagem_biometrica ? "BIO2 sem imagem_biometrica" : null;
    },
  },
];

// Regras anteriores à rodada 2 que também produzem afirmação falsa em juízo.
const NIVEL_PADRAO = {
  "data-contrato-x-juntada": "CRITICA",
  "distancia-com-referencia-recusada": "CRITICA",
  "cet-implicito-no-extremo": "CRITICA",
  "ass1-x-bloco-no-instrumento": "CRITICA",
};

/**
 * @param {object} result resultado da análise (home, contractGeo, ipAnalysis, sumário)
 * @param {object} extracted extração estruturada
 * @returns {Array<{regra: string, descricao: string, detalhe: string}>}
 */
export function verificarCoerencia(result = {}, extracted = {}) {
  const violacoes = [];
  for (const regra of REGRAS) {
    let detalhe = null;
    let falha = false;
    try {
      detalhe = regra.verificar(result, extracted || {});
    } catch (erro) {
      falha = true;
      detalhe = `regra falhou ao executar: ${erro.message}`;
    }
    if (detalhe) violacoes.push({ classe: falha ? "FALHA_VALIDACAO" : HEURISTICAS.has(regra.id) ? "HEURISTICA" : "CONTRADICAO_MATERIAL", bloqueante: falha || !HEURISTICAS.has(regra.id), regra: regra.id, nivel: regra.nivel || NIVEL_PADRAO[regra.id] || "ALERTA", descricao: regra.descricao, detalhe });
  }
  return violacoes;
}

export const REGRAS_COERENCIA = REGRAS.map(({ id, descricao, nivel }) => ({ id, descricao, nivel: nivel || NIVEL_PADRAO[id] || "ALERTA" }));
