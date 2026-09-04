import { spawn } from "bun";
import { expect, test } from "bun:test";
import { bunEnv, isWindows } from "harness";

// Repeatedly spawn a short-lived process and drain both pipes. The original
// failure mode was output going missing or the spawn path crashing after many
// iterations; the child binary is incidental (this test originally spawned
// `clang --version`). Use the cheapest portable child so the full iteration
// count runs everywhere, and overlap spawns in small batches (same pattern as
// spawn-streaming-stdout.test.ts / spawn-many-teardown.test.ts).
const iterations = 100;
const concurrency = 8;
const cmd = isWindows ? [process.env.comspec || "cmd.exe", "/c", "echo", "ok"] : ["/bin/sh", "-c", "echo ok"];

test("spawn stress", async () => {
  for (let i = 0; i < iterations; i += concurrency) {
    const batch: Promise<void>[] = [];
    for (let j = 0; j < concurrency && i + j < iterations; j++) {
      const iteration = i + j;
      batch.push(
        (async () => {
          await using proc = spawn({
            cmd,
            stdout: "pipe",
            stderr: "pipe",
            stdin: "ignore",
            env: bunEnv,
          });
          const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
          try {
            expect(stderr).toBe("");
            expect(stdout.trim()).toBe("ok");
            expect(exitCode).toBe(0);
          } catch (e) {
            console.error(`Failed in iteration ${iteration}`);
            console.error({ stdout, stderr, exitCode });
            throw e;
          }
        })(),
      );
    }
    await Promise.all(batch);
  }
});
