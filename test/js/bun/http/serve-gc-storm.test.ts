// Under sustained HTTP load the GarbageCollectionController used to re-arm its
// 16 ms debounce timer whenever `blockBytesAllocated()` moved at all, so
// `collect_async()` fired every ~16 ms for as long as requests were arriving.
// With a large long-lived heap each eden collection has a multi-millisecond
// pause, and the main thread spent most of its time inside GC instead of
// serving. This test runs a fixed request count against an allocation-heavy
// handler with a ~50 MB live Map and asserts the controller requested a
// bounded number of eden collections, not one every few milliseconds.
import { test, expect } from "bun:test";
import { bunEnv, bunExe, isDebug } from "harness";
import path from "node:path";

// Debug + ASAN is 50-100x slower; trade request count for wall time so both
// profiles run the load phase for a few seconds.
const REQUESTS = isDebug ? 300 : 30000;

test(
  "node:http server with a large live heap does not trigger an eden GC storm",
  async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), path.join(import.meta.dir, "serve-gc-storm-fixture.ts")],
      env: { ...bunEnv, BUN_JSC_logGC: "1", REQUESTS: String(REQUESTS) },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toContain('"served":');
    expect(exitCode).toBe(0);

    // Count eden GCs between the load markers only; the heap build and the
    // explicit Bun.gc() before LOAD-START are not what this test is about.
    const start = stderr.indexOf("=== LOAD-START ===");
    const end = stderr.indexOf("=== LOAD-END ===");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const during = stderr.slice(start, end);
    const edenGCs = (during.match(/EdenCollection/g) ?? []).length;

    // Before the fix, the 16 ms loop fired an eden GC continuously for the
    // duration of the load: ~25 collections over a debug build's 300 requests
    // and ~50-80 over a release build's 30 000. After, the growth-gated nudge
    // fires on the order of once per several-MB of allocation and measures 2-4
    // (debug) / 8-12 (release) here. The thresholds sit comfortably between
    // the two regimes.
    const limit = isDebug ? 12 : 30;
    expect(edenGCs).toBeLessThan(limit);
  },
  30_000,
);
