import crypto from "node:crypto";
import "dotenv/config";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
} from "@aws-sdk/client-s3";

/**
 * Armazenamento do PDF enviado, em Cloudflare R2.
 *
 * ─── Por que o arquivo saiu da fila ──────────────────────────────────────────
 *
 * O PDF trafegava dentro do payload do job, em base64. O BullMQ guarda o payload
 * no Redis, que é MEMÓRIA: base64 acrescenta cerca de 33%, então um PDF de 30 MB
 * ocupava perto de 40 MB de RAM enquanto o job estivesse enfileirado, e cem
 * análises em pico chegavam a aproximadamente 4 GB.
 *
 * O Redis também guarda sessão, rate limit e cache. Quando ele estoura a
 * memória, começa a despejar chaves, e a degradação aparece como sintomas
 * espalhados (usuário deslogado, rate limit sumindo, cache frio) sem nada apontar
 * para a causa. Agora o job carrega só a chave do objeto, algumas dezenas de
 * bytes.
 *
 * ─── R2 e não S3 ─────────────────────────────────────────────────────────────
 *
 * A API é a mesma (o R2 é compatível com S3), e a diferença que pesa é o egresso:
 * o R2 não cobra transferência de saída. Cada PDF é lido ao menos uma vez pelo
 * worker, e potencialmente de novo a cada regeração de laudo.
 *
 * ─── Degradação sem credenciais ──────────────────────────────────────────────
 *
 * Sem as variáveis configuradas, `isConfigured()` devolve false e o sistema volta
 * ao caminho anterior (base64 no payload). É o que mantém o ambiente de
 * desenvolvimento e a suíte de testes funcionando sem conta na Cloudflare, e o
 * que evita que uma credencial ausente em produção derrube a análise inteira em
 * vez de apenas piorar o consumo de memória.
 */

const {
  R2_ACCOUNT_ID,
  R2_ACCESS_KEY_ID,
  R2_SECRET_ACCESS_KEY,
  R2_BUCKET,
} = process.env;

/**
 * Retenção do PDF ORIGINAL.
 *
 * Prazo curto por decisão de proteção de dados, não por economia: o arquivo é o
 * dossiê do banco e carrega dado pessoal de terceiro (CPF, endereço, biometria
 * declarada). O laudo já preserva o SHA-256 e o SHA-1 do arquivo, então a
 * integridade continua demonstrável depois que o original for apagado.
 *
 * A janela existe para o que precisa do arquivo em si: regerar o laudo após
 * correção da coordenada de referência, refazer a extração depois de um ajuste,
 * e responder a contestação imediata do cliente.
 *
 * Ver o documento de auditoria, §12.6, para o racional completo e para a
 * distinção entre controlador e operador.
 */
export const RETENCAO_DIAS = Number(process.env.R2_RETENTION_DAYS) || 90;

let cliente = null;

export function isConfigured() {
  return Boolean(R2_ACCOUNT_ID && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY && R2_BUCKET);
}

function getClient() {
  if (!isConfigured()) return null;
  if (!cliente) {
    cliente = new S3Client({
      region: "auto", // R2 não usa regiões no sentido da AWS
      endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: R2_ACCESS_KEY_ID,
        secretAccessKey: R2_SECRET_ACCESS_KEY,
      },
    });
  }
  return cliente;
}

/**
 * Chave do objeto.
 *
 * Prefixada por tenant para que uma política de exclusão em massa (encerramento
 * de contrato, pedido de eliminação sob a LGPD) seja um prefixo, e não uma
 * varredura do bucket inteiro. A data facilita inspeção manual e eventual regra
 * de ciclo de vida no bucket.
 *
 * O nome do arquivo NÃO entra na chave: nomes de dossiê costumam trazer o nome
 * do contratante e o número do contrato, e a chave aparece em log, em métrica e
 * na listagem do bucket.
 */
export function buildKey(tenantId, analysisId) {
  const dia = new Date().toISOString().slice(0, 10);
  const aleatorio = crypto.randomBytes(6).toString("hex");
  return `uploads/${tenantId}/${dia}/${analysisId}-${aleatorio}.pdf`;
}

/**
 * Envia o PDF. Devolve a chave, ou null se o armazenamento não estiver
 * configurado ou o envio falhar (o chamador cai no payload em base64).
 */
export async function putPdf(key, buffer) {
  const s3 = getClient();
  if (!s3) return null;

  try {
    await s3.send(
      new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: key,
        Body: buffer,
        ContentType: "application/pdf",
        // Metadado informativo: quem inspecionar o bucket vê o prazo previsto
        // sem precisar consultar o banco.
        Metadata: { retencao_dias: String(RETENCAO_DIAS) },
      })
    );
    return key;
  } catch (err) {
    console.error("[R2] Falha ao enviar PDF:", err.message);
    return null;
  }
}

/** Baixa o PDF. Lança se falhar: sem o arquivo não há análise a fazer. */
export async function getPdf(key) {
  const s3 = getClient();
  if (!s3) throw new Error("Armazenamento de objetos não configurado.");

  const resposta = await s3.send(new GetObjectCommand({ Bucket: R2_BUCKET, Key: key }));
  const partes = [];
  for await (const parte of resposta.Body) partes.push(parte);
  return Buffer.concat(partes);
}

export async function deletePdf(key) {
  const s3 = getClient();
  if (!s3 || !key) return;
  try {
    await s3.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: key }));
  } catch (err) {
    console.error(`[R2] Falha ao apagar '${key}':`, err.message);
  }
}

/**
 * Apaga em lote. Devolve quantos foram efetivamente removidos.
 *
 * A API aceita no máximo mil chaves por chamada, e a rotina de expurgo pode ter
 * muito mais que isso num dia de volume alto.
 */
export async function deletePdfs(keys) {
  const s3 = getClient();
  if (!s3 || !keys?.length) return 0;

  let removidos = 0;
  for (let i = 0; i < keys.length; i += 1000) {
    const lote = keys.slice(i, i + 1000);
    try {
      const r = await s3.send(
        new DeleteObjectsCommand({
          Bucket: R2_BUCKET,
          Delete: { Objects: lote.map((Key) => ({ Key })), Quiet: true },
        })
      );
      removidos += lote.length - (r.Errors?.length || 0);
      for (const erro of r.Errors || []) {
        console.error(`[R2] Falha ao apagar '${erro.Key}': ${erro.Message}`);
      }
    } catch (err) {
      console.error("[R2] Falha no expurgo em lote:", err.message);
    }
  }
  return removidos;
}
