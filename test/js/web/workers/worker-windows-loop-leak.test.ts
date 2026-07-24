import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isWindows } from "harness";

// On Windows WindowsLoop::get() passes a non-null uv_loop_t hint to
// uWS::Loop::get(), which left cleanMe = false, so on_thread_exit() never
// freed the wrapper. Each worker thread leaked its us_loop_t plus the
// 512 KiB recv_buf, 16 KiB send_buf, and two 16 KiB cork buffers.
// On POSIX cleanMe is true (no hint) and the existing free path already
// worked, so these tests target Windows only.
//
// mimalloc reclaims abandoned thread heaps, so the leak grows slower than
// 560 KiB/worker in practice; a long warm-up followed by a long measured run
// gives a clear monotone-growth vs plateau separation.
describe.skipIf(!isWindows)("worker thread exit frees the uWS loop wrapper on Windows", () => {
  async function run(workerBody: string) {
    const threshold = isASAN || isDebug ? 25 : 15;
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const url = "data:text/javascript," + encodeURIComponent(${JSON.stringify(workerBody)});

        async function cycle() {
          const w = new Worker(url);
          await new Promise(r => w.addEventListener("message", r, { once: true }));
          w.terminate();
          await new Promise(r => w.addEventListener("close", r, { once: true }));
        }

        for (let i = 0; i < 50; i++) await cycle();
        Bun.gc(true);

        const rssBefore = process.memoryUsage().rss;
        for (let i = 0; i < 200; i++) await cycle();
        Bun.gc(true);
        const rssAfter = process.memoryUsage().rss;

        const deltaMiB = (rssAfter - rssBefore) / 1024 / 1024;
        console.log("delta=" + deltaMiB.toFixed(2) + "MiB");
        if (deltaMiB > ${threshold}) {
          console.error("LEAK: RSS grew " + deltaMiB.toFixed(2) + " MiB over 200 worker cycles (threshold ${threshold})");
          process.exit(1);
        }
      `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    expect(stdout).toContain("delta=");
    expect(exitCode).toBe(0);
  }

  test.concurrent("minimal worker", () => run("self.postMessage(0)"), 120_000);

  // A pending setImmediate routes event_loop.deinit() through
  // set_enable_keeping_event_loop_alive, which used to call uws_loop() on
  // Windows after Loop::shutdown() had nulled the thread-locals, lazily
  // re-creating (and re-leaking) a fresh wrapper + uv_loop_t.
  test.concurrent("worker with pending setImmediate", () => run("setImmediate(()=>{}); self.postMessage(0)"), 120_000);
});
