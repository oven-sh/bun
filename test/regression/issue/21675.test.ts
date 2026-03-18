import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// Regression test for #21675: Segfault in readdirSync during concurrent operations.
// The crash was caused by MimallocArena using mi_heap_new() with tag 0 (same as the
// backing heap), causing mimalloc to misroute abandoned pages from dead threads into
// arena heaps. When those arenas were destroyed, live blocks were freed, corrupting
// the heap and causing segfaults during subsequent allocations (e.g. in readdirSync).
test("concurrent readdirSync from worker threads does not crash", async () => {
  using dir = tempDir("issue-21675", {
    "worker.js": `
      const { Worker, isMainThread, parentPort, workerData } = require("worker_threads");
      const fs = require("fs");
      const path = require("path");

      if (isMainThread) {
        const workerCount = 8;
        let finished = 0;
        const errors = [];

        for (let i = 0; i < workerCount; i++) {
          const worker = new Worker(__filename);
          worker.on("message", (msg) => {
            if (msg.error) errors.push(msg.error);
          });
          worker.on("error", (err) => {
            errors.push(err && err.message || String(err));
          });
          worker.on("exit", (code) => {
            if (code !== 0) errors.push("worker exit code " + code);
            finished++;
            if (finished === workerCount) {
              if (errors.length > 0) {
                console.error("Errors:", errors);
                process.exit(1);
              }
              console.log("OK");
              process.exit(0);
            }
          });
        }
      } else {
        try {
          for (let i = 0; i < 100; i++) {
            fs.readdirSync(process.cwd(), { withFileTypes: true });
          }
          parentPort.postMessage({ done: true });
        } catch (e) {
          parentPort.postMessage({ error: e.message });
        }
      }
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "worker.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  expect(stdout.trim()).toBe("OK");
  expect(stderr.trim()).toBe("");
  expect(exitCode).toBe(0);
}, 30_000);
