import "dotenv/config";

/**
 * Endereço do serviço de geocodificação, em um lugar só.
 *
 * ─── Por que isto existe ─────────────────────────────────────────────────────
 *
 * A URL do Nominatim público estava fixa em DOIS arquivos (`apiService.js` e
 * `geocodingService.js`), e `NOMINATIM_API_KEY` aparecia como variável
 * obrigatória na documentação de produção sem ser lida por nenhuma linha de
 * código. Ou seja: contratar o provedor pago não mudava nada, e o servidor
 * continuava batendo no serviço público.
 *
 * Isso não é questão de cota. O serviço público do OpenStreetMap proíbe uso
 * automatizado pesado e bloqueia POR IP DO SERVIDOR, sem aviso. Quando o
 * bloqueio chega, a geocodificação para para todos os clientes ao mesmo tempo,
 * e o laudo passa a sair sem a coordenada de referência.
 *
 * ─── Como apontar para o provedor contratado ─────────────────────────────────
 *
 * Provedores compatíveis com a API do Nominatim (LocationIQ, Geocode.earth,
 * instância própria) mudam três coisas: o host, o nome do parâmetro da chave e,
 * às vezes, o caminho. Todas são configuráveis:
 *
 *   NOMINATIM_BASE_URL=https://us1.locationiq.com/v1
 *   NOMINATIM_API_KEY=pk.xxxxxxxx
 *   NOMINATIM_KEY_PARAM=key
 *
 * O default continua sendo o serviço público, porque em desenvolvimento ele é o
 * caminho certo: uma consulta manual ocasional está dentro da política de uso.
 * O que não pode acontecer é produção usar esse default em silêncio, e por isso
 * `avisarSeServicoPublico()` reclama no boot.
 */

const BASE_URL = (process.env.NOMINATIM_BASE_URL || "https://nominatim.openstreetmap.org").replace(
  /\/+$/,
  ""
);

const API_KEY = process.env.NOMINATIM_API_KEY || "";

/** LocationIQ e Nominatim hospedado usam `key`; Geocode.earth usa `api_key`. */
const KEY_PARAM = process.env.NOMINATIM_KEY_PARAM || "key";

/**
 * A política de uso do Nominatim exige User-Agent identificando a aplicação.
 * Vinha fixo com o nome do escritório, o que quebra assim que o produto atende
 * outro cliente, e divergia entre os dois arquivos (2.2 num, 3.0 no outro).
 */
export const NOMINATIM_UA =
  process.env.NOMINATIM_USER_AGENT || "ForenseDoc/3.0 (contato@forensedoc.com.br)";

const HOST_PUBLICO = "nominatim.openstreetmap.org";

export function usandoServicoPublico() {
  return BASE_URL.includes(HOST_PUBLICO);
}

/**
 * Monta a URL de busca, já com a chave quando houver.
 *
 * `params` recebe os parâmetros específicos de cada chamador: a busca simples
 * do `apiService` pede `limit=1`, e a busca verificada do `geocodingService`
 * pede `addressdetails` e `countrycodes`.
 */
export function buildSearchUrl(query, params = {}) {
  const url = new URL(`${BASE_URL}/search`);
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("accept-language", "pt-BR");
  for (const [chave, valor] of Object.entries(params)) {
    if (valor !== undefined && valor !== null) url.searchParams.set(chave, String(valor));
  }
  if (API_KEY) url.searchParams.set(KEY_PARAM, API_KEY);
  return url.toString();
}

/**
 * Chamado no boot da API e do worker.
 *
 * O aviso existe porque a falha desta configuração é silenciosa até o dia do
 * bloqueio: sem ele, a única evidência de que o servidor usa o serviço público
 * seria a geocodificação parar de responder para todo mundo de uma vez.
 */
export function avisarSeServicoPublico() {
  if (process.env.NODE_ENV === "production" && usandoServicoPublico()) {
    console.warn(
      "[Geocode] NOMINATIM_BASE_URL não configurada: usando o serviço público do " +
        "OpenStreetMap em produção. A política de uso dele proíbe uso automatizado " +
        "pesado e o bloqueio é por IP do servidor, sem aviso. Configure o provedor " +
        "contratado (NOMINATIM_BASE_URL, NOMINATIM_API_KEY)."
    );
    return true;
  }
  return false;
}
