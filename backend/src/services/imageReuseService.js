/**
 * Reúso da mesma fotografia biométrica em outra análise do mesmo escritório.
 *
 * ─── Por que ─────────────────────────────────────────────────────────────────
 *
 * O TJPR anulou três contratos gerados no mesmo segundo com a mesma selfie. O
 * ForenseDoc via a repetição dentro de um arquivo (IMG2) e nada entre arquivos.
 * Cada análise concluída guarda o inventário de imagens com SHA-256 no
 * `result`; basta procurar o hash da fotografia deste dossiê nas análises
 * anteriores do MESMO tenant. Entre tenants não se procura: o dado é biométrico
 * de cliente de outro escritório (LGPD, art. 11).
 *
 * O `result.text` é o extraído serializado como string dentro do JSONB, então a
 * busca é textual pelo hash, que tem 64 caracteres hexadecimais e não colide
 * com nada por acaso.
 */
/**
 * @param {object} args
 * @param {object} [args.db] cliente Prisma (injetável nos testes; sem ele, o da aplicação)
 * @param {string} args.tenantId
 * @param {string} args.analysisId análise atual, excluída da busca
 * @param {string[]} args.hashes SHA-256 das fotografias biométricas prováveis
 * @param {string|null} [args.documentoSha256] SHA-256 do arquivo atual: outra análise da
 *   mesma cópia (o mesmo PDF subido de novo) não é outro dossiê e sai da busca
 * @param {string|null} [args.contratoAtual] número do contrato atual: análise de outra
 *   cópia do mesmo contrato também não é reúso entre contratações
 * @returns {Promise<Array<{hash:string, analysisId:string, createdAt:Date, reportId:string|null, contrato:string|null}>>}
 */
export async function localizarReusoDeImagem({ db = null, tenantId, analysisId, hashes, documentoSha256 = null, contratoAtual = null }) {
  const alvos = [...new Set((hashes || []).filter((h) => /^[0-9A-Fa-f]{64}$/.test(String(h || ""))))];
  if (!tenantId || !alvos.length) return [];
  const shaAtual = /^[0-9A-Fa-f]{64}$/.test(String(documentoSha256 || "")) ? String(documentoSha256).toUpperCase() : "";
  const contratoDigitos = (v) => String(v || "").replace(/\D/g, "");
  // Carregado só quando há o que consultar: o módulo não obriga o cliente
  // Prisma a existir em testes nem em ferramentas de linha de comando.
  if (!db) db = (await import("../utils/prisma.js")).prisma;
  const ocorrencias = [];
  for (const hash of alvos) {
    const linhas = await db.$queryRaw`
      SELECT id, "createdAt",
             result->>'reportId' AS report_id,
             substring(result->>'text' from '"numero":"([^"]{1,40})"') AS contrato
      FROM analyses
      WHERE "tenantId" = ${tenantId}
        AND id <> ${analysisId}
        AND status = 'COMPLETED'
        AND upper(coalesce(result->'hashes'->>'sha256', '')) <> ${shaAtual}
        AND result->>'text' LIKE ${`%${hash.toUpperCase()}%`}
      ORDER BY "createdAt" ASC
      LIMIT 20`;
    for (const linha of linhas || []) {
      // Mesmo número de contrato em outra cópia do dossiê: mesma contratação.
      if (contratoAtual && linha.contrato && contratoDigitos(linha.contrato) === contratoDigitos(contratoAtual)) continue;
      ocorrencias.push({
        hash: hash.toUpperCase(),
        analysisId: linha.id,
        createdAt: linha.createdAt,
        reportId: linha.report_id || null,
        contrato: linha.contrato || null,
      });
    }
  }
  return ocorrencias;
}

/** Achado IMG6 a partir das ocorrências; puro, para o laudo e para os testes. */
export function montarAchadoReuso(ocorrencias = [], { contratoAtual = null } = {}) {
  if (!ocorrencias.length) return null;
  const porHash = new Map();
  const vistos = new Set();
  for (const o of ocorrencias) {
    // Várias análises do mesmo laudo anterior contam uma vez.
    const chave = `${o.hash}|${o.reportId || o.analysisId}|${o.contrato || ""}`;
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    if (!porHash.has(o.hash)) porHash.set(o.hash, []);
    porHash.get(o.hash).push(o);
  }
  if (!porHash.size) return null;
  const descricao = [...porHash.entries()].map(([hash, lista]) => {
    const onde = lista.map((o) => `${o.reportId || o.analysisId}${o.contrato ? ` (contrato ${o.contrato})` : ""}${o.createdAt ? `, análise de ${new Date(o.createdAt).toLocaleDateString("pt-BR")}` : ""}`).join("; ");
    return `SHA-256 ${hash.slice(0, 12)}… consta também em ${onde}`;
  }).join(". ");
  return {
    codigo: "IMG6",
    gravidade: "CRÍTICO",
    titulo: "Mesma fotografia biométrica em outro dossiê já analisado",
    texto: `A fotografia classificada como biometria provável deste arquivo é idêntica, byte a byte, a fotografia de outro dossiê analisado por este escritório: ${descricao}. Duas contratações distintas${contratoAtual ? ` (esta, contrato ${contratoAtual}, e a anterior)` : ""} não produzem a mesma captura; ou a foto foi reaproveitada pela plataforma, ou os dois dossiês foram montados a partir de uma única imagem. Conferir se os contratos são do mesmo cliente e exigir da instituição as capturas originais, com data, aparelho e resultado de vivacidade de cada uma.`,
    grau: "CONSTATADO",
    ancora: { pagina: null, trecho: `SHA-256 ${[...porHash.keys()][0].slice(0, 16)}` },
  };
}
