// What node:zlib's brotli made of many inputs and streams when it was recorded. See record.ts.
import { expect, test } from "bun:test";
import { join } from "node:path";
import { differences, load, observeDecoder, observeEncoder, type DecoderCase, type EncoderCase } from "./cases";

test("the encoder writes the bytes it was recorded to write", async () => {
  const cases = await load<EncoderCase>(join(import.meta.dir, "encoder.json.gz"));
  expect(cases.length).toBeGreaterThan(500);
  const results = [];
  for (const [index, k] of cases.entries()) {
    results.push({ index, expected: k.result, actual: await observeEncoder(k), what: { ...k, result: undefined } });
  }
  expect(differences(results)).toBe("");
}, 120_000);

test("the decoder reads streams the way it was recorded to", async () => {
  const cases = await load<DecoderCase>(join(import.meta.dir, "decoder.json.gz"));
  expect(cases.length).toBeGreaterThan(800);
  const results = cases.map((k, index) => ({
    index,
    expected: k.result,
    actual: observeDecoder(k),
    what: { ...k, result: undefined },
  }));
  expect(differences(results)).toBe("");
}, 60_000);
