/**
 * Textos fixos do laudo pericial (Fase B).
 *
 * Extraídos do JSX de renderização (frontend/src/pages/Analyze.jsx e
 * ForenseDoc.jsx) para um módulo próprio, no mesmo espírito de
 * src/emails/templates.js — o gerador de PDF do servidor precisa dos mesmos
 * textos normativos e periciais, e mantê-los duplicados no cliente e no
 * servidor faria as duas versões divergirem com o tempo.
 */

/*
 * O laudo é emitido pelo sistema, não por um escritório: quem responde pelo
 * método e pelo resultado é o ForenseDoc. A qualificação do advogado que usa o
 * sistema, quando necessária, é dele e entra na peça processual, não aqui.
 */
export const FIRM = {
  nome: "ForenseDoc",
  descricao: "Verificação técnica e validação de cadeia de custódia documental",
  sistema: "ForenseDoc",
};

// §4 — nota sobre validade da assinatura eletrônica.
export const NOTA_ASSINATURA =
  "A ausência de certificação ICP-Brasil, por si só, não invalida uma assinatura eletrônica (MP 2.200-2/2001, art. 10, § 2º; STJ, REsp 2.159.442 e REsp 2.197.156). A validade no caso concreto depende do método aceito, dos elementos de autoria e integridade e da apreciação do conjunto probatório. A classificação de assinaturas pela Lei 14.063/2020 não dispensa a verificação de seu âmbito de aplicação e dos requisitos do ato. A contagem de itens de um checklist não substitui essa análise.";

// §1 — nota sobre hash calculado pelo sistema quando o documento não traz um.
export const NOTA_HASH_SISTEMA =
  "O hash criptográfico (SHA-256) calculado por este sistema sobre o arquivo original é a impressão digital de referência do documento para fins de cadeia de custódia. Metadados são campos declarativos e podem ser alterados por editores de PDF; servem como indício técnico e devem ser avaliados em conjunto com os hashes do arquivo, a assinatura digital incorporada e a cadeia de custódia.";

// §5 — ressalva sobre distância não provar fraude.
export const NOTA_DISTANCIA =
  "A distância geográfica, isoladamente, não determina fraude. Deslocamentos compatíveis com a rotina do cliente, como ir da zona rural à capital do estado, podem ser plenamente legítimos. Este resultado deve ser confrontado com a entrevista do cliente, com a data e hora da assinatura e com a localização do correspondente bancário antes de qualquer conclusão sobre irregularidade.";

// Marco normativo do consignado, escolhido pelo produto classificado.
//
// O laudo do dossiê C6 citou a Lei 8.213/1991 e as normas do INSS numa operação
// de consignado do trabalhador celetista. Para CLT fica só a Lei 10.820/2003,
// que é segura; a regulamentação do Crédito do Trabalhador (averbação pela
// CTPS Digital) entra depois de validada pelo jurídico.
// TODO(jurídico): acrescentar a regulamentação vigente do Crédito do
// Trabalhador ao grupo CONSIGNADO_CLT.
const GRUPOS_CONSIGNADO = {
  CONSIGNADO_INSS: {
    grupo: "Crédito consignado e benefício do INSS",
    itens: [
      ["Lei 10.820/2003 e Decreto 4.840/2003", "Disciplinam a autorização e os limites do desconto de prestações de empréstimo consignado em folha de pagamento e em benefício previdenciário."],
      ["Lei 8.213/1991, art. 115", "Define as hipóteses e os limites de desconto sobre o valor do benefício previdenciário."],
      ["Normas do INSS sobre consignações e Resoluções do CNPS", "Regulam margem consignável, formalização e averbação. Verificar a Instrução Normativa vigente na data do contrato."],
    ],
  },
  CONSIGNADO_CLT: {
    grupo: "Crédito consignado do trabalhador (CLT)",
    itens: [
      ["Lei 10.820/2003", "Disciplina a autorização para desconto de prestações de empréstimos em folha de pagamento dos empregados regidos pela CLT, os limites da consignação e as obrigações do empregador na retenção e no repasse."],
    ],
  },
  // Servidor público: nem a Lei 10.820/2003 (CLT e INSS) nem a Lei 8.213/1991
  // regem a folha do servidor. A CCB Credcesta de servidora do GOV SP saía com
  // o bloco do INSS.
  // TODO(jurídico): conferir no DOU a redação do art. 45 da Lei 8.112/1990
  // vigente na data do contrato (parágrafos da Lei 13.172/2015) antes de citar
  // parágrafo.
  CONSIGNADO_SERVIDOR: {
    grupo: "Crédito consignado de servidor público",
    itens: [
      ["Lei 8.112/1990, art. 45", "Para o servidor público federal, admite consignação em folha de pagamento a favor de terceiros mediante autorização do servidor, na forma do regulamento."],
      ["Estatuto e regulamento do ente pagador", "Para servidor estadual ou municipal, a consignação em folha segue o estatuto e o regulamento do ente indicado como fonte pagadora no instrumento, a conferir na redação vigente na data do contrato."],
    ],
  },
};

// Produto não classificado mantém o grupo anterior, para não retirar
// fundamentação de documentos que já saíam com ela.
const GRUPO_CONSIGNADO = GRUPOS_CONSIGNADO.CONSIGNADO_INSS;

// §9 — fundamentação normativa, agrupada por tema.
export const FUNDAMENTACAO = [
  {
    grupo: "Relação de consumo e dever de informação",
    itens: [
      ["CDC (Lei 8.078/1990), art. 6º, III", "Direito do consumidor à informação adequada, clara e ostensiva sobre o produto de crédito, seus riscos e seu preço."],
      ["CDC, art. 46", "O contrato não obriga o consumidor que não teve conhecimento prévio de seu conteúdo ou cujos termos sejam de difícil compreensão."],
      ["CDC, art. 52", "No fornecimento de crédito, a instituição deve informar previamente preço, montante dos juros, acréscimos, número e periodicidade das prestações e a soma total a pagar."],
      ["CDC, art. 51, IV e § 1º", "Nulidade de cláusulas que coloquem o consumidor em desvantagem exagerada ou incompatíveis com a boa-fé."],
      ["Súmula 297 do STJ", "O Código de Defesa do Consumidor é aplicável às instituições financeiras."],
    ],
  },
  GRUPO_CONSIGNADO,
  {
    grupo: "Assinatura eletrônica e ônus da prova",
    itens: [
      ["MP 2.200-2/2001, art. 10, § 2º", "Admite outros meios de comprovação de autoria e integridade, além da certificação ICP-Brasil."],
      ["Lei 14.063/2020", "Define categorias de assinatura em seu âmbito de aplicação; a categoria, isoladamente, não comprova validade no caso concreto."],
      ["STJ, REsp 2.159.442 e REsp 2.197.156", "A ausência de certificação ICP-Brasil não invalida, por si só, a assinatura, desde que comprovadas autoria e integridade."],
      ["STJ, Tema 1.061, CPC arts. 6º, 369 e 429, II", "Quando o consumidor impugna a autenticidade da assinatura em contrato bancário juntado pela instituição financeira, cabe a ela provar a autenticidade. A existência de impugnação neste caso não foi demonstrada pelo dossiê."],
    ],
  },
  {
    grupo: "Vícios contratuais e boa-fé",
    itens: [
      ["CC (Lei 10.406/2002), arts. 138, 145 e 157", "Erro, dolo e lesão como vícios do consentimento aptos a invalidar o negócio jurídico."],
      ["CC, art. 422", "Dever de probidade e boa-fé objetiva na conclusão e na execução do contrato."],
      ["CDC, arts. 54-A a 54-G (Lei 14.181/2021)", "Prevenção e tratamento do superendividamento e do crédito responsável."],
      ["Súmula 479 do STJ", "Responsabilidade objetiva da instituição por fraudes e delitos de terceiros no âmbito das operações bancárias."],
    ],
  },
  {
    grupo: "Proteção de dados (geolocalização e logs)",
    itens: [
      ["LGPD (Lei 13.709/2018), arts. 5º e 7º", "Coordenadas de geolocalização e registros de IP são dados pessoais; seu tratamento exige base legal e pode ser objeto de verificação probatória."],
    ],
  },
];

/**
 * Fundamentação aplicável ao produto classificado na extração.
 * CDC e renegociação não recebem grupo de consignado; os demais recebem o do
 * próprio produto. No consignado INSS com regime enquadrado, o item genérico
 * ("verificar a IN vigente") dá lugar às normas do regime da data do contrato.
 */
export function fundamentacaoPara(produtoCodigo, regime = null) {
  return FUNDAMENTACAO.flatMap((bloco) => {
    if (bloco !== GRUPO_CONSIGNADO) return [bloco];
    if (produtoCodigo === "CDC") return [];
    const grupo = GRUPOS_CONSIGNADO[produtoCodigo] || GRUPO_CONSIGNADO;
    const doRegime = regime?.fundamentacao || [];
    if (grupo !== GRUPOS_CONSIGNADO.CONSIGNADO_INSS || !doRegime.length) return [grupo];
    return [{ ...grupo, itens: [...grupo.itens.filter(([dispositivo]) => !/^Normas do INSS/.test(dispositivo)), ...doRegime] }];
  });
}

export const NOTA_FUNDAMENTACAO_RESSALVA =
  "A fundamentação acima é referencial e deve ser ajustada ao caso concreto e à data da contratação. A indicação dos dispositivos não dispensa a conferência da redação vigente de cada norma no momento do contrato.";

export function avisoLegal(timestamp) {
  return (
    `AVISO LEGAL: Este laudo foi gerado automaticamente pelo sistema ${FIRM.sistema} ` +
    "para fins de verificação técnica preliminar da cadeia de custódia do documento. As condições econômicas da " +
    "operação não integram o exame. Os hashes criptográficos SHA-256 e SHA-1 foram calculados pelo " +
    "servidor sobre o arquivo original recebido (NIST FIPS 180-4). A geolocalização de IPs é fornecida por " +
    "serviço de terceiros (ipapi.co) e possui margem de erro inerente; endereços de ISPs e VPNs podem não " +
    "refletir a localização física real do usuário. A geolocalização declarada da assinatura é extraída do " +
    "próprio documento e a geocodificação de endereços usa o serviço OpenStreetMap Nominatim. A fórmula de " +
    "Haversine calcula a distância geodésica sobre a superfície esférica terrestre. A distância geográfica, " +
    "isoladamente, não constitui prova de fraude e deve ser ponderada com o contexto fático. Este documento " +
    "deve ser complementado por análise pericial humana qualificada antes de ser utilizado como prova técnica " +
    `definitiva nos autos. Gerado em ${timestamp}.`
  );
}
