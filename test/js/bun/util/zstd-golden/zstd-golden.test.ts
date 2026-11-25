// Made-up data with what Bun's zstd compresses it to, and made-up frames, well formed and not, with what it makes of
// each. See record.ts. By the start of a case's name, the data to compress, which source.ts generates:
//   mixed/    with levels and parameters chosen at random
//   small/    with small windows and tables, which little data fills up
//   workers/  on several threads
// and the frames to decompress:
//   stored/   of blocks, tables and sequences chosen at random, some with a field or a byte changed
//   encoded/  what such data compresses to, some with a bit changed or the end cut off
//
// The results are those of zstd 1.5.7. A case is here because it tells src/zstd from a version with one small mistake,
// or takes a branch that no other takes.
import { describe, expect, test } from "bun:test";
import { decodeDifferences, encodeDifferences, inParts, loadCases } from "./observe";

const cases = await loadCases();

describe("zstd compresses and decompresses the way it was recorded to", () => {
  test("there are cases of all kinds", () => {
    const kinds = Object.entries(Object.groupBy([...cases.encode, ...cases.decode], c => c.name.split("/")[0]));
    expect(Object.fromEntries(kinds.map(([kind, some]) => [kind, some!.length]))).toEqual({
      mixed: 152,
      small: 100,
      workers: 38,
      encoded: 32,
      stored: 136,
    });
  });

  // zstd-golden-mixed.test.ts and zstd-golden-workers.test.ts have the others.
  test.each(inParts(cases.encode, ["small"], 30))("compress, part %#", async some => {
    expect(await encodeDifferences(some)).toBe("");
  });

  test.each(inParts(cases.decode, ["stored", "encoded"], 40))("decompress, part %#", async some => {
    expect(await decodeDifferences(some)).toBe("");
  });
});
