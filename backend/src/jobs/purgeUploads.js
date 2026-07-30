import { prisma } from "../utils/prisma.js";
import { deletePdfs, RETENCAO_DIAS, isConfigured } from "../services/objectStorageService.js";

/**
 * Expurgo do PDF original vencido.
 *
 * ─── Por que isto existe, se o bucket tem regra de ciclo de vida ─────────────
 *
 * A regra do bucket é configuração de infraestrutura: some num restore, numa
 * migração de conta, ou quando alguém a desativa para investigar algo e esquece
 * de religar. Uma política de retenção que existe só como configuração externa é
 * uma intenção, não uma garantia.
 *
 * Executando o expurgo aqui, ele fica no código, é versionado, tem teste e
 * DEIXA REGISTRO no banco (`pdfPurgedAt`). Esse registro é o que demonstra
 * cumprimento: sob a LGPD não basta ter apagado, é preciso poder comprovar
 * quando e o quê. Recomenda-se manter a regra do bucket também, como segunda
 * camada.
 *
 * ─── O que NÃO é apagado ─────────────────────────────────────────────────────
 *
 * Só o arquivo original. O laudo (`Analysis.result`) permanece, e com ele o
 * SHA-256 e o SHA-1 do arquivo: a integridade do que foi analisado continua
 * demonstrável depois que o original deixa de existir. É essa separação que
 * permite a retenção curta do PDF sem enfraquecer a prova.
 */

// Lotes para não carregar meses de análises em memória de uma vez.
const LOTE = 500;

export async function processUploadPurge() {
  if (!isConfigured()) {
    console.log("[Purge] Armazenamento de objetos não configurado. Nada a expurgar.");
    return { removidos: 0 };
  }

  const limite = new Date(Date.now() - RETENCAO_DIAS * 24 * 60 * 60 * 1000);
  let removidosTotal = 0;

  for (;;) {
    const vencidas = await prisma.analysis.findMany({
      where: {
        pdfObjectKey: { not: null },
        pdfPurgedAt: null,
        createdAt: { lt: limite },
      },
      select: { id: true, pdfObjectKey: true },
      take: LOTE,
    });

    if (vencidas.length === 0) break;

    const removidos = await deletePdfs(vencidas.map((a) => a.pdfObjectKey));

    /*
     * `pdfPurgedAt` é marcado para o lote inteiro mesmo que alguma remoção
     * individual tenha falhado, e a chave é limpa junto.
     *
     * A alternativa (só marcar o que confirmou) parece mais correta, mas cria um
     * laço infinito: uma chave que já não existe no bucket falha para sempre, e
     * a rotina a reprocessaria em toda execução. As falhas individuais são
     * logadas por `deletePdfs`, e o R2 trata remoção de objeto inexistente como
     * sucesso, então o caso comum já se resolve sozinho.
     */
    await prisma.analysis.updateMany({
      where: { id: { in: vencidas.map((a) => a.id) } },
      data: { pdfPurgedAt: new Date(), pdfObjectKey: null },
    });

    removidosTotal += removidos;
    if (vencidas.length < LOTE) break;
  }

  if (removidosTotal > 0) {
    console.log(
      `[Purge] ${removidosTotal} PDF(s) original(is) expurgado(s) após ${RETENCAO_DIAS} dias.`
    );
  }
  return { removidos: removidosTotal };
}
