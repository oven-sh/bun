// Runs fetch() inside Web Workers whose proxy environment differs from the main thread's, and
// prints where each request went.

// Any request that reaches this server was sent to the proxy (absolute-form).
const proxy = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("VIA-PROXY") });
const origin = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("DIRECT") });
const url = `http://127.0.0.1:${origin.port}/`;
const P = `http://127.0.0.1:${proxy.port}`;

// The worker does one fetch per step, after it assigns that step's variables to its process.env.
const source = `self.onmessage = async ({ data: { url, steps } }) => {
  const went = [];
  for (const assign of steps) {
    Object.assign(process.env, assign);
    went.push(await (await fetch(url)).text());
  }
  postMessage(went);
};`;

function run(env, steps = [{}]) {
  const { promise, resolve, reject } = Promise.withResolvers();
  const worker = new Worker(URL.createObjectURL(new Blob([source])), { env });
  worker.onmessage = e => {
    resolve(e.data);
    worker.terminate();
  };
  worker.onerror = e => reject(e.error ?? new Error(e.message));
  worker.postMessage({ url, steps });
  return promise;
}

// A worker's environment is fixed when it is constructed, so the workers run at once. Only the
// order of construction against the main-thread write matters.
const pending = {
  // The worker's env names a proxy, the main thread has none. Then the worker excludes the origin.
  workerEnvProxy: run({ HTTP_PROXY: P }, [{}, { NO_PROXY: "127.0.0.1" }]),
};
process.env.HTTP_PROXY = P;
// The main thread has a proxy, the worker's env has none. Then the worker assigns one.
pending.mainProxyWorkerEnvEmpty = run({}, [{}, { HTTP_PROXY: P }]);
// The worker's env names the main thread's proxy and excludes the origin.
pending.mainProxyWorkerNoProxy = run({ HTTP_PROXY: P, NO_PROXY: "127.0.0.1" });

const results = {};
for (const [name, promise] of Object.entries(pending)) results[name] = await promise;
console.log(JSON.stringify(results));
proxy.stop(true);
origin.stop(true);
process.exit(0);
