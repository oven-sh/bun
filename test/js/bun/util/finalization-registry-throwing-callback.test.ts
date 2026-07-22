import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// JSC schedules FinalizationRegistry cleanup through DeferredWorkTimer. Bun's
// runPendingWork ran the task with no exception scope, so a throw from the
// cleanup callback was left pending and tripped releaseAssertNoException() in
// the Rust-side caller (SIGABRT in debug/ASAN builds). Upstream
// DeferredWorkTimer::doWork catches the exception and routes it to
// reportUncaughtExceptionAtEventLoop; runPendingWork must do the same.

test.concurrent(
  "FinalizationRegistry cleanup callback that throws reaches process.on('uncaughtException')",
  async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        let caught = 0;
        process.on("uncaughtException", err => {
          if (String(err?.message ?? err).includes("cleanup-boom")) caught++;
        });
        const registry = new FinalizationRegistry(() => { throw new Error("cleanup-boom"); });
        (function () {
          for (let i = 0; i < 64; i++) registry.register({}, i);
        })();
        while (!caught) {
          Bun.gc(true);
          await new Promise(resolve => setImmediate(resolve));
        }
        registry;
        console.log("caught=" + caught);
      `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect({ stdout: stdout.trim(), stderr, signal: proc.signalCode }).toEqual({
      stdout: expect.stringMatching(/^caught=\d+$/),
      stderr: "",
      signal: null,
    });
    expect(exitCode).toBe(0);
  },
);

test.concurrent("FinalizationRegistry cleanup continues past a throwing callback", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        let cleaned = 0;
        let caught = 0;
        process.on("uncaughtException", err => {
          if (String(err?.message ?? err).includes("cleanup-boom")) caught++;
        });
        const registry = new FinalizationRegistry(h => {
          cleaned++;
          if (cleaned === 2) throw new Error("cleanup-boom");
        });
        const N = 10;
        (function () {
          for (let i = 0; i < N; i++) registry.register({}, i);
        })();
        // runFinalizationCleanup bails on the first throw; the remaining
        // holdings stay queued on the registry and are picked up by the next
        // GC-driven schedule once the exception is cleared.
        for (let r = 0; cleaned < N && r < 200; r++) {
          Bun.gc(true);
          await new Promise(resolve => setImmediate(resolve));
        }
        registry;
        console.log(JSON.stringify({ cleaned, caught }));
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect({ ...JSON.parse(stdout.trim() || "{}"), stderr, signal: proc.signalCode }).toEqual({
    cleaned: 10,
    caught: 1,
    stderr: "",
    signal: null,
  });
  expect(exitCode).toBe(0);
});
