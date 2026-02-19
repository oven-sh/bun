import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Regression test for https://github.com/oven-sh/bun/issues/27138
// "switch on corrupt value" panic on Windows during long-running sessions
// with heavy spawn usage. Root cause: use-after-free when pipe writer's
// close() was called while an async write was still in-flight, causing
// onCloseSource() to fire synchronously and free resources that the
// pending write callback would later access.

test("rapid spawn/close cycles should not crash", async () => {
  // Spawn many short-lived processes that write to stdin and immediately
  // close. This exercises the close-while-write-pending path.
  const iterations = 50;
  const promises: Promise<void>[] = [];

  for (let i = 0; i < iterations; i++) {
    promises.push(
      (async () => {
        await using proc = Bun.spawn({
          cmd: [bunExe(), "-e", "process.stdin.resume(); setTimeout(() => process.exit(0), 10)"],
          env: bunEnv,
          stdin: "pipe",
          stdout: "pipe",
          stderr: "pipe",
        });

        // Write data to stdin, then immediately close.
        // This creates the race condition where close() is called
        // while the write may still be in-flight.
        try {
          proc.stdin.write("hello world\n".repeat(100));
        } catch {
          // Write may fail if process exits first - that's fine
        }
        proc.stdin.end();

        await proc.exited;
      })(),
    );
  }

  await Promise.all(promises);
  // If we get here without crashing, the test passes.
  expect(true).toBe(true);
});

test("concurrent spawn with stdout/stderr reading should not corrupt memory", async () => {
  // Spawn processes that produce output and read from them concurrently.
  // This exercises the pipe reader close path.
  const iterations = 30;
  const promises: Promise<void>[] = [];

  for (let i = 0; i < iterations; i++) {
    promises.push(
      (async () => {
        await using proc = Bun.spawn({
          cmd: [bunExe(), "-e", `console.log("x".repeat(1024)); console.error("y".repeat(1024));`],
          env: bunEnv,
          stdin: "ignore",
          stdout: "pipe",
          stderr: "pipe",
        });

        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

        expect(stdout.length).toBeGreaterThan(0);
        expect(stderr.length).toBeGreaterThan(0);
        expect(exitCode).toBe(0);
      })(),
    );
  }

  await Promise.all(promises);
});
