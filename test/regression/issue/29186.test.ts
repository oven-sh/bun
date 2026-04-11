// https://github.com/oven-sh/bun/issues/29186
//
// `self.close()` is the WHATWG DedicatedWorkerGlobalScope#close API. Inside a
// Worker it requests termination of the worker on the next event loop tick;
// any task already queued before the call (e.g. an immediately-preceding
// postMessage) still completes. Before the fix, calling it threw
// `TypeError: self.close is not a function`.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// Debug/ASAN builds print a benign banner on every spawn; strip it so we can
// assert a clean stderr.
function cleanStderr(s: string): string {
  return s
    .split(/\r?\n/)
    .filter(line => !line.startsWith("WARNING: ASAN interferes"))
    .join("\n")
    .trim();
}

test("self.close() terminates the worker after the current task finishes", async () => {
  using dir = tempDir("issue-29186", {
    "worker.mjs": `
      self.postMessage("message");
      // Closing immediately after postMessage should just terminate the worker;
      // the queued postMessage above must still reach the parent.
      self.close();
    `,
    "main.mjs": `
      const worker = new Worker(new URL("./worker.mjs", import.meta.url).href, { type: "module" });
      const events = [];
      const { promise, resolve, reject } = Promise.withResolvers();

      worker.onmessage = ({ data }) => { events.push({ type: "message", data }); };
      worker.onerror = (e) => reject(new Error("worker error: " + (e.message || e)));
      worker.addEventListener("close", () => {
        events.push({ type: "close" });
        resolve();
      });

      await promise;
      console.log(JSON.stringify(events));
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "main.mjs"],
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

  expect(cleanStderr(stderr)).toBe("");
  expect(JSON.parse(stdout.trim())).toEqual([
    { type: "message", data: "message" },
    { type: "close" },
  ]);
  expect(exitCode).toBe(0);
});

test("self.close exists on the worker global scope", async () => {
  using dir = tempDir("issue-29186-typeof", {
    "worker.mjs": `
      self.postMessage({
        selfClose: typeof self.close,
        globalClose: typeof close,
      });
    `,
    "main.mjs": `
      const worker = new Worker(new URL("./worker.mjs", import.meta.url).href, { type: "module" });
      const { promise, resolve, reject } = Promise.withResolvers();
      worker.onmessage = ({ data }) => { console.log(JSON.stringify(data)); resolve(); };
      worker.onerror = (e) => reject(new Error("worker error: " + (e.message || e)));
      await promise;
      worker.terminate();
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "main.mjs"],
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

  expect(cleanStderr(stderr)).toBe("");
  expect(JSON.parse(stdout.trim())).toEqual({
    selfClose: "function",
    globalClose: "function",
  });
  expect(exitCode).toBe(0);
});

test("close() on the main thread is a no-op", async () => {
  // On main (non-window) contexts, `close()` should silently do nothing —
  // matching how `postMessage` is a no-op there today.
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `close(); console.log("ok");`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  expect(cleanStderr(stderr)).toBe("");
  expect(stdout).toBe("ok\n");
  expect(exitCode).toBe(0);
});
