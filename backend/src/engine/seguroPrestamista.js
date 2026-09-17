import { blocosDaLinha, valorAbaixoDoRotulo } from "./colunas.js";
import { moneyToCents } from "./numberParsing.js";
import { centsToMoney, parsePtDate } from "./format.js";
import { diasEntre, vencimentosMensais } from "./matematicaFinanceira.js";

/**
 * Seguro prestamista vendido junto com o empréstimo.
 *
 * ─── Por que ─────────────────────────────────────────────────────────────────
 *
 * No dossiê C6 a proposta de seguro ocupa três páginas e representa 12,29% do
 * valor liberado, e o laudo não tinha uma linha sobre ela. O quadro que importa:
 * 93,5% do prêmio numa cobertura de desemprego com 90 dias de carência e 31 de
 * franquia, num contrato cuja primeira parcela vence em 98 dias; quase metade do
 * prêmio como pró-labore; estipulante e beneficiário iguais ao credor.
 *
 * ─── Regra de carência ───────────────────────────────────────────────────────
 *
 * A regra do relatório ("carência maior que metade do prazo") não dispara nesse
 * caso: 90 dias é exatamente a metade de 6 meses. A regra adotada mede o efeito
 * para o consumidor: carência mais franquia é o prazo mínimo até a primeira
 * indenização. Se esse prazo passa do primeiro vencimento, ou deixa descoberto
 * mais de um terço das parcelas, a cobertura é de pouca serventia no contrato
 * em que foi vendida.
 */

const INICIO_COBERTURA = /^(Morte|Invalidez|Desemprego|Perda|Incapacidade|Doen[çc]a|Di[áa]ria|Internaç|Renda|Assist)/i;

const dinheiro = (valor) => {
  const cents = moneyToCents(valor);
  return cents === null ? null : centsToMoney(cents);
};

function dias(valor) {
  const t = String(valor || "");
  if (/n[ãa]o\s+h[áa]/i.test(t)) return 0;
  const m = t.match(/(\d{1,4})\s*dias?/i);
  return m ? Number(m[1]) : null;
}

/** Quadro "Coberturas | Prêmio | Carência | Franquia | Capital", linhas quebradas. */
function lerCoberturas(texto) {
  const linhas = String(texto || "").split("\n");
  const iCab = linhas.findIndex((l) => /Coberturas?\s{2,}.*Pr[êe]mio.*Car[êe]ncia.*Franquia/i.test(l));
  if (iCab < 0) return [];
  const cabecalho = blocosDaLinha(linhas[iCab]);
  const col = (regex) => cabecalho.find((b) => regex.test(b.texto))?.inicio ?? null;
  const colunas = {
    nome: col(/Coberturas?/i),
    premio: col(/Pr[êe]mio/i),
    carencia: col(/Car[êe]ncia/i),
    franquia: col(/Franquia/i),
    capital: col(/Capital/i),
  };
  const nomes = [];
  const premios = [];
  const carencias = [];
  const franquias = [];
  const tetos = [];
  for (let i = iCab + 1; i < linhas.length; i += 1) {
    const linha = linhas[i];
    if (/^\s*\*|Car[êe]ncia:|Franquia:/i.test(linha)) break;
    for (const bloco of blocosDaLinha(linha)) {
      // Coluna mais próxima do início do bloco.
      const [campo] = Object.entries(colunas)
        .filter(([, inicio]) => inicio !== null)
        .sort((a, b) => Math.abs(a[1] - bloco.inicio) - Math.abs(b[1] - bloco.inicio))[0];
      if (campo === "nome") {
        if (INICIO_COBERTURA.test(bloco.texto) || !nomes.length) nomes.push({ nome: bloco.texto, linha: i });
        else nomes.at(-1).nome += ` ${bloco.texto}`;
      } else if (campo === "premio" && /R\$/.test(bloco.texto)) {
        premios.push(bloco.texto);
      } else if (campo === "carencia") {
        carencias.push(bloco.texto);
      } else if (campo === "franquia") {
        franquias.push(bloco.texto);
      } else if (campo === "capital" && /at[ée]\s+\d+\s+parcelas?/i.test(bloco.texto)) {
        tetos.push({ valor: Number(bloco.texto.match(/(\d+)/)[1]), linha: i });
      }
    }
  }
  return nomes.map((n, i) => {
    const teto = tetos.find((t) => Math.abs(t.linha - n.linha) <= 1);
    return {
      nome: n.nome.replace(/\s+/g, " ").trim(),
      premio: dinheiro(premios[i]),
      carencia_dias: dias(carencias[i]),
      franquia_dias: dias(franquias[i]),
      teto_parcelas: teto ? teto.valor : null,
    };
  });
}

const raizCnpj = (v) => String(v || "").replace(/\D/g, "").slice(0, 8);

/**
 * @param {object} args
 * @param {string} args.texto texto do documento (com colunas)
 * @param {object|null} args.segmentacao
 * @param {object} args.contrato contrato extraído
 * @returns {object|null} null quando não há proposta de seguro
 */
export function extrairSeguroPrestamista({ texto, segmentacao, contrato = {} }) {
  const t = String(texto || "");
  if (!/seguro\s+prestamista|proposta\s+de\s+ades[ãa]o\s+ao\s+seguro/i.test(t)) return null;
  const doc = segmentacao?.documentos.find((d) => d.tipo === "SEGURO");
  const trecho = doc ? t.split("\f").slice(doc.paginaInicial - 1, doc.paginaFinal).join("\f") : t;

  const premio = dinheiro(valorAbaixoDoRotulo(trecho, /Pr[êe]mio\s+(?:[àa]\s+vista|total)/i));
  if (!premio) return null;
  const proLabore = dinheiro(valorAbaixoDoRotulo(trecho, /Pr[óo]-?\s*Labore|Remunera[çc][ãa]o\s+do\s+Estipulante|Comiss[ãa]o/i));
  const coberturas = lerCoberturas(trecho);

  const seguradora = t.match(/responsabilida-?\s*de\s+da\s+([^,\n]+?(?:\n[^,\n]+?)?),\s*CNPJ\s*:?\s*([\d./-]{14,18})/i)
    || t.match(/Seguradora\s*:\s*([^\n]+?)\s{2,}|Seguradora\s*:\s*([^\n]+)/i);
  const corretora = trecho.match(/Corretora\s*:?\s*\n?\s*([^\n]+?)\s*\n\s*CNPJ\s*:?\s*([\d./-]{14,18})\s*\n\s*Registro\s+SUSEP\s*:?\s*(\d+)/i);
  const estipulante = trecho.match(/Estipulante\s*:\s*([^\n]+?)\s*\n\s*CNPJ\s*:?\s*([\d./-]{14,18})/i);
  const beneficiario = trecho.match(/O\s+benefici[áa]rio\s+ser[áa]\s+(?:o|a)\s+([A-Za-zÀ-ÿ\- ]{3,40}?)(?:,|\.|\n)/i)?.[1]?.trim() || null;

  const premioCents = moneyToCents(premio);
  const liberadoCents = moneyToCents(contrato.valor_liberado);
  const seguro = {
    documento: doc ? { paginaInicial: doc.paginaInicial, paginaFinal: doc.paginaFinal } : null,
    proposta: valorAbaixoDoRotulo(trecho, /N[ºo°]\s*da\s+Proposta/i),
    premio,
    iof: dinheiro(valorAbaixoDoRotulo(trecho, /\bIOF\s+R\$/i)),
    periodicidade: valorAbaixoDoRotulo(trecho, /Periodicidade\s+de\s+Pagamento/i),
    forma_pagamento: valorAbaixoDoRotulo(trecho, /Forma\s+de\s+pagamento/i),
    pro_labore: proLabore,
    coberturas: coberturas.map((c) => ({
      ...c,
      participacao_premio: c.premio && premioCents ? moneyToCents(c.premio) / premioCents : null,
    })),
    seguradora: seguradora ? { nome: (seguradora[1] || seguradora[2] || "").replace(/\s+/g, " ").trim(), cnpj: seguradora[2] && /\d/.test(seguradora[2]) ? seguradora[2] : null } : null,
    corretora: corretora ? { nome: corretora[1].trim(), cnpj: corretora[2], susep: corretora[3] } : null,
    estipulante: estipulante ? { nome: estipulante[1].trim(), cnpj: estipulante[2] } : null,
    beneficiario,
    premio_sobre_liberado: premioCents && liberadoCents ? premioCents / liberadoCents : null,
    pro_labore_sobre_premio: proLabore && premioCents ? moneyToCents(proLabore) / premioCents : null,
  };
  seguro.achados = avaliarSeguro(seguro, contrato);
  return seguro;
}

const pct = (v, casas = 1) => `${(v * 100).toFixed(casas).replace(".", ",")}%`;

function avaliarSeguro(seguro, contrato) {
  const achados = [];
  const add = (codigo, gravidade, titulo, texto) => achados.push({ codigo, gravidade, titulo, texto });

  // SEG1: carência + franquia contra o cronograma de parcelas.
  const base = parsePtDate(contrato.data_contrato);
  const primeiro = parsePtDate(contrato.data_primeiro_vencimento);
  const parcelas = Number(contrato.numero_parcelas);
  const diasParcelas = base && primeiro && parcelas > 0
    ? vencimentosMensais(primeiro, parcelas).map((d) => diasEntre(base, d))
    : [];
  for (const c of seguro.coberturas) {
    const espera = (c.carencia_dias || 0) + (c.franquia_dias || 0);
    if (!espera || !diasParcelas.length) continue;
    const descobertas = diasParcelas.filter((d) => d <= espera).length;
    if (espera > diasParcelas[0] || descobertas / diasParcelas.length > 1 / 3) {
      add(
        "SEG1",
        "ALTA",
        "Carência e franquia do seguro incompatíveis com o prazo da operação",
        `A cobertura "${c.nome}" tem carência de ${c.carencia_dias || 0} dias e franquia de ${c.franquia_dias || 0} dias: a primeira indenização só é possível ${espera} dias após o início da vigência. O primeiro vencimento ocorre ${diasParcelas[0]} dias após a emissão, e ${descobertas} de ${diasParcelas.length} parcelas ${descobertas === 1 ? "vence" : "vencem"} antes desse prazo mínimo${c.teto_parcelas ? `; a cobertura paga no máximo ${c.teto_parcelas} parcelas` : ""}. A cobertura vendida tem pouca ou nenhuma serventia no contrato ao qual foi vinculada.`
      );
      break;
    }
  }

  // SEG2: cobertura que concentra o prêmio e tem carência ou franquia.
  const concentrada = seguro.coberturas.find((c) => c.participacao_premio > 0.6 && ((c.carencia_dias || 0) > 0 || (c.franquia_dias || 0) > 0));
  if (concentrada) {
    add("SEG2", "MÉDIA", "Prêmio concentrado em cobertura com carência", `A cobertura "${concentrada.nome}" responde por ${pct(concentrada.participacao_premio)} do prêmio (${concentrada.premio} de ${seguro.premio}) e é justamente a que tem carência${concentrada.franquia_dias ? " e franquia" : ""}.`);
  }

  // SEG3 e SEG4: estipulante e beneficiário iguais ao credor.
  const credorRaiz = raizCnpj(contrato.cnpj_instituicao);
  const estipulanteRaiz = raizCnpj(seguro.estipulante?.cnpj);
  const normal = (v) => String(v || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
  const credorNome = normal(contrato.banco).replace(/\bBANCO\b|\bS\.?A\.?\b/g, "").trim();
  const estipulanteIgualCredor = Boolean(
    (credorRaiz && estipulanteRaiz && credorRaiz === estipulanteRaiz)
    || (credorNome && seguro.estipulante?.nome && normal(seguro.estipulante.nome).includes(credorNome.split(/\s+/)[0]))
  );
  if (estipulanteIgualCredor) {
    add("SEG3", "MÉDIA", "Estipulante do seguro é o próprio credor", `O estipulante da apólice é ${seguro.estipulante.nome}${seguro.estipulante.cnpj ? ` (CNPJ ${seguro.estipulante.cnpj})` : ""}, a mesma instituição que concede o empréstimo. Quem vende o crédito contrata o seguro em nome do consumidor.`);
  }
  if (seguro.beneficiario && (/estipulante/i.test(seguro.beneficiario) ? estipulanteIgualCredor : credorNome && normal(seguro.beneficiario).includes(credorNome.split(/\s+/)[0]))) {
    add("SEG4", "MÉDIA", "Beneficiário do seguro é o credor", `A proposta define que "o beneficiário será ${seguro.beneficiario.toLowerCase().startsWith("o ") ? "" : "o "}${seguro.beneficiario}", que é o credor. O seguro pago pelo consumidor protege, antes de tudo, o crédito da instituição.`);
  }

  // SEG5: remuneração do estipulante.
  if (seguro.pro_labore_sobre_premio > 0.2) {
    add("SEG5", "MÉDIA", "Pró-labore elevado sobre o prêmio", `O pró-labore declarado é ${seguro.pro_labore}, ${pct(seguro.pro_labore_sobre_premio)} do prêmio de ${seguro.premio}. Quase metade do valor pago pelo consumidor volta como remuneração para quem intermediou a venda.`.replace("Quase metade", seguro.pro_labore_sobre_premio >= 0.4 ? "Quase metade" : "Parte relevante"));
  }

  // SEG6: peso do prêmio sobre o valor liberado.
  if (seguro.premio_sobre_liberado > 0.05) {
    add("SEG6", "MÉDIA", "Prêmio do seguro elevado em relação ao valor liberado", `O prêmio de ${seguro.premio} equivale a ${pct(seguro.premio_sobre_liberado, 2)} do valor liberado (${contrato.valor_liberado}) e foi financiado junto com o empréstimo, com juros.`);
  }

  // SEG7: prêmio da proposta contra o seguro da planilha do contrato.
  const planilhaCents = moneyToCents(contrato.seguros);
  if (planilhaCents !== null && Math.abs(planilhaCents - moneyToCents(seguro.premio)) > 5) {
    add("SEG7", "MÉDIA", "Prêmio da proposta diverge do seguro da planilha", `A planilha de cálculo registra seguros de ${contrato.seguros}, e a proposta de adesão, prêmio de ${seguro.premio}.`);
  }
  return achados;
}
