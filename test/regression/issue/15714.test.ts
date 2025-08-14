import { test, expect } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("shell assignment with pipe should not crash", async () => {
  // This test is for issue #15714
  // The command "FOO=bar BAR=baz | echo hi" was causing a panic due to
  // missing Assigns support in TaggedPointerUnion definitions
  await using proc = Bun.spawn({
    cmd: [bunExe(), "exec", "FOO=bar BAR=baz | echo hi"],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  // The command should execute successfully without crashing
  expect(exitCode).toBe(0);
  expect(stdout.trim()).toBe("hi");
  expect(stderr).toBe("");
});