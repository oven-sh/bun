import { spawn } from "bun";
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug } from "harness";

// Repeatedly spawn a short-lived process and drain both pipes. The original
// failure mode was output going missing or the spawn path crashing after many
// iterations; the child binary itself is incidental. Debug/ASAN child startup
// dominates wall time, so we run fewer iterations there and overlap spawns in
// small batches (same pattern as spawn-streaming-stdout.test.ts).
const iterations = isASAN || isDebug ? 40 : 100;
const concurrency = 8;

test("spawn stress", async () => {
  const exe = bunExe();
  const expectedVersion = Bun.version;

  for (let i = 0; i < iterations; i += concurrency) {
    const batch: Promise<void>[] = [];
    for (let j = 0; j < concurrency && i + j < iterations; j++) {
      const iteration = i + j;
      batch.push(
        (async () => {
          await using proc = spawn({
            cmd: [exe, "--version"],
            stdout: "pipe",
            stderr: "pipe",
            stdin: "ignore",
            env: bunEnv,
          });
          const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
          try {
            expect(stderr).toBe("");
            expect(stdout.trim()).toBe(expectedVersion);
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
