// The HTTP client read responses with picohttpparser until it got a parser of its own (src/http1). These tests hold it
// to what picohttpparser did. See record.ts for where the recorded results come from.
import { describe, expect, test } from "bun:test";
import {
  decoded,
  loadParserCases,
  observed,
  parsed,
  recordedPath,
  responses,
  type Client,
  type Delivery,
  type Part,
  type Recorded,
} from "./observe";

// Inputs that together reach every line and branch of src/http1, and of picohttpparser as far as Bun could reach it.
describe("the parser by itself", async () => {
  const cases = await loadParserCases();

  test("response heads", () => {
    expect(cases.heads).toHaveLength(1230);
    const wrong = cases.heads.flatMap(([slots, data, expected]) => {
      const actual = parsed(slots, data);
      return actual === expected ? [] : [{ slots, data, actual, expected }];
    });
    expect(wrong).toEqual([]);
  });

  test("chunked bodies", () => {
    expect(cases.bodies).toHaveLength(621);
    const wrong = cases.bodies.flatMap(([cuts, data, expected]) => {
      const actual = decoded(cuts, data);
      return actual === expected ? [] : [{ cuts, data, actual, expected }];
    });
    expect(wrong).toEqual([]);
  });
});

// Not concurrent, and a few dozen responses per test: a connection takes 20 ms in a debug build.
describe.each<[Client, Part, Delivery]>([
  ["fetch", "heads", "in one write"],
  ["fetch", "heads", "in small pieces"],
  ["fetch", "bodies", "in one write"],
  ["fetch", "bodies", "in small pieces"],
  ["ws", "heads", "in one write"],
  ["ws", "bodies", "in small pieces"],
])("%s: %s %s", async (client, part, delivery) => {
  const recorded: Recorded = await Bun.file(recordedPath).json();
  const perTest = 48;
  const starts = Array.from({ length: Math.ceil(responses[part].length / perTest) }, (_, i) => i * perTest);

  test.each(starts)("from %d", async start => {
    const cases = responses[part].slice(start, start + perTest);
    const expected = Object.fromEntries(cases.map(([label]) => [label, recorded[client][part][label]]));
    expect(await observed(client, cases, delivery)).toEqual(expected);
  });
});
