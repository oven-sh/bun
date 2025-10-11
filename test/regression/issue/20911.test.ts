import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Helper function to test worker error handling
async function testWorkerErrorHandling(workerCode: string, description: string) {
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
  );
});

// TODO: Sync handlers also have a crash during worker exit (ASAN stack frame check failure)
// This is a pre-existing bug that also happens on main branch, separate from the async handler issue
test("Worker sync onmessage error should display ErrorEvent", async () => {
  await testWorkerErrorHandling(
    `
    self.onmessage = () => {
      throw new Error('sync error')
    }
    `,
    "sync handler",
  );
});
