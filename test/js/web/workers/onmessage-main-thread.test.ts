import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("setting global onmessage in main thread should not prevent process exit", async () => {
  // This test verifies that setting a global onmessage handler in the main thread
  // doesn't keep the event loop alive and prevent the process from exiting.
  // This was a bug where packages like 'lzma' that detect Web Worker environments
  // by checking `typeof onmessage !== 'undefined'` would inadvertently keep the
  // process alive.

  using dir = tempDir("onmessage-test", {
    "test.js": `
      // Set a global onmessage handler (simulating what the lzma package does)
      onmessage = function(e) {
        console.log('received message:', e);
      };
      console.log('OK');
      // Process should exit here, not hang
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout.trim()).toBe("OK");
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
}, 5000); // 5 second timeout - should exit quickly

test("setting global onmessage in worker thread should work normally", async () => {
  // This test verifies that onmessage in a worker thread still works correctly
  // and doesn't exit prematurely.

  using dir = tempDir("onmessage-worker-test", {
    "worker.js": `
      onmessage = function(e) {
        postMessage('received: ' + e.data);
      };
    `,
    "main.js": `
      const worker = new Worker(new URL('worker.js', import.meta.url).href);
      worker.postMessage('hello');
      worker.onmessage = (e) => {
        console.log(e.data);
        worker.terminate();
      };
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

  expect(stdout.trim()).toBe("received: hello");
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
}, 5000);
