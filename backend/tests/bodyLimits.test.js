import { describe, it, expect, vi } from "vitest";
import express from "express";
import request from "supertest";

/**
 * Limites de corpo por rota — e a regressão que eles causaram.
 *
 * A correção M6 baixou o teto global para 1 MB e declarou um parser de ~42 MB
 * só em /analyze. Só que o parser global roda ANTES do roteador: ele derrubava
 * o upload de PDF com 413 antes de a rota ser escolhida, e o parser grande
 * nunca era usado. Resultado: a funcionalidade central do produto quebrada.
 *
 * Estes testes fixam as três propriedades que precisam valer ao mesmo tempo:
 *   1. /analyze aceita corpo grande;
 *   2. as demais rotas continuam limitadas a 1 MB;
 *   3. requisição anônima é recusada ANTES de o corpo ser materializado.
 */

function makeApp({ onAnalyze = (_req, res) => res.status(202).end() } = {}) {
  const app = express();

  // Réplica do arranjo de server.js + routes/index.js.
  const jsonParser = express.json({ limit: "1mb" });
  app.use((req, res, next) => {
    if (req.path === "/api/analyze") return next();
    return jsonParser(req, res, next);
  });

  const requireAuth = (req, res, next) =>
    req.headers.authorization ? next() : res.status(401).json({ error: "Token ausente." });

  const analyzeBodyParser = express.json({ limit: "42mb" });

  app.post("/api/analyze", requireAuth, analyzeBodyParser, onAnalyze);
  app.post("/api/auth/login", (_req, res) => res.status(200).end());

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => res.status(err.status || 500).end());
  return app;
}

const corpoDe = (mb) => ({ pdfBase64: "A".repeat(mb * 1024 * 1024) });

describe("limites de corpo por rota", () => {
  it("/analyze aceita corpo acima do teto global", async () => {
    const r = await request(makeApp())
      .post("/api/analyze")
      .set("Authorization", "Bearer x")
      .send(corpoDe(3));

    expect(r.status).toBe(202);
  });

  it("o parser grande realmente entrega o corpo ao handler", async () => {
    const handler = vi.fn((req, res) => res.status(202).json({ bytes: req.body.pdfBase64.length }));
    const r = await request(makeApp({ onAnalyze: handler }))
      .post("/api/analyze")
      .set("Authorization", "Bearer x")
      .send(corpoDe(2));

    // Sem isto, um 202 poderia mascarar um corpo vazio.
    expect(handler).toHaveBeenCalled();
    expect(r.body.bytes).toBe(2 * 1024 * 1024);
  });

  it("as demais rotas continuam limitadas a 1 MB", async () => {
    const r = await request(makeApp())
      .post("/api/auth/login")
      .send({ email: "a@b.com", password: "x".repeat(2 * 1024 * 1024) });

    expect(r.status).toBe(413);
  });

  /**
   * Recusar sem ler o corpo tem um efeito colateral no cliente: o servidor
   * responde e fecha a conexão enquanto o upload ainda está sendo escrito, e o
   * socket morre com ECONNRESET antes de a resposta ser lida.
   *
   * Isso é o comportamento DESEJADO — é a prova de que os megabytes não foram
   * consumidos —, mas torna o status inobservável de forma intermitente. Por
   * isso os dois desfechos são aceitos: o que não pode acontecer é 413 (parser
   * global engoliu o corpo) ou 202 (o handler rodou sem autenticação).
   */
  async function statusOuReset(req) {
    try {
      return (await req).status;
    } catch (err) {
      if (["ECONNRESET", "EPIPE"].includes(err.code)) return "reset";
      throw err;
    }
  }

  it("requisição anônima em /analyze não é aceita nem parseada", async () => {
    const status = await statusOuReset(
      request(makeApp()).post("/api/analyze").send(corpoDe(3))
    );

    expect(["reset", 401]).toContain(status);
    expect(status).not.toBe(413); // 413 significaria parser global no caminho
  });

  it("o handler nem é alcançado sem autenticação", async () => {
    // A asserção que importa é sobre o handler, não sobre o status — ela vale
    // mesmo quando a conexão morre antes da resposta chegar ao cliente.
    const handler = vi.fn((_req, res) => res.status(202).end());
    await statusOuReset(
      request(makeApp({ onAnalyze: handler })).post("/api/analyze").send(corpoDe(3))
    );

    expect(handler).not.toHaveBeenCalled();
  });
});
