import { expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN } from "harness";
import { join } from "node:path";

const fixture = join(import.meta.dir, "serve-response-stream-sink-leak-fixture.ts");
const leaksanSupp = join(import.meta.dir, "..", "..", "..", "leaksan.supp");

// Regression: doRenderStream allocates a ResponseStream.JSSink on the heap
// and stores it in RequestContext.sink. A direct stream whose pull() returns
// synchronously without ending the sink keeps the request alive until
// controller.end(); the resolve path must destroy the sink and release the
// request context (neither finalizeWithoutDeinit() nor deinit() touch
// RequestContext.sink), otherwise the allocation plus its pooled buffer
// leaks on every such request.
test("HTTPResponseSink is destroyed after a sync pull() that ends later", async () => {
  if (isASAN) {
    // LeakSanitizer reports the unfreed Box<ResponseStreamJSSink> allocated in
    // do_render_stream directly, so there is no need for the RSS-sampling
    // heuristic (which needs ~60k requests to settle under ASAN quarantine).
    // Run two sizes so fixed one-time leaks (server setup, timer, module
    // loader) cancel out; only a per-request leak survives the subtraction.
    async function run(iterations: number) {
      await using proc = Bun.spawn({
        cmd: [bunExe(), fixture],
        env: {
          ...bunEnv,
          SINK_LEAK_MODE: "lsan",
          SINK_LEAK_ITERATIONS: String(iterations),
          ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "detect_leaks=1"].filter(Boolean).join(":"),
          // exitcode=0: baseline one-time leaks (not all suppressed) would
          // otherwise make LSAN exit 1 on the fixed build too; the byte
          // differential below is the actual assertion.
          LSAN_OPTIONS: `suppressions=${leaksanSupp}:exitcode=0`,
        },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({ stdout, exitCode }, stderr).toEqual({
        stdout: JSON.stringify({ ok: iterations, iterations }),
        exitCode: 0,
      });
      const m = /SUMMARY: AddressSanitizer: (\d+) byte\(s\) leaked/.exec(stderr);
      return { bytes: m ? Number(m[1]) : 0, stderr };
    }
    const [small, large] = await Promise.all([run(10), run(100)]);
    const perRequestLeak = large.bytes - small.bytes;
    console.log({ small: small.bytes, large: large.bytes, perRequestLeak });
    // #29877 leaks ~176 B/req (sizeof ResponseStreamJSSink), so 90 extra
    // requests leak ~15840 B; fixed the delta hovers around 0 (±~500 B of
    // conservative-stack-scan jitter for the final in-flight Response). stderr
    // is attached so a new unsuppressed leak that tips the threshold is
    // diagnosable.
    expect(perRequestLeak, large.stderr).toBeLessThan(2000);
    return;
  }

  // Release (and non-ASAN debug): fall back to the RSS-delta heuristic. This
  // is already fast without ASAN (~5 s for 10000x6 requests) and keeps the
  // leak observable on lanes where LeakSanitizer is unavailable.
  await using proc = Bun.spawn({
    cmd: [bunExe(), fixture],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // The fixture prints nothing if it died or timed out; say which, instead of a bare
  // JSON.parse SyntaxError.
  expect({ printedResult: stdout.trim().length > 0, exitCode, stderr }).toMatchObject({
    printedResult: true,
    exitCode: 0,
  });
  const { delta, deltas, iterations, ok } = JSON.parse(stdout);
  console.log({ deltas, iterations, perRequest: (delta / iterations).toFixed(1) });
  expect(ok).toBe(iterations * 6);

  // `delta` is the median RSS growth per 10k requests (settledRss in the fixture
  // explains RSS over currentCommit). macOS debug: 1.0 MB fixed vs 3.5 MB leaking
  // (~350 B/req); Linux release: flat fixed vs +4.1 MB on the original #29877 leak.
  expect(delta).toBeLessThan(2 * 1024 * 1024);
}, 60_000);
