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

  // Race: either the process exits (crashes) or we see the ErrorEvent output
  const errorEventPromise = (async () => {
    const stderr = await proc.stderr.text();
    return stderr.includes("ErrorEvent");
  })();

  const result = await Promise.race([
    proc.exited.then(code => ({ type: "exited" as const, code })),
    errorEventPromise.then(() => ({ type: "errorEvent" as const })),
    Bun.sleep(2000).then(() => ({ type: "timeout" as const })),
  ]);

  // If process exited before we saw ErrorEvent, it crashed
  if (result.type === "exited") {
    expect(result.code).not.toBe(134); // 134 = SIGABRT (abort/crash)
    expect(result.code).not.toBe(139); // 139 = SIGSEGV (segfault)
  }

  // Terminate the process if it's still running
  proc.kill();
  const exitCode = await proc.exited;

  // Process should exit cleanly when killed (SIGTERM or SIGKILL), not crash with SIGABRT
  expect(exitCode).not.toBe(134); // 134 = SIGABRT (abort/crash)
  expect(exitCode).not.toBe(139); // 139 = SIGSEGV (segfault)
});

// TODO: Sync handler errors also crash workers, but that's a separate issue
// test("Worker sync onmessage error should work as before", async () => { ... });
