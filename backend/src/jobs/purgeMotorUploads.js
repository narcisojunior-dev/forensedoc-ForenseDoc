import path from "node:path";
import { readdir, rm, stat } from "node:fs/promises";

/**
 * Varredura dos arquivos transitórios do motor pericial v2.
 *
 * O PDF do processo (confronto) e os autos da réplica existem só durante o job:
 * o worker os apaga no `finally`. Se o processo morrer no meio (deploy, falta de
 * memória), o `finally` não roda, e nada no banco aponta para esses arquivos,
 * então o expurgo de uploads, que é guiado pelas análises, nunca os alcançaria.
 * Seriam autos processuais de terceiros guardados sem prazo.
 *
 * O prazo aqui é curto de propósito: nenhum desses arquivos tem uso depois que
 * o job termina, e o pior caso de processamento é da ordem de minutos.
 */
export const PRAZO_TRANSITORIO_HORAS = Number(process.env.MOTOR_UPLOAD_MAX_AGE_HOURS) || 24;

const PROCESSO = /-processo-[0-9a-f]+\.pdf$/;

async function entradas(dir) {
  try {
    return await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

async function antigo(caminho, limite) {
  try {
    return (await stat(caminho)).mtimeMs < limite;
  } catch {
    return false;
  }
}

/**
 * Estrutura das chaves: `<tenant>/<dia>/<análise>-processo-<rand>.pdf` e
 * `<tenant>/<dia>/replicas/<réplica>/<nnn>.<ext>`.
 *
 * @param {string} [raiz] diretório de uploads (padrão: UPLOAD_DIR)
 * @param {number} [agora] relógio injetável para teste
 */
export async function processMotorUploadPurge(
  raiz = path.resolve(process.env.UPLOAD_DIR || "./data/uploads"),
  agora = Date.now()
) {
  const limite = agora - PRAZO_TRANSITORIO_HORAS * 3600 * 1000;
  let removidos = 0;

  for (const tenant of await entradas(raiz)) {
    if (!tenant.isDirectory()) continue;
    const dirTenant = path.join(raiz, tenant.name);
    for (const dia of await entradas(dirTenant)) {
      if (!dia.isDirectory()) continue;
      const dirDia = path.join(dirTenant, dia.name);

      for (const item of await entradas(dirDia)) {
        const caminho = path.join(dirDia, item.name);
        if (item.isFile() && PROCESSO.test(item.name) && (await antigo(caminho, limite))) {
          await rm(caminho, { force: true });
          removidos += 1;
        }
      }

      const dirReplicas = path.join(dirDia, "replicas");
      for (const replica of await entradas(dirReplicas)) {
        const caminho = path.join(dirReplicas, replica.name);
        if (replica.isDirectory() && (await antigo(caminho, limite))) {
          await rm(caminho, { recursive: true, force: true });
          removidos += 1;
        }
      }
    }
  }

  if (removidos > 0) {
    console.log(`[Purge] ${removidos} arquivo(s) transitório(s) do motor pericial removido(s).`);
  }
  return { removidos };
}
