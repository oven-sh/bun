// The cases of zstd-golden.test.ts that take longer.
import { expect, test } from "bun:test";
import { encodeDifferences, inParts, loadCases } from "./observe";

const { encode } = await loadCases();

test.each(inParts(encode, ["workers"], 10))("zstd compresses the way it was recorded to, part %#", async some => {
  expect(await encodeDifferences(some)).toBe("");
});
