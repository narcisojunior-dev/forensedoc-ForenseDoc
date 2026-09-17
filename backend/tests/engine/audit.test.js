import { test } from "vitest";
import assert from "node:assert/strict";
import { extractAuditTrail } from "../../src/engine/audit.js";

const SAMPLE = `
DATA E HORA (UTC) 19/01/2023 17:30:24
Histórico de Ações:
Link aberto 19/01/2023 177.51.242.26:55242 Lon: -42.814516 - Lat: - 5.089356 Android 10 - Chrome 109.0.0.0
16:15 (-03:00)
Resumo Aceito 19/01/2023 177.51.242.26:50474 Lon: -42.814525 - Lat: - 5.089338 Android 10 - Chrome 109.0.0.0
16:17 (-03:00)
Selfie 19/01/2023 Lon: -42.814514 - Lat: - 5.089363 Android 10 - Chrome 109.0.0.0
177.51.242.26:59703 Capturada 16:18 (-03:00)
Processo 19/01/2023 Lon: -42.814529 - Lat: - 5.089341 Android 10 - Chrome 109.0.0.0
177.51.242.26:64599 Finalizado 16:18 (-03:00)`;

test("extracts structured audit events", () => {
  const audit = extractAuditTrail(SAMPLE);
  assert.equal(audit.eventCount, 4);
  assert.deepEqual(audit.uniqueIps, ["177.51.242.26"]);
  assert.deepEqual(audit.ports, ["55242", "50474", "59703", "64599"]);
  assert.equal(audit.events[2].action, "Selfie Capturada");
  assert.equal(audit.events[2].lat, -5.089363);
  assert.equal(audit.events[2].lon, -42.814514);
});

test("detects chronology conflict and device gap", () => {
  const audit = extractAuditTrail(SAMPLE);
  assert.equal(audit.chronologyInconsistent, true);
  assert.equal(audit.signatureLocalTime, "14:30");
  assert.equal(audit.device, "Android 10 · Chrome 109");
  assert.equal(audit.deviceIdentifiable, false);
});

test("calculates GPS dispersion", () => {
  const audit = extractAuditTrail(SAMPLE);
  assert.equal(audit.coordinateCount, 4);
  assert.ok(audit.northSouthMeters > 0);
  assert.ok(audit.eastWestMeters > 0);
});
