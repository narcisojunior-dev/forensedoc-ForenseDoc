// Extrator dedicado para o layout de Cartão Consignado de Benefício (RMC) da
// Facta Financeira S.A. — proposta de adesão com quadro "VI - Saque" e
// qualificação em tabela (rótulo em uma linha, valores na linha seguinte).

function firstMatch(text, patterns) {
  for (const pattern of patterns) {
    const match = String(text || "").match(pattern);
    if (match?.[1]) return match[1].trim();
  }
  return null;
}

function normalizeMoney(value) {
  if (!value) return null;
  return String(value).startsWith("R$") ? value : `R$ ${value}`;
}

// Aceita tanto "2,83" quanto "2.83" como separador decimal (o dossiê da Facta
// mistura os dois formatos entre os campos de taxa e os demais valores).
function parseFlexPercent(value) {
  if (!value) return null;
  const raw = String(value).trim();
  if (/^\d+,\d+$/.test(raw)) return `${raw}%`;
  if (/^\d+\.\d+$/.test(raw)) return `${raw.replace(".", ",")}%`;
  if (/^\d+$/.test(raw)) return `${raw}%`;
  return raw.includes("%") ? raw : `${raw}%`;
}

function windowAround(flat, marker, radius = 260) {
  const index = String(flat || "").search(marker);
  if (index < 0) return "";
  const start = Math.max(0, index - 40);
  return flat.slice(start, index + radius);
}

export function isFactaCartaoConsignado(flat) {
  return /Facta\s+Financeira/i.test(String(flat || ""));
}

export function extractFactaCartaoConsignado(text, flat) {
  if (!isFactaCartaoConsignado(flat)) return {};

  const bankWindow = windowAround(flat, /Facta\s+Financeira/i, 260);
  const cnpjInstituicao = firstMatch(bankWindow, [/CNPJ\s*[:\-]?\s*(\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2})/i]);
  const razaoSocial = firstMatch(flat, [
    /(Facta\s+Financeira\s+S\.?A\.?\s*Cr[ée]dito,?\s*Financiamento\s+e\s+Investimento)/i,
  ]) || "Facta Financeira S.A. Crédito, Financiamento e Investimento";

  const propostaNumero = firstMatch(flat, [
    /Proposta\s+de\s+Ades[ãa]o\s*n[ºo°.]?\s*[:\-]?\s*(\d{4,10})/i,
    /Proposta\s*n[ºo°.]?\s*[:\-]?\s*(\d{4,10})/i,
  ]);

  // Quadro VI - Saque
  const limiteCartao = normalizeMoney(firstMatch(flat, [
    /Valor\s+limite\s+do\s+cart[ãa]o(?:\s+de\s+cr[ée]dito)?\s*:?\s*R\$\s*([\d.]+,\d{2})/i,
  ]));
  const valorMaximoSaque = normalizeMoney(firstMatch(flat, [
    /Valor\s+m[áa]ximo\s+para\s+saque\s*:?\s*R\$\s*([\d.]+,\d{2})/i,
  ]));
  const valorConsignadoMensal = normalizeMoney(firstMatch(flat, [
    /Valor\s+consignado\s+(?:para\s+pgto\.?\s+do\s+valor\s+m[íi]nimo\s+indicado\s+na\s+fatura|mensal)\s*:?\s*R\$\s*([\d.]+,\d{2})/i,
  ]));
  const tarifaEmissao = normalizeMoney(firstMatch(flat, [
    /Taxa\s+pela\s+emiss[ãa]o\s+do\s+cart[ãa]o\s*:?\s*R\$\s*([\d.]+,\d{2})/i,
  ]));
  const prazoPrevistoLiquidacaoMeses = firstMatch(flat, [
    /Prazo\s+previsto\s+para\s+liquida[çc][ãa]o\s+do\s+saldo\s*:?\s*(\d{1,3})\s*meses/i,
  ]);
  const iof = normalizeMoney(firstMatch(flat, [
    /Prazo\s+previsto[\s\S]{0,60}?IOF\s*:?\s*R\$\s*([\d.]+,\d{2})/i,
    /\bIOF\s*:?\s*R\$\s*([\d.]+,\d{2})/i,
  ]));
  const taxaJurosMensal = parseFlexPercent(firstMatch(flat, [
    /Taxa\s+de\s+juros\s+ao\s+m[êe]s\s*:?\s*([\d.,]+)\s*%/i,
  ]));
  const taxaJurosAnual = parseFlexPercent(firstMatch(flat, [
    /Taxa\s+de\s+juros\s+ao\s+ano\s*:?\s*([\d.,]+)\s*%/i,
  ]));
  const cetMensal = parseFlexPercent(firstMatch(flat, [
    /Custo\s+Efetivo\s+Total\s+ao\s+m[êe]s\s*:?\s*([\d.,]+)\s*%/i,
  ]));
  const cetAnual = parseFlexPercent(firstMatch(flat, [
    /Custo\s+Efetivo\s+Total\s+ao\s+ano\s*:?\s*([\d.,]+)\s*%/i,
  ]));

  const seguroWindow = windowAround(flat, /[Ss]eguro/i, 120);
  let seguroContratado = null;
  const seguroMatch = seguroWindow.match(/Sim\s*:?\s*(X)?\s*N[ãa]o\s*:?\s*(X)?/i);
  if (seguroMatch) {
    if (seguroMatch[2]) seguroContratado = false;
    else if (seguroMatch[1]) seguroContratado = true;
  }

  const formaFatura = firstMatch(flat, [
    /fatura\s+seja\s+disponibilizada\s+por\s*:?\s*([A-Za-zÀ-ÿ\s()]{5,70}?)\s*:\s*X/i,
  ]);

  // Correspondente bancário (Quadro VII / rodapé da proposta)
  const correspondenteMatch = flat.match(
    /Correspondente\s*:?\s*([A-Z0-9À-Ú\s.&\-]{4,60}?)\s*,?\s*C[óo]digo\s*:?\s*(\d{3,8})\s*,?\s*CNPJ\s*:?\s*([\d./\-]{14,18})/i,
  );
  const correspondente = correspondenteMatch
    ? { nome: correspondenteMatch[1].trim(), codigo: correspondenteMatch[2], cnpj: correspondenteMatch[3] }
    : null;

  // Qualificação em tabela: rótulo em uma linha, valores na linha seguinte,
  // em colunas separadas por espaçamento largo (saída típica de "-layout").
  // O texto multi-linha (com o espaçamento original preservado) é a fonte
  // primária, porque o texto achatado (`flat`) perde a largura das colunas
  // e não distingue com segurança "RUA R" (logradouro) de "ZONA RURAL"
  // (bairro) quando ambos são sequências de palavras em maiúsculas.
  const qualNomeCpfNasc =
    text.match(/Nome\s+CPF\s+Data\s+Nascimento\s*\n\s*([A-ZÀ-Ú][A-ZÀ-Ú\s]*?)\s{2,}(\d{3}\.?\d{3}\.?\d{3}-?\d{2})\s{2,}(\d{2}\/\d{2}\/\d{4})/i)
    || flat.match(/Nome\s+CPF\s+Data\s+Nascimento\s+([A-ZÀ-Ú][A-ZÀ-Ú\s]{7,70}?)\s+(\d{3}\.?\d{3}\.?\d{3}-?\d{2})\s+(\d{2}\/\d{2}\/\d{4})/i);
  const qualEnderecoBairroCep =
    text.match(/Endere[çc]o\s+Bairro\s+CEP\s*\n\s*([A-ZÀ-Ú0-9,.\s]*?)\s{2,}([A-ZÀ-Ú\s]*?)\s{2,}(\d{5}-?\d{3})/i)
    || flat.match(/Endere[çc]o\s+Bairro\s+CEP\s+([A-ZÀ-Ú0-9,.\s]{2,60}?)\s+([A-ZÀ-Ú\s]{3,40}?)\s+(\d{5}-?\d{3})/i);
  const phonePattern = "(?:\\(?\\d{2}\\)?\\s*)?\\d{4,5}-?\\d{4}";
  const qualCidadeUfTelefone =
    text.match(new RegExp(`Cidade\\s+UF\\s+Telefone\\s*\\n\\s*([A-ZÀ-Ú\\s]*?)\\s{2,}([A-Z]{2})\\s{2,}(${phonePattern})`, "i"))
    || flat.match(new RegExp(`Cidade\\s+UF\\s+Telefone\\s+([A-ZÀ-Ú\\s]{3,40}?)\\s+([A-Z]{2})\\s+(${phonePattern})`, "i"));
  const qualIdentidade = flat.match(
    /Identidade\s+Identidade\s+[ÓO]rg[ãa]o\s+Identidade\s+Emiss[ãa]o\s+(\S+)\s+(\S+)\s+(\d{2}\/\d{2}\/\d{4})/i,
  );

  // Conta de recebimento do benefício.
  const contaBeneficioMatch = flat.match(
    /Banco\s*:?\s*(\d{3})\s+Ag[êe]ncia\s*:?\s*(\d{2,6})\s+Conta\s*:?\s*(\d{4,14})/i,
  );

  const numeroBeneficio = firstMatch(flat, [
    /N[uú]mero\s+do\s+benef[íi]cio\s*:?\s*(\d{8,12})/i,
    /\bbenef[íi]cio\s*:?\s*(\d{8,12})\b/i,
  ]);
  const beneficioNoTermoConsentimento = firstMatch(flat, [
    /Termo\s+de\s+Consentimento[\s\S]{0,300}?N[ºo°.]?\s*do\s+benef[íi]cio\s*:?\s*(\d{4,12})/i,
  ]);

  // Trilha de auditoria (dossiê de contratação da própria plataforma).
  // O dossiê imprime "Localização: / IP DE ACESSO:" como cabeçalho de duas
  // colunas e os valores na linha seguinte (coordenada, depois IP) — por
  // isso o padrão principal casa cabeçalho + os dois valores em sequência,
  // com um padrão solto como reserva caso a ordem de extração varie.
  const gpsIpCombined = flat.match(
    /Localiza[çc][ãa]o\s*:?\s*IP\s+DE\s+ACESSO\s*:?\s*(-?\d{1,2}\.\d{4,8})\s*,\s*(-?\d{1,3}\.\d{4,8})\s+(\d{1,3}(?:\.\d{1,3}){3})/i,
  );
  const gpsMatch = gpsIpCombined
    ? [null, gpsIpCombined[1], gpsIpCombined[2]]
    : windowAround(flat, /Localiza[çc][ãa]o\s*:/i, 120).match(/(-?\d{1,2}\.\d{4,8})\s*,\s*(-?\d{1,3}\.\d{4,8})/);
  const ipAcesso = gpsIpCombined?.[3] || firstMatch(flat, [/IP\s+DE\s+ACESSO\s*:?\s*(\d{1,3}(?:\.\d{1,3}){3})/i]);
  const acessoApp = firstMatch(flat, [/Acesso\s+ao\s+APP\s*:?\s*(\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}:\d{2})/i]);
  const aceiteTermos = firstMatch(flat, [
    /Aceite\s+dos\s+Termos\s+e\s+Condi[çc][õo]es\s*:?\s*(\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}:\d{2})/i,
  ]);
  const aceiteCcb = firstMatch(flat, [
    /Aceite\s+e\s+emiss[ãa]o\s+da\s+CCB\s*:?\s*(\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}:\d{2})/i,
  ]);
  const dataAssinaturaTrilha = firstMatch(flat, [
    /Data\s+da\s+Assinatura\s*:?\s*(\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}:\d{2})/i,
  ]);
  const assinadoPorMatch = flat.match(
    /Assinado\s+eletronicamente\s+por\s*:?\s*([A-ZÀ-Ú][A-ZÀ-Ú\s]{7,80}?)\s*[-–]\s*(\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}:\d{2})/i,
  );
  const dispositivoUtilizado = firstMatch(flat, [
    /Dispositivo\s+utilizado\s*:?\s*([^:]{10,300}?)(?=\s+(?:HASH|FACEMATCH|BASE\s+P[ÚU]BLICA|SCORE|Localiza[çc][ãa]o|$))/i,
  ]);
  const facematch = firstMatch(flat, [/FACEMATCH\s*:?\s*([\d,.]+)\s*%/i]);
  const basePublica = firstMatch(flat, [/BASE\s+P[ÚU]BLICA\s*:?\s*([A-ZÀ-Ú]{3,30})/i]);
  const scoreBasePublica = firstMatch(flat, [/SCORE\s*:?\s*([A-ZÀ-Ú\s]{3,40}?)(?=\s{2,}|$)/i]);
  const validadorUrl = firstMatch(flat, [/(https?:\/\/[^\s]*valid[^\s]*)/i]);

  const dataContrato = dataAssinaturaTrilha?.split(/\s+/)[0]
    || assinadoPorMatch?.[2]?.split(/\s+/)[0]
    || null;

  return {
    isFacta: true,
    modalidade: "RMC",
    razaoSocial,
    cnpjInstituicao: cnpjInstituicao ? cnpjInstituicao.replace(/\D/g, "") : null,
    banco: razaoSocial,
    contratoNumero: propostaNumero,
    dataContrato,
    clienteNome: qualNomeCpfNasc?.[1]?.replace(/\s+/g, " ").trim().toUpperCase() || null,
    clienteCpf: qualNomeCpfNasc?.[2] || null,
    clienteDataNascimento: qualNomeCpfNasc?.[3] || null,
    clienteRg: qualIdentidade ? `${qualIdentidade[1]} ${qualIdentidade[2]}, expedido em ${qualIdentidade[3]}` : null,
    clienteEndereco: qualEnderecoBairroCep?.[1]?.trim() || null,
    clienteBairro: qualEnderecoBairroCep?.[2]?.trim() || null,
    clienteCep: qualEnderecoBairroCep?.[3] || null,
    clienteCidade: qualCidadeUfTelefone?.[1]?.trim() || null,
    clienteEstado: qualCidadeUfTelefone?.[2] || null,
    clienteTelefone: qualCidadeUfTelefone?.[3] || null,
    numeroBeneficio,
    beneficioNoTermoConsentimento,
    matriculaInss: numeroBeneficio ? `${numeroBeneficio} (= número do benefício)` : null,
    correspondente,
    contaBeneficio: contaBeneficioMatch
      ? { codigoBanco: contaBeneficioMatch[1], agencia: contaBeneficioMatch[2], conta: contaBeneficioMatch[3] }
      : null,
    // Espelhados no nível superior: taxa/CET/IOF são conceitos comuns a
    // empréstimo e cartão, então reaproveitam os mesmos campos de
    // `contratoExtraido` já usados pelo restante do pipeline (aferição
    // matemática, achados de CET etc.). Valores especificamente de
    // empréstimo (valor contratado, parcela, número de parcelas) NÃO são
    // espelhados aqui de propósito — não se aplicam a cartão consignado.
    taxaJurosMensal,
    taxaJurosAnual,
    cetMensal,
    cetAnual,
    iofTotal: iof,
    cartao: {
      limiteCartao,
      valorMaximoSaque,
      valorConsignadoMensal,
      tarifaEmissao,
      prazoPrevistoLiquidacaoMeses: prazoPrevistoLiquidacaoMeses ? Number(prazoPrevistoLiquidacaoMeses) : null,
      iof,
      taxaJurosMensal,
      taxaJurosAnual,
      cetMensal,
      cetAnual,
      seguroContratado,
      formaFatura,
    },
    trilha: {
      latitude: gpsMatch ? Number(gpsMatch[1]) : null,
      longitude: gpsMatch ? Number(gpsMatch[2]) : null,
      ipAcesso,
      acessoApp,
      aceiteTermos,
      aceiteCcb,
      dataAssinatura: dataAssinaturaTrilha,
      dispositivoUtilizado: dispositivoUtilizado?.trim() || null,
      facematch,
      basePublica,
      scoreBasePublica: scoreBasePublica?.trim() || null,
      validadorUrl,
      titular: assinadoPorMatch?.[1]?.replace(/\s+/g, " ").trim() || null,
    },
  };
}
