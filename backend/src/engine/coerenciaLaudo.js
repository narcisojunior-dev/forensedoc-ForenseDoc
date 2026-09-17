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
 * ─── Modo alerta ─────────────────────────────────────────────────────────────
 *
 * Registra em `result.coerencia`, no log e na tela do laudo (fora do PDF). Com
 * `COERENCIA_BLOQUEANTE=true`, a exportação em PDF fica bloqueada enquanto houver
 * contradição. O padrão é desligado: bloquear sem política de estorno do crédito
 * puniria o cliente por defeito do sistema.
 */

export function coerenciaBloqueante() {
  return process.env.COERENCIA_BLOQUEANTE === "true";
}

const normalizar = (valor) =>
  String(valor || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .trim();

const REGRAS = [
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
      const soClausulado = (a.metodos_mencionados_clausulado || []).some((m) => /biometr/i.test(m));
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

/**
 * @param {object} result resultado da análise (home, contractGeo, ipAnalysis, sumário)
 * @param {object} extracted extração estruturada
 * @returns {Array<{regra: string, descricao: string, detalhe: string}>}
 */
export function verificarCoerencia(result = {}, extracted = {}) {
  const violacoes = [];
  for (const regra of REGRAS) {
    let detalhe = null;
    try {
      detalhe = regra.verificar(result, extracted || {});
    } catch (erro) {
      detalhe = `regra falhou ao executar: ${erro.message}`;
    }
    if (detalhe) violacoes.push({ regra: regra.id, descricao: regra.descricao, detalhe });
  }
  return violacoes;
}

export const REGRAS_COERENCIA = REGRAS.map(({ id, descricao }) => ({ id, descricao }));
