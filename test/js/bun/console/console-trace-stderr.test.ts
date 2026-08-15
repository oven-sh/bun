import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("console.trace writes to stderr, not stdout", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", `console.trace("hello")`],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(exitCode).toBe(0);
  expect(stdout).toBe("");
  expect(stderr).toContain("hello");
  expect(stderr.toLowerCase()).toMatch(/trace/i);
});
