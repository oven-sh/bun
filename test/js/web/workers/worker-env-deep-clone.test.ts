import { expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, tempDir } from "harness";

// Regression test for a use-after-poison found by the fuzzer in
// runEnvLoader → env.get("BUN_DISABLE_TRANSPILER") on a Worker thread.
//
// WebWorker.start() cloned the parent VM's env map with
// ArrayHashMap.cloneWithAllocator, which copies the hashtable backing into
// the worker's arena but leaves every key/value []const u8 slice pointing
// at the parent's bytes. For a nested worker whose parent is itself a
// worker, the parent's .env-file-sourced key/value bytes live in the
// parent worker's MimallocArena; when the parent exits, those bytes are
// poisoned and the child's later env.get() reads freed memory.
//
// The fix deep-clones every key and value into the child's own arena.
//
// The race is timing-dependent and only observable under ASAN, so this
// test is gated to sanitizer builds. The .env file forces the parent
// worker to allocate key/value bytes in its own arena (via Parser.parse →
// allocator.dupe), which is what makes the shallow clone dangerous.
test.skipIf(!isASAN && !isDebug)("worker env map is deep-cloned from parent", async () => {
  // Keys that are NOT in the process environment, so the parent worker's
  // .env parse inserts them fresh (key slice into the worker-arena file
  // buffer, value duped into the worker arena).
  const envLines = Array.from({ length: 64 }, (_, i) => `WORKER_ENV_DEEP_CLONE_${i}=value_${i}_${"x".repeat(32)}`);

  using dir = tempDir("worker-env-deep-clone", {
    ".env": envLines.join("\n") + "\n",
    "main.js": `
      const { Worker } = require("node:worker_threads");
      let done = 0;
      const total = 8;
      for (let i = 0; i < total; i++) {
        const w = new Worker(
          \`
            // Spawn a grandchild with eval so it doesn't go through the
            // filesystem module resolver (which has a separate singleton
            // lifetime issue). The grandchild's start() still runs
            // configureDefines → runEnvLoader → env.get(), which is the
            // code path this regression covers.
            const { Worker, parentPort } = require("node:worker_threads");
            const child = new Worker("1", { eval: true });
            child.unref();
            parentPort.postMessage("ok");
          \`,
          { eval: true },
        );
        w.on("message", () => {
          w.terminate();
          if (++done === total) {
            console.log("ok");
            process.exit(0);
          }
        });
        w.on("error", e => {
          console.error("worker error", e);
          process.exit(1);
        });
      }
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "main.js"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout.trim()).toBe("ok");
  expect(exitCode).toBe(0);
}, 30_000);
