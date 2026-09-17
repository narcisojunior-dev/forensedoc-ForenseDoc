/**
 * Campos cadastrais vazios ou com valor fictício.
 *
 * ─── O defeito que motivou ───────────────────────────────────────────────────
 *
 * O dossiê C6 traz "Doc. Ident.: RG 111111111111" e "Endereço Completo: Nao
 * Informado , SD". O laudo reproduziu o RG como documento válido e mostrou o
 * endereço como "Não identificado", ou seja, apresentou como falha da própria
 * extração o que é achado sobre o documento do réu: a instituição formalizou a
 * operação sem identificar o contratante.
 *
 * Por isso cada campo tem um de quatro estados, que nunca se confundem:
 *   NAO_LOCALIZADO       o rótulo não foi encontrado (limite da extração)
 *   LOCALIZADO_VAZIO     o rótulo existe e o documento não o preencheu
 *   LOCALIZADO_SUSPEITO  preenchido com valor que não pode ser real
 *   LOCALIZADO           preenchido
 */

export const ESTADO = {
  NAO_LOCALIZADO: "NAO_LOCALIZADO",
  LOCALIZADO_VAZIO: "LOCALIZADO_VAZIO",
  LOCALIZADO_SUSPEITO: "LOCALIZADO_SUSPEITO",
  LOCALIZADO: "LOCALIZADO",
};

const MARCAS_DE_VAZIO = /^\s*(?:n[ãa]o\s+informad[oa]s?|N\/?I|S\/?D|S\/?N|X{3,}|0{3,}|-+|\.+|nada\s+consta)\s*[,.;]?\s*(?:S\/?D|S\/?N)?\s*$/i;

/** "Nao Informado , SD", "N/I", "XXX", "000". */
export function valorDeclaradoVazio(valor) {
  const t = String(valor ?? "").trim();
  return !t || MARCAS_DE_VAZIO.test(t);
}

function cpfValido(digitos) {
  if (!/^\d{11}$/.test(digitos) || /^(\d)\1{10}$/.test(digitos)) return false;
  const dv = (base) => {
    const soma = base.split("").reduce((acc, d, i) => acc + Number(d) * (base.length + 1 - i), 0);
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };
  return dv(digitos.slice(0, 9)) === Number(digitos[9]) && dv(digitos.slice(0, 10)) === Number(digitos[10]);
}

function cnpjValido(digitos) {
  if (!/^\d{14}$/.test(digitos) || /^(\d)\1{13}$/.test(digitos)) return false;
  const calc = (base, pesos) => {
    const soma = base.split("").reduce((acc, d, i) => acc + Number(d) * pesos[i], 0);
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };
  const p1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const p2 = [6, ...p1];
  return calc(digitos.slice(0, 12), p1) === Number(digitos[12]) && calc(digitos.slice(0, 13), p2) === Number(digitos[13]);
}

function sequencial(digitos) {
  if (digitos.length < 6) return false;
  const passo = (a, b) => Number(b) - Number(a);
  const primeiro = passo(digitos[0], digitos[1]);
  if (Math.abs(primeiro) !== 1) return false;
  for (let i = 1; i < digitos.length - 1; i += 1) {
    const p = passo(digitos[i], digitos[i + 1]);
    // "0123456789" e "9876543210", com a volta de 9 para 0 aceita.
    if (p !== primeiro && !(primeiro === 1 && p === -9) && !(primeiro === -1 && p === 9)) return false;
  }
  return true;
}

/**
 * @param {string} valor número do documento como lido
 * @param {"cpf"|"cnpj"|"rg"} tipo
 * @returns {{suspeito: boolean, motivo: string|null}}
 */
export function avaliarNumeroDocumento(valor, tipo) {
  const digitos = String(valor ?? "").replace(/\D/g, "");
  if (!digitos) return { suspeito: false, motivo: null };
  if (/^(\d)\1+$/.test(digitos)) return { suspeito: true, motivo: "dígitos repetidos" };
  if (sequencial(digitos)) return { suspeito: true, motivo: "sequência numérica" };
  if (tipo === "cpf" && digitos.length === 11 && !cpfValido(digitos)) return { suspeito: true, motivo: "dígito verificador inválido" };
  if (tipo === "cnpj" && digitos.length === 14 && !cnpjValido(digitos)) return { suspeito: true, motivo: "dígito verificador inválido" };
  return { suspeito: false, motivo: null };
}

/**
 * Colunas de formulário com rótulo numa linha e valor na de baixo, como a
 * proposta de seguro ("Data de nascimento   Nacionalidade   Ocupação" e, abaixo,
 * "27/06/1985   BRASILEIRO(A)   ", com a coluna Ocupação em branco).
 *
 * Só afirma "vazio" quando a linha de valores existe e está preenchida em outra
 * coluna: uma tabela inteira em branco pode ser falha de leitura.
 */
function colunaVazia(texto, rotuloRegex) {
  const linhas = String(texto || "").split(/\r?\n/);
  for (let i = 0; i < linhas.length - 1; i += 1) {
    const m = linhas[i].match(rotuloRegex);
    if (!m) continue;
    const inicio = m.index;
    const antes = linhas[i].slice(0, inicio);
    const depois = linhas[i].slice(inicio + m[0].length);
    // Cabeçalho de coluna, e não o mesmo termo no meio de uma cláusula: isolado
    // por bloco de espaços dos dois lados (ou início/fim de linha).
    if (!(/^\s*$|\s{3,}$/.test(antes) && /^\s*$|^\s{3,}/.test(depois))) continue;
    const proximoRotulo = depois.search(/\S/);
    const fim = proximoRotulo >= 0 ? inicio + m[0].length + proximoRotulo : Infinity;
    let j = i + 1;
    while (j < linhas.length && !linhas[j].replace(/\f/g, "").trim()) j += 1;
    // Até cinco linhas em branco: é o espaço que sobra quando o carimbo do
    // tribunal, impresso entre rótulo e valor, é retirado do texto.
    if (j >= linhas.length || j - i > 6) continue;
    const valores = linhas[j];
    if (!valores.trim()) continue;
    // Tolerância de 4 colunas: o valor raramente começa exatamente sob o rótulo.
    const trecho = valores.slice(Math.max(0, inicio - 4), fim === Infinity ? undefined : fim - 1);
    return { encontrado: true, vazio: !trecho.trim(), valor: trecho.trim() || null };
  }
  return { encontrado: false, vazio: false, valor: null };
}

/**
 * Estados dos campos de qualificação do contratante.
 *
 * @param {string} texto texto do documento (com colunas preservadas)
 * @param {object} cliente campos já extraídos
 */
export function avaliarQualificacao(texto, cliente = {}) {
  const t = String(texto || "");
  const estados = {};

  const rgLiteral = t.match(/Doc\.?\s*Ident\.?\s*:?\s*RG\s*([0-9.\-\/]{5,20})/i)?.[1] || cliente.rg || null;
  if (rgLiteral) {
    const r = avaliarNumeroDocumento(rgLiteral, "rg");
    estados.rg = { estado: r.suspeito ? ESTADO.LOCALIZADO_SUSPEITO : ESTADO.LOCALIZADO, valor: rgLiteral, motivo: r.motivo };
  } else {
    estados.rg = { estado: ESTADO.NAO_LOCALIZADO, valor: null, motivo: null };
  }

  if (cliente.cpf) {
    const r = avaliarNumeroDocumento(cliente.cpf, "cpf");
    estados.cpf = { estado: r.suspeito ? ESTADO.LOCALIZADO_SUSPEITO : ESTADO.LOCALIZADO, valor: cliente.cpf, motivo: r.motivo };
  }

  const enderecoRotulado = t.match(/Endere[çc]o(?:\s+Completo)?\s*:[ \t]*([^\n]{2,120})/i);
  const enderecoVazio = t.match(/Endere[çc]o(?:\s+Completo)?\s*:?[ \t]*(n[ãa]o\s+informad[oa]\s*,?\s*(?:S\/?D|S\/?N)?)/i);
  if (enderecoVazio) {
    estados.endereco = {
      estado: ESTADO.LOCALIZADO_VAZIO,
      valor: enderecoVazio[1].replace(/\s+/g, " ").replace(/\s+,/, ",").trim(),
      motivo: "o instrumento registra o endereço como não informado",
    };
  } else if (cliente.endereco) {
    estados.endereco = { estado: ESTADO.LOCALIZADO, valor: cliente.endereco, motivo: null };
  } else {
    estados.endereco = { estado: ESTADO.NAO_LOCALIZADO, valor: enderecoRotulado?.[1]?.trim() || null, motivo: null };
  }

  for (const [campo, regex] of [
    ["email", /\bE-?mail\b/i],
    ["ocupacao", /\bOcupa[çc][ãa]o\b/i],
    ["nome_social", /\bNome\s+Social(?:\s*\([^)]*\))?/i],
  ]) {
    if (cliente[campo]) {
      estados[campo] = { estado: ESTADO.LOCALIZADO, valor: cliente[campo], motivo: null };
      continue;
    }
    const col = colunaVazia(t, regex);
    estados[campo] = col.encontrado && col.vazio
      ? { estado: ESTADO.LOCALIZADO_VAZIO, valor: null, motivo: "campo do formulário sem preenchimento" }
      : { estado: ESTADO.NAO_LOCALIZADO, valor: null, motivo: null };
  }

  return estados;
}
