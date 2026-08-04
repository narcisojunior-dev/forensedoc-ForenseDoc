import { isIP } from "node:net";

/**
 * Campos que o operador pode conferir e corrigir antes de emitir o laudo.
 *
 * ─── Por que esta camada existe ──────────────────────────────────────────────
 *
 * A extração é heurística e é frágil a variação de formato: três documentos de
 * bancos diferentes revelaram três falhas distintas, todas de interpretação e
 * nenhuma de OCR. Corrigir cada padrão é necessário, mas nunca vai cobrir o
 * próximo formato que aparecer.
 *
 * A revisão pelo operador resolve o problema por outro caminho, e um caminho que
 * FORTALECE a peça em vez de só remendá-la: o laudo deixa de ser saída de uma
 * heurística e passa a ser saída conferida por uma pessoa identificada. É
 * exatamente o que os Termos de Uso já exigem ao dizer que o laudo depende de
 * conferência humana; aqui essa conferência vira registro.
 *
 * ─── Lista fechada, de propósito ─────────────────────────────────────────────
 *
 * Só estes campos são editáveis. Deixar o operador escrever em qualquer chave do
 * resultado abriria caminho para alterar o que o sistema APURA (hashes, fonte da
 * geolocalização, classificação de divergência), e um laudo em que o hash pode
 * ser digitado não prova integridade nenhuma.
 *
 * O que é editável é o que foi LIDO do documento. O que é calculado pelo sistema
 * continua sendo calculado.
 */

const soTexto = (max) => (v) => {
  const t = String(v ?? "").trim().replace(/\s+/g, " ");
  if (!t) return { ok: true, valor: null };
  if (t.length > max) return { ok: false, erro: `Máximo de ${max} caracteres.` };
  return { ok: true, valor: t };
};

/** Aceita com ou sem máscara; guarda como veio, porque o laudo cita o documento. */
function validarCpf(v) {
  const t = String(v ?? "").trim();
  if (!t) return { ok: true, valor: null };
  const digitos = t.replace(/\D/g, "");
  if (digitos.length !== 11) return { ok: false, erro: "CPF deve ter 11 dígitos." };
  // Dígito verificador: rejeita erro de digitação sem depender de consulta.
  if (/^(\d)\1{10}$/.test(digitos)) return { ok: false, erro: "CPF inválido." };
  for (const [inicio, pos] of [[9, 10], [10, 11]]) {
    let soma = 0;
    for (let i = 0; i < inicio; i++) soma += Number(digitos[i]) * (pos - i);
    const d = ((soma * 10) % 11) % 10;
    if (d !== Number(digitos[inicio])) return { ok: false, erro: "CPF inválido." };
  }
  return { ok: true, valor: t };
}

function validarCoordenada(faixa, rotulo) {
  return (v) => {
    const t = String(v ?? "").trim();
    if (!t) return { ok: true, valor: null };
    const n = Number(t.replace(",", "."));
    if (!Number.isFinite(n) || n < faixa[0] || n > faixa[1]) {
      return { ok: false, erro: `${rotulo} fora do território brasileiro.` };
    }
    return { ok: true, valor: String(n) };
  };
}

function validarIp(v) {
  const t = String(v ?? "").trim();
  if (!t) return { ok: true, valor: null };
  if (!isIP(t)) return { ok: false, erro: "Endereço IP inválido." };
  return { ok: true, valor: t };
}

function validarDataHora(v) {
  const t = String(v ?? "").trim();
  if (!t) return { ok: true, valor: null };
  // Formato livre de propósito: o campo reproduz o que o documento escreveu, e
  // documentos escrevem de formas diferentes. Só o tamanho é limitado.
  if (t.length > 40) return { ok: false, erro: "Data e hora com formato muito longo." };
  return { ok: true, valor: t };
}

/**
 * Cada entrada define onde o valor mora dentro do objeto extraído, como validar,
 * e como o campo é chamado para o operador e para o laudo.
 */
export const CAMPOS_REVISAVEIS = {
  "cliente.nome": {
    rotulo: "Nome do contratante",
    grupo: "Contratante",
    validar: soTexto(120),
    critico: true,
  },
  "cliente.cpf": {
    rotulo: "CPF do contratante",
    grupo: "Contratante",
    validar: validarCpf,
    critico: true,
  },
  "contrato.banco": {
    rotulo: "Instituição financeira",
    grupo: "Contrato",
    validar: soTexto(120),
    critico: true,
  },
  "contrato.numero": { rotulo: "Número do contrato", grupo: "Contrato", validar: soTexto(60) },
  "contrato.valor_contratado": {
    rotulo: "Valor contratado",
    grupo: "Contrato",
    validar: soTexto(40),
  },
  "contrato.numero_parcelas": { rotulo: "Parcelas", grupo: "Contrato", validar: soTexto(10) },
  "assinatura.data_hora_assinatura": {
    rotulo: "Data e hora da assinatura",
    grupo: "Assinatura",
    validar: validarDataHora,
    critico: true,
  },
  "geolocalizacao_assinatura.latitude": {
    rotulo: "Latitude declarada",
    grupo: "Geolocalização",
    validar: validarCoordenada([-34, 6], "Latitude"),
    critico: true,
  },
  "geolocalizacao_assinatura.longitude": {
    rotulo: "Longitude declarada",
    grupo: "Geolocalização",
    validar: validarCoordenada([-74, -33], "Longitude"),
    critico: true,
  },
  "ips.0.endereco": {
    rotulo: "Endereço IP da assinatura",
    grupo: "Conexão",
    validar: validarIp,
    critico: true,
    // Mudar o IP exige nova consulta de geolocalização, tratada no controller.
    exigeGeoIp: true,
  },
};

/** Lê um caminho com pontos, tolerando índice numérico de array. */
export function lerCaminho(objeto, caminho) {
  return caminho.split(".").reduce((atual, parte) => {
    if (atual == null) return undefined;
    return atual[parte];
  }, objeto);
}

/** Escreve um caminho com pontos, criando o que faltar no meio. */
export function escreverCaminho(objeto, caminho, valor) {
  const partes = caminho.split(".");
  let atual = objeto;
  for (let i = 0; i < partes.length - 1; i++) {
    const parte = partes[i];
    const proximaEhIndice = /^\d+$/.test(partes[i + 1]);
    if (atual[parte] == null) atual[parte] = proximaEhIndice ? [] : {};
    atual = atual[parte];
  }
  atual[partes[partes.length - 1]] = valor;
}

/**
 * Valida um lote de correções.
 *
 * Devolve os erros TODOS de uma vez, e não o primeiro: o operador está diante de
 * um formulário e corrigir um campo por vez, com uma ida ao servidor para cada,
 * é atrito gratuito.
 */
export function validarCampos(campos) {
  const erros = {};
  const validos = {};

  for (const [caminho, bruto] of Object.entries(campos || {})) {
    const definicao = CAMPOS_REVISAVEIS[caminho];
    if (!definicao) {
      erros[caminho] = "Campo não pode ser corrigido.";
      continue;
    }
    const r = definicao.validar(bruto);
    if (!r.ok) erros[caminho] = r.erro;
    else validos[caminho] = r.valor;
  }

  return { erros, validos, temErro: Object.keys(erros).length > 0 };
}
