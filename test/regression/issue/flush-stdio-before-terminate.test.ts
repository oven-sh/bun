import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Regression test: on Windows, TerminateProcess (used since #27829) skips CRT
// teardown, which can lose buffered stdout/stderr. Bun__flushCStdio must flush
// C stdio buffers before calling TerminateProcess.
test("stdout is not lost on exit", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", `console.log("hello from stdout"); console.error("hello from stderr"); process.exit(0);`],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  expect(stdout.trim()).toBe("hello from stdout");
  expect(stderr.trim()).toBe("hello from stderr");
  expect(exitCode).toBe(0);
});

test("stdout is not lost on non-zero exit", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", `console.log("output before exit"); console.error("error before exit"); process.exit(42);`],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  expect(stdout.trim()).toBe("output before exit");
  expect(stderr.trim()).toBe("error before exit");
  expect(exitCode).toBe(42);
});
