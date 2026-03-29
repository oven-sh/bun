import { test, expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

test("worker does not crash when uncaughtException handler throws", async () => {
  using dir = tempDir("issue-28648", {
    "index.cjs": `
const path = require('path');
const { Worker } = require('worker_threads');
const fs = require('fs');

const logFile = path.join(__dirname, 'result.txt');
fs.writeFileSync(logFile, '');

const worker = new Worker(path.join(__dirname, 'worker.cjs'));

worker
  .on('error', (err) => {
    fs.appendFileSync(logFile, 'error: ' + err.message + '\\n');
  })
  .on('exit', (code) => {
    fs.appendFileSync(logFile, 'exit: ' + code + '\\n');
    process.exit();
  });

setTimeout(() => { process.exit(99); }, 10000);
`,
    "worker.cjs": `
process.on('uncaughtException', function () {
  throw new Error('uncaughtException');
});

throw new Error('oopsie');
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "run", "index.cjs"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  // Process should not crash
  expect(exitCode).not.toBe(99); // timeout guard didn't fire

  const result = await Bun.file(join(String(dir), "result.txt")).text();
  // Parent should receive the error from the uncaughtException handler
  expect(result).toContain("error: uncaughtException");
  // Parent should receive the exit event
  expect(result).toContain("exit:");
});
