// Deterministic reproduction of the SSLConfig intern/deref race (PR #27838)
//
// NOT a bun:test file — run directly as a script:
//   cmake -B build/asan -DCMAKE_BUILD_TYPE=Debug -DENABLE_ASAN=ON
//   ninja -C build/asan bun-debug
//   BUN_DEBUG_QUIET_LOGS=1 BUN_DEBUG_SSLConfig=1 ./build/asan/bun-debug run test/js/web/fetch/sslconfig-race-repro.ts
//
// On unfixed code (main at this branch's merge-base), this crashes with:
//   panic: reached unreachable code
//   ref_count.zig:476 — bun.assert(debug.magic == .valid) in assertValid
//   ref_count.zig:237 — count.debug.assertValid() in ref
//   SSLConfig.zig:313 — existing.ref() in intern
//   fetch.zig:471    — GlobalRegistry.intern
//
// The log right before the crash shows the race:
//   [sslconfig] 0x...  deref 1 - 0
//   [sslconfig] destroy 0x...: strong reached 0, freeing
//   [sslconfig] 0x...    ref 0 - 1      ← 0→1 resurrection on dying config!
//
// Mechanism:
//   - BUN_DEBUG_SSLConfig=1 enables scoped stderr logging in ref_count.zig's
//     deref() and SSLConfig.zig's destroy(). These writes widen the race window
//     from ~10 CPU cycles to ~100μs+.
//   - Driver worker: serial fetches with 1ms gaps → refcount cycles through 0.
//   - Probe workers: setImmediate loop calling fetch+abort → constant intern() probes.
//   - When driver's deref (on HTTP thread) starts writing logs, a probe's intern()
//     (on worker JS thread) slips into the widened window.

import { Worker } from "node:worker_threads";
import { once } from "node:events";
import net from "node:net";
import { tls as tlsCert } from "harness";

const backend = Bun.serve({
  port: 0,
  tls: tlsCert,
  fetch() { return new Response("ok"); },
});

const proxy = net.createServer(client => {
  let head = Buffer.alloc(0);
  const onData = (chunk: Buffer) => {
    head = Buffer.concat([head, chunk]);
    const headerEnd = head.indexOf("\r\n\r\n");
    if (headerEnd === -1) return;
    client.removeListener("data", onData);
    const firstLine = head.subarray(0, head.indexOf("\r\n")).toString("latin1");
    const [, hostPort] = firstLine.split(" ");
    const colon = hostPort!.lastIndexOf(":");
    const upstream = net.connect(Number(hostPort!.slice(colon + 1)), hostPort!.slice(0, colon), () => {
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
proxy.listen(0, "127.0.0.1");
await once(proxy, "listening");
const pp = (proxy.address() as net.AddressInfo).port;

console.error(`[repro] backend=${backend.port} proxy=${pp}`);

// Driver: cycles refcount through 0 repeatedly via serial fetches with gaps.
const driver = `
  const { workerData, parentPort } = require("worker_threads");
  async function run() {
    for (let i = 0; i < workerData.n; i++) {
      try {
        const r = await fetch("https://127.0.0.1:" + workerData.bp + "/", {
          proxy: "http://127.0.0.1:" + workerData.pp,
          keepalive: false,
          tls: { rejectUnauthorized: false },
        });
        await r.text();
      } catch {}
      await Bun.sleep(1);
    }
    parentPort.postMessage(workerData.n);
  }
  run();
`;

// Probe: fires intern() as fast as possible (fetch + immediate abort).
// Each tick calls intern (ref) then abort triggers a quick deref.
const probe = `
  const { workerData, parentPort } = require("worker_threads");
  let stop = false;
  let probes = 0;
  function tick() {
    if (stop) return;
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
  setTimeout(() => { stop = true; parentPort.postMessage(probes); }, workerData.ms);
`;

const promises: Promise<number>[] = [];

const d = new Worker(driver, {
  eval: true,
  workerData: { bp: backend.port, pp, n: 2000 },
});
promises.push(new Promise<number>(resolve => {
  d.on("message", resolve);
  d.on("error", () => resolve(-1));
}));

for (let i = 0; i < 2; i++) {
  const w = new Worker(probe, {
    eval: true,
    workerData: { bp: backend.port, pp, ms: 60000 },
  });
  promises.push(new Promise<number>(resolve => {
    w.on("message", resolve);
    w.on("error", () => resolve(-1));
  }));
}

const results = await Promise.all(promises);
console.error("[repro] results:", results, "(if you see this, race didn't trigger — try again or increase iterations)");
proxy.close();
backend.stop();
