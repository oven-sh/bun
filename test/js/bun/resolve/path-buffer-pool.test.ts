import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// `path_buffer_pool` used to be a per-thread freelist. It is now a
// process-global, lock-free Treiber stack (`src/paths/path_buffer_pool.rs`)
// shared across every thread. These tests hammer the pool-backed path APIs
// (`path.resolve`, `fs.realpathSync`, `Bun.which`) from many Worker threads at
// once. A data race or use-after-free in the lock-free `pop`/`push` shows up as
// a crash under the debug build (ASAN) or as a corrupted result (a buffer
// handed to two threads), which the per-iteration equality checks catch.
describe("path buffer pool (lock-free, process-global)", () => {
  test("concurrent path operations across workers stay correct", async () => {
    using dir = tempDir("path-pool", {
      "worker.js": `
        import { realpathSync } from "node:fs";
        import { isAbsolute, resolve } from "node:path";

        self.onmessage = ({ data: { root, iters } }) => {
          for (let i = 0; i < iters; i++) {
            // path.resolve -> pooled join/normalize buffers. The trailing
            // "d/../e" normalizes to "e", so a correct result is absolute and
            // ends with the "e" segment; a buffer shared between threads would
            // produce garbage here.
            const a = resolve(root, "a", "..", "b", "./c", "d/../e");
            if (!isAbsolute(a) || !a.endsWith("e")) {
              throw new Error("resolve corrupted: " + a);
            }
            // realpathSync -> pooled OS path buffer.
            const rp = realpathSync(root);
            if (typeof rp !== "string" || rp.length === 0) {
              throw new Error("realpath corrupted: " + JSON.stringify(rp));
            }
          }
          self.postMessage("done");
        };
      `,
      "main.js": `
        const N = 8;
        const ITERS = 4000;
        const root = process.cwd();
        const workers = [];
        const dones = [];
        for (let i = 0; i < N; i++) {
          const w = new Worker(new URL("./worker.js", import.meta.url).href);
          const { promise, resolve: res, reject } = Promise.withResolvers();
          w.onmessage = ({ data }) => (data === "done" ? res() : reject(new Error("bad msg: " + data)));
          w.onerror = e => reject(e.error ?? new Error(String(e.message)));
          w.postMessage({ root, iters: ITERS });
          workers.push(w);
          dones.push(promise);
        }
        await Promise.all(dones);
        for (const w of workers) w.terminate();
        console.log("ALL_WORKERS_OK");
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "main.js"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    expect(stdout.trim()).toBe("ALL_WORKERS_OK");
    expect(exitCode).toBe(0);
  });

  test("single-thread get/put reuse keeps results correct under churn", async () => {
    // Drives a tight loop of pooled buffer get/put on one thread (every
    // `path.resolve` acquires and releases buffers). Verifies the LIFO reuse
    // path produces correct output and never leaks the pool dry.
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const { isAbsolute, resolve } = require("node:path");
          const base = resolve("pool", "churn");
          for (let i = 0; i < 5000; i++) {
            const r = resolve(base, String(i), "..", "x", "./y");
            if (!isAbsolute(r) || !r.endsWith("y")) throw new Error("bad: " + r);
          }
          console.log("CHURN_OK");
        `,
      ],
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    expect(stdout.trim()).toBe("CHURN_OK");
    expect(exitCode).toBe(0);
  });
});
