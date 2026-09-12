import { expect, test } from "bun:test";
import { isASAN, isDebug, rss } from "harness";

const MB = 1024 * 1024;

// This file guards the leak fixed in #12387: `new Request(request)` orphaned the
// body slot that the constructor allocates before it copies the input. The slot
// is a 184 byte `HiveRef<Body.Value>` in release builds (400 bytes in debug
// builds), which mimalloc serves from its 192 byte class. A build with the bug
// therefore grows by `iterations * 192` bytes during the measured loop.
const leakedBytesPerIteration = 192;

// Release builds run the full loop. The leak above grows RSS by 18 MB. A clean
// run grows by 0 MB, give or take 1 MB of allocator jitter, so a limit of half
// the leak keeps a wide margin on both sides.
//
// Debug builds construct a Request about 100x slower than release, and ASAN's
// quarantine keeps every block the loop frees resident, so RSS cannot separate
// a 192 byte per iteration leak from the noise there. Those builds run a short
// loop, and the RSS check is only a backstop for gross leaks (a clean run grows
// by 0 to 3 MB). LeakSanitizer reports the small leaks on the ASAN lane: the
// loops below leak about 8000 slots on a build with the bug. That report is only
// attributed to this file when it runs on its own, which is why the file is in
// test/parallel-denylist.txt.
const shortLoop = isDebug || isASAN;
const iterations = shortLoop ? 1_000 : 100_000;
const gcEvery = shortLoop ? 250 : 5_000;
const maxGrowth = shortLoop ? 16 * MB : (iterations * leakedBytesPerIteration) / 2;

const url = "http://foo/";
const method = "POST";
const body = "ahoyhoy";

const cases: {
  name: string;
  testHeader: string | null;
  // Returns a new constructor each time. A constructor may carry state, so the
  // functional check and the measured loop of a test each take their own.
  makeConstruct: () => () => Request;
}[] = [];

for (const testHeader of [null, "value"]) {
  const init: RequestInit = { body, method };
  if (testHeader !== null) init.headers = { "test-header": testHeader };
  const urlObject = new URL(url);
  const suffix = testHeader === null ? "" : " with headers";
  cases.push(
    {
      name: `new Request(request)${suffix}`,
      testHeader,
      // Each request is built from the previous one. This works whether
      // `new Request(request)` tees the input body, as it does today, or moves
      // it, as the fetch spec says. One shared input would only work with tee.
      makeConstruct: () => {
        let input = new Request(url, init);
        return () => (input = new Request(input));
      },
    },
    { name: `new Request(string, init)${suffix}`, testHeader, makeConstruct: () => () => new Request(url, init) },
    { name: `new Request(URL, init)${suffix}`, testHeader, makeConstruct: () => () => new Request(urlObject, init) },
  );
}

function churn(construct: () => unknown, count: number) {
  for (let i = 0; i < count; i++) construct();
}

// The first hot loop in the process makes the JIT compile `churn` and start its
// compiler threads. That adds 6 to 11 MB of RSS on a debug build, and it would
// land in whichever loop happens to be running. Pay for it before the first
// baseline is taken.
churn(() => {}, 1_000_000);

function rssAfterChurn(construct: () => unknown) {
  for (let done = 0; done < iterations; done += gcEvery) {
    churn(construct, gcEvery);
    Bun.gc(true);
  }
  return rss();
}

// The warm-up runs the exact workload that is measured afterwards, and both
// readings are taken at the same point of that sequence, right after a full
// collection. The allocator and the JS heap reach their steady state during the
// warm-up, so the delta is memory that the second run allocated and did not free.
function expectNoRssGrowth(construct: () => unknown) {
  const before = rssAfterChurn(construct);
  const growth = rssAfterChurn(construct) - before;

  expect(
    growth,
    `RSS grew by ${(growth / MB).toFixed(1)} MB over ${iterations} iterations, the limit is ${(maxGrowth / MB).toFixed(1)} MB`,
  ).toBeLessThan(maxGrowth);
}

// The functional checks look up the one header the case sets rather than
// listing every header, so they do not depend on which headers Bun adds for a
// string body on its own.
for (const { name, testHeader, makeConstruct } of cases) {
  test(`${name}: construction does not leak`, async () => {
    const request = makeConstruct()();
    expect({
      url: request.url,
      method: request.method,
      testHeader: request.headers.get("test-header"),
      body: await request.text(),
    }).toEqual({ url, method, testHeader, body });

    expectNoRssGrowth(makeConstruct());
  });

  test(`${name}: request.clone() does not leak`, async () => {
    const request = makeConstruct()();
    const clone = request.clone();
    expect({
      url: clone.url,
      method: clone.method,
      testHeader: clone.headers.get("test-header"),
      bodies: await Promise.all([request.text(), clone.text()]),
    }).toEqual({ url, method, testHeader, bodies: [body, body] });

    const construct = makeConstruct();
    expectNoRssGrowth(() => construct().clone());
  });
}
