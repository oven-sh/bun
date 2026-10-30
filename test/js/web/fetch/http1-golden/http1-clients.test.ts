// What `fetch()` and `ws` make of a response for every verdict and quirk of the parser, as recorded with the last Bun
// that read responses with picohttpparser. See record.ts.
import { describe, expect, test } from "bun:test";
import { observed, recordedPath, responses, type Client, type Delivery, type Part, type Recorded } from "./observe";

const recorded: Recorded = await Bun.file(recordedPath).json();

// Not concurrent, and a few dozen responses per test: a connection takes 20 ms in a debug build.
describe.each<[Client, Part, Delivery]>([
  ["fetch", "heads", "in one write"],
  ["fetch", "heads", "in small pieces"],
  ["fetch", "bodies", "in one write"],
  ["fetch", "bodies", "in small pieces"],
  ["ws", "heads", "in one write"],
  ["ws", "heads", "in small pieces"],
  ["ws", "bodies", "in one write"],
  ["ws", "bodies", "in small pieces"],
])("%s: %s %s", (client, part, delivery) => {
  const perTest = 48;
  const starts = Array.from({ length: Math.ceil(responses[part].length / perTest) }, (_, i) => i * perTest);

  test("there is a recorded result for every response and no other", () => {
    expect(responses[part].length).toBeGreaterThan(90);
    expect(Object.keys(recorded[client][part])).toEqual(responses[part].map(([label]) => label));
  });

  test.each(starts)("from %d", async start => {
    const cases = responses[part].slice(start, start + perTest);
    const expected = Object.fromEntries(cases.map(([label]) => [label, recorded[client][part][label]]));
    expect(await observed(client, cases, delivery)).toEqual(expected);
  });
});
