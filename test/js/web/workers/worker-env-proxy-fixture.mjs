// Runs fetch() inside workers whose proxy environment differs from the main
// thread's, and prints which requests went through the proxy. argv[2] picks
// the Worker constructor: "node" (node:worker_threads) or "web" (globalThis.Worker).
import { isMainThread, parentPort, Worker as NodeWorker, workerData } from "node:worker_threads";

async function workerBody(data, reply) {
  for (const [key, value] of Object.entries(data.assign ?? {})) process.env[key] = value;
  const res = await fetch(data.url);
  reply(await res.text());
}

if (!isMainThread) {
  if (workerData) {
    await workerBody(workerData, msg => parentPort.postMessage(msg));
  } else {
    // Web Worker: the scenario arrives as the first message.
    self.onmessage = e => workerBody(e.data, msg => postMessage(msg));
  }
} else {
  const kind = process.argv[2];
  // Any request that reaches this server was sent to the proxy (absolute-form).
  const proxy = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("VIA-PROXY") });
  const origin = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("DIRECT") });
  const url = `http://127.0.0.1:${origin.port}/`;
  const P = `http://127.0.0.1:${proxy.port}`;
  const file = new URL(import.meta.url);

  function run(env, assign) {
    const data = { url, assign };
    return new Promise((resolve, reject) => {
      if (kind === "node") {
        const w = new NodeWorker(file, { env, workerData: data });
        w.once("message", resolve);
        w.once("error", reject);
      } else {
        const w = new Worker(file.href, { env });
        w.onmessage = e => {
          resolve(e.data);
          w.terminate();
        };
        w.onerror = e => reject(e.error ?? new Error(e.message));
        w.postMessage(data);
      }
    });
  }

  // A worker's environment is captured when it is constructed, so all five run
  // at once; only the construction order relative to the main-thread write matters.
  const pending = {};
  // The worker's own env names a proxy; the main thread has none.
  pending.workerEnvProxy = run({ HTTP_PROXY: P });
  // The worker's env also excludes the origin with NO_PROXY.
  pending.workerEnvNoProxy = run({ HTTP_PROXY: P, NO_PROXY: "127.0.0.1,localhost" });
  // The worker assigns process.env.HTTP_PROXY at runtime before it fetches.
  pending.workerRuntimeProxy = run({}, { HTTP_PROXY: P });
  // The main thread sets a proxy at runtime; the worker's env has none.
  process.env.HTTP_PROXY = P;
  pending.mainProxyWorkerEnvEmpty = run({});
  // ...and a worker env that names the proxy but excludes the origin.
  pending.mainProxyWorkerNoProxy = run({ HTTP_PROXY: P, NO_PROXY: "127.0.0.1" });

  const results = {};
  for (const [name, promise] of Object.entries(pending)) results[name] = await promise;
  console.log(JSON.stringify(results));
  proxy.stop(true);
  origin.stop(true);
  process.exit(0);
}
