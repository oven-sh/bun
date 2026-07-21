import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

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

test.concurrent("--max-old-space-size does not kill the process when a worker exceeds the limit", async () => {
  // The limit only aborts for the main thread VM; Node's model for workers is
  // resourceLimits + a worker-scoped error, never a process-wide abort.
  using dir = tempDir("max-old-space-size-worker", {
    "main.js": `
      const { Worker } = require("node:worker_threads");
      const worker = new Worker("./worker.js");
      worker.on("exit", code => console.log("worker exited " + code));
    `,
    "worker.js": `
      const chunks = [];
      for (let i = 0; i < 128; i++) chunks.push(new Array(131072).fill(i));
      Bun.gc(true);
      console.log("worker reached " + chunks.length + "MB");
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "--max-old-space-size=64", "main.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).not.toContain("JavaScript heap out of memory");
  expect(stdout).toContain("worker reached 128MB");
  expect(stdout).toContain("worker exited 0");
  expect(exitCode).toBe(0);
});

test.concurrent("space-separated value of the underscore alias stays in process.execArgv", async () => {
  using dir = tempDir("max-old-space-size-execargv", {
    "main.js": `console.log(JSON.stringify(process.execArgv));`,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "--max_old_space_size", "256", "main.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
  });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  // The value must be kept with the flag, or children spawned with the default
  // execArgv (worker_threads, child_process.fork) consume the script as the value.
  expect(stdout.trim()).toBe('["--max_old_space_size","256"]');
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
