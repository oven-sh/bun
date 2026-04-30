import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";

// MessagePort::jsRef() takes a self-ref() on the C++ MessagePort (plus an
// event-loop ref) when .onmessage is assigned or .ref() is called. The only
// path that released it was an explicit .close()/.unref() from JS. When a
// Worker (or any owning context) is torn down without that, contextDestroyed()
// → close() ran but never dropped the self-ref, so every such MessagePort
// leaked for the lifetime of the process — along with its entries in the
// global allMessagePorts()/portToContextIdentifier() maps.
//
// Skipped on Windows: RSS there does not drop after worker threads exit (the
// per-thread mimalloc arenas stay committed), so the allocator residue from
// 11 workers alone exceeds the threshold regardless of whether ports leak.
// The fix is platform-agnostic C++; Linux/macOS coverage is sufficient.
test.skipIf(isWindows)(
  "MessagePort self-ref is released when the owning context is destroyed",
  async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const workerBody = ${JSON.stringify(`
          const keep = [];
          for (let i = 0; i < 8000; i++) {
            const { port1, port2 } = new MessageChannel();
            // Assigning onmessage calls MessagePort::jsRef() → self-ref().
            port1.onmessage = () => {};
            keep.push(port1, port2);
          }
          self.postMessage("ready");
          // Intentionally never call port1.close()/port1.unref() — the
          // terminate() from the parent is the only teardown path.
        `)};
        const url = "data:text/javascript," + encodeURIComponent(workerBody);

        async function runWorker() {
          const w = new Worker(url);
          await new Promise(r => w.addEventListener("message", r, { once: true }));
          w.terminate();
          await new Promise(r => w.addEventListener("close", r, { once: true }));
        }

        // Warm up so the allocator high-water mark and per-thread caches are
        // established before we start measuring.
        for (let i = 0; i < 3; i++) await runWorker();
        Bun.gc(true);
        Bun.gc(true);

        const rssBefore = process.memoryUsage().rss;
        for (let i = 0; i < 8; i++) await runWorker();
        Bun.gc(true);
        Bun.gc(true);
        const rssAfter = process.memoryUsage().rss;

        const deltaMB = (rssAfter - rssBefore) / 1024 / 1024;
        // 8 workers × 8000 ports: when leaking, each MessagePort plus its
        // global-map bookkeeping is ~1 KB, so growth is ~60 MB. When fixed,
        // growth is allocator noise (typically under 15 MB).
        if (deltaMB > 30) {
          console.error("LEAK: RSS grew " + deltaMB.toFixed(2) + " MB across 8 worker cycles");
          process.exit(1);
        }
        console.log("PASS delta=" + deltaMB.toFixed(2) + "MB");
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
  },
  120_000,
);
