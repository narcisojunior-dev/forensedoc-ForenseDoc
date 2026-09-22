import QRCode from "qrcode-svg";

/**
 * QR Code de verificação, desenhado direto no PDF.
 *
 * ─── Por que retângulo a retângulo e não uma imagem ──────────────────────────
 *
 * O PDFKit não renderiza SVG, e converter para PNG exigiria uma dependência de
 * rasterização só para isto. A `qrcode-svg`, que já entrou no projeto para o
 * QR do segundo fator, expõe a matriz de módulos em `qrcode.modules`. Desenhar
 * a matriz com `doc.rect().fill()` dá saída vetorial, imprime nítido em
 * qualquer resolução e não acrescenta nada ao `package.json`.
 *
 * A correção de erro fica em M (15%): o laudo é impresso, grampeado e
 * fotocopiado, e o nível L não sobrevive a uma cópia ruim. Acima de M o código
 * fica denso demais para o espaço disponível.
 */

const CORRECAO_DE_ERRO = "M";

export function urlDeVerificacao(codigo) {
  const base = (process.env.FRONTEND_URL || "http://localhost:5173").replace(/\/+$/, "");
  return `${base}/verificar/${codigo}`;
}

/**
 * @param {PDFDocument} doc
 * @param {object} params
 * @param {string} params.conteudo  texto embutido no QR
 * @param {number} params.x         canto superior esquerdo, em pontos
 * @param {number} params.y
 * @param {number} params.lado      lado máximo desejado, em pontos
 * @returns {{ lado: number }} lado efetivo, múltiplo inteiro do módulo
 */
export function desenharQr(doc, { conteudo, x, y, lado }) {
  const matriz = new QRCode({ content: conteudo, padding: 0, ecl: CORRECAO_DE_ERRO }).qrcode.modules;
  const n = matriz.length;

  // O módulo é arredondado para baixo: um módulo fracionário faz a impressora
  // distribuir o resto de forma irregular e alguns leitores perdem o código.
  const modulo = Math.floor((lado / n) * 100) / 100;
  const ladoEfetivo = modulo * n;

  doc.save();
  // Fundo branco explícito. O QR pode cair sobre uma faixa de cor do tema, e
  // leitor nenhum decodifica módulo escuro sobre fundo escuro.
  doc.rect(x, y, ladoEfetivo, ladoEfetivo).fill("#ffffff");

  for (let linha = 0; linha < n; linha++) {
    for (let coluna = 0; coluna < n; coluna++) {
      if (!matriz[linha][coluna]) continue;
      doc.rect(x + coluna * modulo, y + linha * modulo, modulo, modulo).fill("#000000");
    }
  }
  doc.restore();

  return { lado: ladoEfetivo };
}
