import { expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug } from "harness";
import { join } from "node:path";

// The bug is a heap-use-after-free that only surfaces reliably under ASAN:
// response_ptr is dereferenced in onAbort after the (unprotected) Response
// has been GC'd during backpressure. On release builds the freed slot is
// usually still readable so the deref happens to succeed. `bun bd` debug
// builds enable ASAN by default but are named `bun-debug`, not `bun-asan`.
test.skipIf(!isASAN && !isDebug)(
  "Response returned sync is rooted across tryEnd() backpressure so onAbort doesn't UAF response_ptr",
  async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), join(import.meta.dir, "serve-response-gc-backpressure-abort-fixture.ts")],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    const result = JSON.parse(stdout.trim());
    expect(result).toEqual({
      pending: 0,
      abortCount: result.iterations,
      iterations: result.iterations,
    });
    expect(exitCode).toBe(0);
  },
  60_000,
);
