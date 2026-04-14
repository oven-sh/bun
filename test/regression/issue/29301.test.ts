// https://github.com/oven-sh/bun/issues/29301
// Regression: addEventListener must report its native allocation cost to
// JSC so GC is scheduled proportional to listener churn. `AbortSignal`
// goes through the same EventTarget listener path, so exercising
// EventTarget directly covers both.
import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("addEventListener reports native listener cost to JSC", async () => {
  // Each successful addEventListener reports 512 bytes of extra memory
  // to JSC, visible via `process.memoryUsage().external`. Without the
  // fix, 10k adds produces zero delta; with the fix, ~5.12MB.
  // Measured in a subprocess so baselines aren't contaminated by the
  // test runner's own listener churn.
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const target = new EventTarget();
      const before = process.memoryUsage().external;
      for (let i = 0; i < 10000; i++) {
        const fn = () => {};
        target.addEventListener('abort', fn);
        target.removeEventListener('abort', fn);
      }
      const after = process.memoryUsage().external;
      console.log(JSON.stringify({ before, after, delta: after - before }));
      `,
    ],
    env: bunEnv,
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const trimmed = stdout.trim();
  if (trimmed === "") {
    throw new Error(`subprocess produced no stdout (exitCode=${exitCode})\n--- stderr ---\n${stderr}`);
  }

  const { delta } = JSON.parse(trimmed);

  // 10k addEventListener calls at 512 bytes each = 5,120,000 bytes.
  // A generous lower bound that's still well clear of the zero the
  // unfixed build produces.
  expect(delta).toBeGreaterThan(1_000_000);
  expect(exitCode).toBe(0);
});
