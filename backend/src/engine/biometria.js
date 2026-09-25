/**
 * Artefato biométrico como achado de primeira linha.
 *
 * ─── Por que ─────────────────────────────────────────────────────────────────
 *
 * O laudo do dossiê C6 inventariou a selfie do contratante entre 103 linhas de
 * logotipos e máscaras e promoveu como achados de imagem o "reuso de template" e
 * o "arquivo muito pequeno". A fotografia é o único lastro da alegação de que a
 * cédula foi assinada por biometria facial: uma imagem de 0,23 megapixel, sem
 * EXIF, sem prova de vivacidade, sem índice de similaridade e sem documento de
 * identidade para confronto.
 */

const DADOS_DO_PROCESSO_BIOMETRICO = [
  { nome: "teste de vivacidade", regex: /liveness|vivacidade|prova\s+de\s+vida/i },
  { nome: "índice de similaridade", regex: /score|similaridade|facematch|match\s+facial/i },
  { nome: "limiar de aceitação", regex: /limiar|threshold|pontua[çc][ãa]o\s+m[íi]nima/i },
  { nome: "base comparada", regex: /base\s+(?:p[úu]blica|comparada|biom[ée]trica|de\s+refer[êe]ncia)|serpro|datavalid/i },
  { nome: "fornecedor do algoritmo", regex: /fornecedor\s+(?:da\s+)?biometria|unico\s+check|idwall|acesso\s+digital|serpro/i },
];

/** Na IN 138 a selfie é do banco: o hash da captura entra na lista do que ele tem de mostrar. */
const HASH_DA_CAPTURA = { nome: "hash da captura biométrica", regex: /hash\s+(?:da\s+)?(?:selfie|imagem|captura|biometria)/i };

const NOTA_MEU_INSS = "No regime aplicável à data do contrato, a fotografia colhida pela instituição é elemento complementar: a prova central da manifestação é o registro da autorização no Meu INSS (ver a seção Autorização do benefício).";
const NOTA_GOVBR = "A operação foi autorizada pela conta gov.br. Nessa via a fotografia e a prova de vida deixam de ser o objeto do exame, que passa ao registro de acesso gov.br e à conta bancária validada (ver a seção Autorização do benefício).";

/**
 * @param {object} args
 * @param {object} args.imagens resultado de `inspectPdfImages`
 * @param {string} args.flat texto corrido do documento
 * @param {boolean} args.alegaBiometria o documento afirma assinatura/validação biométrica
 * @param {object|null} [args.regime] `extracted.regime_inss` (consignado INSS)
 */
export function analisarBiometria({ imagens, flat, alegaBiometria, regime = null }) {
  const faciais = (imagens?.imagens || []).filter((i) => i.biometricaProvavel);
  if (!faciais.length) return null;
  const principal = [...faciais].sort((a, b) => (b.width * b.height) - (a.width * a.height))[0];
  const documento = (imagens.imagens || []).some((i) => !i.biometricaProvavel && i.classificacao === "imagem documental" && i.pixels >= 150000);
  const texto = String(flat || "");
  const viaGovbr = regime?.codigo === "IN_213_VIA_DUPLA" && regime.via === "GOVBR";
  const complementar = !viaGovbr && (regime?.codigo === "MEU_INSS_BIOMETRIA" || regime?.codigo === "IN_213_VIA_DUPLA");
  const exigidos = regime?.codigo === "IN_138_SELFIE_BANCO" ? [...DADOS_DO_PROCESSO_BIOMETRICO, HASH_DA_CAPTURA] : DADOS_DO_PROCESSO_BIOMETRICO;
  // Só conta como informado se o processo biométrico for descrito, e não apenas
  // listado entre as finalidades de tratamento de dados.
  const ausentes = exigidos.filter(({ regex }) => !regex.test(texto)).map((d) => d.nome);

  const bloco = {
    pagina: principal.page,
    numero: principal.num,
    largura: principal.width,
    altura: principal.height,
    megapixels: principal.megapixels ?? Number(((principal.width * principal.height) / 1_000_000).toFixed(2)),
    formato: principal.formato || String(principal.enc || "").toUpperCase(),
    bytes: principal.extractedBytes ?? null,
    sha256: principal.sha256 || null,
    exif: principal.exif ?? null,
    miniatura: principal.miniatura || null,
    contagem_faciais: faciais.length,
    documento_identidade_localizado: documento,
    dados_do_processo_ausentes: ausentes,
    ela: principal.ela || null,
    nota_regime: viaGovbr ? NOTA_GOVBR : complementar ? NOTA_MEU_INSS : null,
  };

  const falhas = [];
  if (alegaBiometria && faciais.length === 1) falhas.push("exibe uma fotografia; o resultado individual de vivacidade precisa ser apresentado");
  if (bloco.megapixels < 0.5) falhas.push(`de ${String(bloco.megapixels).replace(".", ",")} megapixel`);
  if (bloco.exif === false) falhas.push("sem metadados de captura (EXIF) identificados no artefato extraído");
  if (!documento) ausentes.push("documento de identidade de referência");

  const achadoELA = principal.ela?.achado || null;
  if (viaGovbr) return { ...bloco, achado: null, achado_ela: achadoELA };

  if (!falhas.length && !ausentes.length) return { ...bloco, achado: null, achado_ela: achadoELA };
  const fotografia = faciais.length === 1 ? "uma única fotografia" : `${faciais.length} fotografias`;
  const qualidades = [bloco.megapixels < 0.5 ? `de ${String(bloco.megapixels).replace(".", ",")} megapixel` : null, bloco.exif === false ? "sem EXIF identificado no artefato extraído" : null].filter(Boolean).join(" e ");
  const texto_achado = `${alegaBiometria ? "A instituição afirma ter colhido biometria facial e exibe" : "O arquivo exibe"} ${fotografia}${qualidades ? ` ${qualidades}` : ""} (${bloco.pagina ? `pág. ${bloco.pagina}, ` : ""}${bloco.largura} x ${bloco.altura} pixels${bloco.bytes ? `, ${bloco.bytes.toLocaleString("pt-BR")} bytes` : ""})${ausentes.length ? `, e a extração disponível não localizou ${ausentes.join(", ").replace(/, ([^,]*)$/, " nem $1")}` : ""}. ${faciais.length === 1 && alegaBiometria ? "Uma imagem estática isolada não demonstra o resultado individual de vivacidade ou a vinculação ao titular do CPF. Ausência de EXIF nesta cópia não prova remoção nem ausência de metadados na captura original." : ""}`.trim();
  return {
    ...bloco,
    achado: {
      codigo: "BIO2",
      gravidade: complementar ? "MÉDIA" : "ALTA",
      titulo: "Lastro biométrico frágil",
      texto: complementar ? `${texto_achado} ${NOTA_MEU_INSS}` : texto_achado,
    },
    achado_ela: achadoELA,
  };
}
