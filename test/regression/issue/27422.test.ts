import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("node:test async tests should not time out by default", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--timeout", "5000", import.meta.dir + "/27422-fixture.test.mjs"],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const output = stdout + stderr;
  // The test should pass because node:test defaults to no timeout,
  // even though bun:test's default is 5000ms.
  expect(output).toContain("1 pass");
  expect(output).toContain("0 fail");
  // Should not contain the misleading "done callback" error message
  expect(output).not.toContain("done callback");
  expect(exitCode).toBe(0);
  // The spawned test sleeps for 7s, so this outer bun:test needs a longer timeout.
}, 15_000);
