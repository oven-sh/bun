import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";
import { join } from "node:path";

// The fixture relies on an 8 MiB tryEnd() hitting socket backpressure on a
// loopback client that never reads. Windows' loopback send buffer auto-tunes
// large enough that the write completes synchronously and pending_flush is
// never created, so the precondition can't be satisfied there. The leak being
// guarded is platform-agnostic Zig (handleRejectStream); POSIX coverage is
// sufficient.
test.skipIf(isWindows)(
  "handleRejectStream unprotects pending_flush (no Promise GC-root leak)",
  async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), join(import.meta.dir, "serve-stream-reject-flush-leak-fixture.ts")],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    const result = JSON.parse(stdout.trim());
    // Sanity: we actually hit the backpressure → pending_flush path.
    expect(result.flushPending).toBeGreaterThanOrEqual(result.iterations / 2);
    // Without the fix, delta ≈ iterations (one protected Promise leaked per
    // request). With the fix, it should be ~0. Allow a small constant for
    // unrelated bookkeeping promises.
    expect(result.delta).toBeLessThan(result.iterations / 2);
    expect(exitCode).toBe(0);
  },
  60_000,
);
