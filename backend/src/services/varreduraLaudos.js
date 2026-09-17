/**
 * Critérios para identificar laudos emitidos antes das correções da homologação
 * do dossiê C6 (fases 0 a 5) que podem conter as mesmas afirmações falsas.
 *
 * Função pura sobre o resultado persistido: nenhuma consulta externa e nenhuma
 * escrita. A decisão de reprocessar ou avisar o cliente é humana.
 */

const lerExtraido = (result) => {
  if (!result?.text) return {};
  try {
    return typeof result.text === "string" ? JSON.parse(result.text) : result.text;
  } catch {
    return {};
  }
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CRITERIOS = [
  {
    id: "cet-implicito-no-teto",
    descricao: "CET implícito igual ao teto antigo de 20% ao mês, com indício de subdeclaração possivelmente falso",
    gravidade: "ALTA",
    testar: (_r, e) => {
      const m = e.afericao_matematica || {};
      return Math.abs(Number(m.cet_implicito_mensal_numero) - 0.2) < 1e-6 || m.cet_implicito_mensal === "20,0000%";
    },
  },
  {
    id: "data-contrato-suspeita",
    descricao: "Primeiro vencimento anterior à data do contrato: data do contrato provavelmente lida de outro quadro (carimbo do tribunal)",
    gravidade: "ALTA",
    testar: (_r, e) => Boolean(e.contrato?.datas_nota) || Number(e.afericao_matematica?.carencia_dias) < 0,
  },
  {
    id: "referencia-manual-outra-uf",
    descricao: "Distâncias calculadas a partir de endereço manual em UF diferente da do instrumento",
    gravidade: "ALTA",
    testar: (r, e) => {
      const ufManual = r.home?.geo?.matchedUf;
      const ufInstrumento = e.cliente?.estado;
      return /manual/i.test(r.home?.source || "") && !r.home?.estado_confronto && ufManual && ufInstrumento
        && String(ufManual).toUpperCase() !== String(ufInstrumento).toUpperCase();
    },
  },
  {
    id: "composicao-sem-seguro",
    descricao: "Composição do financiado marcada como divergente pela fórmula antiga (liberado + IOF, sem seguro e tarifa)",
    gravidade: "MÉDIA",
    testar: (_r, e) => e.afericao_matematica?.composicao_confere === false && !e.afericao_matematica?.composicao_componentes,
  },
  {
    id: "anualizacao-12-meses",
    descricao: "Anualização do CET marcada como divergente só pela convenção de 12 meses",
    gravidade: "MÉDIA",
    testar: (_r, e) => e.afericao_matematica?.cet_anual_confere === false && !e.afericao_matematica?.cet_anual_convencao,
  },
  {
    id: "protocolo-como-hash",
    descricao: "Número de protocolo (UUID) tratado como hash declarado",
    gravidade: "MÉDIA",
    testar: (_r, e) => UUID.test(String(e.assinatura?.hash_documento_assinado || "")),
  },
  {
    id: "beneficio-inss-sem-classificacao",
    descricao: "Achado de benefício do INSS emitido antes da classificação de produto (pode ser consignado CLT)",
    gravidade: "MÉDIA",
    testar: (_r, e) => !e.contrato?.produto_codigo && (e.achados_irregularidade || []).some((a) => a.codigo === "CAD2"),
  },
  {
    id: "reimpressao-atribuida-ao-banco",
    descricao: "Arquivo classificado como reimpressão posterior, sem verificação de carimbo de sistema processual",
    gravidade: "MÉDIA",
    testar: (r, e) => r.metadata?.digitalSignature?.procedencia?.procedencia === "REIMPRESSAO_POSTERIOR_PROVAVEL" && !("metadados_processuais" in e),
  },
];

/**
 * @param {object} result `Analysis.result`
 * @returns {Array<{id: string, descricao: string, gravidade: string}>}
 */
export function avaliarAnaliseAfetada(result) {
  const extraido = lerExtraido(result);
  return CRITERIOS.filter((c) => {
    try {
      return c.testar(result || {}, extraido);
    } catch {
      return false;
    }
  }).map(({ id, descricao, gravidade }) => ({ id, descricao, gravidade }));
}

export const CRITERIOS_VARREDURA = CRITERIOS.map(({ id, descricao, gravidade }) => ({ id, descricao, gravidade }));
