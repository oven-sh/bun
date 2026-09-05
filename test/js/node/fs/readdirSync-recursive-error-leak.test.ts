import { expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isWindows } from "harness";
import path from "path";

// Each failing call scans 66 directories before it hits the ELOOP, so the
// original bug leaked 66 path strings (~50 KB) per call: ~20 MB over 400
// calls, ~15 MB over 300. Without the leak the delta is allocator slack,
// within 3 MB on every build measured. Debug+ASAN builds take ~12 ms per
// call, so they run fewer of them.
const iterations = isASAN || isDebug ? 300 : 400;
const maxDeltaMB = 8;

// Windows: self-referential symlinks behave differently and the recursive
// walker takes a different open path there; this leak is posix-specific.
test.skipIf(isWindows)(
  "readdirSync({recursive:true, withFileTypes:true}) error path does not leak Dirent.path",
  async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), path.join(import.meta.dir, "readdirSync-recursive-error-leak-fixture.js"), String(iterations)],
      env: {
        ...bunEnv,
        // The DFG tier-up of the fixture's loop allocates ~4 MB (~8 MB in
        // debug builds) of compiler and code memory a few hundred calls in,
        // which an RSS delta this small cannot tell apart from a leak. The
        // leak under test is in native code, so the JIT adds nothing here.
        BUN_JSC_useJIT: "0",
        // ASAN's quarantine keeps every freed allocation resident until it
        // exceeds quarantine_size_mb (default 256 MB), which would inflate the
        // RSS delta by exactly the amount this test measures. Disable it for
        // the measurement subprocess only.
        ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "quarantine_size_mb=0", "thread_local_quarantine_size_kb=0"]
          .filter(Boolean)
          .join(":"),
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    const report = JSON.parse(stdout);
    expect(report).toEqual({
      iterations,
      warmup: expect.any(Number),
      codes: ["ELOOP"],
      rssBeforeMB: expect.any(Number),
      rssAfterMB: expect.any(Number),
      deltaMB: expect.any(Number),
    });
    expect(report.deltaMB).toBeLessThan(maxDeltaMB);
    expect(exitCode).toBe(0);
  },
  // ~0.3 s in release, ~6 s in a debug+ASAN build.
  isASAN || isDebug ? 30_000 : 15_000,
);
