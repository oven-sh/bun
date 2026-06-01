import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Each VM (including every worker) allocates a WebCore::JSHeapData on creation
// via JSHeapData::ensureHeapData (the default !useGlobalGC path). It is owned by
// a raw JSVMClientData::m_heapData pointer that ~JSVMClientData used to leave
// dangling, so every terminated worker leaked its JSHeapData plus the three
// FastMalloc-backed IsoSubspaces it embeds. Release builds reuse the freed
// backing memory and the object is reachable at exit, so neither RSS nor LSAN
// reliably surfaces it — the deterministic signal is the live-instance count,
// which grew by one per `new Worker()` + `terminate()` cycle before the fix.
test("terminated workers do not leak their JSHeapData", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        const { jsHeapDataLiveCount } = require("bun:internal-for-testing");
        const url =
          "data:text/javascript," +
          encodeURIComponent('self.onmessage = () => {}; self.postMessage("ready");');

        async function runWorker() {
          const w = new Worker(url, { type: "module" });
          await new Promise((resolve, reject) => {
            w.onmessage = resolve;
            w.onerror = reject;
          });
          w.terminate();
          await new Promise(r => w.addEventListener("close", r, { once: true }));
        }

        // Worker teardown (WebWorker__destroy -> ~VM -> ~JSHeapData) runs on the
        // parent after the close task, so let the count settle after a batch.
        async function settle() {
          let prev = -1;
          for (let i = 0; i < 50; i++) {
            Bun.gc(true);
            await new Promise(r => setTimeout(r, 0));
            const now = jsHeapDataLiveCount();
            if (now === prev) return now;
            prev = now;
          }
          return jsHeapDataLiveCount();
        }

        // Warm up, then capture the settled baseline.
        for (let i = 0; i < 8; i++) await runWorker();
        const before = await settle();

        const BATCH = 50;
        for (let i = 0; i < BATCH; i++) await runWorker();
        const after = await settle();

        const leaked = after - before;
        // Before the fix: one leaked JSHeapData per worker (leaked === BATCH).
        // After the fix: the count returns to the baseline (leaked === 0). Allow
        // a tiny slack for any unrelated VM that a later tick might spin up.
        if (leaked > 2) {
          console.error("LEAK: " + leaked + " JSHeapData objects leaked across " + BATCH + " worker cycles");
          process.exit(1);
        }
        console.log("PASS leaked=" + leaked);
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(stdout).toContain("PASS");
  expect(exitCode).toBe(0);
}, 120_000);
