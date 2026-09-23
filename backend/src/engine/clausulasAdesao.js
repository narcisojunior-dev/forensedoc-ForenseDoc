/**
 * Detecção de cláusulas de adesão que "fabricam prova" (Camada 5 - O Instrumento).
 *
 * ─── Fundamentação Pericial e Jurídica ───────────────────────────────────────
 *
 * O documento de regras de perícia destaca que contratos digitais frequentemente
 * inserem cláusulas padronizadas em que o consumidor declara:
 * 1. "Admitir como válido e eficaz qualquer meio eletrônico de prova escolhido pelo credor";
 * 2. "Reconhecer como prova plena os registros informatizados internos do banco";
 * 3. "Renunciar à assinatura física ou à comprovação por certificado ICP-Brasil".
 *
 * Tais cláusulas tentam subverter por via adesiva o regime probatório legal
 * (CPC, art. 429, II e Tema 1.061/STJ), configurando nulidade de pleno direito
 * (CDC, art. 51, VI - vedação à inversão do ônus da prova em prejuízo do consumidor).
 *
 * No laudo, o perito não emite julgamento de mérito, mas assinala a existência
 * da cláusula como INDÍCIO técnico relevante de fragilidade da manifestação de vontade.
 */

const PADROES_CLAUSULA_PROVA = [
  // 1. Aceitação do meio eletrônico escolhido pelo credor
  {
    tipo: "eleicao_meio_prova",
    regex: /(?:admit|reconhec|declar|aceit)\w*\s+(?:expressamente\s+)?(?:como\s+(?:v[áa]lid[oa]|eficaz|prova\s+plena|prova\s+suficiente|meio\s+id[ôo]neo)|a\s+validade\s+d[oe])\s+(?:qualquer\s+meio|os?\s+registros|o\s+meio\s+eletr[ôo]nico|a\s+forma\s+de\s+comprova[çc][ãa]o|as?\s+informa[çc][õo]es\s+eletr[ôo]nicas|os?\s+meios\s+de\s+autentica[çc][ãa]o)\s*(?:adotad[oa]s?|escolhid[oa]s?|utilizad[oa]s?|disponibilizad[oa]s?|gerad[oa]s?\s+pel[oa]|d[oa]|constante\s+d[oa])?\s*(?:banco|credor[a]?|institui[çc][ãa]o|plataforma|sistema)/i,
  },
  // 2. Aceitação dos registros internos do próprio banco como prova definitiva
  {
    tipo: "presuncao_registros_internos",
    regex: /(?:aceit|reconhec|declar)\w*\s+(?:como\s+prova\s+plena|como\s+express[ãa]o\s+da\s+verdade|a\s+efic[áa]cia\s+probat[óo]ria)\s+(?:d[oe]s?|os?|as?)\s+(?:seus\s+pr[óo]prios\s+registros|registros\s+informatizados|logs\s+do\s+sistema|dados\s+eletr[ôo]nicos)\s*(?:do\s+banco|da\s+institui[çc][ãa]o|do\s+credor)?/i,
  },
  // 3. Renúncia a vias físicas ou impugnação do método de autenticação
  {
    tipo: "renuncia_meio_diverso",
    regex: /(?:renunci|abdic)\w*\s+(?:expressamente\s+)?(?:ao\s+direito\s+de\s+|a\s+qualquer\s+|[aà]\s+)?(?:exig[ir|ência]|impugna[çc][ãa]o|comprova[çc][ãa]o|assinatura\s+f[íi]sica|documento\s+f[íi]sico|via\s+(?:f[íi]sica|em\s+papel))/i,
  },
  // 4. Reconhecimento genérico de validade de autenticação unilateral
  {
    tipo: "autenticacao_unilateral",
    regex: /(?:as\s+partes\s+reconhecem|o\s+emitente\s+reconhece|o\s+cliente\s+reconhece|o\s+aderente\s+reconhece)\s+(?:a\s+validade|a\s+plena\s+efic[áa]cia)\s+(?:de\s+qualquer\s+mecanismo|do\s+mecanismo\s+de\s+autentica[çc][ãa]o\s+eletr[ôo]nica\s+adotado\s+pelo\s+banco)/i,
  },
  // 5. Declaração de que registros unilaterais constituem prova plena
  {
    tipo: "declaracao_prova_plena",
    regex: /(?:declar|concord|reconhec)\w*\s+que\s+(?:os\s+registros|os\s+logs|os\s+meios\s+eletr[ôo]nicos)\s*(?:do\s+banco|da\s+institui[çc][ãa]o)?\s*constituem\s+(?:prova\s+plena|comprova[çc][ãa]o\s+inequ[íi]voca|presun[çc][ãa]o\s+absoluta)/i,
  },
  // 6. Presunção absoluta de veracidade em contrato de adesão
  {
    tipo: "presuncao_absoluta_adesao",
    regex: /(?:presun[çc][ãa]o\s+absoluta\s+de\s+veracidade|efic[áa]cia\s+de\s+prova\s+plena)\s*(?:d[ao]s?\s+)?(?:assinatura\s+eletr[ôo]nica|registros\s+eletr[ôo]nicos|meios\s+digitais|aceite\s+digital)?/i,
  },
];

/**
 * Analisa o texto do instrumento contratual em busca de cláusulas abusivas de prova.
 *
 * @param {string} textoDocumento - Texto extraído integral do documento
 * @returns {object} Resultado com `detectada`, `trecho` e `achado` (ADE1)
 */
export function analisarClausulasAdesao(textoDocumento) {
  const texto = String(textoDocumento || "");
  if (!texto || texto.length < 50) {
    return { detectada: false, achado: null };
  }

  for (const { tipo, regex } of PADROES_CLAUSULA_PROVA) {
    const match = texto.match(regex);
    if (match) {
      const idx = match.index || 0;
      const start = Math.max(0, idx - 40);
      const end = Math.min(texto.length, idx + match[0].length + 100);
      const trecho = texto.slice(start, end).replace(/\s+/g, " ").trim();

      return {
        detectada: true,
        tipo,
        trecho: `“...${trecho}...”`,
        achado: {
          codigo: "ADE1",
          gravidade: "MÉDIA",
          grau: "INDÍCIO",
          titulo: "Cláusula de adesão com presunção unilateral de prova",
          texto: "O instrumento contratual contém cláusula padrão pré-impressa imputando ao consumidor a aceitação como prova plena dos registros eletrônicos gerados pelo próprio credor. O expediente transfere o ônus da autenticidade por adesão, prática contrária ao art. 51, VI, do CDC e ao regime de ônus probatório do art. 429, II, do CPC.",
        },
      };
    }
  }

  return { detectada: false, achado: null };
}
