import { test } from "vitest";
import assert from "node:assert/strict";
import { extractCoordinates, parseCoordinate } from "../../src/engine/geo.js";

test("extracts labeled decimal coordinates", () => {
  assert.deepEqual(extractCoordinates("Latitude: -3.731862 Longitude: -38.526670"), { lat: -3.731862, lon: -38.52667 });
});

test("extracts decimal comma coordinates", () => {
  assert.deepEqual(extractCoordinates("lat -3,731862; lng -38,526670"), { lat: -3.731862, lon: -38.52667 });
});

test("extracts a coordinate pair from a map URL", () => {
  assert.deepEqual(extractCoordinates("https://maps.example/?q=-3.731862%2C-38.526670"), { lat: -3.731862, lon: -38.52667 });
});

test("converts DMS and hemisphere coordinates", () => {
  const result = extractCoordinates("Latitude 3°43'54.7\"S Longitude 38°31'36.0\"O");
  assert.ok(Math.abs(result.lat - -3.731861) < 0.00001);
  assert.ok(Math.abs(result.lon - -38.526667) < 0.00001);
});

test("rejects values outside geographic limits", () => {
  assert.equal(parseCoordinate("-93.1000", "lat"), null);
  assert.equal(extractCoordinates("geolocalização da assinatura presente"), null);
});

test("does not fabricate coordinates from IP octets", () => {
  const text = "IP: 177.54.151.211, 64.252.179.152, 10.42.92.128, ::ffff:127.0.0.1";
  assert.equal(extractCoordinates(text), null);
});

test("rejects labeled coordinates outside Brazil for Brazilian banking contracts", () => {
  assert.equal(extractCoordinates("Geolocalização: 51.211000, 64.252000"), null);
});

test("accepts labeled Brazilian coordinates with enough precision", () => {
  assert.deepEqual(extractCoordinates("Geolocalização: -5.566700, -42.616700"), { lat: -5.5667, lon: -42.6167 });
});
