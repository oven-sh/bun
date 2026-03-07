// Subprocess fixture for fetch-proxy-tls-intern-race.test.ts.
//
// Creates the conditions for the SSLConfig intern/deref race within a single
// bun process. The race is between the JS thread (intern) and the HTTP thread
// (deref) — both share the same process-level SSLConfig.GlobalRegistry.
//
// Workers are REQUIRED: with a single JS thread, AsyncHTTP's callback ordering
// (client.deinit() before callback.function()) prevents intern() from ever
// overlapping with deref(). Workers provide independent JS threads whose
// intern() calls can race against the driver's HTTP-thread deref().
//
// The parent test spawns this as a subprocess and checks for exit 0. If the
// race triggers (on unfixed code), debugAssert in ref() or assertValid()'s
// debug.magic check catches it and the process crashes with non-zero exit.

import { Worker } from "node:worker_threads";

const BACKEND_PORT = Number(process.env.BACKEND_PORT);
const PROXY_PORT = Number(process.env.PROXY_PORT);
const DRIVER_ITERATIONS = Number(process.env.DRIVER_ITERATIONS || 100);
const NUM_PROBES = Number(process.env.NUM_PROBES || 2);
const HARD_CAP_MS = Number(process.env.HARD_CAP_MS || 15000);

if (!BACKEND_PORT || !PROXY_PORT) {
  console.error("BACKEND_PORT and PROXY_PORT must be set");
  process.exit(2);
}

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

const stopBuf = new SharedArrayBuffer(4);
const stopFlag = new Int32Array(stopBuf);

const probeWorkers: Worker[] = [];
const probePromises: Promise<number>[] = [];
for (let i = 0; i < NUM_PROBES; i++) {
  const w = new Worker(probe, {
    eval: true,
    workerData: { bp: BACKEND_PORT, pp: PROXY_PORT, stopBuf },
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
  workerData: { bp: BACKEND_PORT, pp: PROXY_PORT, n: DRIVER_ITERATIONS },
});
const driverPromise = new Promise<number>(resolve => {
  d.on("message", (n: number) => resolve(n));
  d.on("error", () => resolve(-1));
  d.on("exit", (code: number) => {
    if (code !== 0) resolve(-1);
  });
});

// Hard cap: if neither the race nor the driver finishes quickly, stop
// probes anyway so the process completes in bounded time.
const capTimer = setTimeout(() => Atomics.store(stopFlag, 0, 1), HARD_CAP_MS);

const driverOk = await Promise.race([
  driverPromise,
  new Promise<number>(resolve => setTimeout(() => resolve(-2), HARD_CAP_MS)),
]);
clearTimeout(capTimer);
Atomics.store(stopFlag, 0, 1);
const probeCounts = await Promise.all(probePromises);

// Cleanup — fire and forget (aborted fetches leave tasks that can block awaits).
d.terminate();
for (const w of probeWorkers) w.terminate();

// Report results via stdout. If we reach this point, no crash.
// driverOk: -2 means hard cap hit (probes congested proxy, driver stalled).
//           -1 means worker errored.
//           >=0 means completed successfully.
process.stdout.write(JSON.stringify({ driverOk, probeCounts }) + "\n");
process.exit(0);
