import { expect, test } from "bun:test";
import { isASAN, isDebug, isWindows } from "harness";

// Regression coverage for issue #18265 / PR #20102: a `"pipe"` stdio stream
// that JS never reads must not retain the PipeReader's read buffer past the
// child's exit.
//
// PipeReader reserves a 16 KB read buffer (libuv's suggested_size on Windows)
// after the first byte has been buffered. On POSIX the first read uses a
// shared stack buffer and only falls through to the per-reader `reserve()`
// loop once it has produced data, so the child must write at least one byte to
// the piped stream for that allocation to happen. stdout is piped and never
// consumed; `echo x` / `cmd /c echo x` writes two bytes to it and exits.
//
// The previous form spawned `cat` with only stderr piped. `cat` writes nothing
// to stderr, so since the stack-buffer fast path landed the per-reader buffer
// was never allocated there and the POSIX release lane was not exercising the
// retention path at all. Switching to a tiny stdout write restores that, and
// replacing msys2 `cat` (~9 ms/spawn) with native `cmd` (~2.5 ms/spawn) is what
// brings the Windows arm64 wall time down.

const MB = 1024 * 1024;
const BATCH = 50;

const cmd = isWindows ? ["cmd", "/c", "echo x"] : ["echo", "x"];

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

test("unread 'pipe' stdio does not leak the PipeReader buffer", async () => {
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

  // Release builds sit at ~0 MB delta across all platforms when nothing leaks;
  // 5 MB corresponds to ~8.5 KB/spawn of touched pages, tighter than the
  // previous `before * 3` ratio (which allowed ~12 KB/spawn). ASAN quarantine
  // retains freed allocations on the same order as the buffer itself so the
  // delta there is ~10 MB regardless of whether the retention path is broken;
  // keep those lanes as a smoke check with a wider bound (the earlier 6x
  // multiplier encoded the same thing).
  const limitMB = isASAN || isDebug ? 30 : 5;
  expect(deltaMB).toBeLessThan(limitMB);
});
