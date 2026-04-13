// Issue #29275 — two Workers concurrently importing `bun:sqlite` and opening
// a Database raced each other through `lazyLoadSQLite()` on macOS (and on
// Windows, where the same lazy-dlopen path is used). One thread would publish
// the library handle before all the function-pointer slots were filled, the
// other would skip the load and call a still-null `sqlite3_config` —
// segfault at address 0x0.
//
// On Linux libsqlite3 is statically linked (LAZY_LOAD_SQLITE=0), so there is
// no lazy-load race to hit. The test is gated to the platforms that have
// the code path being exercised.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isMacOS, isWindows, tempDir } from "harness";

test.skipIf(!isMacOS && !isWindows)(
  "parallel Workers opening bun:sqlite Database do not race (#29275)",
  async () => {
    using dir = tempDir("issue-29275", {
      "worker.js": `
        import { Database } from "bun:sqlite";
        globalThis.onmessage = () => {
          new Database(":memory:");
          postMessage("done");
        };
      `,
      "repro.js": `
        const workerUrl = new URL("./worker.js", import.meta.url).href;
        function once() {
          return new Promise((resolve, reject) => {
            const worker = new Worker(workerUrl, { type: "module" });
            worker.onmessage = () => {
              worker.terminate();
              resolve();
            };
            worker.onerror = (event) => {
              reject(event instanceof ErrorEvent ? (event.error ?? new Error(event.message)) : new Error("worker error"));
            };
            worker.postMessage("go");
          });
        }
        // Fan out many parallel workers so the first batch hits the lazy-load
        // race. A buggy build segfaults before we print "ok".
        const jobs = [];
        for (let i = 0; i < 16; i++) jobs.push(once());
        await Promise.all(jobs);
        console.log("ok");
      `,
    });

    // Each fresh process exercises the lazy-load race at most once, so run
    // many processes. The race is intermittent (~1 in 5 on a buggy build) —
    // with this many tries, a regression reliably surfaces as exit code 139.
    async function run(i: number) {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "repro.js"],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      return { i, stdout: stdout.trim(), exitCode };
    }

    const RUNS = 40;
    const BATCH = 8;
    const failures: { i: number; stdout: string; exitCode: number }[] = [];
    for (let start = 0; start < RUNS; start += BATCH) {
      const batch = await Promise.all(Array.from({ length: Math.min(BATCH, RUNS - start) }, (_u, k) => run(start + k)));
      for (const r of batch) {
        if (r.exitCode !== 0 || r.stdout !== "ok") failures.push(r);
      }
    }
    expect(failures).toEqual([]);
  },
  120_000,
);
