// More of zlib-golden-steps.test.ts. Each case tells src/zlib from a version with one small mistake that the others
// let through, so all builds get all of them.
import { expect, test } from "bun:test";
import { deflateDifferences, inParts, loadCases } from "./observe";

const cases = (await loadCases()).rare;

test("there is something to compress", () => {
  expect(cases.length).toBe(91);
});

test.each(inParts(cases, 10))("part %#", some => {
  expect(deflateDifferences(some)).toBe("");
});
