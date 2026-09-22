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
    marcos_temporais: /Car[êe]ncia:[\s\S]{0,400}in[íi]cio\s+de\s+vig[êe]ncia/i.test(trecho) && /Franquia:[\s\S]{0,400}(?:sinistro|evento)/i.test(trecho) ? "A carência é contada do início da vigência; a franquia, da ocorrência do sinistro, conforme definições da proposta." : null,
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

  /*
   * ─── D9 · premissa de início de vigência ────────────────────────────────────
   *
   * O achado de carência conclui que a primeira indenização só é possível N dias
   * "após o início da vigência". A conta está certa, mas a conclusão só vale se
   * a vigência começou na data do contrato, e o laudo FD-20260917 tomou essa
   * data como início sem dizer que tomou.
   *
   * A proposta remete as datas de vigência ao certificado individual do seguro,
   * que não está no arquivo. A premissa passa a sair declarada e ancorada, e o
   * achado é rebaixado enquanto o certificado não vier. O Quesito 7 do Anexo I
   * já pede esse certificado; faltava ligar as duas coisas.
   */
  // A remissão ao certificado individual atravessa quebras de linha no PDF, mas
  // não pode atravessar o fim da frase.
  const remissaoVigencia = trecho.match(/[^.]{0,160}data[s]?\s+de\s+in[íi]cio\s+e\s+fim\s+de\s+vig[êe]ncia[^.]{0,220}\./i)
    || trecho.match(/[^.]{0,160}vig[êe]ncia[^.]{0,100}certificado\s+individual[^.]{0,140}\./i);

  // `valorAbaixoDoRotulo` devolve a linha seguinte ao rótulo, e sem rótulo
  // presente ela devolve outra coisa qualquer: neste dossiê trouxe "Coberturas
  // contratadas." como se fosse data de vigência. Só vale como declarada a data
  // que se parece com data, e a remissão ao certificado é decisiva em contrário:
  // se o documento diz que as datas estão no certificado, elas não estão aqui.
  const candidatoVigencia = valorAbaixoDoRotulo(trecho, /In[íi]cio\s+de\s+Vig[êe]ncia/i);
  const pareceData = /\b\d{2}\/\d{2}\/\d{2,4}\b/.test(String(candidatoVigencia || ""));
  const vigenciaDeclarada = pareceData && !remissaoVigencia ? candidatoVigencia : null;
  // O certificado individual só é dado como ausente quando foi procurado. Sem
  // essa procura, o laudo afirmaria uma lacuna que não verificou, que é a mesma
  // família do defeito que o D1 corrige.
  const mencionaCertificado = /certificado\s+(?:individual|do\s+seguro)/i.test(t);
  const certificadoNoArquivo = Boolean(segmentacao?.documentos?.some((d) => /certificado/i.test(d.rotulo || d.tipo || "")))
    || /certificado\s+individual\s+(?:de\s+seguro\s+)?n[ºo°]\s*[:\-]?\s*\S+/i.test(t);

  const remissaoTexto = remissaoVigencia ? remissaoVigencia[0].replace(/\s+/g, " ").trim() : null;
  seguro.vigencia = {
    inicio_declarado: vigenciaDeclarada || null,
    premissa: vigenciaDeclarada
      ? `Início de vigência declarado na proposta (${vigenciaDeclarada}).`
      : `Início de vigência não demonstrado pela extração da proposta. ${remissaoTexto || "Solicitar o certificado individual."}`,
    premissa_origem: vigenciaDeclarada ? "DECLARADO_NA_PROPOSTA" : "INDETERMINADO",
    // Três estados, não dois: localizado, não localizado, e não verificado.
    certificado_individual: certificadoNoArquivo
      ? "LOCALIZADO_NO_ARQUIVO"
      : mencionaCertificado ? "NAO_LOCALIZADO_NO_ARQUIVO" : "NAO_VERIFICADO",
    remissao_ao_certificado: remissaoTexto,
  };

  /*
   * ─── D10 · a soma dos prêmios por cobertura não fecha ───────────────────────
   *
   * No dossiê C6 as coberturas somam R$ 218,65 contra R$ 218,64 declarados como
   * prêmio total. Um centavo, quase certamente arredondamento, e o defeito é do
   * documento do banco, não do laudo. Mas o laudo deve registrar a diferença com
   * o valor e a explicação provável, em vez de deixar que a outra parte a
   * apresente primeiro como erro de quem calculou.
   */
  const somaCoberturasCents = seguro.coberturas.reduce((acc, c) => acc + (moneyToCents(c.premio) || 0), 0);
  seguro.conferencia_premio = somaCoberturasCents && premioCents
    ? {
      soma_coberturas_centavos: somaCoberturasCents,
      premio_declarado_centavos: premioCents,
      diferenca_centavos: somaCoberturasCents - premioCents,
      confere: somaCoberturasCents === premioCents,
      // A margem compatível com arredondamento sai como número, para que a
      // hipótese possa ser conferida em vez de aceita.
      margem_arredondamento_centavos: Math.max(1, seguro.coberturas.length),
      coberturas_somadas: seguro.coberturas.length,
    }
    : null;
  const instrumento = segmentacao?.documentos?.find(d => d.tipo === "INSTRUMENTO_PRINCIPAL");
  const paginas = t.split("\f");
  for (let i = (instrumento?.paginaInicial || 1) - 1; i < (instrumento?.paginaFinal || paginas.length); i++) {
    const linha = paginas[i]?.split("\n").find(l => /Forma de Pagamento:/i.test(l) && /\[\s*[xX]\s*\]/.test(l));
    const marcado = linha?.match(/\[\s*[xX]\s*\]\s*([ÀàAa]\s*Vista|Financiado)/i)?.[1];
    if (marcado) { seguro.forma_pagamento_instrumento = { valor: marcado, pagina: i + 1, trecho: linha.trim() }; break; }
  }
  seguro.achados = avaliarSeguro(seguro, contrato);
  if (seguro.forma_pagamento_instrumento && seguro.forma_pagamento && seguro.forma_pagamento_instrumento.valor.toLowerCase() !== seguro.forma_pagamento.toLowerCase()) {
    seguro.achados.push({ codigo: "SEG9", gravidade: "INFO", titulo: "Formas de pagamento do seguro com rótulos distintos", texto: `O instrumento assinala "${seguro.forma_pagamento_instrumento.valor}" (pág. ${seguro.forma_pagamento_instrumento.pagina}); a proposta de seguro informa "${seguro.forma_pagamento}"${seguro.documento ? ` (pág. ${seguro.documento.paginaInicial})` : ""}. Os rótulos podem se referir a relações diferentes: repasse à seguradora e financiamento ao consumidor. Solicitar conciliação documental; a diferença, isoladamente, não prova cobrança duplicada.` });
  }
  if (seguro.conferencia_premio && !seguro.conferencia_premio.confere) {
    const dif = seguro.conferencia_premio.diferenca_centavos;
    const reais = (n) => `R$ ${(Math.abs(n) / 100).toFixed(2).replace(".", ",")}`;
    // Arredondamento de centavos acumula, no pior caso, um centavo por parcela
    // somada. A margem é derivada do documento, não escolhida.
    const margemArredondamento = Math.max(1, seguro.coberturas.length);
    seguro.achados.push({
      // SEG8, não SEG7: `avaliarSeguro` já emite SEG7 para prêmio da proposta
      // contra o seguro da planilha. Repetir o código faria `addFinding`
      // deduplicar por chave no sumário e esconder um dos dois achados.
      codigo: "SEG8",
      // O limiar fixo de cinco centavos não prova causa nenhuma. O que o laudo
      // afirma é a divergência documental, que é verificável; o arredondamento
      // entra como hipótese a conferir, e a margem compatível com ela é
      // declarada em vez de embutida. Acima dessa margem o laudo NÃO afirma que
      // o arredondamento é impossível: afirma que ele deixa de explicar sozinho.
      gravidade: Math.abs(dif) <= margemArredondamento ? "INFO" : "MÉDIA",
      titulo: "Soma dos prêmios por cobertura não fecha com o prêmio total declarado",
      texto: `Os prêmios por cobertura somam ${reais(somaCoberturasCents)}, contra ${reais(premioCents)} declarados como prêmio total: diferença de ${reais(dif)}${dif > 0 ? " a mais na soma das coberturas" : " a menos na soma das coberturas"}. A divergência é do documento da instituição e está registrada como tal, não como resultado de cálculo do laudo. ${Math.abs(dif) <= margemArredondamento
        ? `Uma hipótese compatível é o arredondamento de centavos na composição, que com ${seguro.coberturas.length} ${seguro.coberturas.length === 1 ? "cobertura" : "coberturas"} pode acumular até ${reais(margemArredondamento)}; a hipótese não foi verificada e depende da memória de cálculo da seguradora.`
        : `O arredondamento de centavos na composição, com ${seguro.coberturas.length} ${seguro.coberturas.length === 1 ? "cobertura" : "coberturas"}, acumularia no máximo ${reais(margemArredondamento)}, de modo que não explica sozinho a diferença observada. A memória de cálculo deve ser apresentada pela seguradora.`}`,
    });
  }
  return seguro;
}

const pct = (v, casas = 1) => `${(v * 100).toFixed(casas).replace(".", ",")}%`;

function avaliarSeguro(seguro, contrato) {
  const achados = [];
  const add = (codigo, gravidade, titulo, texto) => achados.push({ codigo, gravidade, titulo, texto });

  // Carência e franquia têm marcos diferentes; vencimento não é sinistro.
  for (const c of seguro.coberturas) {
    if (!(c.carencia_dias > 0 || c.franquia_dias > 0)) continue;
    add("SEG1", "INFO", "Carência, franquia e vigência a conferir",
      `A cobertura "${c.nome}" declara carência de ${c.carencia_dias ?? "não identificado"} dias e franquia de ${c.franquia_dias ?? "não identificado"} dias. ${seguro.marcos_temporais || "Os marcos de contagem devem ser conferidos nas condições da cobertura."} ${seguro.vigencia?.premissa || "Solicitar o certificado individual para identificar a vigência."}${c.teto_parcelas ? ` O limite declarado é de até ${c.teto_parcelas} parcelas.` : ""} Esses prazos não permitem contar parcelas descobertas nem fixar a primeira indenização sem vigência, data e enquadramento do sinistro.`);
  }

  // SEG2: cobertura que concentra o prêmio e tem carência ou franquia.
  const concentrada = seguro.coberturas.find((c) => c.participacao_premio > 0.6 && ((c.carencia_dias || 0) > 0 || (c.franquia_dias || 0) > 0));
  if (concentrada) {
    add("SEG2", "INFO", "Prêmio concentrado em cobertura com carência", `A cobertura "${concentrada.nome}" responde por ${pct(concentrada.participacao_premio)} do prêmio (${concentrada.premio} de ${seguro.premio}) e é justamente a que tem carência${concentrada.franquia_dias ? " e franquia" : ""}.`);
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
    add("SEG3", "INFO", "Estipulante do seguro é o próprio credor", `O estipulante da apólice é ${seguro.estipulante.nome}${seguro.estipulante.cnpj ? ` (CNPJ ${seguro.estipulante.cnpj})` : ""}, a mesma instituição que concede o empréstimo. Essa coincidência de papéis não demonstra irregularidade por si.`);
  }
  if (seguro.beneficiario && (/estipulante/i.test(seguro.beneficiario) ? estipulanteIgualCredor : credorNome && normal(seguro.beneficiario).includes(credorNome.split(/\s+/)[0]))) {
    add("SEG4", "INFO", "Beneficiário do seguro é o credor", `A proposta define que "o beneficiário será ${seguro.beneficiario.toLowerCase().startsWith("o ") ? "" : "o "}${seguro.beneficiario}", que é o credor. A destinação ao credor é compatível com a natureza prestamista; não demonstra irregularidade por si.`);
  }

  // SEG5: remuneração do estipulante.
  if (seguro.pro_labore_sobre_premio > 0.2) {
    add("SEG5", "INFO", "Pró-labore declarado sobre o prêmio", `O pró-labore declarado é ${seguro.pro_labore}, ${pct(seguro.pro_labore_sobre_premio)} do prêmio de ${seguro.premio}. Quase metade do valor pago pelo consumidor volta como remuneração para quem intermediou a venda.`.replace("Quase metade", seguro.pro_labore_sobre_premio >= 0.4 ? "Quase metade" : "Parte relevante"));
  }

  // SEG6: peso do prêmio sobre o valor liberado.
  if (seguro.premio_sobre_liberado > 0.05) {
    add("SEG6", "INFO", "Relação entre prêmio e valor liberado", `O prêmio de ${seguro.premio} equivale a ${pct(seguro.premio_sobre_liberado, 2)} do valor liberado (${contrato.valor_liberado}) na proposta examinada.${/financiado/i.test(seguro.forma_pagamento || "") ? " A forma de pagamento da proposta é financiada." : " O modo de pagamento deve ser conferido no instrumento."}`);
  }

  // SEG7: prêmio da proposta contra o seguro da planilha do contrato.
  const planilhaCents = moneyToCents(contrato.seguros);
  if (planilhaCents !== null && Math.abs(planilhaCents - moneyToCents(seguro.premio)) > 5) {
    add("SEG7", "MÉDIA", "Prêmio da proposta diverge do seguro da planilha", `A planilha de cálculo registra seguros de ${contrato.seguros}, e a proposta de adesão, prêmio de ${seguro.premio}.`);
  }
  return achados;
}
