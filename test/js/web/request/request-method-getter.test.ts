import { heapStats } from "bun:jsc";
import { expect, test } from "bun:test";
import { isASAN, isDebug } from "harness";

// A getter that allocates one JSString per call leaves `iterations` live
// strings behind, 8x the budget. The cached string adds none (a handful of
// unrelated strings is the observed noise).
const iterations = isASAN || isDebug ? 1024 : 8192;
const budget = iterations / 8;

// [constructor arguments after the URL, expected `method`]
const cases: [[] | [RequestInit], string][] = [
  [[], "GET"],
  [[{ method: "GET" }], "GET"],
  [[{ method: "POST" }], "POST"],
  // The constructor normalizes a lowercase method to the uppercase form.
  [[{ method: "post" }], "POST"],
];

function liveStrings(): number {
  Bun.gc(true);
  return heapStats().objectTypeCounts.string;
}

// Keeping every returned string alive makes the count independent of GC
// timing: a per-call allocation stays live until the final reading.
function measure(read: () => string) {
  const samples: string[] = [];
  const before = liveStrings();
  for (let i = 0; i < iterations; i++) {
    samples.push(read());
  }
  const growth = liveStrings() - before;
  return { distinct: [...new Set(samples)], growth };
}

test.each(cases)(
  "new Request(url, ...%j).clone().method is %s and does not allocate a JSString per call",
  (init, method) => {
    const request = new Request("http://localhost:3000/", ...init);
    expect(request.method).toBe(method);

    const { distinct, growth } = measure(() => request.clone().method);

    expect(distinct).toEqual([request.method]);
    expect(growth, `${growth} new JSStrings after ${iterations} clone().method reads`).toBeLessThan(budget);
  },
);

test.each(cases)("new Request(url, ...%j).method is %s and does not allocate a JSString per call", (init, method) => {
  const { distinct, growth } = measure(() => new Request("http://localhost:3000/", ...init).method);

  expect(distinct).toEqual([method]);
  expect(growth, `${growth} new JSStrings after ${iterations} new Request().method reads`).toBeLessThan(budget);
});
