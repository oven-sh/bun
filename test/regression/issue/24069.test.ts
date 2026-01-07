import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";

test("should not panic when exception is thrown in uncaughtException handler in worker", async () => {
  const dir = tempDirWithFiles("uncaught-exception-worker-test", {
    "worker.js": `
const observedWindows = [{ Error: undefined }];

process.on('uncaughtException', (error) => {
  // This mimics what happy-dom does - checking instanceof with undefined
  // This will throw TypeError: Right hand side of instanceof is not an object
  for (const window of observedWindows) {
    if (error instanceof window.Error) {
      break;
    }
  }
});

throw new Error("Test error");
`,
    "main.js": `
import { Worker } from 'worker_threads';

const worker = new Worker('./worker.js');
worker.on('exit', (code) => {
  // Worker should exit with code 7 (nested exception)
  process.exit(code === 7 ? 0 : 1);
});

setTimeout(() => process.exit(1), 5000);
`,
  });

  const proc = Bun.spawn({
    cmd: [bunExe(), "main.js"],
    cwd: String(dir),
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

  // Should not panic
  expect(stderr).not.toContain("panic:");
  expect(stderr).not.toContain("oh no: Bun has crashed");

  // Should show the TypeError
  expect(stderr).toContain("TypeError");
  expect(stderr).toContain("Right hand side of instanceof is not an object");

  // Should exit 0 (worker exited with 7, main treats that as success)
  expect(exitCode).toBe(0);
});
