import { contaDeCredito } from "./salvaguardas.js";
import { moneyToCents } from "./numberParsing.js";
import { centsToMoney } from "./format.js";

/**
 * Prova de que o valor liberado chegou ao contratante.
 *
 * ─── Por que ─────────────────────────────────────────────────────────────────
 *
 * O item 5.3 da CCB do dossiê C6 declara crédito em conta (banco 237, agência
 * e conta informadas). Nas 27 páginas não há TED, recibo nem extrato, e o laudo
 * não disse isso em lugar nenhum. Num processo de contratação impugnada, a
 * ausência de prova do crédito é um dos achados centrais.
 *
 * ─── Onde procurar ───────────────────────────────────────────────────────────
 *
 * Fora da cédula, das condições gerais, da proposta de seguro e dos termos: é
 * ali que moram as cláusulas que FALAM de transferência, favorecido e crédito
 * em conta, e elas não são comprovante. Exige ao menos dois marcadores de
 * comprovante na mesma página.
 */

const MARCADORES = [
  { nome: "título de comprovante", regex: /comprovante\s+de\s+(?:transfer[êe]ncia|TED|DOC|PIX|pagamento|transa[çc][ãa]o|cr[ée]dito)/i },
  { nome: "NSU", regex: /\bNSU\b/ },
  { nome: "autenticação bancária", regex: /autentica[çc][ãa]o\s+(?:banc[áa]ria|mec[âa]nica|eletr[ôo]nica)/i },
  { nome: "favorecido", regex: /\bfavorecido\s*:/i },
  { nome: "remetente", regex: /\bremetente\s*:/i },
  { nome: "valor transferido", regex: /valor\s+(?:transferido|creditado|da\s+transfer[êe]ncia)/i },
  { nome: "identificador end to end", regex: /end\s*-?\s*to\s*-?\s*end|\bE2E\b|ID\s+da\s+transa[çc][ãa]o/i },
  { nome: "dados do recebedor", regex: /dados\s+do\s+(?:recebedor|destinat[áa]rio|favorecido)/i },
];

const TIPOS_EXCLUIDOS = new Set(["INSTRUMENTO_PRINCIPAL", "CONDICOES_GERAIS", "SEGURO", "TERMOS"]);

/** Forma de liberação declarada no instrumento. */
export function liberacaoDeclarada(flat) {
  const texto = String(flat || "");
  const conta = contaDeCredito(texto);
  const forma = texto.match(/LIBERA[ÇC][ÃA]O\s+DO\s+CR[ÉE]DITO\s*:?\s*(Cr[ée]dito\s+em\s+Conta|TED|DOC|PIX|Transfer[êe]ncia[^.;\n]{0,30}|Ordem\s+de\s+Pagamento)/i)?.[1] || (conta ? "Crédito em Conta" : null);
  if (!forma) return null;
  if (/ordem\s+de\s+pagamento/i.test(forma)) return null;
  return { forma: forma.replace(/\s+/g, " ").trim(), banco: conta?.compe || null, agencia: conta?.agencia || null, conta: conta?.conta || null };
}

/**
 * @param {object} args
 * @param {string} args.texto texto com quebras de página
 * @param {string} args.flat texto corrido
 * @param {object|null} args.segmentacao resultado de `segmentarDocumentos`
 * @param {object} args.contrato contrato extraído (valor liberado, cliente)
 * @param {object} args.cliente cliente extraído
 */
export function avaliarComprovanteCredito({ texto, flat, segmentacao, contrato = {}, cliente = {} }) {
  const liberacao = liberacaoDeclarada(flat);
  if (!liberacao) return { liberacao: null, comprovante: null, achados: [] };

  const paginas = String(texto || "").includes("\f") ? String(texto).split("\f") : [String(texto || "")];
  let comprovante = null;
  paginas.forEach((pagina, i) => {
    if (comprovante) return;
    const numero = i + 1;
    const doc = segmentacao?.documentos.find((d) => numero >= d.paginaInicial && numero <= d.paginaFinal);
    if (doc && TIPOS_EXCLUIDOS.has(doc.tipo)) return;
    const encontrados = MARCADORES.filter(({ regex }) => regex.test(pagina)).map((m) => m.nome);
    if (encontrados.length < 2) return;
    const valor = pagina.match(/valor[^\n\d]{0,30}R\$\s*([\d.]+,\d{2})/i)?.[1] || null;
    comprovante = {
      pagina: paginas.length > 1 ? numero : null,
      marcadores: encontrados,
      valor: valor ? `R$ ${valor}` : null,
      data: pagina.match(/\b(\d{2}\/\d{2}\/\d{4})\b/)?.[1] || null,
      cpf: pagina.match(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/)?.[0] || null,
      agencia: pagina.match(/Ag[êe]ncia\s*:?\s*(\d{3,6}(?:-\d)?)/i)?.[1] || null,
      conta: pagina.match(/Conta\s*:?\s*([\d.]{3,15}-?\d?)/i)?.[1] || null,
    };
  });

  const alvo = [
    liberacao.banco ? `Banco ${liberacao.banco}` : null,
    liberacao.agencia ? `agência ${liberacao.agencia}` : null,
    liberacao.conta ? `conta ${liberacao.conta}` : null,
  ].filter(Boolean).join(", ");
  const achados = [];

  if (!comprovante) {
    achados.push({
      codigo: "LIB1",
      gravidade: "ALTA",
      titulo: "Ausência de comprovante de transferência",
      texto: `O instrumento declara liberação por ${liberacao.forma.toLowerCase()}${alvo ? ` (${alvo})` : ""}${contrato.valor_liberado ? `, no valor de ${contrato.valor_liberado}` : ""}, e o arquivo analisado não traz comprovante de TED, recibo de crédito, extrato ou qualquer outra prova de que o valor chegou ao contratante. A prova do crédito cabe a quem afirma tê-lo realizado.`,
    });
    return { liberacao, comprovante: null, achados };
  }

  const divergencias = [];
  const liberadoCents = moneyToCents(contrato.valor_liberado);
  const comprovadoCents = moneyToCents(comprovante.valor);
  if (liberadoCents !== null && comprovadoCents !== null && Math.abs(liberadoCents - comprovadoCents) > 5) {
    divergencias.push(`valor comprovado ${centsToMoney(comprovadoCents)} contra liberado ${contrato.valor_liberado}`);
  }
  const digitos = (v) => String(v || "").replace(/\D/g, "");
  // Crédito em favor de terceiro é o anel que mais decide o caso (Súmula 479
  // do STJ, fortuito interno): sai como achado próprio, e não misturado com
  // divergência de valor ou de conta.
  if (comprovante.cpf && cliente.cpf && digitos(comprovante.cpf) !== digitos(cliente.cpf)) {
    achados.push({
      codigo: "LIB3",
      gravidade: "ALTA",
      titulo: "Crédito registrado em favor de pessoa diversa do contratante",
      texto: `O comprovante localizado${comprovante.pagina ? ` na pág. ${comprovante.pagina}` : ""} registra como destinatário do crédito${comprovante.valor ? ` (${comprovante.valor})` : ""} um documento de identificação diferente do que consta na qualificação do contratante. Segundo o próprio dossiê, o valor liberado não chegou à esfera do contratante. A titularidade da conta de destino e o destino posterior do valor são a diligência central do caso.`,
      grau: "CONSTATADO",
      ancora: { pagina: comprovante.pagina, trecho: "destinatário do comprovante" },
    });
  }
  if (comprovante.conta && liberacao.conta && digitos(comprovante.conta) !== digitos(liberacao.conta)) {
    divergencias.push(`conta do comprovante (${comprovante.conta}) diferente da declarada (${liberacao.conta})`);
  }
  if (divergencias.length) {
    achados.push({
      codigo: "LIB2",
      gravidade: "ALTA",
      titulo: "Comprovante de transferência diverge do instrumento",
      texto: `O comprovante localizado${comprovante.pagina ? ` na pág. ${comprovante.pagina}` : ""} não confere com a liberação declarada: ${divergencias.join("; ")}.`,
      grau: "CONSTATADO",
      ancora: { pagina: comprovante.pagina, trecho: divergencias[0] },
    });
  }
  return { liberacao, comprovante, achados };
}
