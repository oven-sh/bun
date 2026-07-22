import { expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isWindows } from "harness";

// On Windows WindowsLoop::get() passes a non-null uv_loop_t hint to
// uWS::Loop::get(), which leaves cleanMe = false, so on_thread_exit() never
// frees the wrapper. Each worker thread leaked its us_loop_t plus the
// 512 KiB recv_buf, 16 KiB send_buf, and two 16 KiB cork buffers.
// On POSIX cleanMe is true (no hint) and the existing free path works, so
// this test targets Windows only.
test.skipIf(!isWindows)("worker thread exit frees the uWS loop wrapper on Windows", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        const url = "data:text/javascript," + encodeURIComponent("self.postMessage(0)");

        async function cycle() {
          const w = new Worker(url);
          await new Promise(r => w.addEventListener("message", r, { once: true }));
          w.terminate();
          await new Promise(r => w.addEventListener("close", r, { once: true }));
        }

        // Warm up so the allocator high-water mark and per-thread caches are
        // established before we start measuring.
        for (let i = 0; i < 4; i++) await cycle();
        Bun.gc(true);

        const rssBefore = process.memoryUsage().rss;
        // 60 workers x ~560 KiB leaked wrapper = ~33 MiB when leaking.
        for (let i = 0; i < 60; i++) await cycle();
        Bun.gc(true);
        const rssAfter = process.memoryUsage().rss;

        const deltaMiB = (rssAfter - rssBefore) / 1024 / 1024;
        console.log("delta=" + deltaMiB.toFixed(2) + "MiB");
        // When leaking, 60 workers grow RSS by ~30 MiB. When fixed, growth is
        // allocator residue (typically under 6 MiB on release).
        if (deltaMiB > ${isASAN || isDebug ? 40 : 15}) {
          console.error("LEAK: RSS grew " + deltaMiB.toFixed(2) + " MiB over 60 worker cycles");
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
}, 120_000);
