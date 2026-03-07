// Regression test: SSLConfig intern/deref race (UAF) — see PR #27838, #27863
//
// Non-deterministic by nature: the race window between deref()'s fetchSub(1→0)
// and destroy()'s mutex.lock() is ~10 CPU cycles in release. This test creates
// the conditions for the race but won't catch it every run. Its value is:
//   - On unfixed code: occasionally crashes (assert in debug, segfault in release+ASAN)
//   - On fixed code: never crashes (upgrade() refuses 0→1 CAS)
//   - Regression detection: if the fix is ever reverted, this test will catch it
//     eventually across enough CI runs.
//
// For a deterministic reproduction (debug+ASAN with BUN_DEBUG_SSLConfig=1
// widening the window via stderr logging), see #27863.
//
// Pattern:
//   - Driver worker: serial proxy+TLS fetches with 1ms gaps. With keepalive:false
//     and no ca/cert/key (requires_custom_request_ctx=false), the SSL context
//     cache doesn't hold a ref, so refcount cycles through 0 each iteration.
//   - Probe workers: setImmediate loop firing fetch+immediate-abort. Each tick
//     calls intern() then abort triggers a fast deref. These probe the race
//     window whenever driver's deref happens.

import { expect, test } from "bun:test";
import { tls as tlsCert } from "harness";
import { once } from "node:events";
import net from "node:net";
import { Worker } from "node:worker_threads";

async function createConnectProxy() {
  const server = net.createServer(client => {
    let head = Buffer.alloc(0);
    const onData = (chunk: Buffer) => {
      head = Buffer.concat([head, chunk]);
      const headerEnd = head.indexOf("\r\n\r\n");
      if (headerEnd === -1) return;
      client.removeListener("data", onData);
      const firstLine = head.subarray(0, head.indexOf("\r\n")).toString("latin1");
      const [, hostPort] = firstLine.split(" ");
      const colon = hostPort!.lastIndexOf(":");
      const host = hostPort!.slice(0, colon);
      const port = Number(hostPort!.slice(colon + 1));
      const upstream = net.connect(port, host, () => {
        client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        const extra = head.subarray(headerEnd + 4);
        if (extra.length > 0) upstream.write(extra);
        client.pipe(upstream);
        upstream.pipe(client);
      });
      upstream.on("error", () => client.destroy());
      client.on("error", () => upstream.destroy());
    };
    client.on("data", onData);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return { server, port: (server.address() as net.AddressInfo).port };
}

test("SSLConfig intern/deref race does not cause use-after-free", async () => {
  using backend = Bun.serve({
    port: 0,
    tls: tlsCert,
    fetch() {
      return new Response("ok");
    },
  });

  const proxy = await createConnectProxy();

  // Driver: serial fetches with gaps → cycles refcount through 0 repeatedly.
  const driver = `
    const { workerData, parentPort } = require("worker_threads");
    async function run() {
      let ok = 0;
      for (let i = 0; i < workerData.n; i++) {
        try {
          const r = await fetch("https://127.0.0.1:" + workerData.bp + "/", {
            proxy: "http://127.0.0.1:" + workerData.pp,
            keepalive: false,
            tls: { rejectUnauthorized: false },
          });
          if ((await r.text()) === "ok") ok++;
        } catch {}
        await Bun.sleep(1);
      }
      parentPort.postMessage(ok);
    }
    run();
  `;

  // Probe: tight intern() loop via fetch+abort. setImmediate keeps the JS
  // event loop ticking fast so intern calls probe the race window constantly.
  // Stops when the driver signals completion via SharedArrayBuffer.
  const probe = `
    const { workerData, parentPort } = require("worker_threads");
    const stopFlag = new Int32Array(workerData.stopBuf);
    let probes = 0;
    function tick() {
      if (Atomics.load(stopFlag, 0) !== 0) {
        parentPort.postMessage(probes);
        return;
      }
      const ac = new AbortController();
      fetch("https://127.0.0.1:" + workerData.bp + "/", {
        proxy: "http://127.0.0.1:" + workerData.pp,
        keepalive: false,
        tls: { rejectUnauthorized: false },
        signal: ac.signal,
      }).catch(() => {});
      ac.abort();
      probes++;
      setImmediate(tick);
    }
    tick();
  `;

  const DRIVER_ITERATIONS = 100;
  const NUM_PROBES = 2;
  const HARD_CAP_MS = 15000;

  // NOTE: For deterministic reproduction on debug+ASAN builds, run with
  // BUN_DEBUG_SSLConfig=1. That enables scoped stderr logging in
  // ref_count.zig's deref() and SSLConfig.zig's destroy(), widening the
  // race window from ~10 CPU cycles to ~100μs+ via stderr write syscalls.
  // See PR #27863 for the full deterministic repro recipe.

  const stopBuf = new SharedArrayBuffer(4);
  const stopFlag = new Int32Array(stopBuf);

  const probeWorkers: Worker[] = [];
  const probePromises: Promise<number>[] = [];
  for (let i = 0; i < NUM_PROBES; i++) {
    const w = new Worker(probe, {
      eval: true,
      workerData: { bp: backend.port, pp: proxy.port, stopBuf },
    });
    probeWorkers.push(w);
    probePromises.push(
      new Promise<number>(resolve => {
        w.on("message", (n: number) => resolve(n));
        w.on("error", () => resolve(-1));
        w.on("exit", (code: number) => {
          if (code !== 0) resolve(-1);
        });
      }),
    );
  }

  const d = new Worker(driver, {
    eval: true,
    workerData: { bp: backend.port, pp: proxy.port, n: DRIVER_ITERATIONS },
  });
  const driverPromise = new Promise<number>(resolve => {
    d.on("message", (n: number) => resolve(n));
    d.on("error", () => resolve(-1));
    d.on("exit", (code: number) => {
      if (code !== 0) resolve(-1);
    });
  });

  // Hard cap: if neither the race nor the driver finishes quickly, stop
  // probes anyway so the test completes in bounded time. This handles
  // the case where probe congestion stalls the driver.
  const capTimer = setTimeout(() => Atomics.store(stopFlag, 0, 1), HARD_CAP_MS);

  const driverOk = await Promise.race([
    driverPromise,
    new Promise<number>(resolve => setTimeout(() => resolve(-2), HARD_CAP_MS)),
  ]);
  clearTimeout(capTimer);
  // Signal probes to stop now that the driver is done (or capped).
  Atomics.store(stopFlag, 0, 1);
  const probeCounts = await Promise.all(probePromises);

  // If we reach this point without crashing, the race didn't trigger.
  // Under probe congestion the driver may not finish (-2), but that's fine —
  // the real assertion is that we didn't crash. Only verify driver success
  // if it actually completed.
  if (driverOk >= 0) {
    expect(driverOk).toBeGreaterThanOrEqual(DRIVER_ITERATIONS * 0.8);
  }
  // Probes should have fired (sanity check they were actually running).
  for (const count of probeCounts) {
    expect(count).toBeGreaterThan(50);
  }

  proxy.server.close();
}, 30_000);
