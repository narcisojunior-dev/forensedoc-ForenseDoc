// Lógica pura (sem I/O) da cascata de geocodificação por CEP/endereço.
// Isolada do server.js para poder ser testada sem depender de rede.
//
// Motivação (relatório técnico de 09/09/2026, item 6): o endereço "Rua R,
// zona rural, boa hora/Pi. cep 64108000" foi geocodificado 369 km fora do
// lugar porque geocodeResultMatches() aprovava QUALQUER resultado quando
// não conseguia extrair nenhum candidato de cidade do texto — em
// JavaScript, `[].every(fn)` é `true`, e o antigo extrator de cidade só
// reconhecia rótulos explícitos ("cidade:", "municipio:") ou o padrão
// "nome, UF", nenhum dos quais aparece em "boa hora/Pi." (separador "/").

const STOP_WORDS = new Set([
  "cep", "endereco", "bairro", "rua", "avenida", "av", "travessa", "tv",
  "rodovia", "estrada", "numero", "zona", "rural", "brasil", "estado",
  "cidade", "municipio", "complemento", "promotor", "atendente", "n",
]);

const UF_CODES = [
  "ac", "al", "ap", "am", "ba", "ce", "df", "es", "go", "ma", "mt", "ms",
  "mg", "pa", "pb", "pr", "pe", "pi", "rj", "rn", "rs", "ro", "rr", "sc",
  "sp", "se", "to",
];

export const BR_STATES = {
  AC: "acre", AL: "alagoas", AP: "amapa", AM: "amazonas", BA: "bahia", CE: "ceara",
  DF: "distrito federal", ES: "espirito santo", GO: "goias", MA: "maranhao", MT: "mato grosso",
  MS: "mato grosso do sul", MG: "minas gerais", PA: "para", PB: "paraiba", PR: "parana",
  PE: "pernambuco", PI: "piaui", RJ: "rio de janeiro", RN: "rio grande do norte",
  RS: "rio grande do sul", RO: "rondonia", RR: "roraima", SC: "santa catarina",
  SP: "sao paulo", SE: "sergipe", TO: "tocantins",
};

function stripDiacritics(value) {
  return String(value || "").normalize("NFD").replace(/[̀-ͯ]/g, "");
}

export function normalizedGeoText(value) {
  return stripDiacritics(String(value || ""))
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isWholeMunicipalityCep(cep) {
  const digits = String(cep || "").replace(/\D/g, "");
  return digits.length === 8 && digits.endsWith("000");
}

// Extrai candidatos de nome de município a partir de um texto normalizado,
// tanto por rótulo explícito ("cidade x", "municipio x") quanto pelas 1-3
// palavras que antecedem uma sigla de UF reconhecida — o que cobre formatos
// como "boa hora pi" (originalmente "boa hora/Pi.", "Boa Hora - PI" etc.,
// já sem pontuação após normalizedGeoText).
export function extractCityCandidates(normalizedRaw) {
  const candidates = [];

  const labeled = normalizedRaw.match(/\b(?:cidade|municipio)\s+([a-z\s]{3,40}?)(?:\s+(?:uf|estado|cep)\b|$)/);
  if (labeled?.[1]) candidates.push(labeled[1].trim());

  const beforeUfComma = normalizedRaw.match(new RegExp(`,\\s*([a-z\\s]{3,40}?)\\s+(?:${UF_CODES.join("|")})\\b`));
  if (beforeUfComma?.[1]) candidates.push(beforeUfComma[1].trim());

  const ufPattern = new RegExp(`\\b(${UF_CODES.join("|")})\\b`, "g");
  let match;
  while ((match = ufPattern.exec(normalizedRaw))) {
    const before = normalizedRaw.slice(0, match.index).trim().split(/\s+/);
    const words = [];
    for (let i = before.length - 1; i >= 0 && words.length < 3; i -= 1) {
      const word = before[i];
      if (!word || STOP_WORDS.has(word) || /^\d+$/.test(word)) break;
      words.unshift(word);
    }
    if (words.length) candidates.push(words.join(" "));
  }

  return [...new Set(candidates.map((value) => value.trim()).filter(Boolean))];
}

// Decide se um resultado do Nominatim é aceitável para a consulta original.
// Ao contrário da versão anterior, uma consulta da qual não se consegue
// extrair NENHUM sinal positivo (UF, CEP ou candidato de cidade) reprova o
// resultado por padrão — nunca aprova por ausência de evidência contrária.
export function geocodeResultMatches(rawQuery, displayName) {
  const raw = normalizedGeoText(rawQuery);
  const display = normalizedGeoText(displayName);

  const uf = raw.match(new RegExp(`\\b(${UF_CODES.join("|")})\\b`))?.[1]?.toUpperCase();
  if (uf) {
    const stateName = BR_STATES[uf];
    const ufMatches = (stateName && display.includes(stateName)) || display.match(new RegExp(`\\b${uf.toLowerCase()}\\b`));
    if (!ufMatches) return false;
  }

  const cep = raw.match(/\b\d{5}\s*-?\s*\d{3}\b/)?.[0]?.replace(/\D/g, "");
  if (cep && display.replace(/\D/g, "").includes(cep)) return true;

  const cityCandidates = extractCityCandidates(raw);
  if (cityCandidates.length) {
    return cityCandidates.every((city) => display.includes(city));
  }

  // Nenhum sinal de cidade/CEP: só aceita quando pelo menos a UF foi
  // confirmada acima (senão não há base nenhuma para validar o resultado).
  return Boolean(uf);
}
