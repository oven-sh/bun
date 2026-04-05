// https://github.com/oven-sh/bun/issues/28648
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// Worker spawning can be slow under ASAN/CI
test("worker does not crash when uncaughtException handler throws", async () => {
  using dir = tempDir("issue-28648", {
    "worker.cjs": `
process.on('uncaughtException', function () {
  throw new Error('uncaughtException');
});

throw new Error('oopsie');
`,
  });

  // Spawn as a subprocess to isolate the potential crash
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
const { Worker } = require('worker_threads');
const worker = new Worker(require('path').join(process.argv[1], 'worker.cjs'));
worker.on('exit', (code) => {
  // Write exit code to stdout so the test can verify
  process.stdout.write('exit:' + code + '\\n');
  process.exit(0);
});
setTimeout(() => { process.stdout.write('timeout\\n'); process.exit(99); }, 10000);
`,
      String(dir),
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // Worker should terminate gracefully with exit code 1 (Node.js convention)
  expect(stdout).toContain("exit:1");
  expect(exitCode).toBe(0);
}, 30_000);
