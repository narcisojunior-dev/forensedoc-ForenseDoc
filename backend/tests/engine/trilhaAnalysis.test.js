import { test } from "vitest";
import assert from "node:assert/strict";
import { parseUserAgent, assessPlatformIndependence, buildAcceptanceTimeline, formatDurationPt } from "../../src/engine/trilhaAnalysis.js";

// User-agent do dossiê Facta citado no relatório técnico de 09/09/2026.
const FACTA_UA = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Mobile Safari/537.36";

test("lê Android e versão do Chrome, mas não inventa um modelo de aparelho", () => {
  const result = parseUserAgent(FACTA_UA);
  assert.equal(result.android, "10");
  assert.equal(result.chrome, "116.0.0.0");
  assert.equal(result.modelo, null);
  assert.match(result.resumo, /Chrome Mobile 116/);
  assert.match(result.resumo, /Android 10/);
  assert.match(result.resumo, /modelo não identificado/);
});

test("identifica quando o validador pertence ao próprio credor", () => {
  const result = assessPlatformIndependence("https://validador.factafinanceira.com.br/contrato/visualizar/abc", "Facta Financeira S.A. Crédito, Financiamento e Investimento");
  assert.equal(result.dominio, "validador.factafinanceira.com.br");
  assert.equal(result.pertenceAoCredor, true);
  assert.match(result.nota, /n[aã]o [ée] um terceiro independente/);
});

test("não acusa vínculo com o credor quando o domínio é de terceiro", () => {
  const result = assessPlatformIndependence("https://assinatura.clicksign.com/x", "Facta Financeira S.A.");
  assert.equal(result.pertenceAoCredor, false);
});

test("monta a linha do tempo do dossiê Facta: 4 min 32 s no total, 6 s até o primeiro aceite", () => {
  const timeline = buildAcceptanceTimeline([
    { label: "Acesso ao APP", value: "17/10/2023 12:24:25" },
    { label: "Aceite dos Termos e Condições", value: "17/10/2023 12:24:31" },
    { label: "Aceite e emissão da CCB", value: "17/10/2023 12:24:54" },
    { label: "Assinatura", value: "17/10/2023 12:28:57" },
  ]);
  assert.equal(timeline.totalSeconds, 272);
  assert.equal(timeline.firstIntervalSeconds, 6);
  assert.equal(formatDurationPt(timeline.totalSeconds), "4 min 32 s");
  assert.equal(formatDurationPt(timeline.firstIntervalSeconds), "6 s");
});

test("sem pelo menos dois carimbos de tempo válidos, não monta linha do tempo", () => {
  assert.equal(buildAcceptanceTimeline([{ label: "Único", value: "17/10/2023 12:24:25" }]), null);
  assert.equal(buildAcceptanceTimeline([]), null);
});
