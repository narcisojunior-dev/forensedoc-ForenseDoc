import sharp from "sharp";

/**
 * Análise de Nível de Erro (Error Level Analysis - ELA)
 *
 * A ELA funciona re-salvando a imagem JPEG em um nível de qualidade conhecido
 * (tipicamente 95%) e calculando a diferença absoluta pixel a pixel entre a
 * imagem de entrada e a imagem re-comprimida.
 *
 * Em imagens autênticas e não modificadas localmente, a degradação de compressão
 * é homogênea sobre toda a superfície da imagem (proporcional à frequência visual).
 * Quando há inserção, colagem ou edição de elementos gráficos com histórico de
 * salvamento ou matrizes de quantização distintas, essas regiões exibem níveis
 * de erro desproporcionais (outliers concentrados ou discrepância regional).
 *
 * IMPORTANTE (Princípio Pericial):
 * A ELA isolada não conclui fraude por si só (pois arestas de alto contraste
 * naturalmente geram maiores resíduos). Por isso, qualquer anomalia é classificada
 * com gravidade MÉDIA (indício técnico que exige corroboração).
 */

const DEFAULT_OPTIONS = {
  qualidadeReferencia: 95,
  fatorAmplificacao: 15,
  maxHeatmapDim: 400,
  blockSize: 16,
};

/**
 * Executa a análise ELA sobre um buffer de imagem.
 *
 * @param {Buffer} imageBuffer - Buffer bruto da imagem
 * @param {object} [options]
 * @param {number} [options.qualidadeReferencia=95] - Qualidade JPEG para re-compressão
 * @param {number} [options.fatorAmplificacao=15] - Multiplicador visual para o mapa de calor
 * @param {number} [options.maxHeatmapDim=400] - Dimensão máxima da miniatura do mapa de calor
 * @param {number} [options.blockSize=16] - Tamanho do bloco para análise de dispersão regional
 * @returns {Promise<object>} Resultado estruturado da análise ELA
 */
export async function analisarELA(imageBuffer, options = {}) {
  if (!imageBuffer || !Buffer.isBuffer(imageBuffer) || imageBuffer.length < 32) {
    return {
      disponivel: false,
      motivo: "Buffer de imagem inválido ou ausente",
    };
  }

  const {
    qualidadeReferencia,
    fatorAmplificacao,
    maxHeatmapDim,
    blockSize,
  } = { ...DEFAULT_OPTIONS, ...options };

  let metadata;
  try {
    metadata = await sharp(imageBuffer).metadata();
  } catch (err) {
    return {
      disponivel: false,
      motivo: `Falha ao inspecionar metadados da imagem: ${err.message}`,
    };
  }

  const formato = (metadata.format || "").toLowerCase();

  // ELA aplica-se exclusivamente a imagens JPEG (depende da grade DCT e quantização)
  if (formato !== "jpeg" && formato !== "jpg") {
    return {
      disponivel: false,
      formato: metadata.format ? metadata.format.toUpperCase() : "DESCONHECIDO",
      motivo: `Formato ${metadata.format?.toUpperCase() || "não-JPEG"} não suporta análise ELA baseada em grade DCT`,
      achado: {
        codigo: "ELA3",
        gravidade: "INFO",
        titulo: "Análise ELA não aplicável ao formato",
        texto: `A imagem biométrica extraída está no formato ${metadata.format?.toUpperCase() || "não-JPEG"}. A análise de nível de erro (ELA) baseia-se na quantização da transformada discreta de cosseno (DCT) do padrão JPEG, não sendo aplicável a formatos sem perdas (lossless) ou sem estrutura de blocos DCT.`,
      },
    };
  }

  const width = metadata.width;
  const height = metadata.height;

  if (!width || !height || width < 32 || height < 32) {
    return {
      disponivel: false,
      motivo: `Dimensões insuficientes para análise pericial ELA (${width}x${height} px; mínimo 32x32 px)`,
    };
  }

  try {
    // 1. Decodificar a imagem original para sRGB de 3 canais (R, G, B)
    const { data: origRaw } = await sharp(imageBuffer)
      .removeAlpha()
      .toColorspace("srgb")
      .raw()
      .toBuffer({ resolveWithObject: true });

    // 2. Re-comprimir em JPEG com a qualidade de referência (padrão 95%)
    const recompBuffer = await sharp(origRaw, {
      raw: { width, height, channels: 3 },
    })
      .jpeg({ quality: qualidadeReferencia })
      .toBuffer();

    // 3. Decodificar o JPEG re-comprimido para sRGB de 3 canais
    const { data: recompRaw } = await sharp(recompBuffer)
      .removeAlpha()
      .toColorspace("srgb")
      .raw()
      .toBuffer({ resolveWithObject: true });

    const totalPixels = width * height;
    const diffMap = Buffer.alloc(totalPixels * 3);
    const pixelDiffs = new Float32Array(totalPixels);

    let sumDiff = 0;
    let maxDiff = 0;

    for (let i = 0; i < totalPixels; i++) {
      const idx = i * 3;
      const rDiff = Math.abs(origRaw[idx] - recompRaw[idx]);
      const gDiff = Math.abs(origRaw[idx + 1] - recompRaw[idx + 1]);
      const bDiff = Math.abs(origRaw[idx + 2] - recompRaw[idx + 2]);

      const pDiff = (rDiff + gDiff + bDiff) / 3;
      pixelDiffs[i] = pDiff;
      sumDiff += pDiff;
      if (pDiff > maxDiff) maxDiff = pDiff;

      // Mapa de calor visual com amplificação
      diffMap[idx] = Math.min(255, Math.round(rDiff * fatorAmplificacao));
      diffMap[idx + 1] = Math.min(255, Math.round(gDiff * fatorAmplificacao));
      diffMap[idx + 2] = Math.min(255, Math.round(bDiff * fatorAmplificacao));
    }

    const mediaDiferenca = sumDiff / totalPixels;

    // Desvio padrão global
    let varianceSum = 0;
    for (let i = 0; i < totalPixels; i++) {
      const d = pixelDiffs[i] - mediaDiferenca;
      varianceSum += d * d;
    }
    const desvioPadrao = Math.sqrt(varianceSum / totalPixels);

    // Detecção de pixels com nível de erro anômalo (outliers)
    const outlierThreshold = Math.max(3, mediaDiferenca + 2.5 * desvioPadrao);
    let outliersCount = 0;
    for (let i = 0; i < totalPixels; i++) {
      if (pixelDiffs[i] > outlierThreshold) outliersCount++;
    }
    const percentualOutliers = (outliersCount / totalPixels) * 100;

    // Análise de dispersão por blocos regionais (para identificar patches colados)
    const cols = Math.floor(width / blockSize);
    const rows = Math.floor(height / blockSize);
    let dispersaoRegional = 0;

    if (cols >= 2 && rows >= 2) {
      const blockMeans = [];
      for (let by = 0; by < rows; by++) {
        for (let bx = 0; bx < cols; bx++) {
          let bSum = 0;
          let count = 0;
          for (let y = by * blockSize; y < (by + 1) * blockSize; y++) {
            for (let x = bx * blockSize; x < (bx + 1) * blockSize; x++) {
              bSum += pixelDiffs[y * width + x];
              count++;
            }
          }
          blockMeans.push(bSum / count);
        }
      }
      const bGlobalMean = blockMeans.reduce((a, b) => a + b, 0) / blockMeans.length;
      const maxBlock = Math.max(...blockMeans);
      const minBlock = Math.min(...blockMeans);
      dispersaoRegional = bGlobalMean > 0.05 ? (maxBlock - minBlock) / bGlobalMean : 0;
    }

    // 4. Gerar miniatura compacta em JPEG base64 do mapa de calor ELA
    let heatmapImg = sharp(diffMap, {
      raw: { width, height, channels: 3 },
    });
    if (width > maxHeatmapDim || height > maxHeatmapDim) {
      heatmapImg = heatmapImg.resize(maxHeatmapDim, maxHeatmapDim, { fit: "inside" });
    }
    const heatmapJpegBuffer = await heatmapImg.jpeg({ quality: 85 }).toBuffer();
    const mapaCalor = `data:image/jpeg;base64,${heatmapJpegBuffer.toString("base64")}`;

    // 5. Classificação Pericial
    // Uma região inconsistente apresenta outliers concentrados e/ou alta dispersão regional
    const isRegionalInconsistent =
      (percentualOutliers >= 6.0 && maxDiff >= 15 && desvioPadrao >= 2.0) ||
      (dispersaoRegional >= 1.8 && maxDiff >= 5 && desvioPadrao >= 0.4);

    const classificacao = isRegionalInconsistent ? "REGIÃO INCONSISTENTE" : "UNIFORME";

    let achado = null;
    let conclusao = "";

    if (isRegionalInconsistent) {
      achado = {
        codigo: "ELA2",
        gravidade: "MÉDIA",
        titulo: "Inconsistência de compressão em nível de erro (ELA)",
        texto: `A análise de nível de erro (ELA a ${qualidadeReferencia}%) identificou variação anômala nos resíduos de compressão da imagem biométrica (${percentualOutliers.toFixed(1)}% de pixels discrepantes, dispersão regional ${dispersaoRegional.toFixed(2)}, desvio padrão ${desvioPadrao.toFixed(1)}). Esse padrão sugere montagem, inserção de elementos ou re-salvamento a partir de fontes distintas.`,
      };
      conclusao = "A análise ELA detectou regiões com taxa de erro discrepante em relação à matriz de compressão global, indicando possível manipulação ou colagem digital.";
    } else {
      achado = {
        codigo: "ELA1",
        gravidade: "INFO",
        titulo: "Nível de erro ELA uniforme",
        texto: `A análise de nível de erro (ELA a ${qualidadeReferencia}%) indicou degradação de compressão homogênea em toda a extensão da imagem biométrica (média ${mediaDiferenca.toFixed(1)}, desvio padrão ${desvioPadrao.toFixed(1)}, ${percentualOutliers.toFixed(1)}% outliers), sem evidências de descontinuidade localizada.`,
      };
      conclusao = "A análise de nível de erro indica compressão uniforme em toda a imagem — sem indício de edição ou inserção localizada.";
    }

    return {
      disponivel: true,
      qualidade_referencia: qualidadeReferencia,
      fator_amplificacao: fatorAmplificacao,
      largura: width,
      altura: height,
      media_diferenca: Number(mediaDiferenca.toFixed(2)),
      desvio_padrao: Number(desvioPadrao.toFixed(2)),
      percentual_outliers: Number(percentualOutliers.toFixed(2)),
      max_diferenca: Math.round(maxDiff),
      dispersao_regional: Number(dispersaoRegional.toFixed(2)),
      classificacao,
      conclusao,
      mapa_calor: mapaCalor,
      ferramenta: "sharp (libvips)",
      achado,
    };
  } catch (err) {
    return {
      disponivel: false,
      motivo: `Erro durante o cálculo ELA: ${err.message}`,
    };
  }
}
