/**
 * O que o dossiê traz sobre a autorização do consignado INSS.
 *
 * Nos contratos com autorização no Meu INSS a prova central é o registro dessa
 * autorização, mantido pelo INSS e pela Dataprev, e não a selfie da instituição.
 * Este módulo só lê o texto: diz o que está e o que falta. Quem decide se a
 * falta é achado é `avaliacaoInss.js`, conforme o regime.
 *
 * A via facial só conta quando o termo aparece perto de "Meu INSS": a selfie da
 * própria instituição também é descrita como "biometria facial".
 */

const DATA_HORA = /(\d{2}\/\d{2}\/\d{4})(?:[^\d\n]{1,8}(\d{2}:\d{2}(?::\d{2})?))?/;
const CONTA = /(?:Banco\s*:?\s*(\d{3})[\s\S]{0,40}?)?Ag[êe]ncia\s*:?\s*(\d{3,6}(?:-\d)?)[\s\S]{0,40}?Conta\s*:?\s*([\d.]{3,15}-?[\dxX]?)/i;
const IP = /\b((?:\d{1,3}\.){3}\d{1,3}|(?:[0-9a-f]{1,4}:){3,7}[0-9a-f]{1,4})\b/i;

/** Trechos ao redor de cada ocorrência do termo, unidos. */
function janelas(texto, regex, raio) {
  const global = new RegExp(regex.source, regex.flags.includes("g") ? regex.flags : `${regex.flags}g`);
  return Array.from(texto.matchAll(global), (m) => texto.slice(Math.max(0, m.index - raio), m.index + m[0].length + raio)).join("\n");
}

function dataDepois(texto, rotulo, alcance = 160) {
  const m = texto.match(rotulo);
  if (!m) return null;
  const d = texto.slice(m.index, m.index + m[0].length + alcance).match(DATA_HORA);
  return d ? { data: d[1], hora: d[2] || null } : null;
}

function contaDepois(texto, rotulo, alcance = 200) {
  const m = texto.match(rotulo);
  if (!m) return null;
  const c = texto.slice(m.index, m.index + m[0].length + alcance).match(CONTA);
  return c ? { banco: c[1] || null, agencia: c[2], conta: c[3] } : null;
}

export function extrairEvidenciasAutorizacao(texto) {
  const t = String(texto || "");
  const meuInss = janelas(t, /Meu\s*INSS/i, 400);
  const govbr = janelas(t, /gov\.br/i, 300);

  const viaFacial = /(?:biometria|reconhecimento|valida[çc][ãa]o)\s+facial/i.test(meuInss);
  const viaGovbr = /(?:conta|login|acesso|autentica[çc][ãa]o)\s+(?:na\s+|pela\s+|via\s+)?gov\.br|gov\.br[\s\S]{0,120}n[íi]vel/i.test(t);
  const bases = [
    /\bCNH\b|Carteira\s+Nacional\s+de\s+Habilita[çc][ãa]o|SENATRAN/i.test(meuInss) ? "CNH" : null,
    /Justi[çc]a\s+Eleitoral|\bTSE\b/i.test(meuInss) ? "Justiça Eleitoral" : null,
  ].filter(Boolean);

  const semBiometria = /sem\s+biometria\s+(?:facial\s+)?(?:cadastrada|nas\s+bases)|biometria\s+(?:facial\s+)?n[ãa]o\s+(?:cadastrada|localizada|encontrada)/i.test(t);
  const comBiometria = /(?:possui|com)\s+biometria\s+(?:facial\s+)?cadastrada|biometria\s+(?:facial\s+)?(?:cadastrada|localizada|encontrada)\s+nas?\s+bases?/i.test(t);
  const nivel = govbr.match(/n[íi]vel\s+(?:da\s+conta\s+)?(bronze|prata|ouro)|conta\s+(bronze|prata|ouro)/i);

  return {
    meu_inss: {
      mencionado: Boolean(meuInss),
      autorizacao: dataDepois(t, /autoriza[çc][ãa]o[^.\n]{0,80}Meu\s*INSS|Meu\s*INSS[^.\n]{0,80}autoriza/i),
      via_facial: viaFacial,
      vivacidade: /vivacidade|liveness|prova\s+de\s+vida/i.test(meuInss),
      bases_oficiais: bases,
    },
    govbr: {
      mencionado: viaGovbr,
      nivel: nivel ? (nivel[1] || nivel[2]).toLowerCase() : null,
      ip: govbr.match(IP)?.[1] || null,
      dispositivo: govbr.match(/(?:dispositivo|aparelho|user[\s-]?agent)\s*[:\-]?\s*([^\n]{3,80})/i)?.[1]?.trim() || null,
    },
    via: viaFacial && viaGovbr ? "AMBIGUA" : viaFacial ? "FACIAL" : viaGovbr ? "GOVBR" : null,
    biometria_cadastrada: semBiometria ? false : comBiometria ? true : null,
    conta_validada: contaDepois(t, /conta\s+(?:banc[áa]ria\s+)?validada/i),
    conta_beneficio: contaDepois(t, /conta\s+(?:de\s+)?recebimento\s+do\s+benef[íi]cio/i),
    averbacao: dataDepois(t, /averba[çc][ãa]o|averbad[oa]\s+em/i),
    demonstrativo_previo: /demonstrativo\s+pr[ée]vio|simula[çc][ãa]o\s+pr[ée]via|demonstrativo\s+(?:da\s+)?opera[çc][ãa]o\s+anterior/i.test(t),
    dib: t.match(/\bDIB\b\s*[:\-]?\s*(\d{2}\/\d{2}\/\d{4})|Data\s+de\s+In[íi]cio\s+do\s+Benef[íi]cio\s*[:\-]?\s*(\d{2}\/\d{2}\/\d{4})/i)?.slice(1).find(Boolean) || null,
  };
}
