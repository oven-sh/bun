// What node:zlib's brotli made of many inputs and streams when it was recorded. See record.ts.
import { expect, test } from "bun:test";
import { join } from "node:path";
import {
  differences,
  generateEncoderCases,
  load,
  observeDecoder,
  observeEncoder,
  type DecoderCase,
  type EncoderCase,
} from "./cases";

const encoderCases = await load<EncoderCase>(join(import.meta.dir, "encoder.json.gz"));
const decoderCases = await load<DecoderCase>(join(import.meta.dir, "decoder.json.gz"));

/** `[first, end]` of each run of `size` out of `count`. */
const runs = (count: number, size: number) =>
  Array.from({ length: Math.ceil(count / size) }, (_, i) => [i * size, Math.min(count, (i + 1) * size)]);

async function check<Case extends { result?: string }>(
  cases: Case[],
  first: number,
  end: number,
  observe: (k: Case) => Promise<string>,
) {
  const results = [];
  for (let index = first; index < end; index++) {
    const { result: expected, ...what } = cases[index];
    results.push({ index, expected, actual: await observe(cases[index]), what });
  }
  expect(differences(results)).toBe("");
}

test("the recorded cases are those of cases.ts", () => {
  expect(encoderCases.map(({ result, ...k }) => k)).toEqual(generateEncoderCases());
  expect(decoderCases.length).toBe(604);
});

test.each(runs(encoderCases.length, 32))(
  "the encoder writes the bytes it was recorded to write: cases %i to %i",
  (first, end) => check(encoderCases, first, end, observeEncoder),
);

test.each(runs(decoderCases.length, 128))(
  "the decoder reads streams the way it was recorded to: cases %i to %i",
  (first, end) => check(decoderCases, first, end, observeDecoder),
);
