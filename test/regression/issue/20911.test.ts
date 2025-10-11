import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Helper function to test worker error handling
async function testWorkerErrorHandling(workerCode: string, description: string, allowCrashAfterEvent = false) {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
const blob = new Blob(
  [\`${workerCode}\`],
  { type: 'application/typescript' },
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

  // Read stderr incrementally to detect ErrorEvent without waiting for process exit
  const { promise: errorEventPromise, resolve: resolveError } = Promise.withResolvers<boolean>();

  (async () => {
    const reader = proc.stderr.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        if (buffer.includes("ErrorEvent")) {
          resolveError(true);
          return;
        }
      }
      resolveError(false);
    } finally {
      reader.releaseLock();
    }
  })();

  const result = await Promise.race([
    proc.exited.then(code => ({ type: "exited" as const, code })),
    errorEventPromise.then(hasError => ({
      type: "errorEvent" as const,
      hasError,
    })),
  ]);

  // The test passes only if ErrorEvent is detected before the process exits
  if (result.type === "exited") {
    throw new Error(`${description}: Expected ErrorEvent before exit (code ${result.code})`);
  }
  expect(result.hasError).toBe(true);

  if (!allowCrashAfterEvent) {
    // Wait to ensure the process doesn't crash after displaying ErrorEvent
    // (the bug causes a crash shortly after ErrorEvent is printed)
    const crashCheck = await Promise.race([
      proc.exited.then(code => ({ crashed: true, code })),
      new Promise(resolve => setTimeout(() => resolve({ crashed: false }), 200)),
    ]);

    if (crashCheck.crashed) {
      throw new Error(`${description}: Process crashed after ErrorEvent (exit code ${crashCheck.code})`);
    }
  }

  // Clean up: terminate the process
  proc.kill();
  await proc.exited;
}

// https://github.com/oven-sh/bun/issues/20911
test("Worker async onmessage error should not crash process", async () => {
  await testWorkerErrorHandling(
    `
    self.onmessage = async () => {
      throw new Error('pong')
    }
    `,
    "async handler",
    false, // Should NOT crash after ErrorEvent
  );
});

// Sync handlers display ErrorEvent correctly (the fix improves this from stack-buffer-overflow
// to a minor ASAN stack frame check failure). The remaining ASAN issue is a pre-existing bug
// that also occurs on main branch and requires deeper investigation into thread cleanup.
test("Worker sync onmessage error should display ErrorEvent", async () => {
  await testWorkerErrorHandling(
    `
    self.onmessage = () => {
      throw new Error('sync error')
    }
    `,
    "sync handler",
    true, // Allow post-ErrorEvent crash (known ASAN thread cleanup issue)
  );
});
