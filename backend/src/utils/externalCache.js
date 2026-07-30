import crypto from "node:crypto";
import { redis } from "./redis.js";

/**
 * Cache das consultas a serviços externos.
 *
 * ─── Por que isto é limite de produto, não otimização ────────────────────────
 *
 * Nenhuma consulta externa era cacheada. Por análise o sistema chamava até duas
 * vezes o Nominatim (geocodificação), uma vez por IP único o provedor de
 * geolocalização, e duas vezes o Geoapify a CADA geração de PDF.
 *
 * As cotas gratuitas param muito antes do volume de um SaaS B2B:
 *
 *   Nominatim   política de 1 req/s; uso automatizado pesado é bloqueado por IP
 *   ipapi.co    ~1.000 consultas por dia
 *   Geoapify    3.000 créditos por dia, 2 por laudo gerado
 *
 * O Nominatim é o mais delicado: não é questão de pagar mais, é questão de estar
 * violando os termos de uso. E quando qualquer um deles falha, o laudo sai
 * degradado (sem mapa, sem geolocalização) sem que ninguém seja avisado.
 *
 * O cache ataca a repetição real do domínio, que é alta: os documentos de um
 * mesmo cliente repetem o endereço da residência, repetem o mesmo IP em vários
 * eventos da trilha de assinatura, e o mesmo laudo é baixado mais de uma vez.
 *
 * ─── Fail-open, sempre ───────────────────────────────────────────────────────
 *
 * Redis fora do ar não pode impedir a geração do laudo. Toda falha de cache é
 * registrada e ignorada: o pior caso é o comportamento anterior, que é consultar
 * o serviço externo.
 */

/** TTLs em segundos, por natureza do dado. */
export const TTL = {
  // Coordenada de um endereço não muda. O ano é para o cache não virar um
  // registro permanente de endereços consultados, o que é dado pessoal (LGPD).
  geocode: Number(process.env.CACHE_TTL_GEOCODE) || 365 * 24 * 3600,

  // Alocação de bloco de IP muda com o tempo, e uma atribuição errada
  // envelhecida vira erro num laudo pericial. Trinta dias é conservador.
  geoip: Number(process.env.CACHE_TTL_GEOIP) || 30 * 24 * 3600,

  /*
   * Mapa estático: TTL curto de propósito, porque aqui o cache CONSOME memória
   * de forma proporcional ao volume, e memória do Redis é o recurso que a fase 2
   * está justamente tentando desafogar.
   *
   * Medido: os dois mapas de um laudo ocupam cerca de 300 KB em base64. O
   * consumo em regime é `laudos por dia x (TTL em horas / 24) x 300 KB`:
   *
   *   1.000 laudos/dia, TTL 24h  ->  ~300 MB
   *   1.000 laudos/dia, TTL  6h  ->  ~75 MB
   *
   * Seis horas capturam o padrão real de repetição, que é o advogado gerar o
   * laudo, conferir e gerar de novo para anexar ao processo. Esticar para dias
   * pouco acrescenta em acerto e multiplica a memória.
   */
  staticMap: Number(process.env.CACHE_TTL_STATIC_MAP) || 6 * 3600,
};

/**
 * Teto para não cachear imagem anômala.
 *
 * Um mapa costuma ter entre 100 e 250 KB. Uma resposta muito acima disso indica
 * mudança na API ou erro devolvido como imagem, e guardá-la envenena a memória
 * sem trazer acerto útil.
 */
const MAX_BYTES_CACHE = Number(process.env.CACHE_MAX_BYTES) || 1024 * 1024;

/** Chave estável e curta: a consulta pode ser um endereço longo. */
function chave(namespace, entrada) {
  const digest = crypto.createHash("sha1").update(String(entrada)).digest("hex").slice(0, 24);
  return `extcache:${namespace}:${digest}`;
}

/**
 * Consulta o cache; em falta, executa `buscar` e grava o resultado.
 *
 * Resultado nulo NÃO é cacheado de propósito. Um endereço que não geocodificou
 * hoje pode geocodificar amanhã, e gravar a ausência transformaria uma falha
 * transitória de rede em ausência permanente no laudo.
 */
export async function cached(namespace, entrada, ttlSegundos, buscar) {
  const k = chave(namespace, entrada);

  try {
    const bruto = await redis.get(k);
    if (bruto) return JSON.parse(bruto);
  } catch (err) {
    console.error(`[Cache] Leitura de '${namespace}' falhou:`, err.message);
  }

  const valor = await buscar();
  if (valor == null) return valor;

  try {
    await redis.setex(k, ttlSegundos, JSON.stringify(valor));
  } catch (err) {
    console.error(`[Cache] Gravação de '${namespace}' falhou:`, err.message);
  }

  return valor;
}

/**
 * Variante para conteúdo binário (imagem de mapa).
 *
 * JSON.stringify de um Buffer produz `{"type":"Buffer","data":[...]}`, que é
 * cerca de quatro vezes o tamanho original. Base64 acrescenta 33% e é o formato
 * que o ioredis transporta sem corromper.
 */
export async function cachedBuffer(namespace, entrada, ttlSegundos, buscar) {
  const k = chave(namespace, entrada);

  try {
    const b64 = await redis.get(k);
    if (b64) return Buffer.from(b64, "base64");
  } catch (err) {
    console.error(`[Cache] Leitura de '${namespace}' falhou:`, err.message);
  }

  const buffer = await buscar();
  if (!buffer) return buffer;

  if (buffer.length > MAX_BYTES_CACHE) {
    console.warn(
      `[Cache] '${namespace}' devolveu ${Math.round(buffer.length / 1024)} KB, ` +
        `acima do teto de ${Math.round(MAX_BYTES_CACHE / 1024)} KB. Não será cacheado.`
    );
    return buffer;
  }

  try {
    await redis.setex(k, ttlSegundos, buffer.toString("base64"));
  } catch (err) {
    console.error(`[Cache] Gravação de '${namespace}' falhou:`, err.message);
  }

  return buffer;
}
