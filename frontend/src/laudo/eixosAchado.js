/**
 * Eixo da tese a que cada achado pertence, para ordenar o sumário e o § 8.
 *
 * Dentro da mesma gravidade, vem primeiro o que sustenta a impugnação da
 * contratação: assinatura, prova do crédito, biometria, consentimento na
 * trilha. Metadados descritivos ausentes nunca aparecem antes disso.
 *
 * Cópia de backend/src/engine/eixosAchado.js: manter as duas iguais.
 */

const EIXOS = [
  { eixo: "assinatura", regex: /^(ASS\d|AUT\d|signature-absent|simple-signature|sig-)/ },
  { eixo: "credito", regex: /^LIB\d/ },
  { eixo: "biometria", regex: /^(BIO\d|ELA\d|IMG3|IMG2)/ },
  { eixo: "consentimento", regex: /^(TRL\d|TZ\d|TML\d|chronology|device-gap)/ },
  { eixo: "custodia", regex: /^(INT\d|CUS\d|hash-|integrity-|chain-)/ },
  { eixo: "financeiro", regex: /^(CET\d|FIN\d|PRZ\d|TRB\d|TET\d|RMC\d|TAR\d|economics|DAT\d)/ },
  { eixo: "seguro", regex: /^SEG\d/ },
  { eixo: "geografia", regex: /^(gps-|ip-|geo)/ },
  { eixo: "cadastro", regex: /^(CAD\d|EMP\d|ADE\d|IDA\d|FAT\d|client-|dates-)/ },
  { eixo: "metadados", regex: /^(metadata-|IMG\d|OCR\d|LOG\d|INT2)/ },
];

export function eixoDoAchado(codigo) {
  const c = String(codigo || "");
  const indice = EIXOS.findIndex(({ regex }) => regex.test(c));
  return indice < 0 ? { eixo: "outros", ordem: EIXOS.length } : { eixo: EIXOS[indice].eixo, ordem: indice };
}

const GRAVIDADE = { CRÍTICO: 0, ALTA: 1, ALTO: 1, MÉDIA: 2, MÉDIO: 2, INFO: 3, FAVORÁVEL: 4 };

/** Ordena por gravidade e, dentro dela, pelo eixo da tese. Estável. */
export function ordenarAchados(lista, { codigo = (a) => a.codigo, gravidade = (a) => a.gravidade } = {}) {
  return lista
    .map((item, i) => ({ item, i }))
    .sort((a, b) =>
      (GRAVIDADE[gravidade(a.item)] ?? 5) - (GRAVIDADE[gravidade(b.item)] ?? 5)
      || eixoDoAchado(codigo(a.item)).ordem - eixoDoAchado(codigo(b.item)).ordem
      || a.i - b.i)
    .map(({ item }) => item);
}
