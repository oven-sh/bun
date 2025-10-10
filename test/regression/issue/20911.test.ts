import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// https://github.com/oven-sh/bun/issues/20911
test("Worker async onmessage error should not crash process", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
const blob = new Blob(
  [
    \`
    self.onmessage = async () => {
      throw new Error('pong')
    }
    \`,
  ],
  {
    type: 'application/typescript',
  },
)
const url = URL.createObjectURL(blob)
const worker = new Worker(url)
worker.onerror = (error) => console.error(error)
worker.postMessage('ping')

// keep alive
setInterval(() => {}, 1000)
`,
    ],
    env: bunEnv,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });

  // Wait a bit to ensure the worker processes the message and doesn't crash
  await Bun.sleep(1000);

  // Terminate the process
  proc.kill();

  const exitCode = await proc.exited;

  // Process should exit cleanly when killed (SIGTERM or SIGKILL), not crash with SIGABRT
  // Exit code 143 = 128 + 15 (SIGTERM)
  // Exit code 137 = 128 + 9 (SIGKILL)
  expect(exitCode).not.toBe(134); // 134 = SIGABRT (abort/crash)
  expect(exitCode).not.toBe(139); // 139 = SIGSEGV (segfault)
});

test("Worker sync onmessage error should work as before", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
const blob = new Blob(
  [
    \`
    self.onmessage = () => {
      throw new Error('sync error')
    }
    \`,
  ],
  {
    type: 'application/typescript',
  },
)
const url = URL.createObjectURL(blob)
const worker = new Worker(url)
worker.onerror = (error) => console.error(error)
worker.postMessage('ping')

// keep alive
setInterval(() => {}, 1000)
`,
    ],
    env: bunEnv,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });

  // Wait a bit to ensure the worker processes the message and doesn't crash
  await Bun.sleep(1000);

  // Terminate the process
  proc.kill();

  const exitCode = await proc.exited;

  // Process should exit cleanly when killed (SIGTERM or SIGKILL), not crash with SIGABRT
  // Exit code 143 = 128 + 15 (SIGTERM)
  // Exit code 137 = 128 + 9 (SIGKILL)
  expect(exitCode).not.toBe(134); // 134 = SIGABRT (abort/crash)
  expect(exitCode).not.toBe(139); // 139 = SIGSEGV (segfault)
});
