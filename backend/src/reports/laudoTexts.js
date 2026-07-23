/**
 * Textos fixos do laudo pericial (Fase B).
 *
 * Extraídos do JSX de renderização (frontend/src/pages/Analyze.jsx e
 * ForenseDoc.jsx) para um módulo próprio, no mesmo espírito de
 * src/emails/templates.js — o gerador de PDF do servidor precisa dos mesmos
 * textos normativos e periciais, e mantê-los duplicados no cliente e no
 * servidor faria as duas versões divergirem com o tempo.
 */

export const FIRM = {
  nome: "Ronney Menezes Advocacia",
  oab: "OAB/PI 15.508 · OAB/MA 26.102-A",
  sistema: "ForenseDoc",
};

// §4 — nota sobre validade da assinatura eletrônica.
export const NOTA_ASSINATURA =
  "A validade da assinatura eletrônica não depende de certificação ICP-Brasil. A MP 2.200-2/2001 (art. 10, §2º) admite outros meios de comprovação de autoria e integridade, e a Lei 14.063/2020 reconhece as assinaturas simples, avançada e qualificada, todas com validade jurídica. O STJ consolidou esse entendimento no REsp 2.159.442 (rel. Min. Nancy Andrighi) e o reafirmou no REsp 2.205.708. O ponto decisivo não é o selo ICP-Brasil, e sim a completude da cadeia de custódia: demonstrar quem assinou, quando, de onde e com qual integridade.";

// §1 — nota sobre hash calculado pelo sistema quando o documento não traz um.
export const NOTA_HASH_SISTEMA =
  "O hash criptográfico (SHA-256) calculado por este sistema sobre o arquivo original é a impressão digital de referência do documento para fins de cadeia de custódia. Metadados são campos declarativos e podem ser alterados por editores de PDF; servem como indício técnico e devem ser avaliados em conjunto com os hashes do arquivo, a assinatura digital incorporada e a cadeia de custódia.";

// §5 — ressalva sobre distância não provar fraude.
export const NOTA_DISTANCIA =
  "A distância geográfica, isoladamente, não determina fraude. Deslocamentos compatíveis com a rotina do cliente — por exemplo, ir da zona rural à capital do estado — podem ser plenamente legítimos. Este resultado deve ser confrontado com a entrevista do cliente, com a data e hora da assinatura e com a localização do correspondente bancário antes de qualquer conclusão sobre irregularidade.";

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
  {
    grupo: "Crédito consignado e benefício do INSS",
    itens: [
      ["Lei 10.820/2003 e Decreto 4.840/2003", "Disciplinam a autorização e os limites do desconto de prestações de empréstimo consignado em folha de pagamento e em benefício previdenciário."],
      ["Lei 8.213/1991, art. 115", "Define as hipóteses e os limites de desconto sobre o valor do benefício previdenciário."],
      ["Normas do INSS sobre consignações e Resoluções do CNPS", "Regulam margem consignável, formalização e averbação. Verificar a Instrução Normativa vigente na data do contrato."],
    ],
  },
  {
    grupo: "Custo Efetivo Total (CET)",
    itens: [
      ["Resolução CMN 4.881/2020, art. 2º", "Define o CET como a taxa que representa, de forma consolidada, todos os encargos e despesas da operação."],
      ["Resolução CMN 4.881/2020, art. 7º", "Obriga a instituição a informar o CET previamente à contratação e a apresentar o demonstrativo de cálculo ao tomador."],
      ["CDC, art. 52, c/c Resolução CMN 4.881/2020", "A ausência, a incorreção ou a inconsistência do CET frente à taxa de juros caracteriza falha no dever de informação."],
    ],
  },
  {
    grupo: "Assinatura eletrônica e ônus da prova",
    itens: [
      ["MP 2.200-2/2001, art. 10, § 2º", "Admite outros meios de comprovação de autoria e integridade, além da certificação ICP-Brasil."],
      ["Lei 14.063/2020", "Classifica as assinaturas em simples, avançada e qualificada, todas com validade jurídica conforme o grau de segurança."],
      ["STJ, REsp 2.159.442 e REsp 2.205.708", "A ausência de certificação ICP-Brasil não invalida, por si só, a assinatura, desde que comprovadas autoria e integridade."],
      ["STJ, Tema 1.061, c/c CPC, art. 373", "Impugnada a assinatura em contrato bancário, cabe à instituição financeira comprovar a autenticidade e a integridade do documento."],
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

export const NOTA_FUNDAMENTACAO_RESSALVA =
  "A fundamentação acima é referencial e deve ser ajustada ao caso concreto e à data da contratação. A indicação dos dispositivos não dispensa a conferência da redação vigente de cada norma no momento do contrato.";

export function avisoLegal(timestamp) {
  return (
    `AVISO LEGAL: Este laudo foi gerado automaticamente pelo sistema ForenseDoc (${FIRM.nome}, ${FIRM.oab}) ` +
    "para fins de análise jurídica preliminar. Os hashes criptográficos SHA-256 e SHA-1 foram calculados pelo " +
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
