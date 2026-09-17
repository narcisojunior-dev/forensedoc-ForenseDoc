/**
 * Rotas que recebem arquivo em base64 e aplicam parser próprio, maior que o
 * teto global de 1 MB.
 *
 * O parser global roda ANTES do roteador; qualquer rota de upload que não
 * esteja aqui recebe 413 antes de ser escolhida, e o parser declarado nela nunca
 * chega a ser usado (ver tests/bodyLimits.test.js).
 *
 * A lista é por método e caminho exatos: liberar um prefixo inteiro daria a
 * rotas de leitura um corpo que elas não têm motivo para aceitar.
 */
const ROTAS_DE_UPLOAD = [
  { metodo: "POST", caminho: /^\/api\/analyze$/ },
  // Motor pericial v2: PDF do processo judicial para confronto.
  { metodo: "POST", caminho: /^\/api\/analyses\/[^/]+\/process-comparison$/ },
  // Réplica processual: autos (inicial, contestação, documentos).
  { metodo: "POST", caminho: /^\/api\/replicas\/?$/ },
];

export function usaParserProprio(req) {
  return ROTAS_DE_UPLOAD.some(({ metodo, caminho }) => {
    // /api/analyze mantém o comportamento anterior, que não olhava o método.
    const metodoConfere = caminho.source === "^\\/api\\/analyze$" || req.method === metodo;
    return metodoConfere && caminho.test(req.path);
  });
}
