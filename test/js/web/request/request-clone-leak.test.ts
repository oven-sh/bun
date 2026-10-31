import { expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isLinux, withoutAsanQuarantine } from "harness";
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

// With the leak of #12387 put back, one `new Request(request)` measures 194
// bytes on a release build and 580 on an ASAN build, whose body slot is larger
// and has a redzone. The bound is a third of that. A run with no leak measures
// 8 at most on a release build, 12 on an ASAN build and 59 on a debug build.
const maxBytesPerIteration = isASAN || isDebug ? 192 : 64;
// The loop is long enough that the bound, summed over the run, is well above
// what a run with no leak moves by. On Linux the fixture reads an exact
// number, so a short loop is enough. A debug build can only run a short one:
// it spends 40 to 200 µs on each request, a release build 2. Elsewhere the
// bound sums to 29 MB over the run.
const iterationsPerRound = !isLinux ? 25_000 : isDebug ? 250 : isASAN ? 1000 : 5000;
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
      String(rounds),
      String(iterationsPerRound),
    ],
    env: { ...withoutAsanQuarantine(bunEnv), BUN_JSC_useJIT: "0" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
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
  expect(exitCode).toBe(0);
}

// Without smaps the fixture reads the resident set size, which needs the long
// loop, and a debug or ASAN build is too slow for it. No CI lane runs such a
// build outside Linux.
const tooSlowForALongLoop = !isLinux && (isDebug || isASAN);

for (const [i, shape] of shapes.entries()) {
  test.skipIf(tooSlowForALongLoop).concurrent("new Request(test #" + i + ")", () => expectNoLeak("construct", shape));
  test.skipIf(tooSlowForALongLoop).concurrent("request.clone(test #" + i + ")", () => expectNoLeak("clone", shape));
}
