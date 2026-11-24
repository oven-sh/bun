// The cases of webp-golden.test.ts that take longer.
import { expect, test } from "bun:test";
import { isDebug } from "harness";
import { encodeDifferences, inParts, loadCases, sourceOf } from "./observe";

const cases = await loadCases();

test.each(inParts(cases.encode, ["sequence"], 11))("encode sequences, part %#", async some => {
  expect(await encodeDifferences(some)).toBe("");
});

test("encode up to 16 megapixels", async () => {
  const [[large]] = inParts(cases.encode, ["large"], 12);
  const sizes = await Promise.all(large.map(c => new Bun.Image(sourceOf(c)).metadata()));
  // The largest take a debug build 2 to 6 seconds each.
  const some = large.filter((_, i) => !isDebug || sizes[i].width * sizes[i].height < 7e6);
  expect(some.length).toBe(isDebug ? 9 : 12);
  expect(await encodeDifferences(some)).toBe("");
});
