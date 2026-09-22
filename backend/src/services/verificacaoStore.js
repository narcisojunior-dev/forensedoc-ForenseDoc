import { prisma } from "../utils/prisma.js";
import { hashDoLaudo, gerarCodigo, montarSnapshotPublico } from "./laudoVerificacao.js";

/**
 * Único módulo que escreve e lê `laudo_verifications`.
 *
 * A concentração é intencional: a regra de "o que pode aparecer na página
 * pública" tem que ter um lugar só. Espalhar consultas a esta tabela pelos
 * controllers seria o caminho mais curto para alguém devolver o registro
 * inteiro, com `tenantId` e `analysisId`, numa rota sem autenticação.
 */

/**
 * @param {object} params
 * @param {string} params.analysisId
 * @param {string} params.tenantId
 * @param {object} params.result   snapshot persistido em analyses.result
 * @param {string} [params.substituindo] id da verificação que esta aposenta
 */
export async function emitirVerificacao({ analysisId, tenantId, result, substituindo = null }) {
  const nova = await prisma.laudoVerification.create({
    data: {
      codigo: gerarCodigo(),
      laudoHash: hashDoLaudo(result),
      reportId: result?.reportId || "",
      emitidoEm: result?.generatedAt ? new Date(result.generatedAt) : new Date(),
      publicSnapshot: montarSnapshotPublico(result),
      status: "VALIDO",
      analysisId,
      tenantId,
    },
  });

  // A anterior só é aposentada DEPOIS de a nova existir. Na ordem inversa, uma
  // falha no meio deixaria o laudo que já circulou marcado como substituído
  // por nada, e a página diria "substituído" sem ter o que mostrar no lugar.
  if (substituindo) {
    await prisma.laudoVerification.update({
      where: { id: substituindo },
      data: { status: "SUBSTITUIDO", substituidoPorId: nova.id },
    });
  }

  return nova;
}

export async function buscarPorChave({ tipo, valor }) {
  if (!tipo || !valor) return null;
  const where = tipo === "hash" ? { laudoHash: valor } : { codigo: valor };
  return prisma.laudoVerification.findUnique({
    where,
    // Só o código da substituta. Um include aberto traria o registro inteiro
    // da outra linha para dentro de uma rota sem autenticação.
    include: { substituidoPor: { select: { codigo: true } } },
  });
}

/**
 * Reemite a verificação depois de o laudo ser recalculado.
 *
 * `recomputeDerived` roda em toda correção de coordenada e de campo, inclusive
 * quando o usuário confirma o valor que já estava lá. Comparar o hash antes de
 * emitir evita invalidar um laudo que continua idêntico: quem tem o documento
 * impresso não deveria ver "substituído" porque alguém abriu a tela de revisão
 * e clicou em salvar sem mudar nada.
 */
export async function substituirVerificacaoVigente(analysisId, tenantId, result) {
  const vigente = await prisma.laudoVerification.findFirst({
    where: { analysisId, status: "VALIDO" },
  });

  const hashNovo = hashDoLaudo(result);
  if (vigente && vigente.laudoHash === hashNovo) return vigente;

  return emitirVerificacao({ analysisId, tenantId, result, substituindo: vigente?.id || null });
}

export async function cancelarVerificacao(codigo, motivo) {
  return prisma.laudoVerification.update({
    where: { codigo },
    data: { status: "CANCELADO", canceladoEm: new Date(), canceladoMotivo: motivo },
  });
}

/**
 * Eliminação a pedido do titular (LGPD, art. 18, VI).
 *
 * Os hashes ficam. Um resumo criptográfico não identifica ninguém sozinho, e é
 * o que permite a quem recebeu o laudo continuar conferindo que o documento em
 * mãos é o que foi emitido. O que sai é o titular mascarado e o vínculo com o
 * tenant, que são os dados pessoais do registro.
 */
export async function anonimizarVerificacao(id) {
  const atual = await prisma.laudoVerification.findUnique({ where: { id } });
  if (!atual) return null;

  return prisma.laudoVerification.update({
    where: { id },
    data: {
      status: "DADOS_REMOVIDOS",
      dadosRemovidosEm: new Date(),
      tenantId: null,
      publicSnapshot: {
        ...atual.publicSnapshot,
        titular: { nome: null, cpf: null },
      },
    },
  });
}
