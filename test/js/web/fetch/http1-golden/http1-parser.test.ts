// Holds src/http1 to what picohttpparser, from which it derives, makes of the same bytes. See record.ts for where the
// inputs and the recorded results come from.
import { expect, test } from "bun:test";
import { decoded, loadParserCases, parsed, parserCasesHash } from "./observe";

const cases = await loadParserCases();

// Whoever records them again with the code under test has to say so here.
test("the recorded results are the ones that picohttpparser printed", async () => {
  expect(await parserCasesHash()).toBe("c337a2d1732547c9cd862747f08a7e5ecc9b23c270049c2e8e2111fcbd64bb37");
  expect([cases.heads.length, cases.bodies.length]).toEqual([5326, 5741]);
});

test("response heads", () => {
  const wrong = cases.heads.flatMap(([slots, data, expected]) => {
    const actual = parsed(slots, data);
    return actual === expected ? [] : [{ slots, data, actual, expected }];
  });
  expect(wrong).toEqual([]);
});

test("chunked bodies", () => {
  const wrong = cases.bodies.flatMap(([cuts, data, expected]) => {
    const actual = decoded(cuts, data);
    return actual === expected ? [] : [{ cuts, data, actual, expected }];
  });
  expect(wrong).toEqual([]);
});
