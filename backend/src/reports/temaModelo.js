/**
 * Tema visual do laudo no desenho do modelo anterior (documentação/modelo_anterior.pdf).
 *
 * O modelo não era um PDF desenhado: era a tela do laudo fotografada pelo
 * html2canvas e colada no jsPDF, uma imagem por página, sem texto selecionável
 * e com 5 MB. Aqui o mesmo desenho é reconstruído em vetor, com o PDFKit que o
 * servidor já usa, de modo que o laudo continue pesquisável, leve e emitido sem
 * navegador.
 *
 * A referência de cores e de escala é o modo claro de exportação do
 * `frontend/src/laudo/laudo.css` (bloco `body.fd-exporting`), que é justamente
 * o que o modelo fotografou: cartão branco sobre fundo cinza, título de seção
 * em azul-petróleo com bolinha, linha "rótulo à esquerda, valor à direita" com
 * filete, nota em caixa azul-clara e selos em pílula.
 *
 * O tema expõe as MESMAS primitivas de `reportPdfService.js` (heading, field,
 * paragraph, badge, table, bullet, subheading), então as seções do laudo não
 * mudam: só o desenho muda.
 */

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const RAIZ_FONTES = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "assets", "fonts");

// ─── Tokens, transcritos do modo claro de exportação do laudo.css ────────────

export const COR = {
  pagina: "#f5f7f8",
  cartao: "#ffffff",
  borda: "#dce2e6",
  filete: "#e8ecef",
  titulo: "#0b5f78",
  ponto: "#0b88aa",
  tituloAlerta: "#a83434",
  texto: "#1d2733",
  rotulo: "#5d6875",
  mono: "#064d68",
  sub: "#0b6f8d",
  vazio: "#7b8490",
  notaFundo: "#f3f8fb",
  notaBorda: "#bfd7e2",
  notaTexto: "#253241",
  okFundo: "#eaf7f0",
  okBorda: "#a8dcc4",
  okTexto: "#1a7f5a",
  alertaFundo: "#fdf4e3",
  alertaBorda: "#e8cd9a",
  alertaTexto: "#9a6a12",
  perigoFundo: "#fdf1f1",
  perigoBorda: "#e6b7b7",
  perigoTexto: "#a83434",
};

/*
 * O cartão ocupa 35pt de cada lado da folha e tem 15pt de respiro interno, de
 * modo que o texto começa exatamente em x=50: a mesma coluna do tema atual.
 * Assim as seções que posicionam em `MARGIN` continuam caindo dentro do cartão,
 * sem tocar em uma linha sequer do conteúdo.
 */
export const CARTAO_X = 35;
export const PAD_X = 15;
export const LARGURA_CARTAO = 595.28 - CARTAO_X * 2;
export const MARGEM_TEXTO = CARTAO_X + PAD_X;
export const LARGURA_TEXTO = LARGURA_CARTAO - PAD_X * 2;
export const MARGEM_TOPO = 62;
export const MARGEM_RODAPE = 58;

const PAD_TOPO = 10;
const PAD_BASE = 9;
const RAIO = 4;

/** Cores do tema clássico traduzidas para a paleta do modelo. */
const EQUIVALENTES = {
  "#1a1a1a": COR.texto,
  "#6b7280": COR.rotulo,
  "#0f766e": COR.titulo,
  "#b91c1c": COR.tituloAlerta,
  "#d4d4d8": COR.filete,
  "#f1f5f9": "#eef3f5",
  "#fef2f2": COR.perigoFundo,
};

export function cor(valor) {
  return EQUIVALENTES[String(valor || "").toLowerCase()] || valor;
}

/**
 * Registra Inter e JetBrains Mono, as fontes do modelo, inclusive sob os nomes
 * padrão do PDFKit.
 *
 * O apelido é o que faz o tema valer para o laudo inteiro: as seções chamam
 * `doc.font("Helvetica")` em dezenas de pontos, e registrar o apelido troca a
 * fonte nesses pontos sem reescrevê-los. Sem os arquivos, o laudo sai nas
 * fontes padrão em vez de falhar.
 */
const ARQUIVOS_DE_FONTE = {
  Helvetica: "Inter-Regular.ttf",
  "Helvetica-Bold": "Inter-SemiBold.ttf",
  "Helvetica-Oblique": "Inter-Italic.ttf",
  Courier: "JetBrainsMono-Regular.ttf",
  "Courier-Bold": "JetBrainsMono-Bold.ttf",
};

/*
 * Os arquivos são lidos uma vez por processo. O PDFKit reabriria cada um a
 * cada laudo emitido.
 */
const FONTES = new Map();
for (const [nome, arquivo] of Object.entries(ARQUIVOS_DE_FONTE)) {
  const caminho = join(RAIZ_FONTES, arquivo);
  if (existsSync(caminho)) FONTES.set(nome, readFileSync(caminho));
}

export function registrarFontes(doc) {
  for (const [nome, conteudo] of FONTES) {
    doc.registerFont(nome, conteudo);
    /*
     * O PDFKit resolve "Helvetica" no construtor e guarda a fonte padrão no
     * cache de famílias. O apelido registrado depois nunca chegava a ser
     * consultado para esse nome: o laudo saía com o texto regular em
     * Helvetica não embutida no meio da Inter, e só o negrito e o
     * monoespaçado vinham das fontes do desenho.
     */
    if (doc._fontFamilies) delete doc._fontFamilies[nome];
  }
  if (FONTES.size) doc.font("Helvetica");
  return FONTES.size > 0;
}

// ─── Moldura da página ───────────────────────────────────────────────────────

/** Fundo cinza, faixa do cabeçalho e régua superior, como no modelo. */
export function pintarMoldura(doc) {
  const { width, height } = doc.page;
  doc.save();
  doc.rect(0, 0, width, height).fill(COR.pagina);

  doc
    .fontSize(7.5)
    .font("Helvetica")
    .fillColor(COR.rotulo)
    .text("FORENSEDOC  |  LAUDO TÉCNICO PERICIAL", CARTAO_X, 26, {
      width: LARGURA_CARTAO,
      align: "left",
      lineBreak: false,
      characterSpacing: 0.3,
    });

  // Régua do cabeçalho: degradê do azul-petróleo ao âmbar, como no modelo.
  const degrade = doc.linearGradient(CARTAO_X, 0, CARTAO_X + LARGURA_CARTAO, 0);
  degrade.stop(0, "#0b88aa").stop(0.62, "#0b5f78").stop(1, "#d7a13a");
  doc.rect(CARTAO_X, 40, LARGURA_CARTAO, 2).fill(degrade);

  doc.restore();
}

/**
 * Numeração e rodapé, escritos no fim, quando o total de páginas é conhecido.
 * O SHA-256 do arquivo examinado continua no pé de cada folha: é elemento de
 * cadeia de custódia, não enfeite.
 */
export function pintarRodapes(doc, sha256) {
  const intervalo = doc.bufferedPageRange();
  for (let i = 0; i < intervalo.count; i++) {
    doc.switchToPage(intervalo.start + i);
    const baixo = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.save();

    doc
      .fontSize(7.5)
      .font("Helvetica")
      .fillColor(COR.rotulo)
      .text(`Página ${i + 1} de ${intervalo.count}`, CARTAO_X, 26, {
        width: LARGURA_CARTAO,
        align: "right",
        lineBreak: false,
      });

    const y = doc.page.height - 38;
    doc.moveTo(CARTAO_X, y).lineTo(CARTAO_X + LARGURA_CARTAO, y).lineWidth(0.5).strokeColor(COR.borda).stroke();
    doc
      .fontSize(7)
      .font("Helvetica")
      .fillColor(COR.vazio)
      .text("Documento gerado pelo ForenseDoc", CARTAO_X, y + 7, {
        width: LARGURA_CARTAO,
        align: "left",
        lineBreak: false,
      });
    if (sha256) {
      doc
        .fontSize(6.5)
        .font("Courier")
        .fillColor(COR.vazio)
        .text(`SHA-256 ${sha256}`, CARTAO_X, y + 7, { width: LARGURA_CARTAO, align: "right", lineBreak: false });
    }

    doc.restore();
    doc.page.margins.bottom = baixo;
  }
}

// ─── Cartão ──────────────────────────────────────────────────────────────────

/*
 * O cartão é desenhado em duas etapas porque o PDFKit escreve em fluxo e pinta
 * na ordem das chamadas: o fundo branco vai saindo atrás de cada elemento, à
 * medida que ele é escrito, e a borda é traçada no fim, quando já se conhece a
 * altura. Se a seção virar a página no meio, cada trecho vira um segmento com
 * a sua própria borda.
 */

export function abrirCartao(ctx) {
  fecharCartao(ctx);
  const { doc } = ctx;
  if (espacoLivre(doc) < 40) doc.addPage();
  ctx.cartao = { pagina: paginaAtual(doc), y0: doc.y - PAD_TOPO, segmentos: [] };
  fundo(doc, doc.y - PAD_TOPO, PAD_TOPO, { topo: true });
}

export function fecharCartao(ctx) {
  const { doc } = ctx;
  if (!ctx.cartao) return;
  fundo(doc, doc.y, PAD_BASE, { base: true });
  const segmentos = [...ctx.cartao.segmentos, { pagina: paginaAtual(doc), y0: ctx.cartao.y0, y1: doc.y + PAD_BASE }];
  const atual = paginaAtual(doc);
  for (const seg of segmentos) {
    if (seg.y1 - seg.y0 < 6) continue;
    irParaPagina(doc, seg.pagina);
    doc.save();
    doc
      .roundedRect(CARTAO_X, seg.y0, LARGURA_CARTAO, seg.y1 - seg.y0, RAIO)
      .lineWidth(0.7)
      .strokeColor(COR.borda)
      .stroke();
    doc.restore();
  }
  irParaPagina(doc, atual);
  doc.y = segmentos.at(-1).y1 + 7;
  doc.x = MARGEM_TEXTO;
  ctx.cartao = null;
}

/** Chamado quando o PDFKit abre uma página no meio de um cartão. */
export function quebrarCartao(ctx) {
  const { doc } = ctx;
  if (!ctx.cartao) return;
  ctx.cartao.segmentos.push({
    pagina: ctx.cartao.pagina,
    y0: ctx.cartao.y0,
    y1: doc.page.height - doc.page.margins.bottom + 6,
  });
  ctx.cartao.pagina = paginaAtual(doc);
  ctx.cartao.y0 = doc.page.margins.top - PAD_TOPO;
  fundo(doc, ctx.cartao.y0, PAD_TOPO, { topo: true });
}

function paginaAtual(doc) {
  const indice = doc._pageBuffer.indexOf(doc.page);
  return doc._pageBufferStart + (indice >= 0 ? indice : doc._pageBuffer.length - 1);
}

function irParaPagina(doc, indice) {
  if (paginaAtual(doc) !== indice) doc.switchToPage(indice);
}

/** Pinta o corpo branco do cartão atrás do elemento que vem a seguir. */
function fundo(doc, y, altura, { topo = false, base = false } = {}) {
  doc.save();
  if (topo || base) {
    doc.roundedRect(CARTAO_X, topo ? y : y - RAIO, LARGURA_CARTAO, altura + RAIO, RAIO).fill(COR.cartao);
  } else {
    doc.rect(CARTAO_X, y, LARGURA_CARTAO, altura).fill(COR.cartao);
  }
  doc.restore();
}

function espacoLivre(doc) {
  return doc.page.height - doc.page.margins.bottom - doc.y;
}

/*
 * Nem toda seção começa por um título: as notas de processamento, por exemplo,
 * entram direto com um subtítulo. Sem cartão aberto, o texto cairia sobre o
 * fundo cinza da página.
 */
function garantirCartao(ctx) {
  if (!ctx.cartao) abrirCartao(ctx);
}

/*
 * O fundo branco é pintado antes do texto e só até o pé da página: o PDFKit
 * pode quebrar o bloco no meio, e pintar a altura inteira invadiria a margem.
 */
function fundoDoBloco(doc, altura) {
  fundo(doc, doc.y, Math.max(0, Math.min(altura, espacoLivre(doc))));
}

/**
 * Fecha o bloco no lugar certo.
 *
 * Se o PDFKit virou a página no meio do texto, o cursor já está correto na
 * folha nova; forçar o Y calculado antes da quebra jogava o elemento seguinte
 * para uma posição da página anterior, e ele saía por cima do texto.
 */
function fecharBloco(doc, paginaAntes, yPrevisto, respiro = 0) {
  if (paginaAtual(doc) === paginaAntes) {
    doc.y = yPrevisto;
  } else {
    doc.y += respiro;
  }
  doc.x = MARGEM_TEXTO;
}

/** Garante espaço para um bloco que não deve ser partido. */
function reservar(ctx, pontos) {
  const { doc } = ctx;
  if (doc.y <= doc.page.margins.top + 1) return;
  if (espacoLivre(doc) < pontos) doc.addPage();
}

// ─── Primitivas de conteúdo ──────────────────────────────────────────────────

/**
 * Fundo do cartão para um bloco desenhado fora das primitivas, como o gráfico
 * de distâncias do sumário. Sem isto o desenho cai sobre o cinza da página.
 */
export function fundoParaBloco(ctx, altura) {
  garantirCartao(ctx);
  fundoDoBloco(ctx.doc, altura);
}

/**
 * Linha do placar de gravidade do sumário executivo.
 *
 * A gravidade fica numa coluna própria, como na tela, e o texto corre alinhado
 * à esquerda. Em prosa justificada, as linhas curtas do placar abriam vãos
 * enormes entre as palavras.
 */
export function achadoPlacar(ctx, { severidade, grau, titulo, texto }) {
  const { doc } = ctx;
  garantirCartao(ctx);
  const paleta = {
    ALTA: { fundo: COR.perigoFundo, tinta: COR.perigoTexto },
    CRÍTICO: { fundo: COR.perigoFundo, tinta: COR.perigoTexto },
    MÉDIA: { fundo: COR.alertaFundo, tinta: COR.alertaTexto },
    INFO: { fundo: "#eef3f5", tinta: COR.sub },
    FAVORÁVEL: { fundo: COR.okFundo, tinta: COR.okTexto },
  }[String(severidade || "").toUpperCase()] || { fundo: "#eef3f5", tinta: COR.rotulo };

  const paletaGrau = {
    CONSTATADO: { fundo: "#fee2e2", tinta: "#991b1b" },
    "NÃO VERIFICÁVEL": { fundo: "#fef3c7", tinta: "#92400e" },
    INDÍCIO: { fundo: "#e0f2fe", tinta: "#0369a1" },
  }[String(grau || "").toUpperCase()] || null;

  const temGrau = Boolean(paletaGrau);
  const larguraSeloSev = temGrau ? 44 : 54;
  const larguraSeloGrau = temGrau ? 84 : 0;
  const espacoSelos = temGrau ? larguraSeloSev + 4 + larguraSeloGrau + 8 : larguraSeloSev + 10;
  const larguraTexto = LARGURA_TEXTO - espacoSelos;

  doc.fontSize(8.2).font("Helvetica");
  const alturaTexto = doc.heightOfString(`${titulo} ${texto || ""}`.trim(), { width: larguraTexto, lineGap: 1.3 });
  const altura = Math.max(alturaTexto, 14) + 8;

  reservar(ctx, altura + 4);
  const pagina = paginaAtual(doc);
  const y = doc.y;
  fundoDoBloco(doc, altura);

  // Selo 1: Severidade técnica
  doc.save();
  doc
    .roundedRect(MARGEM_TEXTO, y + 1.5, larguraSeloSev, 12, 2)
    .fillColor(paleta.fundo)
    .fill();
  doc.restore();
  doc
    .fontSize(6.6)
    .font("Helvetica-Bold")
    .fillColor(paleta.tinta)
    .text(String(severidade || "").toUpperCase(), MARGEM_TEXTO, y + 5, {
      width: larguraSeloSev,
      align: "center",
      lineBreak: false,
    });

  // Selo 2: Grau processual (se presente)
  if (temGrau) {
    const xGrau = MARGEM_TEXTO + larguraSeloSev + 4;
    doc.save();
    doc
      .roundedRect(xGrau, y + 1.5, larguraSeloGrau, 12, 2)
      .fillColor(paletaGrau.fundo)
      .fill();
    doc.restore();
    doc
      .fontSize(6.2)
      .font("Helvetica-Bold")
      .fillColor(paletaGrau.tinta)
      .text(String(grau || "").toUpperCase(), xGrau, y + 5, {
        width: larguraSeloGrau,
        align: "center",
        lineBreak: false,
      });
  }

  const x = MARGEM_TEXTO + espacoSelos;
  doc.fontSize(8.2).font("Helvetica-Bold").fillColor(COR.texto);
  if (texto) {
    doc.text(`${titulo} `, x, y + 1, { width: larguraTexto, lineGap: 1.3, continued: true });
    doc.font("Helvetica").fillColor(COR.notaTexto).text(texto, { width: larguraTexto, lineGap: 1.3 });
  } else {
    doc.text(titulo, x, y + 1, { width: larguraTexto, lineGap: 1.3 });
  }

  fecharBloco(doc, pagina, y + altura, 3);
}

/**
 * Cabeçalho da folha do sumário executivo.
 *
 * Na tela o sumário é uma peça destacável: tem marca própria, a etiqueta
 * "SUMÁRIO EXECUTIVO" e a linha de banco, contrato e CPF. É por esse cabeçalho
 * que o operador reconhece o bloco ao folhear. Sem ele, o sumário virava mais
 * uma seção corrida no meio do laudo e quem procurava concluía que não tinha
 * sido impresso.
 *
 * A identificação vai no cabeçalho, e não em linhas de campo abaixo dele, pelo
 * mesmo motivo da tela: quem confere precisa ver de relance se está olhando o
 * laudo certo, sem ler a seção inteira.
 */
export function cabecalhoSumario(ctx, { marca, subMarca, etiqueta, linhas = [] }) {
  const { doc } = ctx;
  abrirCartao(ctx);
  const altura = 46;
  // Reserva a folha inteira do cabeçalho mais o começo do conteúdo: cabeçalho
  // sozinho no pé da página é pior que não ter cabeçalho.
  reservar(ctx, altura + 90);
  const y = doc.y;
  fundo(doc, y, altura);

  // Faixa no alto, como na capa: marca visualmente o início de uma peça nova.
  doc.save();
  const degrade = doc.linearGradient(MARGEM_TEXTO, 0, MARGEM_TEXTO + LARGURA_TEXTO, 0);
  degrade.stop(0, "#0b88aa").stop(0.7, "#0b5f78").stop(1, "#d7a13a");
  doc.rect(MARGEM_TEXTO, y, LARGURA_TEXTO, 2.5).fill(degrade);
  doc.restore();

  const meia = LARGURA_TEXTO / 2;

  doc
    .fontSize(10)
    .font("Courier-Bold")
    .fillColor(COR.titulo)
    .text(String(marca).toUpperCase(), MARGEM_TEXTO, y + 10, {
      width: meia,
      characterSpacing: 0.8,
      lineBreak: false,
    });
  doc
    .fontSize(6)
    .font("Courier")
    .fillColor(COR.rotulo)
    .text(String(subMarca).toUpperCase(), MARGEM_TEXTO, y + 24, {
      width: meia + 40,
      characterSpacing: 0.4,
      lineBreak: false,
    });

  const xDireita = MARGEM_TEXTO + meia;
  doc
    .fontSize(7)
    .font("Courier-Bold")
    .fillColor(COR.sub)
    .text(String(etiqueta).toUpperCase(), xDireita, y + 9, {
      width: meia,
      align: "right",
      characterSpacing: 0.6,
      lineBreak: false,
    });

  let linhaY = y + 20;
  for (const linha of linhas.filter(Boolean)) {
    doc
      .fontSize(6.6)
      .font("Courier")
      .fillColor(COR.rotulo)
      .text(linha, xDireita - 60, linhaY, { width: meia + 60, align: "right", lineBreak: false });
    linhaY += 9;
  }

  doc
    .moveTo(MARGEM_TEXTO, y + altura - 5)
    .lineTo(MARGEM_TEXTO + LARGURA_TEXTO, y + altura - 5)
    .lineWidth(0.7)
    .strokeColor(COR.borda)
    .stroke();

  doc.x = MARGEM_TEXTO;
  doc.y = y + altura;
}

/** Título de seção: bolinha, texto em versalete e filete, dentro do cartão. */
export function heading(ctx, titulo, { danger = false } = {}) {
  const { doc } = ctx;
  abrirCartao(ctx);
  const tinta = danger ? COR.tituloAlerta : COR.titulo;
  const y = doc.y;
  const altura = 20;
  fundo(doc, y, altura);

  doc.save();
  doc.circle(MARGEM_TEXTO + 2.5, y + 5.5, 2.5).fill(danger ? COR.tituloAlerta : COR.ponto);
  doc.restore();

  doc
    .fontSize(9.5)
    .font("Helvetica-Bold")
    .fillColor(tinta)
    .text(titulo.toUpperCase(), MARGEM_TEXTO + 11, y, {
      width: LARGURA_TEXTO - 11,
      characterSpacing: 0.4,
      lineBreak: false,
    });

  doc
    .moveTo(MARGEM_TEXTO, y + 15)
    .lineTo(MARGEM_TEXTO + LARGURA_TEXTO, y + 15)
    .lineWidth(0.7)
    .strokeColor(COR.borda)
    .stroke();

  doc.x = MARGEM_TEXTO;
  doc.y = y + altura;
}

/** Subtítulo interno, em versalete espaçado. */
export function subheading(ctx, titulo) {
  const { doc } = ctx;
  garantirCartao(ctx);
  reservar(ctx, 54);
  const y = doc.y + 4;
  fundo(doc, doc.y, 18);
  doc
    .fontSize(7.5)
    .font("Courier")
    .fillColor(COR.sub)
    .text(String(titulo).toUpperCase(), MARGEM_TEXTO, y, {
      width: LARGURA_TEXTO,
      characterSpacing: 0.5,
      lineBreak: false,
    });
  doc.x = MARGEM_TEXTO;
  doc.y = y + 14;
}

const LARGURA_ROTULO = 200;

/**
 * Linha do modelo: rótulo à esquerda em cinza, valor à direita em escuro, e um
 * filete separando das demais. O valor monoespaçado sai no azul do modelo.
 */
export function field(ctx, rotulo, valor, { mono = false } = {}) {
  if (valor === null || valor === undefined || valor === "") return;
  const { doc } = ctx;
  garantirCartao(ctx);
  const texto = String(valor);

  /*
   * Hash, identificador de validação e coordenada são lidos caractere a
   * caractere: quebrar em duas linhas atrapalha a conferência. O rótulo cede
   * largura e o corpo diminui até o valor caber inteiro, com um piso de
   * legibilidade; abaixo disso ele quebra mesmo.
   */
  let larguraRotulo = LARGURA_ROTULO;
  let corpoValor = mono ? 7.8 : 9;
  if (mono) {
    doc.font("Courier");
    for (const tentativa of [7.8, 7.2, 6.8, 6.4]) {
      doc.fontSize(tentativa);
      const disponivel = LARGURA_TEXTO - (texto.length > 40 ? 150 : LARGURA_ROTULO) - 12;
      if (doc.widthOfString(texto) <= disponivel) {
        corpoValor = tentativa;
        larguraRotulo = texto.length > 40 ? 150 : LARGURA_ROTULO;
        break;
      }
      corpoValor = tentativa;
      larguraRotulo = texto.length > 40 ? 150 : LARGURA_ROTULO;
    }
  }
  const larguraValor = LARGURA_TEXTO - larguraRotulo - 12;

  doc.fontSize(8.4).font("Helvetica");
  const altRotulo = doc.heightOfString(`${rotulo}`, { width: larguraRotulo });
  doc.fontSize(corpoValor).font(mono ? "Courier" : "Helvetica-Bold");
  const altValor = doc.heightOfString(texto, { width: larguraValor, align: "right" });
  const altura = Math.max(altRotulo, altValor) + 5;

  reservar(ctx, altura + 4);
  const pagina = paginaAtual(doc);
  const y = doc.y;
  fundoDoBloco(doc, altura);

  doc
    .fontSize(8.4)
    .font("Helvetica")
    .fillColor(COR.rotulo)
    .text(rotulo, MARGEM_TEXTO, y + 3.5, { width: larguraRotulo });

  doc
    .fontSize(corpoValor)
    .font(mono ? "Courier" : "Helvetica-Bold")
    .fillColor(mono ? COR.mono : COR.texto)
    .text(texto, MARGEM_TEXTO + larguraRotulo + 12, y + 3.5, { width: larguraValor, align: "right" });

  if (paginaAtual(doc) === pagina) {
    doc
      .moveTo(MARGEM_TEXTO, y + altura - 1)
      .lineTo(MARGEM_TEXTO + LARGURA_TEXTO, y + altura - 1)
      .lineWidth(0.5)
      .strokeColor(COR.filete)
      .stroke();
  }

  fecharBloco(doc, pagina, y + altura, 3);
}

/** Selo em pílula, à direita da linha, como no modelo. */
export function badge(ctx, rotulo, valor, ok) {
  const { doc } = ctx;
  garantirCartao(ctx);
  const paleta = ok === true
    ? { fundo: COR.okFundo, borda: COR.okBorda, tinta: COR.okTexto }
    : ok === false
      ? { fundo: COR.perigoFundo, borda: COR.perigoBorda, tinta: COR.perigoTexto }
      : { fundo: COR.alertaFundo, borda: COR.alertaBorda, tinta: COR.alertaTexto };

  const texto = String(valor).toUpperCase();
  doc.fontSize(7.2).font("Helvetica-Bold");
  const largura = doc.widthOfString(texto, { characterSpacing: 0.4 }) + 18;
  const alturaPilula = 13;
  const altura = 20;

  reservar(ctx, altura + 4);
  const pagina = paginaAtual(doc);
  const y = doc.y;
  fundoDoBloco(doc, altura);

  doc
    .fontSize(8.6)
    .font("Helvetica")
    .fillColor(COR.rotulo)
    .text(rotulo, MARGEM_TEXTO, y + 5, { width: LARGURA_TEXTO - largura - 10 });

  const x = MARGEM_TEXTO + LARGURA_TEXTO - largura;
  doc.save();
  doc
    .roundedRect(x, y + 2, largura, alturaPilula, alturaPilula / 2)
    .lineWidth(0.7)
    .fillColor(paleta.fundo)
    .strokeColor(paleta.borda)
    .fillAndStroke();
  doc.restore();
  doc
    .fontSize(7.2)
    .font("Helvetica-Bold")
    .fillColor(paleta.tinta)
    .text(texto, x, y + 5.6, { width: largura, align: "center", characterSpacing: 0.4, lineBreak: false });

  doc
    .moveTo(MARGEM_TEXTO, y + altura - 1)
    .lineTo(MARGEM_TEXTO + LARGURA_TEXTO, y + altura - 1)
    .lineWidth(0.5)
    .strokeColor(COR.filete)
    .stroke();

  fecharBloco(doc, pagina, y + altura, 3);
}

/**
 * Parágrafo. O texto explicativo do laudo sai na caixa azul-clara do modelo
 * (`.note`); o texto de apoio, em cinza, segue como prosa corrida.
 */
export function paragraph(ctx, texto, { color, size = 9.5, italic = false } = {}) {
  const { doc } = ctx;
  garantirCartao(ctx);
  const tinta = cor(color);
  const nota = tinta === COR.texto || tinta === COR.perigoTexto || tinta === COR.tituloAlerta;
  const corpo = nota ? 8.4 : 8;
  const fonte = italic ? "Helvetica-Oblique" : "Helvetica";

  doc.fontSize(corpo).font(fonte);
  const largura = nota ? LARGURA_TEXTO - 22 : LARGURA_TEXTO;
  const alturaTexto = doc.heightOfString(String(texto), { width: largura, align: "justify", lineGap: 1.6 });
  const altura = nota ? alturaTexto + 14 : alturaTexto + 6;

  // Bloco inteiro na mesma folha sempre que couber: a caixa da nota é desenhada
  // com a altura medida, e parti-la deixaria a metade de baixo sem fundo.
  reservar(ctx, altura + 6);
  const pagina = paginaAtual(doc);
  const y = doc.y + 4;
  fundoDoBloco(doc, altura + 4);

  if (nota) {
    doc.save();
    doc
      .roundedRect(MARGEM_TEXTO, y, LARGURA_TEXTO, alturaTexto + 14, 3)
      .lineWidth(0.7)
      .fillColor(tinta === COR.texto ? COR.notaFundo : COR.perigoFundo)
      .strokeColor(tinta === COR.texto ? COR.notaBorda : COR.perigoBorda)
      .fillAndStroke();
    doc.restore();
    doc
      .fontSize(corpo)
      .font(fonte)
      .fillColor(tinta === COR.texto ? COR.notaTexto : COR.perigoTexto)
      .text(String(texto), MARGEM_TEXTO + 11, y + 7, { width: largura, align: "justify", lineGap: 1.6 });
  } else {
    doc
      .fontSize(corpo)
      .font(fonte)
      .fillColor(tinta || COR.rotulo)
      .text(String(texto), MARGEM_TEXTO, y, { width: largura, align: "justify", lineGap: 1.6 });
  }

  fecharBloco(doc, pagina, y + altura - 2, 4);
}

/** Item de lista com marcador losango, como o `.flag` da tela. */
export function bullet(ctx, texto, { color, size = 9 } = {}) {
  const { doc } = ctx;
  garantirCartao(ctx);
  const tinta = cor(color) || COR.texto;
  doc.fontSize(8.2).font("Helvetica");
  const alturaTexto = doc.heightOfString(String(texto), { width: LARGURA_TEXTO - 14, lineGap: 1.4 });
  const altura = alturaTexto + 6;

  reservar(ctx, altura + 4);
  const pagina = paginaAtual(doc);
  const y = doc.y;
  fundoDoBloco(doc, altura);

  doc.save();
  doc.circle(MARGEM_TEXTO + 3, y + 5.5, 1.6).fill(COR.ponto);
  doc.restore();
  doc
    .fontSize(8.2)
    .font("Helvetica")
    .fillColor(tinta)
    .text(String(texto), MARGEM_TEXTO + 12, y + 1, { width: LARGURA_TEXTO - 14, lineGap: 1.4 });

  fecharBloco(doc, pagina, y + altura, 3);
}

/** Tabela em fluxo, com cabeçalho repetido na virada de página. */
export function table(ctx, colunas, linhas, { size = 7.5, destaque = null } = {}) {
  const { doc } = ctx;
  if (!linhas.length) return;
  garantirCartao(ctx);
  const larguras = colunas.map((c) => c.largura * LARGURA_TEXTO);
  const corpo = Math.min(size, 7.2);

  const cabecalho = () => {
    const y = doc.y;
    doc.fontSize(6.2).font("Helvetica-Bold");
    // Título de coluna longo ("DATA/HORA (GMT)") ocupa duas linhas em vez de
    // ser cortado: a altura da faixa vem da medida, não de um valor fixo.
    const alturaFaixa =
      Math.max(
        ...colunas.map((coluna, i) =>
          doc.heightOfString(String(coluna.titulo).toUpperCase(), { width: larguras[i] - 6, characterSpacing: 0.1 })),
        9,
      ) + 7;
    fundo(doc, y, alturaFaixa + 1);
    doc.save();
    doc.rect(MARGEM_TEXTO, y, LARGURA_TEXTO, alturaFaixa).fill("#eef3f5");
    doc.restore();
    let x = MARGEM_TEXTO;
    colunas.forEach((coluna, i) => {
      doc
        .fontSize(6.2)
        .font("Helvetica-Bold")
        .fillColor(COR.sub)
        .text(String(coluna.titulo).toUpperCase(), x + 4, y + 4, {
          width: larguras[i] - 6,
          characterSpacing: 0.1,
        });
      x += larguras[i];
    });
    doc.x = MARGEM_TEXTO;
    doc.y = y + alturaFaixa + 1;
  };

  reservar(ctx, 46);
  cabecalho();

  linhas.forEach((linha, indice) => {
    const celulas = linha.map((valor) => (valor === null || valor === undefined ? "" : String(valor)));
    doc.fontSize(corpo).font("Helvetica");
    const altura =
      Math.max(
        ...celulas.map((texto, i) => doc.heightOfString(texto, { width: larguras[i] - 6 })),
        9,
      ) + 6;

    if (espacoLivre(doc) < altura + 12) {
      doc.addPage();
      cabecalho();
    }

    const y = doc.y;
    fundo(doc, y, altura);
    // O predicado recebe o índice da linha, como no tema clássico.
    if (destaque && destaque(indice)) {
      doc.save();
      doc.rect(MARGEM_TEXTO, y, LARGURA_TEXTO, altura).fill(COR.perigoFundo);
      doc.restore();
    }

    let x = MARGEM_TEXTO;
    celulas.forEach((texto, i) => {
      doc
        .fontSize(corpo)
        .font(colunas[i].mono ? "Courier" : "Helvetica")
        .fillColor(colunas[i].mono ? COR.mono : COR.texto)
        .text(texto, x + 4, y + 3, { width: larguras[i] - 6 });
      x += larguras[i];
    });

    doc
      .moveTo(MARGEM_TEXTO, y + altura - 0.5)
      .lineTo(MARGEM_TEXTO + LARGURA_TEXTO, y + altura - 0.5)
      .lineWidth(0.4)
      .strokeColor(COR.filete)
      .stroke();

    doc.x = MARGEM_TEXTO;
    doc.y = y + altura;
  });
  doc.moveDown(0.3);
}

/**
 * Aviso legal do fim do laudo.
 *
 * Desenhado como bloco próprio: escrito direto no documento, ele ficava sem o
 * fundo do cartão e a borda do cartão cortava a última linha ao meio.
 */
export function avisoLegalBloco(ctx, texto) {
  const { doc } = ctx;
  garantirCartao(ctx);
  doc.fontSize(7.2).font("Helvetica-Oblique");
  const alturaTexto = doc.heightOfString(String(texto), { width: LARGURA_TEXTO, align: "justify", lineGap: 1.2 });
  const altura = alturaTexto + 14;

  reservar(ctx, altura + 6);
  const pagina = paginaAtual(doc);
  const y = doc.y;
  fundoDoBloco(doc, altura);

  doc
    .moveTo(MARGEM_TEXTO, y + 4)
    .lineTo(MARGEM_TEXTO + LARGURA_TEXTO, y + 4)
    .lineWidth(0.5)
    .strokeColor(COR.borda)
    .stroke();
  doc
    .fontSize(7.2)
    .font("Helvetica-Oblique")
    .fillColor(COR.vazio)
    .text(String(texto), MARGEM_TEXTO, y + 10, { width: LARGURA_TEXTO, align: "justify", lineGap: 1.2 });

  fecharBloco(doc, pagina, y + altura, 4);
}

// ─── Capa ────────────────────────────────────────────────────────────────────

/**
 * Capa do modelo: título espaçado, quadro de quatro colunas com protocolo,
 * emissão, arquivo e impressão digital, e as pastilhas de escopo.
 *
 * Recebe os dados já calculados por `reportPdfService.js`, para a regra do
 * laudo continuar em um lugar só.
 */
export function capa(ctx, dados) {
  const { doc } = ctx;
  const {
    protocolo, emissao, arquivo, tamanho, sha256, produto, escopo,
    resumoTitulo, resumoValor, resumoLinhas, alerta,
  } = dados;

  abrirCartao(ctx);
  const y0 = doc.y;
  const titulo = "LAUDO TÉCNICO PERICIAL · CADEIA DE CUSTÓDIA";
  const subtitulo = "EXAME AUTOMATIZADO DE INTEGRIDADE, AUTORIA E COERÊNCIA GEOGRÁFICA";
  // O título ocupa uma linha só: reduz o corpo até caber na largura do cartão.
  let corpoTitulo = 12;
  doc.font("Courier-Bold");
  while (corpoTitulo > 8) {
    doc.fontSize(corpoTitulo);
    if (doc.widthOfString(titulo, { characterSpacing: 0.6 }) <= LARGURA_TEXTO) break;
    corpoTitulo -= 0.5;
  }
  fundo(doc, y0, 78);

  // Faixa em degradê no alto do cartão, como no modelo.
  const degrade = doc.linearGradient(MARGEM_TEXTO, 0, MARGEM_TEXTO + LARGURA_TEXTO, 0);
  degrade.stop(0, "#0b88aa").stop(0.7, "#0b5f78").stop(1, "#d7a13a");
  doc.save();
  doc.rect(MARGEM_TEXTO, y0 + 2, LARGURA_TEXTO, 3).fill(degrade);
  doc.restore();

  doc
    .fontSize(corpoTitulo)
    .font("Courier-Bold")
    .fillColor(COR.titulo)
    .text(titulo, MARGEM_TEXTO, y0 + 22, {
      width: LARGURA_TEXTO,
      align: "center",
      characterSpacing: 0.6,
      lineBreak: false,
    });
  doc
    .fontSize(7)
    .font("Courier")
    .fillColor(COR.rotulo)
    .text(subtitulo, MARGEM_TEXTO, y0 + 44, {
      width: LARGURA_TEXTO,
      align: "center",
      characterSpacing: 0.4,
      lineBreak: false,
    });

  doc.x = MARGEM_TEXTO;
  doc.y = y0 + 66;

  // Quadro de quatro colunas.
  const celulas = [
    ["PROTOCOLO TÉCNICO", protocolo],
    ["EMISSÃO", emissao],
    ["ARQUIVO EXAMINADO", `${arquivo}${tamanho ? `\n${tamanho}` : ""}`],
    ["IMPRESSÃO DIGITAL", `SHA-256\n${sha256 ? `${sha256.slice(0, 22)}…` : "não calculada"}`],
  ];
  const largura = LARGURA_TEXTO / 4;
  doc.fontSize(7.4).font("Courier");
  const alturaQuadro =
    Math.max(...celulas.map(([, v]) => doc.heightOfString(String(v), { width: largura - 16 }))) + 30;

  fundo(doc, doc.y, alturaQuadro + 8);
  const yq = doc.y;
  doc.save();
  doc
    .roundedRect(MARGEM_TEXTO, yq, LARGURA_TEXTO, alturaQuadro, 3)
    .lineWidth(0.7)
    .fillColor("#fbfcfd")
    .strokeColor(COR.borda)
    .fillAndStroke();
  doc.restore();

  celulas.forEach(([rotulo, valor], i) => {
    const x = MARGEM_TEXTO + largura * i;
    if (i > 0) {
      doc.save();
      doc.moveTo(x, yq + 6).lineTo(x, yq + alturaQuadro - 6).lineWidth(0.5).strokeColor(COR.borda).stroke();
      doc.restore();
    }
    doc
      .fontSize(6.2)
      .font("Courier")
      .fillColor(COR.rotulo)
      .text(rotulo, x + 8, yq + 8, { width: largura - 16, characterSpacing: 0.4, lineBreak: false });
    doc
      .fontSize(7.4)
      .font("Courier")
      .fillColor(COR.mono)
      .text(String(valor), x + 8, yq + 20, { width: largura - 16, lineGap: 1.5 });
  });

  doc.x = MARGEM_TEXTO;
  doc.y = yq + alturaQuadro + 12;

  // Pastilhas de escopo.
  const pastilhas = String(escopo || "").split("·").map((s) => s.trim()).filter(Boolean);
  if (pastilhas.length) {
    doc.fontSize(7).font("Helvetica");
    const alturas = 15;
    fundo(doc, doc.y, alturas + 10);
    const larguras = pastilhas.map((p) => doc.widthOfString(p) + 16);
    const total = larguras.reduce((a, b) => a + b, 0) + (pastilhas.length - 1) * 6;
    let x = MARGEM_TEXTO + (LARGURA_TEXTO - total) / 2;
    const y = doc.y;
    pastilhas.forEach((texto, i) => {
      doc.save();
      doc
        .roundedRect(x, y, larguras[i], alturas, alturas / 2)
        .lineWidth(0.6)
        .fillColor("#f6f9fa")
        .strokeColor(COR.borda)
        .fillAndStroke();
      doc.restore();
      doc
        .fontSize(7)
        .font("Helvetica")
        .fillColor(COR.sub)
        .text(texto, x, y + 4.5, { width: larguras[i], align: "center", lineBreak: false });
      x += larguras[i] + 6;
    });
    doc.x = MARGEM_TEXTO;
    doc.y = y + alturas + 12;
  }

  field(ctx, "Instrumento examinado", produto);
  if (dados.ocr) field(ctx, "OCR", dados.ocr);
  fecharCartao(ctx);

  // Quadro do resumo executivo, em cartão próprio. Quem abre o cartão é o
  // próprio título: abrir aqui deixava um cartão vazio antes dele.
  heading(ctx, resumoTitulo, { danger: alerta });
  doc
    .fontSize(14)
    .font("Helvetica-Bold")
    .fillColor(alerta ? COR.tituloAlerta : COR.titulo);
  const alturaValor = doc.heightOfString(String(resumoValor), { width: LARGURA_TEXTO });
  fundo(doc, doc.y, alturaValor + 8);
  doc.text(String(resumoValor), MARGEM_TEXTO, doc.y + 2, { width: LARGURA_TEXTO });
  doc.x = MARGEM_TEXTO;
  doc.y += 6;
  for (const linha of resumoLinhas.filter(Boolean)) bullet(ctx, linha, {});
  fecharCartao(ctx);
}
