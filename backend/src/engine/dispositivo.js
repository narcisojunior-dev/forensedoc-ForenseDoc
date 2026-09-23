/**
 * Aparelho e navegador registrados no dossiê, como bloco próprio do laudo.
 *
 * ─── Por que ─────────────────────────────────────────────────────────────────
 *
 * O dossiê C6 traz "Navegador e versão do celular: Mozilla/5.0 (Linux; Android
 * 11; moto e32) ... Chrome/94.0.4606.85" e "Identificador do aparelho:
 * jcHJ8qqZkProloI78hLl". O laudo disse só "identificador de aparelho
 * registrado" e não mostrou nem o modelo nem o navegador. O perito pergunta
 * duas coisas com esses dados: a cliente tem um Moto E32? E por que um Chrome
 * de setembro de 2021 numa contratação de dezembro de 2024? Navegador parado no
 * tempo é compatível com WebView de aplicativo ou com user agent fixado por
 * ferramenta. Não prova nada sozinho; é pergunta para o perito e para a
 * cliente, e precisa estar escrita no laudo.
 */
import { parseUserAgentForensic } from "../utils/userAgentParser.js";
import { instanteDe } from "./metadadosDatas.js";
import { GRAUS } from "./grausConclusao.js";

/** Datas aproximadas de lançamento de versões principais do Chrome (canal estável). */
const CHROME_MARCOS = [
  [80, Date.UTC(2020, 1, 4)],
  [90, Date.UTC(2021, 3, 14)],
  [94, Date.UTC(2021, 8, 21)],
  [100, Date.UTC(2022, 2, 29)],
  [110, Date.UTC(2023, 1, 7)],
  [120, Date.UTC(2023, 11, 5)],
  [130, Date.UTC(2024, 9, 15)],
  [140, Date.UTC(2025, 8, 2)],
];
const QUATRO_SEMANAS = 28 * 86_400_000;

/** Data aproximada de lançamento de uma versão principal do Chrome. */
export function lancamentoChrome(major) {
  if (!Number.isFinite(major)) return null;
  const primeiro = CHROME_MARCOS[0];
  const ultimo = CHROME_MARCOS.at(-1);
  if (major <= primeiro[0]) return primeiro[1] - (primeiro[0] - major) * 6 * 7 * 86_400_000;
  if (major >= ultimo[0]) return ultimo[1] + (major - ultimo[0]) * QUATRO_SEMANAS;
  for (let i = 1; i < CHROME_MARCOS.length; i += 1) {
    const [vA, tA] = CHROME_MARCOS[i - 1];
    const [vB, tB] = CHROME_MARCOS[i];
    if (major >= vA && major <= vB) return tA + ((major - vA) / (vB - vA)) * (tB - tA);
  }
  return null;
}

/** Versão principal do Chrome esperada numa data, pela mesma tabela. */
export function chromeEsperadoEm(instante) {
  if (!Number.isFinite(instante)) return null;
  const ultimo = CHROME_MARCOS.at(-1);
  if (instante >= ultimo[1]) return ultimo[0] + Math.floor((instante - ultimo[1]) / QUATRO_SEMANAS);
  for (let i = 1; i < CHROME_MARCOS.length; i += 1) {
    const [vA, tA] = CHROME_MARCOS[i - 1];
    const [vB, tB] = CHROME_MARCOS[i];
    if (instante >= tA && instante <= tB) return Math.floor(vA + ((instante - tA) / (tB - tA)) * (vB - vA));
  }
  return CHROME_MARCOS[0][0];
}

const UA_RE = /(Mozilla\/5\.0\s*\([^)]*\)[^\n]{0,260}?)(?=\s+Identificador|\s{2,}|\n|$)/;
const IDENT_RE = /Identificador\s+do\s+(?:aparelho|dispositivo)\s*:?\s*([A-Za-z0-9_\-]{6,64})/i;
const MODELO_RE = /\(Linux;\s*Android\s*[0-9.]+;\s*([^;)]+?)(?:\s*Build\/[^;)]*)?\)/i;

/**
 * @param {object} args
 * @param {string} args.flat texto corrido do PDF
 * @param {Array<{user_agent?:string|null}>} [args.ips] registros de IP da extração
 * @param {string|null} [args.dataAto] "dd/mm/aaaa hh:mm[:ss]" do ato
 * @param {string|null} [args.fusoAto] rótulo do fuso do ato, se houver
 */
export function analisarDispositivo({ flat, ips = [], dataAto = null, fusoAto = null }) {
  const texto = String(flat || "");
  // O texto extraído do PDF quebra versões em "Chrome/94. 0.4606.85"; sem
  // recolar, o parser lia "94." como versão.
  const recolar = (s) => (s ? String(s).replace(/(\d)\.\s+(?=\d)/g, "$1.").trim() : null);
  const uaTexto = recolar((ips || []).map((ip) => ip?.user_agent).find(Boolean) || texto.match(UA_RE)?.[1] || null);
  const identificador = texto.match(IDENT_RE)?.[1] || null;
  if (!uaTexto && !identificador) return null;

  const ua = uaTexto ? parseUserAgentForensic(uaTexto) : null;
  // "Android 10; K" é o user agent reduzido do Chrome (a partir da versão 110):
  // a letra K substitui o modelo. Não é um aparelho chamado K.
  const modeloBruto = uaTexto?.match(MODELO_RE)?.[1]?.trim() || null;
  const uaReduzido = modeloBruto === "K";
  const modelo = uaReduzido ? null : modeloBruto;
  const iphone = uaTexto && /iPhone/i.test(uaTexto) ? "iPhone" : null;
  const webview = uaTexto ? /\bwv\b|; wv\)|Version\/\d+\.\d+ Chrome\//.test(uaTexto) : false;

  const achados = [];
  const major = ua?.browser === "Google Chrome" && ua.browserVersion ? Number(String(ua.browserVersion).split(".")[0]) : null;
  const instanteAto = dataAto ? instanteDe(dataAto, fusoAto && /GMT|UTC/i.test(fusoAto) ? 0 : 180) : null;
  let defasagem = null;
  if (major && instanteAto) {
    const lancamento = lancamentoChrome(major);
    const esperado = chromeEsperadoEm(instanteAto);
    const meses = lancamento ? Math.floor((instanteAto - lancamento) / (30.4 * 86_400_000)) : null;
    defasagem = { versao: major, esperado, meses };
    if (meses !== null && meses >= 12) {
      achados.push({
        codigo: "DEV2",
        gravidade: "INFO",
        titulo: "Navegador com versão antiga para a data do ato",
        texto: `O user agent registrado declara Chrome ${ua.browserVersion}, versão principal ${major}, lançada por volta de ${new Date(lancamento).toLocaleDateString("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" })}. Na data do ato (${dataAto}) a versão corrente do Chrome era aproximadamente a ${esperado}; a diferença é de cerca de ${meses} meses. Navegador de celular com atualização automática não costuma ficar tanto tempo parado. O quadro é compatível com WebView embutido em aplicativo, com navegador de aparelho sem atualização ou com user agent fixado por ferramenta de automação. Isoladamente não prova nada; é ponto a esclarecer com os registros da plataforma (canal de contratação: aplicativo, site ou tablet de correspondente) e com o cliente (modelo e navegador do aparelho que usava na data).`,
        grau: GRAUS.INDICIO,
        ancora: { pagina: null, trecho: uaTexto.slice(0, 160) },
      });
    }
  }
  if (identificador && !modelo && !iphone) {
    achados.push({
      codigo: "DEV3",
      gravidade: "INFO",
      titulo: "Identificador de aparelho sem modelo",
      texto: `O dossiê registra o identificador "${identificador}" para o aparelho, sem fabricante nem modelo${uaReduzido ? " (o navegador enviou user agent reduzido, em que a letra K substitui o modelo)" : ""}. Identificador gerado pela plataforma só tem valor se a plataforma exibir o histórico de aparelhos vinculados ao CPF e a data em que este foi vinculado.`,
      grau: GRAUS.NAO_VERIFICAVEL,
      ancora: { pagina: null, trecho: `Identificador do aparelho: ${identificador}` },
    });
  }

  const resumo = [
    modelo || iphone,
    ua ? `${ua.os}${ua.osVersion ? ` ${ua.osVersion}` : ""}` : null,
    ua ? `${ua.browser}${ua.browserVersion ? ` ${ua.browserVersion}` : ""}` : null,
    webview ? "WebView provável" : null,
  ].filter(Boolean).join(" · ");

  return {
    user_agent: uaTexto,
    sistema: ua?.os || null,
    versao_sistema: ua?.osVersion || null,
    navegador: ua?.browser || null,
    versao_navegador: ua?.browserVersion || null,
    modelo: modelo || iphone,
    modelo_nota: uaReduzido ? "não exposto pelo navegador (user agent reduzido)" : null,
    identificador,
    webview_provavel: webview,
    tipo: ua?.deviceType || null,
    defasagem_navegador: defasagem,
    resumo: resumo || null,
    achados,
  };
}
