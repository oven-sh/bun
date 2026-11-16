// WebP files of every kind, well formed and not, with what Bun.Image makes of each, and pictures with the file that
// Bun.Image writes for each. See record.ts. By the start of a case's name, the files to decode:
//   encoded/   made-up pictures, written by libwebp 1.6.0 with settings chosen at random
//   random/    valid streams of modes, coefficients, transforms, prefix codes and copies chosen at random
//   handmade/  at the limits of the format and beyond
//   changed/   the above with bytes changed at random
//   extreme/   what no encoder writes, for the same result on every CPU
// and the pictures to encode:
//   layers/, noise/, sequence/  made by the function of that name in picture.ts
//   stored/, large/             made for a decision of an encoder that nothing else gets to
//
// Nearly all results are those of libwebp 1.6.0 with
// https://github.com/webmproject/libwebp/commit/80bda3fdb882bc4131b223124c0411ac8b366386. A case is here because it
// tells src/webp and its kernels from a version with one small mistake, or takes a branch that no other takes.
import { describe, expect, test } from "bun:test";
import { decodeDifferences, encodeDifferences, inParts, loadCases } from "./observe";

const cases = await loadCases();

describe("Bun.Image reads and writes WebP the way it was recorded to", () => {
  test("decode", async () => {
    expect(cases.decode.length).toBe(354);
    expect(await decodeDifferences(cases.decode)).toBe("");
  });

  test("there is something to encode", () => {
    const kinds = Object.entries(Object.groupBy(cases.encode, c => c.name.split("/")[0]));
    expect(Object.fromEntries(kinds.map(([kind, some]) => [kind, some!.length]))).toEqual({
      layers: 285,
      sequence: 36,
      noise: 9,
      stored: 29,
      large: 12,
    });
  });

  // webp-golden-large.test.ts has the others.
  test.each(inParts(cases.encode, ["layers", "noise", "stored"], 80))("encode, part %#", async some => {
    expect(await encodeDifferences(some)).toBe("");
  });
});
