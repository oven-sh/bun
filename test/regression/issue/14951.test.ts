import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("top-level await on never-resolving promise should not cause 100% CPU usage", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", "await new Promise(r => {})"],
    env: bunEnv,
    stderr: "pipe",
  });

  // The process should exit on its own (not hang). Give it a generous timeout.
  const timeout = setTimeout(() => {
    proc.kill();
  }, 10_000);

  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

  clearTimeout(timeout);

  expect(stderr).toContain("unsettled top-level await");
  expect(exitCode).toBe(13);
});

test("top-level await on resolving promise should work normally", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", "await new Promise(r => setTimeout(r, 100)); console.log('done')"],
    env: bunEnv,
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout.trim()).toBe("done");
  expect(exitCode).toBe(0);
});
