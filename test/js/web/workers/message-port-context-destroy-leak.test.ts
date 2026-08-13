import { expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isWindows } from "harness";

// MessagePort::jsRef() takes a self-ref() on the C++ MessagePort (plus an
// event-loop ref) when .onmessage is assigned or .ref() is called. The only
// path that released it was an explicit .close()/.unref() from JS. When a
// Worker (or any owning context) is torn down without that, contextDestroyed()
// → close() ran but never dropped the self-ref, so every such MessagePort
// leaked for the lifetime of the process.
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
        const rss = process.platform === "darwin" && typeof Bun.unsafe.memoryFootprint === "function" ? Bun.unsafe.memoryFootprint : process.memoryUsage.rss;
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

        const rssBefore = rss();
        for (let i = 0; i < 8; i++) await runWorker();
        Bun.gc(true);
        Bun.gc(true);
        const rssAfter = rss();

        const deltaMB = (rssAfter - rssBefore) / 1024 / 1024;
        // 8 workers × 8000 ports: when leaking, each MessagePort plus its
        // pipe bookkeeping is ~1 KB, so growth is ~50 MB. When fixed,
        // growth is allocator noise (typically under 15 MB).
        // ASAN's quarantine retains freed allocations so widen the threshold there.
        if (deltaMB > ${isASAN ? 200 : 30}) {
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

// The other half of the contract above: once the wrapper and the peer are collected, the
// self-ref taken by .ref() is the only thing keeping the native port alive. A context that
// is torn down without a stop phase (a collected ShadowRealm global here) reaches
// contextDestroyed() -> close() directly, and close() drops that self-ref part-way
// through, so it has to hold its own reference for the rest of the teardown.
//
// ASAN only: the port lives in a bmalloc heap, which Malloc=1 routes to the system
// allocator so ASAN can see a read of the freed port.
test.skipIf(!isASAN)(
  "closing a ref()'d port during context destruction does not free it mid-close",
  async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const { heapStats } = require("bun:jsc");
       const globals = () => heapStats().objectTypeCounts.GlobalObject;
       const baseline = globals();
       let realm = new ShadowRealm();
       realm.evaluate("(() => { const { port1 } = new MessageChannel(); port1.ref(); })()");
       // Collect the wrapper and the peer while the realm is still alive: the ref()'d native
       // port now survives on its self-ref alone.
       for (let i = 0; i < 5; i++) Bun.gc(true);
       // Drop the realm. Destroying its global destroys the context the port is registered on.
       // A stale stack slot can keep the realm alive through a collection or two, so collect
       // (with a different call in between each time) until its global is actually gone.
       realm = null;
       let collected = false;
       for (let i = 0; i < 50 && !collected; i++) {
         Bun.gc(true);
         collected = globals() === baseline;
       }
       console.log(collected ? "PASS" : "the realm's global was never collected");`,
      ],
      env: { ...bunEnv, ...(isWindows ? {} : { Malloc: "1" }) },
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    expect(stdout).toBe("PASS\n");
    expect(exitCode).toBe(0);
  },
  // The passing run takes about a second; a failing one has to symbolize an ASAN report
  // for the debug binary first, which takes longer than the default timeout.
  30_000,
);
