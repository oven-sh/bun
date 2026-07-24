import { expect, test } from "bun:test";
import { isASAN, isWindows, tempDir } from "harness";
import { join } from "node:path";

// Regression coverage for issue #18265 / PR #20102: a `"pipe"` stdio stream
// that JS never reads must not retain the PipeReader's read buffer past the
// child's exit.
//
// PipeReader reserves a per-reader read buffer once data arrives (~16 KB on
// POSIX via the hardcoded `reserve(16 * 1024)` in PosixBufferedReader, ~64 KB
// on Windows via libuv's pipe alloc_cb suggested_size). On POSIX the first
// read uses a shared stack buffer and only falls through to the per-reader
// `reserve()` loop once it has produced data, so the child must write to the
// piped stream for that allocation to happen. The child writes a full 16 KB so
// the retained buffer's pages are actually faulted in; with a tiny write only
// one page is touched and the regressed delta sits under any useful RSS bound.
//
// The previous form spawned msys2 `cat` (~9 ms/spawn on Windows arm64) with an
// empty stderr pipe; native `cmd /c type` / POSIX `cat` keep the spawn cost at
// ~2.5 ms / ~0.2 ms respectively.

const MB = 1024 * 1024;
const BATCH = 50;

test("unread 'pipe' stdio does not leak the PipeReader buffer", async () => {
  using dir = tempDir("spawn-noread-leak", {
    "payload.bin": Buffer.alloc(16 * 1024, "x").toString(),
  });
  const payload = join(String(dir), "payload.bin");
  const cmd = isWindows ? ["cmd", "/c", "type", payload] : ["cat", payload];

  async function spawnBatch(): Promise<number> {
    const codes = await Promise.all(
      Array.from({ length: BATCH }, async () => {
        const proc = Bun.spawn(cmd, { stdio: ["ignore", "pipe", "ignore"] });
        return proc.exited;
      }),
    );
    // Fold all exit codes so a child that failed to launch surfaces as a test
    // failure instead of a silently-different workload.
    return codes.reduce((a, b) => a | b, 0);
  }

  let badExit = 0;

  // Warm up so lazily-created runtime state (thread pools, signal fds, JSC
  // heap growth) is already in the baseline and only per-spawn retention shows
  // up in the delta.
  for (let i = 0; i < 3; i++) {
    badExit |= await spawnBatch();
    Bun.gc(true);
  }
  const baseline = process.memoryUsage.rss();

  const MEASURE_BATCHES = 12;
  for (let i = 0; i < MEASURE_BATCHES; i++) {
    badExit |= await spawnBatch();
    Bun.gc(true);
  }
  const final = process.memoryUsage.rss();
  const deltaMB = (final - baseline) / MB;

  console.log(
    `RSS: ${(baseline / MB).toFixed(1)} MB -> ${(final / MB).toFixed(1)} MB ` +
      `(+${deltaMB.toFixed(1)} MB over ${MEASURE_BATCHES * BATCH} spawns)`,
  );

  expect(badExit).toBe(0);

  // Release builds sit at ~0-1 MB delta across all platforms when nothing
  // leaks; a retained 16 KB buffer over 600 spawns shows as ~10 MB. ASAN
  // quarantine holds the freed buffers so the delta there (~50 MB) is
  // dominated by quarantine growth regardless of whether the retention path is
  // broken; keep that lane as a smoke check with a wider bound (the earlier 6x
  // multiplier on the ratio assertion encoded the same thing).
  const limitMB = isASAN ? 100 : 5;
  expect(deltaMB).toBeLessThan(limitMB);
});
