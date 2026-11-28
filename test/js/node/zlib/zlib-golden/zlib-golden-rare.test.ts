// More of zlib-golden-steps.test.ts, for corners of zlib-ng's way to compress. All builds get all of them.
import { expect, test } from "bun:test";
import { deflateDifferences, inParts, loadCases } from "./observe";

const cases = (await loadCases()).rare;

test("there is something to compress", () => {
  expect(cases.length).toBe(91);
});

test.each(inParts(cases, 10))("part %#", some => {
  expect(deflateDifferences(some)).toBe("");
});
