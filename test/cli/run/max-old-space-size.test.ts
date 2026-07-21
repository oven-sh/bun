import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Pushes ~1 MB of live array data per iteration, then reports how far it got.
const allocateScript = (mb: number) =>
  `const chunks = [];
   for (let i = 0; i < ${mb}; i++) chunks.push(new Array(131072).fill(i));
   console.log("reached " + chunks.length + "MB");`;

test.concurrent.each(["--max-old-space-size", "--max_old_space_size"])(
  "%s aborts like Node.js when the live heap exceeds the limit",
  async flag => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), `${flag}=64`, "-e", allocateScript(256)],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toContain("JavaScript heap out of memory");
    expect(stdout).not.toContain("reached");
    // Node exits with 134 (128 + SIGABRT) on heap OOM
    expect(exitCode).toBe(134);
  },
);

test.concurrent("--max-old-space-size does not abort workloads that fit under the limit", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "--max-old-space-size=512", "-e", allocateScript(16)],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).not.toContain("JavaScript heap out of memory");
  expect(stdout).toContain("reached 16MB");
  expect(exitCode).toBe(0);
});

test.concurrent("--max-old-space-size rejects a non-numeric value", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "--max-old-space-size=abc", "-e", "console.log('ran')"],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toContain("Invalid value for --max-old-space-size");
  expect(stdout).not.toContain("ran");
  expect(exitCode).toBe(1);
});
