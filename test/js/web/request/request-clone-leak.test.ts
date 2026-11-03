import { expect, test } from "bun:test";
import { isASAN, isDebug, rss } from "harness";

const MB = 1024 * 1024;

// `new Request(request)` once leaked the body slot that the constructor allocates before it copies the
// input (#12387). The slot is a 184 byte `HiveRef<Body.Value>`, which mimalloc serves from its 192 byte class.
const leakedBytesPerIteration = 192;

// On release that leak grows RSS by 18 MB and a clean run by 0 to 1 MB, so the limit is half the leak.
//
// Debug builds construct a Request about 100x slower, and ASAN's quarantine keeps freed blocks resident,
// so RSS can't see a 192 byte leak there. Those builds run a short loop with a limit that only catches
// gross leaks. LeakSanitizer catches the small ones on the ASAN lane, but only attributes them to this
// file when it runs on its own, so the file is listed in test/parallel-denylist.txt.
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
  // A constructor can carry state, so each check and each measured loop gets its own.
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
      // Build each request from the previous one. That works whether `new Request(request)` tees the
      // input body or moves it, as the fetch spec says.
      makeConstruct: () => {
        let input = new Request(url, init);
        return () => (input = new Request(input));
      },
    },
    { name: `new Request(string, init)${suffix}`, testHeader, makeConstruct: () => () => new Request(url, init) },
    {
      name: `new Request(URL, init)${suffix}`,
      testHeader,
      makeConstruct: () => () => new Request(urlObject as any, init),
    },
  );
}

function churn(construct: () => unknown, count: number) {
  for (let i = 0; i < count; i++) construct();
}

// The first hot loop makes the JIT compile `churn` and start its compiler threads, which adds 6 to 11 MB
// of RSS on a debug build. Pay for it before the first baseline.
churn(() => {}, 1_000_000);

function rssAfterChurn(construct: () => unknown) {
  for (let done = 0; done < iterations; done += gcEvery) {
    churn(construct, gcEvery);
    Bun.gc(true);
  }
  return rss();
}

// The warm-up runs the same workload as the measured run, and both readings follow a full collection.
function expectNoRssGrowth(construct: () => unknown) {
  const before = rssAfterChurn(construct);
  const growth = rssAfterChurn(construct) - before;

  expect(
    growth,
    `RSS grew by ${(growth / MB).toFixed(1)} MB over ${iterations} iterations, the limit is ${(maxGrowth / MB).toFixed(1)} MB`,
  ).toBeLessThan(maxGrowth);
}

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
