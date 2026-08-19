import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("process.title assigned in a Worker is thread-local and does not change the main thread's title", async () => {
  using dir = tempDir("worker-process-title", {
    "index.js": `
      const { Worker, isMainThread, parentPort } = require("node:worker_threads");
      if (isMainThread) {
        process.title = "MAIN-TITLE";
        const w = new Worker(__filename);
        let result;
        w.on("message", m => { result = m; });
        w.on("error", e => { console.error("WORKER_ERROR:" + (e && e.message)); process.exitCode = 1; });
        w.on("exit", () => {
          console.log(JSON.stringify({ worker: result, mainAfter: process.title }));
        });
      } else {
        const before = process.title;
        process.title = "WORKER-TITLE";
        parentPort.postMessage({ before, after: process.title });
      }
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "index.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).not.toContain("WORKER_ERROR");
  expect(JSON.parse(stdout.trim())).toEqual({
    // the worker starts with the parent's title and its own assignment round-trips locally
    worker: { before: "MAIN-TITLE", after: "WORKER-TITLE" },
    // the process-wide title the main thread sees is untouched
    mainAfter: "MAIN-TITLE",
  });
  expect(exitCode).toBe(0);
});

test("a Web Worker cannot change the main thread's process.title either", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        process.title = "MAIN-TITLE";
        const w = new Worker(new URL("data:text/javascript," + encodeURIComponent('process.title = "WEB-WORKER-TITLE"; postMessage(process.title);')));
        w.onmessage = e => {
          console.log(JSON.stringify({ worker: e.data, mainAfter: process.title }));
          w.terminate();
        };
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(JSON.parse(stdout.trim())).toEqual({ worker: "WEB-WORKER-TITLE", mainAfter: "MAIN-TITLE" });
  expect(exitCode).toBe(0);
});
