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
import { bunEnv, bunExe, isMacOS, isMacOSVersionAtLeast, isWindows, tempDir } from "harness";

// macOS 13 aarch64 CI runners show additional flakiness unrelated to the
// lazy-load race (the test setup passes reliably on macOS 14 aarch64,
// Windows 11 aarch64, and all x64 platforms). Limit macOS to >=14.
const shouldRun = (isMacOS && isMacOSVersionAtLeast(14)) || isWindows;

test.skipIf(!shouldRun)(
  "parallel Workers opening bun:sqlite Database do not race (#29275)",
  async () => {
    using dir = tempDir("issue-29275", {
      // Worker opens a Database at module load. The buggy build segfaults
      // inside \`new Database\` during the lazy-load race between two workers
      // starting at the same time.
      "worker.js": `
        import { Database } from "bun:sqlite";
        new Database(":memory:");
        postMessage("done");
      `,
      "repro.js": `
        const workerUrl = new URL("./worker.js", import.meta.url).href;
        function once() {
          return new Promise((resolve, reject) => {
            const worker = new Worker(workerUrl, { type: "module", smol: true });
            worker.onmessage = () => { worker.unref(); resolve(); };
            worker.onerror = (event) => {
              reject(event instanceof ErrorEvent ? (event.error ?? new Error(event.message)) : new Error("worker error"));
            };
          });
        }
        // Two concurrent workers are enough to expose the lazy-load race.
        // A buggy build segfaults before we print "ok".
        await Promise.all([once(), once()]);
        console.log("ok");
      `,
    });

    // Each fresh process exercises the lazy-load race at most once, so run
    // many processes. The race is intermittent (~1 in 5 on a buggy build) —
    // with this many tries, a regression reliably surfaces as a non-zero
    // exit code (often 139 on Unix, an access-violation code on Windows).
    async function run(i: number) {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "repro.js"],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      return { i, stdout: stdout.trim(), stderr: stderr.trim(), exitCode };
    }

    const RUNS = 5;
    const BATCH = 1;
    const failures: { i: number; stdout: string; stderr: string; exitCode: number }[] = [];
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
