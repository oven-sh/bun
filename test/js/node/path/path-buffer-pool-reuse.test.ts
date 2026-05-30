import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Behavioral regression guard for the path buffer pool rework
// (src/paths/path_buffer_pool.rs: now a process-global lock-free stack; and
// src/paths/Path.rs: `Path<U>` now owns its buffer via the pool's RAII guard).
// Every `path.resolve`/`path.join`/`path.normalize` acquires and returns a
// pooled buffer, so a pool that handed out an aliased/corrupted buffer — or a
// broken Path ownership/reset path — would produce wrong output under this
// tight churn. The lock-free concurrency itself is covered by the Rust Miri
// unit tests in src/paths/path_buffer_pool.rs; this keeps an end-to-end check
// that the pooled buffers stay correct across many get/put cycles.
test("pooled path buffers stay correct across heavy reuse", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        const { resolve, join, normalize, isAbsolute } = require("node:path");
        // Each iteration forces several pool get/put cycles. The inputs
        // normalize to known results, so a corrupted buffer would diverge.
        for (let i = 0; i < 20000; i++) {
          const r = resolve("/base", String(i), "..", "x", "./y", "z/../w");
          if (!isAbsolute(r) || !r.endsWith("w")) throw new Error("resolve: " + r);

          const j = join("a", "b", "..", "c", String(i), "..", "d");
          if (!j.endsWith("d")) throw new Error("join: " + j);

          const n = normalize("/p/q/../r/./s//t/../" + i + "/..");
          if (!n.startsWith("/p/r/s")) throw new Error("normalize: " + n);
        }
        console.log("OK");
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(stdout.trim()).toBe("OK");
  expect(exitCode).toBe(0);
}, 30_000);
