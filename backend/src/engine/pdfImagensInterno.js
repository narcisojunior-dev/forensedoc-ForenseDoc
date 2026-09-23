/**
 * Inventário de imagens sem o Poppler.
 *
 * ─── Por que ─────────────────────────────────────────────────────────────────
 *
 * O laudo FD-20260920-538F54AACD saiu com "a ferramenta de exame de imagens não
 * concluiu a execução": o `pdfimages` não estava no ambiente e o § 4.4 ficou sem
 * hash, sem EXIF e sem verificação de repetição da única fotografia do dossiê.
 * Uma falha de ambiente virou lacuna do laudo, e lacuna do laudo é sempre lida
 * pelo banco como "o perito não achou nada".
 *
 * Este módulo faz o inventário com o que o Node já tem:
 *
 *   1. Varre os objetos do arquivo e recolhe os XObjects de imagem com o fluxo
 *      BRUTO. Para JPEG (DCTDecode) o fluxo é o próprio arquivo JPEG, então o
 *      SHA-256, o EXIF e o JFIF são os mesmos que o `pdfimages -all` daria.
 *   2. Usa o pdf.js (via pdf-parse) para saber em que página cada imagem é
 *      desenhada, porque o objeto sozinho não diz onde foi usado.
 *
 * O resultado tem o mesmo formato das linhas do `pdfimages -list`, para que a
 * classificação, os grupos repetidos e os achados IMG continuem os mesmos.
 *
 * ─── Limites ─────────────────────────────────────────────────────────────────
 *
 * Imagem em fluxo de objetos comprimido (ObjStm) não existe: fluxos nunca vão
 * dentro de ObjStm. Dicionários de página podem ir, e por isso a página vem do
 * pdf.js e não da árvore de páginas. Quando dois objetos têm as mesmas
 * dimensões, o vínculo página × objeto é por ordem de aparição; o laudo registra
 * isso na observação do inventário.
 */
import { createHash } from "node:crypto";
import { PDFParse } from "pdf-parse";

const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex").toUpperCase();

function lerNome(dict, chave) {
  const m = dict.match(new RegExp(`/${chave}\\s*(?:\\[\\s*)?/([A-Za-z0-9]+)`));
  return m ? m[1] : null;
}

function lerInteiro(dict, chave) {
  const m = dict.match(new RegExp(`/${chave}\\s+(\\d+)(?:\\s+(\\d+)\\s+R)?`));
  if (!m) return null;
  return m[2] !== undefined ? { ref: Number(m[1]) } : Number(m[1]);
}

/** Segmento APP1 "Exif" num JPEG. Copiado de pdfForensics para não criar ciclo. */
function temExif(data) {
  let i = 2;
  while (i + 4 < data.length && data[i] === 0xff) {
    const marker = data[i + 1];
    if (marker === 0xda || marker === 0xd9) break;
    const length = data.readUInt16BE(i + 2);
    if (marker === 0xe1 && data.subarray(i + 4, i + 10).toString("latin1") === "Exif\0\0") return true;
    i += 2 + length;
  }
  return false;
}

/**
 * Objetos de imagem do arquivo, com o fluxo bruto.
 * @param {Buffer} pdfBuffer
 * @returns {Array<{objnum:number, width:number, height:number, filtro:string|null, bytes:Buffer, smask:number|null, mascara:boolean}>}
 */
export function varrerObjetosDeImagem(pdfBuffer) {
  const texto = pdfBuffer.toString("latin1");
  const objetos = [];
  const posicoes = new Map();
  for (const m of texto.matchAll(/(?:^|[\r\n\s>])(\d+)\s+(\d+)\s+obj\b/g)) {
    posicoes.set(Number(m[1]), m.index + m[0].indexOf(m[1]));
  }
  const inteiroDoObjeto = (objnum) => {
    const pos = posicoes.get(objnum);
    if (pos === undefined) return null;
    const m = texto.slice(pos, pos + 64).match(/^\d+\s+\d+\s+obj\s*(\d+)/);
    return m ? Number(m[1]) : null;
  };
  for (const [objnum, pos] of posicoes) {
    const cabeca = texto.slice(pos, pos + 4000);
    const fimDict = cabeca.search(/\bstream\b|\bendobj\b/);
    const dict = fimDict === -1 ? cabeca : cabeca.slice(0, fimDict);
    if (!/\/Subtype\s*\/Image\b/.test(dict)) continue;
    const streamRel = cabeca.search(/\bstream\b/);
    if (streamRel === -1) continue;
    let inicio = pos + streamRel + "stream".length;
    if (texto[inicio] === "\r") inicio += 1;
    if (texto[inicio] === "\n") inicio += 1;
    let length = lerInteiro(dict, "Length");
    if (length && typeof length === "object") length = inteiroDoObjeto(length.ref);
    let fim;
    if (Number.isFinite(length) && length > 0 && inicio + length <= pdfBuffer.length) {
      fim = inicio + length;
    } else {
      const endstream = texto.indexOf("endstream", inicio);
      if (endstream === -1) continue;
      fim = endstream;
      while (fim > inicio && (texto[fim - 1] === "\n" || texto[fim - 1] === "\r")) fim -= 1;
    }
    const width = lerInteiro(dict, "Width");
    const height = lerInteiro(dict, "Height");
    if (typeof width !== "number" || typeof height !== "number") continue;
    const smask = lerInteiro(dict, "SMask");
    objetos.push({
      objnum,
      width,
      height,
      filtro: lerNome(dict, "Filter"),
      bytes: pdfBuffer.subarray(inicio, fim),
      smask: smask && typeof smask === "object" ? smask.ref : null,
      mascara: /\/ImageMask\s+true/.test(dict),
    });
  }
  const mascaras = new Set(objetos.map((o) => o.smask).filter(Boolean));
  for (const o of objetos) if (mascaras.has(o.objnum)) o.mascara = true;
  return objetos;
}

const PRAZO_PDFJS_MS = 20_000;

/**
 * Páginas e imagens desenhadas, pelo pdf.js.
 *
 * Com prazo: em alguns arquivos (dossiê exportado do PROJUDI com 103 imagens
 * e máscaras) a promessa do pdf.js nunca se resolve e o processo morre com
 * "unsettled top-level await". O temporizador mantém o laço de eventos vivo e,
 * vencido o prazo, o inventário segue sem página, com os hashes intactos.
 */
async function usosPorPagina(pdfBuffer) {
  const parser = new PDFParse({ data: pdfBuffer });
  let temporizador = null;
  const prazo = new Promise((resolve) => { temporizador = setTimeout(() => resolve({ prazoVencido: true }), PRAZO_PDFJS_MS); });
  try {
    const r = await Promise.race([parser.getImage({ imageThreshold: 0 }), prazo]);
    if (r?.prazoVencido) throw new Error(`pdf.js não concluiu a leitura das imagens em ${PRAZO_PDFJS_MS / 1000} s`);
    return (r.pages || []).map((pg) => ({
      page: pg.pageNumber,
      imagens: (pg.images || []).map((im) => ({ name: im.name, width: im.width, height: im.height, png: im.data ? Buffer.from(im.data) : null })),
    }));
  } finally {
    if (temporizador) clearTimeout(temporizador);
    await parser.destroy().catch(() => {});
  }
}

/**
 * Inventário no formato das linhas do `pdfimages -list`, com hash e metadados
 * de cada representação.
 * @param {Buffer} pdfBuffer
 */
export async function inventarioImagensInterno(pdfBuffer) {
  const objetos = varrerObjetosDeImagem(pdfBuffer).filter((o) => !o.mascara);
  let paginas = [];
  let motivoPaginas = null;
  try {
    paginas = await usosPorPagina(pdfBuffer);
  } catch (e) {
    motivoPaginas = e?.message || String(e);
  }

  const porDimensao = new Map();
  for (const o of objetos) {
    const chave = `${o.width}x${o.height}`;
    if (!porDimensao.has(chave)) porDimensao.set(chave, []);
    porDimensao.get(chave).push(o);
  }
  const ambiguas = new Set();
  const linhas = [];
  const objetosUsados = new Set();
  const montarLinha = (page, num, objeto, uso) => {
    const bytes = objeto ? objeto.bytes : uso?.png || Buffer.alloc(0);
    const jpeg = bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8;
    const png = bytes.length > 4 && bytes.subarray(1, 4).toString("latin1") === "PNG";
    const width = objeto ? objeto.width : uso.width;
    const height = objeto ? objeto.height : uso.height;
    const linha = {
      page,
      num,
      type: "image",
      width,
      height,
      color: null,
      comp: null,
      bpc: null,
      enc: objeto?.filtro === "DCTDecode" ? "jpeg" : objeto?.filtro === "JPXDecode" ? "jpx" : "image",
      interp: null,
      size: `${bytes.length}B`,
      ratio: null,
      objectId: objeto ? String(objeto.objnum) : null,
      generation: objeto ? "0" : null,
      xPpi: null,
      yPpi: null,
      pixels: width * height,
      sha256: bytes.length ? sha256(bytes) : null,
      extractedBytes: bytes.length,
      extractedFile: null,
      origem_hash: objeto ? "fluxo bruto do objeto" : "PNG recodificado pelo pdf.js",
      formato: jpeg ? "JPEG" : png ? "PNG" : objeto?.filtro || null,
      megapixels: Number(((width * height) / 1_000_000).toFixed(2)),
      exif: jpeg ? temExif(bytes) : false,
      jfif: jpeg ? bytes.includes(Buffer.from("JFIF\0", "latin1")) : false,
    };
    if ((jpeg || png) && bytes.length <= 400 * 1024) {
      linha.miniatura = `data:image/${jpeg ? "jpeg" : "png"};base64,${bytes.toString("base64")}`;
    }
    return linha;
  };

  for (const pg of paginas) {
    const contagem = new Map();
    pg.imagens.forEach((uso, idx) => {
      const chave = `${uso.width}x${uso.height}`;
      const candidatos = porDimensao.get(chave) || [];
      const k = contagem.get(chave) || 0;
      contagem.set(chave, k + 1);
      if (candidatos.length > 1) ambiguas.add(chave);
      const objeto = candidatos.length ? candidatos[k % candidatos.length] : null;
      if (objeto) objetosUsados.add(objeto.objnum);
      linhas.push(montarLinha(pg.page, idx, objeto, uso));
    });
  }
  // Objeto de imagem que o pdf.js não desenhou em página nenhuma (por exemplo,
  // dentro de um Form XObject que não foi resolvido): entra sem página, para o
  // hash e a repetição continuarem conferíveis.
  let num = 0;
  for (const o of objetos) {
    if (objetosUsados.has(o.objnum)) continue;
    linhas.push(montarLinha(null, num++, o, null));
  }

  const observacoes = [
    "Inventário interno: objetos de imagem lidos do próprio arquivo, com SHA-256 do fluxo bruto; páginas atribuídas pelo pdf.js.",
    ambiguas.size ? `Objetos com as mesmas dimensões (${[...ambiguas].join(", ")}) foram vinculados às páginas por ordem de aparição.` : null,
    motivoPaginas ? `Páginas não atribuídas: ${motivoPaginas}.` : null,
  ].filter(Boolean);

  return { imagens: linhas, objetos: objetos.length, observacao: observacoes.join(" ") };
}
