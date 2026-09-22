import { normalizarChave } from "../services/laudoVerificacao.js";
import { buscarPorChave } from "../services/verificacaoStore.js";
import { prisma } from "../utils/prisma.js";

/**
 * Consulta pública de autenticidade de laudo.
 *
 * Não exige sessão: quem confere é justamente quem não tem conta aqui, como o
 * juízo, a parte contrária e o titular do dado que aparece no contrato.
 *
 * A resposta é montada campo a campo a partir do snapshot já mascarado.
 * Devolver o registro do Prisma com um spread seria o caminho mais curto para
 * vazar `tenantId` e `analysisId` numa rota aberta no dia em que alguém
 * acrescentasse uma coluna.
 */

const NAO_ENCONTRADO = { error: "Nenhum laudo corresponde a este código ou hash." };

const AVISOS = {
  VALIDO:
    "O que se verifica é o conteúdo do laudo, não o arquivo. Confira se o hash e o titular exibidos aqui coincidem com os impressos no documento em mãos.",
  SUBSTITUIDO:
    "Este laudo era autêntico na data de emissão, mas foi reemitido depois de uma correção. Use o laudo com o código indicado abaixo.",
  CANCELADO: "Este laudo foi cancelado pelo emissor e não deve ser usado.",
  DADOS_REMOVIDOS:
    "Os resumos criptográficos continuam conferindo. Os dados do titular foram eliminados a pedido e não são mais exibidos.",
};

function projetar(v) {
  return {
    situacao: v.status,
    codigo: v.codigo,
    protocolo: v.reportId,
    emitidoEm: v.emitidoEm,
    laudo: { sha256: v.laudoHash },
    documentoAnalisado: v.publicSnapshot?.documentoAnalisado ?? { sha256: null, sha1: null },
    titular: v.publicSnapshot?.titular ?? { nome: null, cpf: null },
    emissor: v.publicSnapshot?.emissor ?? "ForenseDoc",
    substituidoPor: v.substituidoPor?.codigo ?? null,
    cancelamento: v.status === "CANCELADO" ? { em: v.canceladoEm, motivo: v.canceladoMotivo } : null,
    aviso: AVISOS[v.status] || AVISOS.VALIDO,
  };
}

export async function consultarLaudo(req, res) {
  const chave = normalizarChave(req.params.chave);

  // Chave malformada nem chega ao banco: economiza a consulta e fecha o canal
  // de medição por tempo de resposta.
  if (!chave.tipo) return res.status(404).json(NAO_ENCONTRADO);

  try {
    const registro = await buscarPorChave(chave);
    if (!registro) return res.status(404).json(NAO_ENCONTRADO);

    /*
     * A consulta entra na trilha de auditoria. Serve para dois fins: detectar
     * tentativa de varredura de códigos e atender o piso do Marco Civil
     * (art. 15) de registros de acesso à aplicação. Guarda o código, nunca o
     * hash inteiro, e a retenção de 365 dias do purgeRecords já cobre a linha.
     */
    prisma.auditLog
      .create({
        data: {
          action: "laudo_verification_lookup",
          ipAddress: req.ip,
          userAgent: req.get("user-agent") || null,
          metadata: { codigo: registro.codigo, situacao: registro.status },
        },
      })
      .catch((erro) => console.error("[Verificacao] Falha ao registrar consulta:", erro.message));

    return res.json(projetar(registro));
  } catch (erro) {
    console.error("[Verificacao] Erro ao consultar laudo:", erro);
    return res.status(500).json({ error: "Erro interno no servidor." });
  }
}
