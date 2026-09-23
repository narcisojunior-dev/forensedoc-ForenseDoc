/**
 * Datas internas do PDF confrontadas entre si e com o instante do aceite.
 *
 * ─── Por que ─────────────────────────────────────────────────────────────────
 *
 * Dois dossiês reais passaram pelo laudo sem que ele dissesse o óbvio:
 *
 *   - Dossiê C6 (contrato 90140674306): ModDate 31/07/2024, CreationDate
 *     12/12/2024. Modificado antes de criado. Com Creator "Aspose.Words",
 *     Producer "openhtmltopdf" e rótulos MSIP de 2020 e 2021, o quadro é de
 *     arquivo montado sobre um template corporativo de Word. Os metadados são
 *     do molde, não do ato. Isso também explica o "autor dos metadados diverge
 *     do contratante": o autor é quem fez o template.
 *
 *   - CCB Banco Master 27766845 e o mesmo C6: CreationDate no MESMO segundo do
 *     carimbo de assinatura ("13/09/2023 10:37" = 13:37:55 UTC; "12/12/2024
 *     11:06:39" = coleta da biometria). O documento foi gerado no instante em
 *     que a foto entrou. O que o banco chama de assinatura é a geração do PDF,
 *     e o "carimbo de data e hora" é o relógio do servidor, não carimbo de tempo
 *     de terceiro.
 *
 * Nenhum dos dois é prova de fraude. Os dois são fatos do arquivo que o perito
 * precisa registrar e que mudam a leitura de outros achados.
 */

const DATA_PT = /(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?/;
const FUSO = /UTC\s*([+-])(\d{2}):?(\d{2})/i;

/**
 * "12/12/2024 11:06:39 UTC-03:00" → instante absoluto. Sem fuso, assume o
 * informado em `fusoPadraoMin` (minutos a somar para chegar a UTC).
 */
export function instanteDe(texto, fusoPadraoMin = 180) {
  const m = String(texto || "").match(DATA_PT);
  if (!m) return null;
  const [, d, mo, y, h = "00", mi = "00", s = "00"] = m;
  const fuso = String(texto).match(FUSO);
  const offsetMin = fuso ? (fuso[1] === "-" ? 1 : -1) * (Number(fuso[2]) * 60 + Number(fuso[3])) : fusoPadraoMin;
  const utc = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
  return Number.isFinite(utc) ? utc + offsetMin * 60_000 : null;
}

const TEMPLATE_EDITOR = /aspose|microsoft\s*(?:word|office)|\bword\b|libreoffice|openoffice|google\s*docs|wps\s*office/i;

/**
 * @param {object} args
 * @param {string|null} args.creationDate   metadata.creationDate formatado
 * @param {string|null} args.modificationDate metadata.modificationDate formatado
 * @param {string|null} args.creator
 * @param {string|null} args.producer
 * @param {boolean} [args.rotulosMsip] há chaves MSIP_Label_* no Info do PDF
 * @param {string|null} args.dataHoraAssinatura "dd/mm/aaaa hh:mm[:ss]" do bloco de assinatura
 * @param {Array<{nome:string, data_hora:string, fuso?:string|null}>} [args.eventos] trilha
 * @param {string|null} [args.fusoTrilha] rótulo do fuso da trilha (GMT, UTC, BRT, ...)
 */
export function avaliarDatasDoArquivo({
  creationDate,
  modificationDate,
  creator,
  producer,
  rotulosMsip = false,
  dataHoraAssinatura = null,
  eventos = [],
  fusoTrilha = null,
}) {
  const achados = [];
  const warnings = [];
  const criacao = instanteDe(creationDate, 0);
  const modificacao = instanteDe(modificationDate, 0);

  // INT3: modificado antes de criado.
  if (criacao && modificacao && criacao - modificacao > 60_000) {
    const dias = Math.round((criacao - modificacao) / 86_400_000);
    const texto = `A data de modificação interna (${modificationDate}) é anterior à data de criação (${creationDate}) em ${dias === 1 ? "1 dia" : `${dias} dias`}. Um arquivo não é modificado antes de existir: o par de datas foi herdado de outro documento, em regra o modelo (template) a partir do qual este PDF foi renderizado${creator || producer ? ` (aplicativo criador "${creator || "não informado"}", produtor "${producer || "não informado"}")` : ""}. Os metadados descritivos deste arquivo, inclusive autor e datas, não descrevem o ato de contratação e não servem para datá-lo.`;
    achados.push({ codigo: "INT3", gravidade: "MÉDIA", titulo: "Data de modificação anterior à data de criação", texto, grau: "CONSTATADO", ancora: { pagina: null, trecho: `CreationDate ${creationDate}; ModDate ${modificationDate}` } });
    warnings.push(texto);
  }

  // Linhagem de template: Word, Aspose, rótulos de proteção corporativa.
  const linhagemTemplate = rotulosMsip || TEMPLATE_EDITOR.test(creator || "") || TEMPLATE_EDITOR.test(producer || "");

  // INT4: PDF gerado no instante do aceite ou da biometria.
  const candidatos = [];
  if (dataHoraAssinatura) candidatos.push({ rotulo: "carimbo de assinatura", valor: dataHoraAssinatura });
  for (const ev of eventos || []) {
    if (/biometria|selfie|assinatura|aceite\s+da\s+ccb|aceite\s+da\s+c[ée]dula/i.test(ev.nome || "")) {
      candidatos.push({ rotulo: `evento "${ev.nome}"`, valor: ev.data_hora, fuso: ev.fuso || fusoTrilha });
    }
  }
  if (criacao && candidatos.length) {
    for (const c of candidatos) {
      const leituras = c.fuso && /GMT|UTC/i.test(c.fuso)
        ? [{ nome: "UTC, como rotula a trilha", instante: instanteDe(c.valor, 0) }]
        : [{ nome: "horário de Brasília", instante: instanteDe(c.valor, 180) }, { nome: "UTC", instante: instanteDe(c.valor, 0) }];
      const coincidente = leituras.find((l) => l.instante && Math.abs(l.instante - criacao) <= 120_000);
      if (!coincidente) continue;
      const delta = Math.round(Math.abs(coincidente.instante - criacao) / 1000);
      const texto = `A data de criação interna do PDF (${creationDate}) coincide com o ${c.rotulo} (${c.valor}, lido em ${coincidente.nome})${delta ? `, com diferença de ${delta} s` : ", no mesmo segundo"}. O arquivo foi gerado no instante do ato: o horário impresso como assinatura é o relógio do servidor que renderizou o documento, não um carimbo de tempo de terceiro. A coincidência não invalida o ato; ela mostra que assinatura e geração do arquivo são o mesmo evento e que a prova do momento depende dos registros de origem, não do PDF.`;
      achados.push({ codigo: "INT4", gravidade: "MÉDIA", titulo: "Arquivo gerado no instante do aceite", texto, grau: "CONSTATADO", ancora: { pagina: null, trecho: `CreationDate ${creationDate}; ${c.rotulo} ${c.valor}` } });
      warnings.push(texto);
      break;
    }
  }

  return { achados, warnings, linhagemTemplate };
}

/**
 * Redação do aviso sobre o autor dos metadados. Com linhagem de template, o
 * nome no campo Author é de quem fez o molde e a divergência não sustenta
 * achado de gravidade média.
 */
export function avisoAutorMetadados({ author, clientName, linhagemTemplate, creator, producer, rotulosMsip }) {
  if (linhagemTemplate) {
    const sinais = [
      creator ? `aplicativo criador "${creator}"` : null,
      producer ? `produtor "${producer}"` : null,
      rotulosMsip ? "rótulos de classificação corporativa (MSIP) no dicionário de informações" : null,
    ].filter(Boolean).join(", ");
    return `Nota de rastreabilidade: o autor declarado nos metadados (${author}) não é o contratante (${clientName}). O arquivo tem linhagem de modelo de editor de texto (${sinais}); nesse cenário o campo Autor identifica quem preparou o template, não o signatário, e a divergência não constitui achado autônomo.`;
  }
  return `O autor declarado nos metadados (${author}) difere do nome do contratante extraído (${clientName}). A divergência não comprova fraude, mas deve ser contextualizada.`;
}
