/**
 * Aparência de uma imagem: fotografia de pessoa ou ilustração do template?
 *
 * ─── Por que ─────────────────────────────────────────────────────────────────
 *
 * A classificação por dimensões (`classifyEmbeddedImage`) chama de "fotografia/
 * biometria provável" qualquer JPEG com mais de 180 px de lado e proporção entre
 * 0,45 e 2,25. A arte do cartão Credcesta (379 x 240, vermelho chapado) passou
 * nesse crivo nos dois dossiês da Eunice x Banco Master e o laudo saiu com IMG2
 * e IMG6 críticos e constatados sobre um desenho de cartão.
 *
 * Uma selfie tem pele. Um cartão, um selo ou um mapa não têm. A medida abaixo
 * reduz a imagem a 48 x 48 pixels e conta os que caem na faixa de tom de pele
 * (regra clássica em RGB, Kovac et al. 2003). É heurística, não reconhecimento
 * facial: serve para descartar ilustração, não para afirmar que há um rosto.
 */
import sharp from "sharp";

const LADO = 48;

/**
 * Duas regras em conjunto. A de RGB (Kovac) sozinha aceita vermelho saturado:
 * o cartão Credcesta (220, 50, 60) passava com 94 % de "pele". A de YCbCr
 * (Chai e Ngan, Cb 77..127 e Cr 133..173) exclui o vermelho puro, o branco e
 * o azul, e mantém pele clara e escura.
 */
function ehPele(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const rgb = r > 95 && g > 40 && b > 20 && max - min > 15 && Math.abs(r - g) > 15 && r > g && r > b;
  if (!rgb) return false;
  const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
  const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
  return cb >= 77 && cb <= 127 && cr >= 133 && cr <= 173;
}

/**
 * @param {Buffer} data bytes de JPEG ou PNG
 * @returns {Promise<{fracaoPele:number, pixels:number, disponivel:true}|{disponivel:false, erro:string}>}
 */
export async function medirPele(data) {
  try {
    const { data: raw, info } = await sharp(data)
      .resize(LADO, LADO, { fit: "fill" })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const canais = info.channels;
    let pele = 0;
    let chapada = 0;
    let total = 0;
    for (let i = 0; i + 2 < raw.length; i += canais) {
      total += 1;
      const r = raw[i], g = raw[i + 1], b = raw[i + 2];
      if (ehPele(r, g, b)) pele += 1;
      else if (corChapada(r, g, b)) chapada += 1;
    }
    const fracao = (n) => (total ? Number((n / total).toFixed(4)) : 0);
    return { disponivel: true, pixels: total, fracaoPele: fracao(pele), fracaoChapada: fracao(chapada) };
  } catch (e) {
    return { disponivel: false, erro: e?.message || String(e) };
  }
}

/** Cor de marca: saturada e escura o bastante para não ser pele nem papel. */
function corChapada(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max < 60) return false;
  return (max - min) / max > 0.6;
}

/**
 * Selfies reais medidas aqui deram de 28 % a 37 % de pele; a arte do cartão
 * Credcesta deu 6,6 % (bordas serrilhadas entre vermelho e branco) com 60 % de
 * cor chapada. Ilustração é o que tem pouca pele, ou pele modesta com a maior
 * parte da área em cor de marca.
 */
export const LIMIAR_PELE = 0.10;
export const LIMIAR_PELE_COM_CHAPADA = 0.20;
export const LIMIAR_CHAPADA = 0.45;

export function pareceIlustracao(medida) {
  if (!medida?.disponivel) return false;
  if (medida.fracaoPele < LIMIAR_PELE) return true;
  return medida.fracaoPele < LIMIAR_PELE_COM_CHAPADA && (medida.fracaoChapada || 0) > LIMIAR_CHAPADA;
}

export const CLASSE_ILUSTRACAO = "ilustração/cartão do template";
