import { expect, it } from "bun:test";
import { bunEnv, bunExe } from "harness";

// https://github.com/oven-sh/bun/issues/19952
it.concurrent("console.trace() writes to stderr, not stdout", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", `console.trace("marker");`],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout).toBe("");
  expect(stderr).toContain("marker");
  expect(stderr).toContain("at ");
  expect(exitCode).toBe(0);
});

it.concurrent("console.trace() with no arguments writes the stack to stderr", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", `console.trace();`],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout).toBe("");
  expect(stderr).toContain("at ");
  expect(exitCode).toBe(0);
});

it.concurrent("console.trace() does not interleave with console.log() on stdout", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", `console.log("before"); console.trace("traced"); console.log("after");`],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout).toBe("before\nafter\n");
  expect(stderr).toContain("traced");
  expect(exitCode).toBe(0);
});
