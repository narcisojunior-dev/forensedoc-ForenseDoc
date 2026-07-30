/**
 * Cadeia de custódia da assinatura eletrônica — § 4 do laudo.
 *
 * Antes esta seção era uma lista de oito selos "PRESENTE / AUSENTE". O laudo
 * afirmava que a cadeia estava "incompleta" sem dizer o que cada elemento
 * comprova, qual norma o exige nem que consequência processual a ausência
 * produz — e um laudo que conclui sem demonstrar não sustenta impugnação.
 *
 * Este módulo transforma cada elemento em uma proposição verificável: função
 * probatória, base normativa e efeito da ausência.
 *
 * ─── Nota sobre a aplicação do CPP à matéria cível ───────────────────────────
 * Os arts. 158-A a 158-F do CPP (incluídos pela Lei 13.964/2019) disciplinam a
 * cadeia de custódia no processo PENAL. Em ação cível de revisão de contrato
 * bancário eles não incidem diretamente; são invocados como referência
 * doutrinária do padrão de rastreabilidade exigível de prova digital, uso já
 * corrente na literatura de computação forense. O laudo declara isso
 * expressamente para não sugerir aplicação direta.
 */

/** Definição legal, citada no início da seção. */
export const DEFINICAO_CADEIA_CUSTODIA =
  "O CPP, art. 158-A (Lei 13.964/2019), define cadeia de custódia como “o conjunto de todos os procedimentos utilizados para manter e documentar a história cronológica do vestígio”, com o objetivo de rastrear sua posse e manuseio desde o reconhecimento até o descarte. A norma é de processo penal e não incide diretamente nesta matéria cível; é referida como parâmetro doutrinário do grau de rastreabilidade exigível de uma prova digital. No plano técnico, a ISO/IEC 27037:2012 estabelece as diretrizes de identificação, coleta, aquisição e preservação de evidência digital, e é a referência internacional para a mesma finalidade.";

/** Por que a completude importa, em termos de ônus da prova. */
export const EFEITO_PROCESSUAL_CADEIA =
  "Impugnada a assinatura pelo consumidor, o ônus de comprovar autenticidade e integridade do documento recai sobre a instituição financeira (STJ, Tema 1.061; CPC, art. 373, e art. 429, II). A assinatura eletrônica sem certificação ICP-Brasil é válida (MP 2.200-2/2001, art. 10, § 2º; Lei 14.063/2020), mas essa validade é CONDICIONADA à demonstração de autoria e integridade — e é exatamente isso que a cadeia de custódia documenta. Cada elemento ausente subtrai um meio de prova de que a instituição dispõe para se desincumbir desse ônus.";

/**
 * Os oito elementos, cada um com função probatória, base normativa e efeito da
 * ausência. A ordem acompanha o ciclo do ato: quem, quando, de onde, como,
 * com qual integridade, com qual registro.
 */
export const ELEMENTOS_CADEIA = [
  {
    chave: "identificacao_signatario",
    nome: "Identificação do signatário",
    comprova:
      "Vincula o ato a uma pessoa determinada, por dado que só o titular deveria possuir (CPF, documento, biometria ou certificado).",
    norma: "Lei 14.063/2020, art. 4º; MP 2.200-2/2001, art. 10, § 2º",
    ausencia:
      "Sem identificação, o documento não permite atribuir autoria a ninguém, e a assinatura não se sustenta como manifestação de vontade do contratante.",
  },
  {
    chave: "carimbo_tempo",
    nome: "Carimbo de data e hora",
    comprova:
      "Fixa o instante do ato, permitindo confrontá-lo com a disponibilidade do contratante e com a sequência dos demais registros.",
    norma: "Lei 14.063/2020, art. 5º; ITI, DOC-ICP-15 (para carimbo qualificado)",
    ausencia:
      "Sem marco temporal confiável, não é possível verificar se o ato ocorreu quando a instituição afirma, nem detectar registros inseridos depois.",
  },
  {
    chave: "registro_ip",
    nome: "Registro de endereço IP",
    comprova:
      "Indica de qual conexão partiu o ato. Combinado com data e hora, é o dado que permite requisitar da operadora a identificação do assinante da conexão.",
    norma:
      "Marco Civil da Internet (Lei 12.965/2014), arts. 13 e 15 — guarda de registros de conexão por 1 ano e de acesso a aplicações por 6 meses; art. 10, § 1º e art. 22 — fornecimento mediante ordem judicial",
    ausencia:
      "Sem o IP, extingue-se a única via de rastrear a origem material da conexão. A prazo, a perda é irreversível: passados os prazos de guarda do Marco Civil, o dado deixa de existir na operadora.",
  },
  {
    chave: "geolocalizacao",
    nome: "Geolocalização do ato",
    comprova:
      "Situa o ato no espaço, permitindo o confronto com a residência do contratante e com a localização do correspondente bancário.",
    norma: "LGPD (Lei 13.709/2018), arts. 5º, I e 7º — coordenada é dado pessoal e seu tratamento exige base legal",
    ausencia:
      "Sem geolocalização, o laudo não pode aferir incompatibilidade espacial, e resta apenas o IP — cuja precisão é de nível de operadora.",
  },
  {
    chave: "metodo_autenticacao",
    nome: "Método de autenticação",
    comprova:
      "Descreve COMO a identidade foi verificada (token por SMS, biometria facial, senha, certificado) e determina o nível da assinatura.",
    norma: "Lei 14.063/2020, art. 4º, I a III — assinatura simples, avançada e qualificada",
    ausencia:
      "Sem o método declarado, não é possível classificar o nível da assinatura nem avaliar se ele era adequado ao ato praticado.",
  },
  {
    chave: "hash_integridade",
    nome: "Hash de integridade",
    comprova:
      "Permite verificar que o conteúdo assinado é idêntico ao apresentado, detectando qualquer alteração posterior de um único bit.",
    norma: "MP 2.200-2/2001, art. 10, § 1º; NIST FIPS 180-4 (SHA-2)",
    ausencia:
      "Sem hash, não há como demonstrar que o documento exibido é o mesmo que foi assinado, e a integridade fica indemonstrável por meio técnico.",
  },
  {
    chave: "trilha_auditoria",
    nome: "Trilha de auditoria",
    comprova:
      "Registra a sequência de eventos do fluxo (envio, abertura, leitura, aceite), permitindo reconstituir o que ocorreu e em que ordem.",
    norma: "CPP, art. 158-A (por analogia — história cronológica do vestígio); ISO/IEC 27037:2012",
    ausencia:
      "Sem trilha, cada registro isolado passa a depender da palavra da instituição, sem meio de conferir consistência entre eles.",
  },
  {
    chave: "evidencia_aceite",
    nome: "Evidência de aceite e manifestação de vontade",
    comprova:
      "Demonstra que o contratante teve acesso ao conteúdo e manifestou concordância, não apenas que um clique foi registrado.",
    norma: "CDC, arts. 46 e 52; CC (Lei 10.406/2002), art. 107",
    ausencia:
      "Sem evidência de aceite informado, o contrato não obriga o consumidor que não teve conhecimento prévio de seu conteúdo (CDC, art. 46).",
  },
];

/** Faixas de completude, com a leitura pericial correspondente. */
export function classifyCustodyCompleteness(presentes, total) {
  const pct = total > 0 ? Math.round((presentes / total) * 100) : 0;

  if (presentes >= 7) {
    return {
      nivel: "substancialmente_completa",
      rotulo: "SUBSTANCIALMENTE COMPLETA",
      tom: "ok",
      pct,
      leitura:
        "A cadeia reúne os elementos necessários para que a instituição comprove autoria e integridade. A ausência de certificação ICP-Brasil, se for o caso, não compromete a validade do ato.",
    };
  }
  if (presentes >= 5) {
    return {
      nivel: "parcial",
      rotulo: "PARCIAL",
      tom: "warn",
      pct,
      leitura:
        "A cadeia cobre o núcleo do ato, mas há lacunas que reduzem a robustez da prova. A instituição ainda pode se desincumbir do ônus, desde que supra os elementos faltantes por outros meios.",
    };
  }
  if (presentes >= 3) {
    return {
      nivel: "fragil",
      rotulo: "FRÁGIL",
      tom: "warn",
      pct,
      leitura:
        "Faltam elementos essenciais à demonstração de autoria ou de integridade. A prova documental, isoladamente, tende a ser insuficiente frente a impugnação fundamentada do consumidor.",
    };
  }
  return {
    nivel: "incompleta",
    rotulo: "INCOMPLETA",
    tom: "danger",
    pct,
    leitura:
      "A cadeia de custódia não documenta o ato de forma rastreável. Impugnada a assinatura, a instituição não dispõe, no documento apresentado, dos meios necessários para comprovar autenticidade e integridade (STJ, Tema 1.061).",
  };
}

/**
 * Monta a seção completa a partir do que a extração encontrou.
 *
 * @param {object} extracted resultado da extração
 * @param {Array}  ipAnalysis análise de IP do § 6 (um IP geolocalizado supre o
 *   elemento "registro de IP" mesmo sem o campo declarado)
 * @param {boolean} geoPresente geolocalização declarada foi encontrada
 */
export function buildCustodyChain(extracted, ipAnalysis = [], geoPresente = false) {
  const a = extracted.assinatura || {};
  const cc = extracted.cadeia_custodia || {};
  const cliente = extracted.cliente || {};

  const detectado = {
    identificacao_signatario: !!(
      cc.identificacao_signatario || a.titular_certificado || a.cpf_titular || cliente.nome
    ),
    carimbo_tempo: !!(cc.carimbo_tempo || a.data_hora_assinatura),
    registro_ip: !!(cc.registro_ip || ipAnalysis.length > 0),
    geolocalizacao: !!(cc.geolocalizacao || geoPresente),
    metodo_autenticacao: !!(
      cc.metodo_autenticacao ||
      a.metodos_autenticacao?.length ||
      (a.tipo && a.tipo !== "Ausente" && a.tipo !== "Indeterminado")
    ),
    hash_integridade: !!(cc.hash_integridade || a.hash_documento_assinado),
    trilha_auditoria: !!cc.trilha_auditoria,
    evidencia_aceite: !!cc.evidencia_aceite,
  };

  const elementos = ELEMENTOS_CADEIA.map((e) => ({ ...e, presente: !!detectado[e.chave] }));
  const presentes = elementos.filter((e) => e.presente).length;

  return {
    definicao: DEFINICAO_CADEIA_CUSTODIA,
    efeitoProcessual: EFEITO_PROCESSUAL_CADEIA,
    elementos,
    presentes,
    total: elementos.length,
    faltantes: elementos.filter((e) => !e.presente),
    avaliacao: classifyCustodyCompleteness(presentes, elementos.length),
  };
}
