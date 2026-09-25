import { isIP } from "node:net";
import { firstMatch } from "./format.js";
import { extractIpAddresses as extrairIpsRotulados } from "../utils/ipExtraction.js";
import { classifyIpAddress, extractIpAddresses as extrairIpsMotor } from "./network.js";

/**
 * Salvaguardas de extração herdadas do SaaS.
 *
 * O motor de geração trouxe layouts dedicados por banco e muito mais achados,
 * mas os padrões genéricos dele ainda carregam defeitos que o SaaS já tinha
 * corrigido com documento real e teste de regressão (tests/extractionFields e
 * tests/corpus): nome "Do Cliente", número de contrato "Documento", coordenada
 * de três casas ignorada e IPv6 com porta perdido.
 *
 * A regra da mescla é simples: layout dedicado do motor tem prioridade; quando
 * o motor cai no padrão genérico, o valor só é aceito se passar pelo mesmo
 * critério que o SaaS já validou.
 */

// ─── Nome do contratante ─────────────────────────────────────────────────────

/**
 * Termos de formulário que nunca fazem parte de um nome. Barrados DENTRO da
 * palavra: "CPF" em caixa alta casaria como palavra de nome e faria a captura
 * engolir o rótulo seguinte.
 */
const TERMO_DE_FORMULARIO_FONTE =
  "CPF|CNPJ|RG|ID|Data|Banco|Ag[êe]ncia|Conta|Matr[íi]cula|Benef[íi]cio|Sess[ãa]o|Cliente|Titular|Anexo|Propriedades|Endere[çc]o|Bairro|CEP|Telefone|E-?mail|Latitude|Longitude";

/** Palavra de nome: inicial maiúscula, ou sigla toda em caixa alta. */
const PALAVRA_DE_NOME =
  `(?!(?:${TERMO_DE_FORMULARIO_FONTE})\\b)` +
  "(?:[A-ZÁÀÂÃÉÊÍÓÔÕÚÜÇ][A-Za-zÁÀÂÃÉÊÍÓÔÕÚÜÇáàâãéêíóôõúüç']+|[A-ZÁÀÂÃÉÊÍÓÔÕÚÜÇ]{2,})";
/** Conectivos que aparecem no MEIO de um nome, nunca no começo. */
const CONECTIVO_DE_NOME = "(?:d[aeo]s?|e|del|von|van)";

const FORMA_DE_NOME = new RegExp(
  `^\\s*[:\\-]?\\s*(${PALAVRA_DE_NOME}(?:\\s+(?:${PALAVRA_DE_NOME}|${CONECTIVO_DE_NOME})){1,5})`
);

const ROTULOS_NOME =
  /\b(?:nome\s+do\s+cliente|nome\s+completo|nome\s+do\s+contratante|nome|contratante|benefici[aá]rio)\b/gi;

/** "Nome da mãe", "Nome do consultor": o valor pertence a outra pessoa. */
const ROTULO_DE_TERCEIRO =
  /\b(?:m[ãa]e|pai|c[ôo]njuge|representante|testemunha|procurador|consultor|vendedor|promotor|correspondente|fantasia)\b/i;

/** Nome do contratante pelo critério de FORMA, e não de caixa. */
export function extrairNomeContratante(flat) {
  for (const m of String(flat || "").matchAll(ROTULOS_NOME)) {
    const inicio = m.index + m[0].length;
    if (ROTULO_DE_TERCEIRO.test(flat.slice(inicio, inicio + 20))) continue;

    const candidato = flat.slice(inicio, inicio + 140).match(FORMA_DE_NOME);
    if (!candidato) continue;

    const valor = candidato[1].trim().replace(/\s+/g, " ");
    if (valor.length < 8) continue;

    return valor;
  }
  return null;
}

/**
 * Filtro aplicado aos nomes que os padrões genéricos do motor capturam. Os
 * padrões usam `/i` com classe de caixa alta, o que aceita "do cliente" como
 * valor; aqui o candidato precisa ter forma de nome de pessoa.
 */
export function nomePlausivel(valor) {
  const t = String(valor || "").trim();
  if (!t) return false;
  if (t.split(/\s+/).length < 2) return false;
  if (/^(?:d[aeo]s?|e)\b/i.test(t)) return false;
  if (/\d/.test(t)) return false;
  if (new RegExp(`\\b(?:${TERMO_DE_FORMULARIO_FONTE})\\b`, "i").test(t)) return false;
  if (ROTULO_DE_TERCEIRO.test(t)) return false;
  return true;
}

// ─── Número do contrato ──────────────────────────────────────────────────────

/**
 * O rótulo solto aceitava qualquer palavra depois de "contrato": o laudo saía
 * com "Documento" ou "contratada" no número do instrumento. Nenhum banco numera
 * contrato com menos de quatro dígitos.
 */
const NUMERO_DE_CONTRATO = /(?=[A-Z0-9.\-\/]*(?:\d[A-Z0-9.\-\/]*){4,})([A-Z0-9.\-\/]{5,})/i;

export function numeroContratoPlausivel(valor) {
  const v = String(valor || "").trim();
  return /^[A-Z0-9][A-Z0-9./-]{3,79}$/i.test(v)
    && (v.match(/\d/g) || []).length >= 4
    && !/^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$/.test(v)
    && !/^\d{2}\/\d{2}\/\d{4}$/.test(v)
    && !/https|visualizar|listview/i.test(v);
}

export function extrairNumeroContrato(flat) {
  return firstMatch(flat, [
    new RegExp(
      `(?:contrato|proposta|c[eé]dula|opera[cç][aã]o)\\s*(?:n[ºo.]*)?\\s*[:\\-]?\\s*${NUMERO_DE_CONTRATO.source}`,
      "i"
    ),
    new RegExp(`\\b(?:CCB|ADE)\\s*[:\\-]?\\s*${NUMERO_DE_CONTRATO.source}`, "i"),
  ]);
}

// ─── Coordenadas ─────────────────────────────────────────────────────────────

const LAT_BR = [-34, 6];
const LON_BR = [-74, -33];

const numeroDeCoordenada = (bruto) => Number(String(bruto).replace(",", "."));

function dentroDoBrasil(lat, lon) {
  return (
    Number.isFinite(lat) && lat >= LAT_BR[0] && lat <= LAT_BR[1] &&
    Number.isFinite(lon) && lon >= LON_BR[0] && lon <= LON_BR[1]
  );
}

/**
 * Coordenadas pelo critério de PLAUSIBILIDADE geográfica, não de casas
 * decimais: "-7.115, -34.86306" é coordenada real de contrato e tem latitude
 * com três casas.
 *
 * O rótulo combinado "Latitude e Longitude: a / b" tem precedência: os padrões
 * isolados casavam o "Longitude:" de dentro dele e trocavam os valores.
 */
export function extrairCoordenadasPlausiveis(flat) {
  const texto = String(flat || "");
  const combinado = texto.match(
    /latitude\s*(?:e|,|\/)\s*longitude\s*[:\-]?\s*(-?\d{1,2}[,.]\d{3,})\s*[\/,;]\s*(-?\d{1,3}[,.]\d{3,})/i
  );
  if (combinado) {
    const lat = numeroDeCoordenada(combinado[1]);
    const lon = numeroDeCoordenada(combinado[2]);
    if (dentroDoBrasil(lat, lon)) return { lat, lon, origem: "rotulo-combinado" };
  }

  const latRotulada = firstMatch(texto, [
    /latitude\s*[:\-]\s*(-?\d{1,2}[,.]\d{3,})/i,
    /\blat\s*[:\-]\s*(-?\d{1,2}[,.]\d{3,})/i,
  ]);
  const lonRotulada = firstMatch(texto, [
    /longitude\s*[:\-]\s*(-?\d{1,3}[,.]\d{3,})/i,
    /\blon(?:g)?\s*[:\-]\s*(-?\d{1,3}[,.]\d{3,})/i,
  ]);
  if (latRotulada && lonRotulada) {
    const lat = numeroDeCoordenada(latRotulada);
    const lon = numeroDeCoordenada(lonRotulada);
    if (dentroDoBrasil(lat, lon)) return { lat, lon, origem: "rotulos" };
  }

  for (const m of texto.matchAll(/(-?\d{1,2}[,.]\d{3,})\s*[,; ]\s*(-?\d{1,3}[,.]\d{3,})/g)) {
    const lat = numeroDeCoordenada(m[1]);
    const lon = numeroDeCoordenada(m[2]);
    if (dentroDoBrasil(lat, lon)) return { lat, lon, origem: "par" };
  }
  return null;
}

/**
 * Formata a coordenada como texto, no contrato de dados que o restante do SaaS
 * espera (revisão de campos, recálculo e laudo leem string com ponto decimal).
 */
export function coordenadaComoTexto(valor) {
  if (valor === null || valor === undefined || valor === "") return null;
  const n = Number(String(valor).replace(",", "."));
  return Number.isFinite(n) ? String(n) : null;
}

// ─── Endereços IP ────────────────────────────────────────────────────────────

/**
 * Une os dois extratores.
 *
 * O do SaaS lê os rótulos das plataformas ("IP e Porta Lógica"), separa a
 * porta, associa data/hora e User-Agent e descarta número de versão. O do motor
 * cobre casos que o outro recusa por desenho, como IPv4 mapeado em IPv6
 * (`::ffff:`), e classifica a faixa do endereço.
 *
 * Registros rotulados vêm primeiro; o que só o motor encontrou entra depois,
 * marcado como tal. Toda entrada recebe a classe (PUBLICO, CGNAT, PRIVADO...),
 * que o enriquecimento geográfico usa para não geolocalizar faixa interna.
 */
export function extrairIps(texto) {
  const registros = extrairIpsRotulados(texto);
  const conhecidos = new Set(registros.map((r) => String(r.endereco).toLowerCase()));
  const plano = String(texto || "").replace(/\s+/g, " ");
  const planoMinusculo = plano.toLowerCase();

  for (const ip of extrairIpsMotor(texto)) {
    const chave = String(ip).toLowerCase();
    if (conhecidos.has(chave) || !isIP(ip)) continue;
    // O extrator do SaaS recusa IPv4 com todos os octetos menores que 10 por ser
    // quase sempre numeração de seção. O do motor não tem essa guarda.
    if (isIP(ip) === 4 && ip.split(".").every((o) => Number(o) < 10)) continue;
    const classe = classifyIpAddress(ip);
    // Endereço público que o SaaS descartou costuma ser número de versão
    // ("Versão do aplicativo 2.14.0.1"). Geolocalizar isso poria no laudo uma
    // origem estrangeira que nunca existiu, então a recusa é mantida.
    if (classe === "PUBLICO") {
      const posicao = planoMinusculo.indexOf(chave);
      const antes = posicao >= 0 ? plano.slice(Math.max(0, posicao - 60), posicao) : "";
      if (/(?:vers[ãa]o|version|build|release|revis[ãa]o|patch|firmware|aplicativo|app|sistema|m[óo]dulo|plugin|biblioteca|chrome|safari|firefox|android|ios)\b[^.]{0,25}$|\/\s*$/i.test(antes)) {
        continue;
      }
    }
    conhecidos.add(chave);
    registros.push({
      endereco: ip,
      versao: isIP(ip),
      compartilhado: classe === "CGNAT",
      porta: null,
      rotulo: null,
      contexto: "Encontrado pela varredura complementar do motor pericial",
      data_hora: null,
      user_agent: null,
    });
  }

  return registros.map((r, indice) => ({
    ...r,
    ordem: indice + 1,
    classe: classifyIpAddress(r.endereco),
  }));
}

// ─── Tabelas em colunas (texto com `-layout`) ───────────────────────────────

const ROTULOS_DE_ENDERECO = {
  bairro: /^bairro:?$/i,
  cidade: /^(?:cidade|munic[íi]pio):?$/i,
  estado: /^(?:estado|uf):?$/i,
  cep: /^cep:?$/i,
};

/**
 * Rótulo de formulário lido como se fosse valor ("Cidade: Estado", "Estado:").
 * Na CCB do Banco Master os rótulos vêm com dois-pontos e em sequência, e o
 * laudo imprimia "Bairro: Cidade: Estado:" como bairro da cliente.
 */
export function valorEhRotulo(valor) {
  const t = String(valor || "").trim();
  if (!t) return false;
  return /^(?:(?:bairro|cidade|munic[íi]pio|estado|uf|cep|endere[çc]o(?:\s+residencial)?)\s*:?\s*)+$/i.test(t);
}

/**
 * Lê "Bairro  Cidade  Estado  CEP" numa linha e os valores na linha seguinte,
 * casando cada valor com o rótulo pela posição da coluna.
 *
 * O `pdftotext -layout` preserva as colunas (e é por isso que o motor o usa:
 * sem elas o layout Facta não separa logradouro de bairro), mas o padrão por
 * rótulo do texto corrido passa a ler o rótulo vizinho como valor. O dossiê C6
 * saía com a cidade do contratante igual a "Estado".
 */
export function enderecoPorColunas(texto) {
  const linhas = String(texto || "").split(/\r?\n/);
  const blocos = (linha) =>
    Array.from(linha.matchAll(/\S+(?: \S+)*/g), (m) => ({ texto: m[0].trim(), inicio: m.index }));

  for (let i = 0; i < linhas.length - 1; i += 1) {
    const cabecalho = blocos(linhas[i]);
    const colunas = cabecalho
      .map((bloco, indice) => ({
        ...bloco,
        campo: Object.keys(ROTULOS_DE_ENDERECO).find((chave) => ROTULOS_DE_ENDERECO[chave].test(bloco.texto)),
        limite: cabecalho[indice + 1]?.inicio ?? Infinity,
      }));
    if (colunas.filter((c) => c.campo).length < 2) continue;

    let j = i + 1;
    while (j < linhas.length && !linhas[j].trim()) j += 1;
    if (j >= linhas.length || j - i > 2) continue;

    const valores = blocos(linhas[j]);
    if (valores.some((v) => valorEhRotulo(v.texto))) continue;
    const achado = {};
    for (const coluna of colunas) {
      if (!coluna.campo) continue;
      const valor = valores.find((v) => v.inicio >= coluna.inicio - 4 && v.inicio < coluna.limite - 1);
      if (valor) achado[coluna.campo] = valor.texto;
    }
    if (Object.keys(achado).length >= 2) return achado;
  }
  return null;
}

/**
 * Quadro de dados pessoais com os rótulos impressos e nada embaixo.
 *
 * A CCB Credcesta de 2024 traz "Bairro: Cidade: Estado: CEP:" e, na linha
 * seguinte, "Telefone/Celular: E-mail:", sem um valor sequer. O extrator, sem
 * valor no quadro, caía no CEP da filial do credor e o laudo domiciliava a
 * cliente na sede do banco. Rótulo sem valor é achado sobre o instrumento.
 *
 * @returns {string[]} campos em branco (bairro, cidade, estado, cep, telefone, fonte_pagadora)
 */
const LINHAS_DE_ROTULOS_DO_CLIENTE = [
  { campos: ["bairro", "cidade", "estado", "cep"], regex: /Bairro\s*:[^\n]*Cidade\s*:[^\n]*(?:Estado|UF)\s*:[^\n]*CEP\s*:/i },
  { campos: ["telefone"], regex: /Telefone(?:\/Celular)?\s*:/i },
  { campos: ["fonte_pagadora"], regex: /Fonte\s+Pagadora\s*:/i },
];
const PROXIMA_LINHA_DE_ROTULOS = /^\s*(?:QUADRO\s+\d|Cargo\/Fun[çc][ãa]o|Nome\s+do\s+Representante|Telefone|E-?mail|Matr[íi]cula)/i;

export function quadroClienteEmBranco(texto) {
  const linhas = String(texto || "").split(/\r?\n/);
  const soRotulos = (l) => Boolean(l.trim()) && !l.replace(/[A-Za-zÀ-ÿ\/º°ª .()-]+\s*:/g, "").trim();
  const vazios = [];
  for (const { campos, regex } of LINHAS_DE_ROTULOS_DO_CLIENTE) {
    const i = linhas.findIndex((l) => regex.test(l));
    if (i < 0 || !soRotulos(linhas[i])) continue;
    let j = i + 1;
    while (j < linhas.length && !linhas[j].trim()) j += 1;
    const proxima = linhas[j] ?? "";
    if (j - i > 2 || !proxima.trim() || soRotulos(proxima) || PROXIMA_LINHA_DE_ROTULOS.test(proxima)) vazios.push(...campos);
  }
  return vazios;
}

// ─── Endereço do contratante ────────────────────────────────────────────────

const CONTEXTO_INSTITUCIONAL =
  /\b(?:CNPJ|Estipulante|Seguradora|Corretora|Correspondente|Sede|Ouvidoria|SAC|Institui[çc][ãa]o\s+Credora|Credor)\b/i;

/**
 * Endereço que pertence à instituição, e não ao contratante.
 *
 * O padrão por rótulo "Endereço:" casa o primeiro endereço do documento, e em
 * dossiê com apólice de seguro esse é o da estipulante: no dossiê C6, a sede do
 * banco na Av. Nove de Julho, em São Paulo, saía como residência de uma
 * contratante de Manaquiri/AM. O dano não fica no § 3: todo o confronto
 * geográfico do § 5 passaria a medir distância até a sede do banco.
 */
export function enderecoInstitucional(flat, endereco) {
  const texto = String(flat || "");
  const valor = String(endereco || "").trim();
  if (!valor) return false;
  const inicio = texto.indexOf(valor.slice(0, 40));
  if (inicio < 0) return false;
  const antes = texto.slice(Math.max(0, inicio - 140), inicio);
  return CONTEXTO_INSTITUCIONAL.test(antes);
}

/** "Não informado", "Nao Informado , SD - ..." e afins não são endereço. */
export function enderecoNaoInformado(endereco) {
  return /^\s*(?:completo\s*:?\s*)?n[ãa]o\s+informad[oa]\b/i.test(String(endereco || ""));
}

// ─── Campos com captura solta ───────────────────────────────────────────────

/**
 * Credor original / cedente. O padrão por rótulo capturava o marcador da lista
 * seguinte ("(ii) Credor Original (iii) Saldo Devedor" virava "(iii)").
 */
export function credorPlausivel(valor) {
  const t = String(valor || "").trim();
  if (!t) return false;
  if (/^\(?[ivxlcdm]+\)?[.)]?$/i.test(t)) return false;
  return /[A-Za-zÀ-ÿ]{3,}/.test(t);
}

/**
 * Espécie do benefício. "espécie" aparece no clausulado ("dados de qualquer
 * espécie apresentados por meio da Plataforma"), e o rótulo solto trazia trecho
 * de cláusula como espécie. Só vale código numérico de espécie do INSS ou nome
 * de benefício.
 */
export function especieBeneficioPlausivel(valor) {
  const t = String(valor || "").trim();
  if (!t) return false;
  return /^(?:B\s*)?\d{2}\b|aposentad|pens[aã]o|aux[ií]lio|amparo|assistencial|\bLOAS\b|\bBPC\b/i.test(t);
}

const BANCO_POR_COMPE = { "001": "Banco do Brasil S.A.", "104": "Caixa Econômica Federal", "237": "Banco Bradesco S.A." };

/**
 * Conta de crédito do valor liberado ("Crédito em Conta Banco: 237 - Ag: 3717 -
 * Conta: 008621-5").
 *
 * O código de três dígitos desse quadro é do banco que RECEBE o dinheiro, não
 * do credor. No dossiê C6 o laudo informava código BACEN 237 (Bradesco) para
 * um contrato do C6 Consignado.
 */
export function contaDeCredito(flat) {
  const m = String(flat || "").match(
    /(?:cr[eé]dito\s+em\s+conta|conta\s+(?:de\s+)?(?:cr[eé]dito|recebimento)|libera[cç][aã]o\s+do\s+cr[eé]dito)[^.]{0,60}?Banco\s*[:\-]?\s*(\d{3})(?:\s*[-–]\s*Ag(?:[eê]ncia)?\.?\s*[:\-]?\s*([\d-]{2,8}))?(?:\s*[-–]\s*Conta\s*[:\-]?\s*([\d.-]{3,15}))?/i
  );
  if (!m) return null;
  return {
    compe: m[1],
    banco: BANCO_POR_COMPE[m[1]] || `Banco de código COMPE ${m[1]}`,
    agencia: m[2] || null,
    conta: m[3] || null,
  };
}
