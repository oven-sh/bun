// Holds src/http1 to what picohttpparser, from which it derives, makes of the same bytes. See record.ts for where the
// inputs and the recorded results come from.
import { describe, expect, test } from "bun:test";
import { decoded, loadParserCases, parsed, parserCasesHash, received } from "./observe";

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

// Neither client parses all it has received after every read. Both have to find what picohttpparser found that way.
describe("the end of a response head", () => {
  const heads = cases.heads.map(([slots, data, recorded]) => [slots, Buffer.from(data, "hex"), recorded] as const);

  test("that comes whole", () => {
    const wrong = heads.flatMap(([slots, data, recorded]) => {
      const actual = received(slots, data, data.length);
      const expected = `${data.length} ${recorded.split(" ")[3] ?? recorded}`;
      return actual.every(found => found === expected) ? [] : [{ slots, data: data.toString("hex"), actual, expected }];
    });
    expect(wrong).toEqual([]);
  });

  test.each([1, 16])("that comes %d bytes at a time", piece => {
    // To parse everything after every piece takes time quadratic in their number.
    const few = heads.filter(([, data]) => data.length / piece <= 300);
    expect(few.length).toBeGreaterThan(5300);
    const wrong = few.flatMap(([slots, data]) => {
      const [expected, ...actual] = received(slots, data, piece);
      return actual.every(found => found === expected) ? [] : [{ slots, data: data.toString("hex"), actual, expected }];
    });
    expect(wrong).toEqual([]);
  });
});

test("chunked bodies", () => {
  const wrong = cases.bodies.flatMap(([cuts, data, expected]) => {
    const actual = decoded(cuts, data);
    return actual === expected ? [] : [{ cuts, data, actual, expected }];
  });
  expect(wrong).toEqual([]);
});
