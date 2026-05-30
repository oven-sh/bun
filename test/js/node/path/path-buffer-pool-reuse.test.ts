import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { chmodSync } from "node:fs";
import { join } from "node:path";

// Behavioral regression guard for the path buffer pool rework
// (src/paths/path_buffer_pool.rs: now a process-global lock-free stack; and
// src/paths/Path.rs: `Path<U>` now owns its buffer via the pool's RAII guard).
//
// `Bun.which()` acquires a pooled buffer on every call (src/runtime/api/
// BunObject.rs: `let mut path_buf = bun_paths::path_buffer_pool::get();`), so
// these tests actually exercise the pool — unlike `node:path.resolve/join`,
// which use a separate per-VM scratch buffer and never touch the pool.
//
// The deep lock-free correctness is covered by the Rust Miri unit tests in
// src/paths/path_buffer_pool.rs; these add an end-to-end guard that the pooled
// buffer stays correct across (a) heavy single-thread get/put churn and (b)
// concurrent contention on the now-shared global pool from many threads. A
// buffer handed to two threads at once, or a use-after-free in pop/push, would
// corrupt the resolved path or crash under the debug (ASAN) build.
//
// Each call is compared against a reference `Bun.which` result computed once in
// the same process, so the assertions are robust to platform PATHEXT/case
// quirks — the point is the pooled buffer yields a *stable, correct* path.
const PROBE = isWindows ? "poolprobe.cmd" : "poolprobe";
const PROBE_CONTENT = isWindows ? "@echo off\r\nexit /b 0\r\n" : "#!/bin/sh\nexit 0\n";

describe.concurrent("path buffer pool (used by Bun.which)", () => {
  test("single-thread: Bun.which churns the pool and stays correct", async () => {
    using dir = tempDir("which-pool", { [PROBE]: PROBE_CONTENT });
    if (!isWindows) chmodSync(join(String(dir), PROBE), 0o755);

    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const expected = Bun.which("poolprobe");
          if (typeof expected !== "string" || expected.length === 0) {
            throw new Error("fixture not on PATH: " + expected);
          }
          // Each call takes + returns a pooled buffer; run many to churn it.
          for (let i = 0; i < 10000; i++) {
            const got = Bun.which("poolprobe");
            if (got !== expected) throw new Error("which #" + i + ": " + got);
            // A name that cannot resolve — pooled buffer reused, must stay null.
            if (Bun.which("definitely-missing-" + i) !== null) throw new Error("stale: " + i);
          }
          console.log("OK");
        `,
      ],
      env: { ...bunEnv, PATH: String(dir) },
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout.trim()).toBe("OK");
    expect(exitCode).toBe(0);
  });

  test("concurrent: many workers contend on the shared pool via Bun.which", async () => {
    using dir = tempDir("which-pool", { [PROBE]: PROBE_CONTENT });
    if (!isWindows) chmodSync(join(String(dir), PROBE), 0o755);

    using files = tempDir("which-pool-workers", {
      "worker.js": `
        self.onmessage = ({ data: { expected, iters } }) => {
          for (let i = 0; i < iters; i++) {
            const got = Bun.which("poolprobe");
            // Shared global pool: a buffer handed to two threads would produce
            // a wrong path here; a race/UAF in pop/push crashes under ASAN.
            if (got !== expected) throw new Error("which mismatch: " + got);
          }
          self.postMessage("done");
        };
      `,
      "main.js": `
        const N = 8;
        const ITERS = 2000;
        const expected = Bun.which("poolprobe");
        if (typeof expected !== "string" || expected.length === 0) {
          throw new Error("fixture not on PATH: " + expected);
        }
        const dones = [];
        const workers = [];
        for (let i = 0; i < N; i++) {
          const w = new Worker(new URL("./worker.js", import.meta.url).href);
          const { promise, resolve, reject } = Promise.withResolvers();
          w.onmessage = ({ data }) => (data === "done" ? resolve() : reject(new Error(data)));
          w.onerror = e => reject(e.error ?? new Error(String(e.message)));
          w.postMessage({ expected, iters: ITERS });
          workers.push(w);
          dones.push(promise);
        }
        await Promise.all(dones);
        for (const w of workers) w.terminate();
        console.log("ALL_WORKERS_OK");
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), join(String(files), "main.js")],
      env: { ...bunEnv, PATH: String(dir) },
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout.trim()).toBe("ALL_WORKERS_OK");
    expect(exitCode).toBe(0);
  });
});
