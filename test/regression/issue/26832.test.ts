import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Regression test for https://github.com/oven-sh/bun/issues/26832
// Segfault when libuv delivers pipe EOF callbacks after the reader is cleaned up.
// The crash occurs when spawning many subprocesses and closing them rapidly,
// causing a race between pipe close and pending EOF callbacks.
test("rapid subprocess spawn and close does not crash", async () => {
  const iterations = 50;
  const promises: Promise<void>[] = [];

  for (let i = 0; i < iterations; i++) {
    promises.push(
      (async () => {
        const proc = Bun.spawn({
          cmd: [bunExe(), "-e", "process.stdout.write('x'); process.exit(0)"],
          stdout: "pipe",
          stderr: "pipe",
          env: bunEnv,
        });

        // Read and immediately discard - the key is rapid open/close cycles
        const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

        expect(exitCode).toBe(0);
      })(),
    );
  }

  await Promise.all(promises);
});
