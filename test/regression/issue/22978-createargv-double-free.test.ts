import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("process.argv with many arguments doesn't double-free", async () => {
  // The stack fallback buffer in createArgv is 32 * @sizeOf(jsc.ZigString)
  // We need more than 32 arguments to trigger heap allocation
  // Adding 40 arguments to ensure we exceed the stack buffer
  const manyArgs = Array.from({ length: 129 }, (_, i) => `arg${i}`);

  using dir = tempDir("argv-test", {
    "check-argv.js": `
      // Just access process.argv to trigger the createArgv function
      const argv = process.argv;
      console.log(JSON.stringify({
        length: argv.length,
        // Check that all arguments are present and valid
        hasAllArgs: argv.slice(2).every((arg, i) => arg === \`arg\${i}\`),
        // The first two should be the executable and script path
        hasExe: argv[0].includes("bun"),
        hasScript: argv[1].endsWith("check-argv.js")
      }));
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "check-argv.js", ...manyArgs],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // If there was a double-free, ASAN would catch it and the process would crash
  expect(exitCode).toBe(0);
  expect(stderr).toBe("");

  const result = JSON.parse(stdout.trim());
  expect(result.length).toBe(131); // exe + script + 129 args
  expect(result.hasAllArgs).toBe(true);
  expect(result.hasExe).toBe(true);
  expect(result.hasScript).toBe(true);
});

test.todo("process.argv with many arguments in worker", async () => {
  // Test the worker code path as well
  const manyArgs = Array.from({ length: 129 }, (_, i) => `worker-arg${i}`);

  using dir = tempDir("argv-worker-test", {
    "worker.js": `
      const { parentPort, workerData } = require("worker_threads");
      const argv = process.argv;
      parentPort.postMessage({
        length: argv.length,
        hasAllArgs: workerData.every((arg, i) => argv[i + 2] === arg),
        hasExe: argv[0].includes("bun"),
        hasScript: argv[1] === "[worker eval]" || argv[1].endsWith("worker.js")
      });
    `,
    "main.js": `
      const { Worker } = require("worker_threads");
      const args = ${JSON.stringify(manyArgs)};

      const worker = new Worker("./worker.js", {
        workerData: args,
        argv: args
      });

      worker.on("message", (msg) => {
        console.log(JSON.stringify(msg));
        process.exit(0);
      });

      worker.on("error", (err) => {
        console.error("Worker error:", err);
        process.exit(1);
      });
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "main.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(exitCode).toBe(0);
  expect(stderr).toBe("");

  const result = JSON.parse(stdout.trim());
  expect(result.length).toBe(131); // exe + script + 129 args
  expect(result.hasAllArgs).toBe(true);
  expect(result.hasExe).toBe(true);
  expect(result.hasScript).toBe(true);
});
