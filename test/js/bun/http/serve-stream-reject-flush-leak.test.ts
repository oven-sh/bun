import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";
import { join } from "node:path";

// The fixture needs tryEnd() to park under socket backpressure so
// pending_flush is set when the stream rejects. On Windows that can't happen:
// Winsock's non-blocking send() never returns a partial write — it either
// copies the entire buffer into the AFD queue (which grows to fit) or returns
// WSAEWOULDBLOCK only when the queue is already full from a *previous* send.
// tryEnd() is the first write on a fresh socket, so it always reports full
// success regardless of payload size, and pending_flush is never created.
// The leak being guarded (handleRejectStream not unprotecting pending_flush)
// is therefore POSIX-only by construction.
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
