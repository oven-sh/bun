import { gcAndSweep } from "bun:jsc";
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
// loops below leak about 8000 slots on a build with the bug.
const shortLoop = isDebug || isASAN;
const iterations = shortLoop ? 1_000 : 100_000;
const gcEvery = shortLoop ? 250 : 5_000;
const maxGrowth = shortLoop ? 16 * MB : (iterations * leakedBytesPerIteration) / 2;

const url = "http://foo/";
const method = "POST";
const body = "ahoyhoy";

const cases: {
  name: string;
  args: ConstructorParameters<typeof Request>;
  headers: [string, string][];
}[] = [];

for (const headers of [[], [["test-header", "value"]]] as [string, string][][]) {
  const init: RequestInit = { body, method };
  if (headers.length > 0) init.headers = headers;
  const suffix = headers.length > 0 ? " with headers" : "";
  cases.push(
    { name: `new Request(request)${suffix}`, args: [new Request(url, init)], headers },
    { name: `new Request(string, init)${suffix}`, args: [url, init], headers },
    { name: `new Request(URL, init)${suffix}`, args: [new URL(url), init], headers },
  );
}

function churn(construct: () => void, count: number) {
  for (let i = 0; i < count; i++) construct();
}

// The JIT tiers `churn` up once per process. The compiler threads and code
// pages this brings in add 6 to 11 MB of RSS on a debug build, and they would
// land in whichever loop happens to be running. Pay for them before the first
// baseline is taken.
churn(() => {}, 1_000_000);

// gcAndSweep() frees every dead Request before it returns, and unlike Bun.gc()
// it neither deletes the JIT code (which would recompile `churn` in every batch)
// nor purges the allocator, so RSS stays a plain high-water mark.
function rssAfterChurn(construct: () => void) {
  for (let done = 0; done < iterations; done += gcEvery) {
    churn(construct, gcEvery);
    gcAndSweep();
  }
  return rss();
}

// The warm-up runs the exact workload that is measured afterwards, so the
// allocator and the JS heap reach their high-water mark before the baseline is
// taken. Only memory that the second run does not free shows up in the delta.
function expectNoRssGrowth(construct: () => void) {
  const before = rssAfterChurn(construct);
  const growth = rssAfterChurn(construct) - before;

  expect(
    growth,
    `RSS grew by ${(growth / MB).toFixed(1)} MB over ${iterations} iterations, the limit is ${(maxGrowth / MB).toFixed(1)} MB`,
  ).toBeLessThan(maxGrowth);
}

for (const { name, args, headers } of cases) {
  test(`${name}: construction does not leak`, async () => {
    const request = new Request(...args);
    expect({
      url: request.url,
      method: request.method,
      headers: [...request.headers],
      body: await request.text(),
    }).toEqual({ url, method, headers, body });

    expectNoRssGrowth(() => {
      new Request(...args);
    });
  });

  test(`${name}: request.clone() does not leak`, async () => {
    const request = new Request(...args);
    const clone = request.clone();
    expect({
      url: clone.url,
      method: clone.method,
      headers: [...clone.headers],
      bodies: await Promise.all([request.text(), clone.text()]),
    }).toEqual({ url, method, headers, bodies: [body, body] });

    expectNoRssGrowth(() => {
      new Request(...args).clone();
    });
  });
}
