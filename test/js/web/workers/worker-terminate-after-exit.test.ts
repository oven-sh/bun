import { expect, test } from "bun:test";
import { bunEnv, bunExe, isDebug } from "harness";

// The Zig `WebWorker` struct used to be destroyed on the worker thread in
// `exitAndDeinit`, while `Worker::terminate()` on the main thread could still
// call `WebWorker__notifyNeedTermination(impl_)` afterwards, reading freed
// memory. Calling `terminate()` immediately sets `requested_terminate`, so the
// worker thread takes the fast early-exit path (before its VM is created) and
// the struct was freed right after the close event was posted. Calling
// `terminate()` again from the close handler then touched the freed struct.
test(
  "Worker.terminate() after the worker thread has exited does not use freed memory",
  async () => {
    const code = `
    for (let i = 0; i < 10; i++) {
      const w = new Worker("nonexistent-entrypoint-58146");
      const { promise, resolve } = Promise.withResolvers();
      w.addEventListener("close", resolve);
      w.addEventListener("error", () => {});
      w.terminate();
      await promise;
      w.terminate();
    }
    Bun.gc(true);
  `;
    const concurrency = 5;
    for (let batch = 0; batch < 4; batch++) {
      const runs = Array.from({ length: concurrency }, async () => {
        await using proc = Bun.spawn({
          cmd: [bunExe(), "-e", code],
          env: bunEnv,
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
        return { stderr, exitCode };
      });
      for (const { stderr, exitCode } of await Promise.all(runs)) {
        if (exitCode !== 0) {
          expect(stderr).toBe("");
        }
        expect(exitCode).toBe(0);
      }
    }
  },
  isDebug ? 60_000 : undefined,
);
