import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { analisarELA } from "../../src/engine/elaAnalysis.js";
import { analisarBiometria } from "../../src/engine/biometria.js";

describe("Análise de Nível de Erro (ELA)", () => {
  it("classifica JPEG uniforme como UNIFORME com achado ELA1", async () => {
    // Cria uma imagem simulando fotografia uniforme (gradiente suave)
    const width = 120;
    const height = 120;
    const pixels = Buffer.alloc(width * height * 3);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 3;
        pixels[idx] = Math.min(255, 100 + Math.floor(x * 0.5));
        pixels[idx + 1] = Math.min(255, 120 + Math.floor(y * 0.5));
        pixels[idx + 2] = 150;
      }
    }

    const jpegBuffer = await sharp(pixels, { raw: { width, height, channels: 3 } })
      .jpeg({ quality: 90 })
      .toBuffer();

    const resultado = await analisarELA(jpegBuffer);

    expect(resultado.disponivel).toBe(true);
    expect(resultado.qualidade_referencia).toBe(95);
    expect(resultado.classificacao).toBe("UNIFORME");
    expect(resultado.achado?.codigo).toBe("ELA1");
    expect(resultado.achado?.gravidade).toBe("INFO");
    expect(resultado.mapa_calor).toMatch(/^data:image\/jpeg;base64,/);
    expect(resultado.media_diferenca).toBeGreaterThanOrEqual(0);
    expect(resultado.desvio_padrao).toBeGreaterThanOrEqual(0);
    expect(resultado.percentual_outliers).toBeLessThan(8.0);
  });

  it("detecta manipulação em JPEG com colagem/patch e emite ELA2", async () => {
    const size = 160;
    const pixels = Buffer.alloc(size * size * 3);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const idx = (y * size + x) * 3;
        pixels[idx] = Math.floor(128 + 60 * Math.sin(x / 8) * Math.cos(y / 8));
        pixels[idx + 1] = Math.floor(128 + 50 * Math.cos(x / 12) * Math.sin(y / 12));
        pixels[idx + 2] = Math.floor(128 + 40 * Math.sin((x + y) / 10));
      }
    }
    const baseJpeg = await sharp(pixels, { raw: { width: size, height: size, channels: 3 } })
      .jpeg({ quality: 70 })
      .toBuffer();

    const patchSize = 50;
    const patchPixels = Buffer.alloc(patchSize * patchSize * 3);
    for (let y = 0; y < patchSize; y++) {
      for (let x = 0; x < patchSize; x++) {
        const idx = (y * patchSize + x) * 3;
        const v = ((x % 4 < 2) ^ (y % 4 < 2)) ? 240 : 15;
        patchPixels[idx] = v;
        patchPixels[idx + 1] = v;
        patchPixels[idx + 2] = v;
      }
    }
    const patchJpeg = await sharp(patchPixels, { raw: { width: patchSize, height: patchSize, channels: 3 } })
      .jpeg({ quality: 100 })
      .toBuffer();

    const compositeJpeg = await sharp(baseJpeg)
      .composite([{ input: patchJpeg, top: 40, left: 40 }])
      .jpeg({ quality: 90 })
      .toBuffer();

    const resultado = await analisarELA(compositeJpeg);

    expect(resultado.disponivel).toBe(true);
    expect(resultado.classificacao).toBe("REGIÃO INCONSISTENTE");
    expect(resultado.achado?.codigo).toBe("ELA2");
    expect(resultado.achado?.gravidade).toBe("MÉDIA");
    expect(resultado.achado?.titulo).toContain("Inconsistência de compressão");
    expect(resultado.dispersao_regional).toBeGreaterThanOrEqual(1.0);
    expect(resultado.mapa_calor).toMatch(/^data:image\/jpeg;base64,/);
  });

  it("amplia o mapa de foto salva em qualidade alta com escala relativa à imagem", async () => {
    const width = 160;
    const height = 160;
    const pixels = Buffer.alloc(width * height * 3);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 3;
        pixels[idx] = Math.floor(128 + 60 * Math.sin(x / 7) * Math.cos(y / 9));
        pixels[idx + 1] = Math.floor(120 + 40 * Math.cos(x / 11));
        pixels[idx + 2] = Math.floor(110 + 30 * Math.sin((x + y) / 13));
      }
    }
    const jpeg = await sharp(pixels, { raw: { width, height, channels: 3 } }).jpeg({ quality: 95 }).toBuffer();

    const brilhoMedio = async (resultado) => {
      const mapa = Buffer.from(resultado.mapa_calor.split(",")[1], "base64");
      const { channels } = await sharp(mapa).stats();
      return channels.reduce((soma, c) => soma + c.mean, 0) / channels.length;
    };

    const relativo = await analisarELA(jpeg);
    const fixo = await analisarELA(jpeg, { fatorAmplificacao: 15 });

    expect(relativo.escala_mapa).toBe("relativa");
    expect(relativo.fator_amplificacao).toBeGreaterThan(15);
    expect(relativo.fator_amplificacao).toBeLessThanOrEqual(100);
    expect(fixo.escala_mapa).toBe("fixa");
    expect(fixo.fator_amplificacao).toBe(15);
    expect(await brilhoMedio(relativo)).toBeGreaterThan(2 * (await brilhoMedio(fixo)));
    // A escala do mapa é só apresentação: métricas e classificação não mudam.
    expect(relativo.media_diferenca).toBe(fixo.media_diferenca);
    expect(relativo.classificacao).toBe(fixo.classificacao);
  });

  it("informa não aplicabilidade para imagens PNG com achado ELA3", async () => {
    const pngBuffer = await sharp({
      create: { width: 64, height: 64, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } },
    })
      .png()
      .toBuffer();

    const resultado = await analisarELA(pngBuffer);

    expect(resultado.disponivel).toBe(false);
    expect(resultado.formato).toBe("PNG");
    expect(resultado.achado?.codigo).toBe("ELA3");
    expect(resultado.achado?.gravidade).toBe("INFO");
    expect(resultado.motivo).toMatch(/não suporta análise ELA/i);
  });

  it("rejeita buffers corrompidos, vazios ou inválidos sem quebrar", async () => {
    expect((await analisarELA(null)).disponivel).toBe(false);
    expect((await analisarELA(Buffer.alloc(0))).disponivel).toBe(false);
    expect((await analisarELA(Buffer.from("isto não é uma imagem válida"))).disponivel).toBe(false);
  });

  it("recusa imagem com dimensões microscópicas (<32px)", async () => {
    const tinyJpeg = await sharp({
      create: { width: 16, height: 16, channels: 3, background: { r: 128, g: 128, b: 128 } },
    })
      .jpeg()
      .toBuffer();

    const resultado = await analisarELA(tinyJpeg);
    expect(resultado.disponivel).toBe(false);
    expect(resultado.motivo).toMatch(/Dimensões insuficientes/);
  });

  it("propaga resultado ELA através de analisarBiometria", () => {
    const imagens = {
      imagens: [
        {
          num: 1,
          page: 2,
          width: 480,
          height: 640,
          biometricaProvavel: true,
          classificacao: "fotografia/biometria provável",
          formato: "JPEG",
          extractedBytes: 52000,
          sha256: "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
          exif: false,
          ela: {
            disponivel: true,
            classificacao: "UNIFORME",
            media_diferenca: 3.4,
            desvio_padrao: 2.1,
            percentual_outliers: 2.5,
            mapa_calor: "data:image/jpeg;base64,...",
            ferramenta: "sharp (libvips)",
            achado: { codigo: "ELA1", gravidade: "INFO", titulo: "Nível de erro ELA uniforme", texto: "..." },
          },
        },
      ],
    };

    const bio = analisarBiometria({ imagens, flat: "contrato de emprestimo consignado", alegaBiometria: true });
    expect(bio).not.toBeNull();
    expect(bio.ela).toBeDefined();
    expect(bio.ela?.classificacao).toBe("UNIFORME");
    expect(bio.achado_ela?.codigo).toBe("ELA1");
  });
});
