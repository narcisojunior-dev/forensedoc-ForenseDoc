import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/*
 * Metadados de compartilhamento (Open Graph e X/Twitter) do index.html.
 *
 * Um erro aqui não aparece em nenhuma tela do sistema: só se vê quando alguém
 * cola o link no WhatsApp e a prévia sai sem imagem. Por isso o teste confere o
 * que os robôs exigem e que ninguém repara ao revisar o HTML: URL absoluta, o
 * arquivo existir em public/ e as dimensões declaradas baterem com as reais.
 */

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND = path.resolve(AQUI, "..", "..");
const PUBLIC = path.join(FRONTEND, "public");

const html = fs.readFileSync(path.join(FRONTEND, "index.html"), "utf8");
const doc = new DOMParser().parseFromString(html, "text/html");

const meta = (chave) =>
  doc.querySelector(`meta[property="${chave}"], meta[name="${chave}"]`)?.getAttribute("content");

/** Largura e altura lidas do cabeçalho IHDR do PNG (bytes 16 a 23). */
function dimensoesPng(arquivo) {
  const buf = fs.readFileSync(arquivo);
  expect(buf.subarray(1, 4).toString("ascii")).toBe("PNG");
  return { largura: buf.readUInt32BE(16), altura: buf.readUInt32BE(20) };
}

describe("metadados de compartilhamento", () => {
  it("declara título, descrição e tipo de cartão", () => {
    for (const chave of [
      "og:title",
      "og:description",
      "og:site_name",
      "twitter:title",
      "twitter:description",
      "description",
    ]) {
      expect(meta(chave), chave).toBeTruthy();
    }
    expect(meta("og:type")).toBe("website");
    expect(meta("og:locale")).toBe("pt_BR");
    // Sem summary_large_image o X mostra só um quadradinho ao lado do texto.
    expect(meta("twitter:card")).toBe("summary_large_image");
  });

  it("usa URLs absolutas em https, que é o único formato que os robôs resolvem", () => {
    for (const chave of ["og:url", "og:image", "twitter:image"]) {
      expect(meta(chave), chave).toMatch(/^https:\/\/[^/]+\//);
    }
    expect(meta("twitter:image")).toBe(meta("og:image"));
  });

  it("aponta para uma imagem que existe em public/ com as dimensões declaradas", () => {
    const { pathname } = new URL(meta("og:image"));
    const arquivo = path.join(PUBLIC, pathname);
    expect(fs.existsSync(arquivo), `${pathname} não está em public/`).toBe(true);

    const { largura, altura } = dimensoesPng(arquivo);
    expect(largura).toBe(Number(meta("og:image:width")));
    expect(altura).toBe(Number(meta("og:image:height")));
    // 1,91:1 é a proporção que Facebook, LinkedIn e WhatsApp exibem sem cortar.
    expect({ largura, altura }).toEqual({ largura: 1200, altura: 630 });
    expect(meta("og:image:type")).toBe("image/png");
  });

  it("mantém a imagem abaixo de 300 KB, acima disso o WhatsApp cai para a miniatura", () => {
    const { pathname } = new URL(meta("og:image"));
    expect(fs.statSync(path.join(PUBLIC, pathname)).size).toBeLessThan(300 * 1024);
  });

  it("descreve a imagem para quem usa leitor de tela", () => {
    expect(meta("og:image:alt")).toBeTruthy();
    expect(meta("twitter:image:alt")).toBeTruthy();
  });
});
