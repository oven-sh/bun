// Damaged streams, with the output and the error that they give. See record.ts.
// The results are those of zlib-ng 2.3.3.
import { expect, test } from "bun:test";
import { DAMAGES, damagedDifferences, fewerIfSlow, inParts, loadCases } from "./observe";

const cases = (await loadCases()).damaged;

test("there is something to read", () => {
  expect(cases.map(c => c.results.length)).toEqual(Array(260).fill(DAMAGES));
});

test.each(inParts(fewerIfSlow(cases, 9), 5))("part %#", some => {
  expect(damagedDifferences(some)).toBe("");
});
