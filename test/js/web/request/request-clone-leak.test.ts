import { expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, withoutAsanQuarantine } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Guards `new Request()` and `request.clone()` against a native leak on every
// call. #12387 fixed one: `new Request(request)` allocates a body slot before
// it copies the input, and it did not release that slot.
//
// The loop runs in request-clone-leak-fixture.ts so that the memory it samples
// tracks live memory. In this process it does not:
// - ASAN parks every freed block in a 256 MB quarantine, so resident memory
//   follows the allocation volume: 50 MB for 100,000 requests. ASAN reads
//   ASAN_OPTIONS only at startup.
// - The JIT compiles on its own threads while the loop runs. On an ASAN build,
//   the first DFG compile and the first FTL compile each bring 15 MB of the
//   bun binary into memory. A leak here is native, so the fixture runs without
//   the JIT.

// The first argument of the constructor, and whether the init has headers.
// Test #N uses shapes[N].
const shapes = [
  ["request", "no-headers"],
  ["string", "no-headers"],
  ["url", "no-headers"],
  ["request", "headers"],
  ["string", "headers"],
  ["url", "headers"],
] as const;

// The fixture sums /proc/self/smaps where the kernel serves that file, which
// is exact. Elsewhere it reads the resident set size.
function smapsIsReadable(): boolean {
  try {
    return readFileSync("/proc/self/smaps", "utf8").includes("\nAnonymous:");
  } catch {
    return false;
  }
}
const source = smapsIsReadable() ? "smaps" : "rss";

// The release bound is that of the in-process form of this test: 30 MB for
// 1,000,000 requests. With the leak of #12387 put back, one
// `new Request(request)` measures 194 bytes on a release build and 580 on an
// ASAN build, whose body slot is larger and has a redzone. A run with no leak
// measures 1 at most on a release build, 4 on an ASAN build and 59 on a debug
// build.
const maxBytesPerIteration = isDebug ? 192 : isASAN ? 64 : 32;
// The loop is long enough that the bound, summed over the run, is well above
// what a run with no leak moves by: the release bound sums to 14 MB. An ASAN
// build spends 15 µs on each request and a debug build 40 to 200, where a
// release build spends 2. They run a shorter loop, which is enough with smaps.
const iterationsPerRound = isDebug ? 250 : isASAN ? 2500 : 25_000;
const rounds = 20;
const warmupRounds = 2;

// `samples` has one value for each round, taken after the full GC that ends
// it. The growth for each round is the median slope over every pair of samples
// (Theil-Sen). A few stray samples cannot move it, and they do happen: with no
// leak, a sample can sit 0.4 MB away from the ones around it.
function growthPerIteration(samples: number[]): number {
  expect(samples).toHaveLength(rounds);
  const measured = samples.slice(warmupRounds);
  const slopes: number[] = [];
  for (let i = 0; i < measured.length; i++) {
    for (let j = i + 1; j < measured.length; j++) slopes.push((measured[j] - measured[i]) / (j - i));
  }
  return slopes.sort((a, b) => a - b)[slopes.length >> 1] / iterationsPerRound;
}

async function expectNoLeak(op: "construct" | "clone", [input, headers]: (typeof shapes)[number]) {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      join(import.meta.dir, "request-clone-leak-fixture.ts"),
      op,
      input,
      headers,
      source,
      String(rounds),
      String(iterationsPerRound),
    ],
    env: { ...withoutAsanQuarantine(bunEnv), BUN_JSC_useJIT: "0" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  // A fixture that dies prints no report, so this comes before the JSON.
  expect({ stderr, exitCode, signalCode: proc.signalCode }).toEqual({ stderr: "", exitCode: 0, signalCode: null });
  const { samples, ...report } = JSON.parse(stdout) as { samples: number[] };
  // The loop copied a request that has the url, the method, the header and the
  // body, and so does its clone.
  const request = {
    url: "http://foo/",
    method: "POST",
    testHeader: headers === "headers" ? "value" : null,
    body: "ahoyhoy",
  };
  expect(report).toEqual({
    request,
    ...(op === "clone" && { clone: request }),
    iterations: rounds * iterationsPerRound,
  });
  const bytesPerIteration = growthPerIteration(samples);
  console.log(op, input, headers + ":", bytesPerIteration.toFixed(1), "bytes per iteration");
  expect(bytesPerIteration).toBeLessThan(maxBytesPerIteration);
}

// The resident set size needs the long loop, and a debug or ASAN build is too
// slow for it. No CI lane runs such a build without smaps.
const tooSlowForALongLoop = source === "rss" && (isDebug || isASAN);

for (const [i, shape] of shapes.entries()) {
  test.skipIf(tooSlowForALongLoop).concurrent("new Request(test #" + i + ")", () => expectNoLeak("construct", shape));
  test.skipIf(tooSlowForALongLoop).concurrent("request.clone(test #" + i + ")", () => expectNoLeak("clone", shape));
}

// The fixture runs without the quarantine, where ASAN gives a freed block to
// the next allocation and can miss a read of it. This loop keeps the
// constructor, clone() and the finalizers under the default quarantine, as
// every loop of this file was before.
test("a clone keeps its body after its request is collected", async () => {
  const url = "http://foo/";
  for (const headers of [undefined, { "test-header": "value" }]) {
    const init = { body: "ahoyhoy", method: "POST", headers };
    for (const args of [[new Request(url, init)], [url, init], [new URL(url), init]] as [any, RequestInit?][]) {
      let clone = new Request(...args).clone();
      for (let i = 0; i < 1000; i++) clone = new Request(...args).clone();
      Bun.gc(true);
      expect(await clone.text()).toBe("ahoyhoy");
    }
  }
});
