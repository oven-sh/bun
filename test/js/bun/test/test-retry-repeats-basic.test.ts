// Runs the retry/repeats hook-ordering checks in a subprocess so the
// intentional intermediate retry failures don't leak into this run's
// reporter output (JUnit, GitHub Actions annotations).
import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { join } from "node:path";

test("retry and repeats hook ordering", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", join(import.meta.dir, "test-retry-repeats-basic-fixture.ts")],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toContain("12 pass");
  expect(stderr).toContain("0 fail");
  expect(stderr).toContain("(attempt 3)");
  expect(exitCode).toBe(0);
});
