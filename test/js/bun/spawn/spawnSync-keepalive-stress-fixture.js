// Everything that can touch the main loop's keep-alive while Bun.spawnSync has
// its private loop installed, at once: a GC ending inside spawnSync
// (FinalizationRegistry deferred work), a worker posting messages to this
// thread (cross-thread wakeups + tasks), and a listening server (a poll that
// must stay registered). After each round the main loop must still do I/O and
// its poll count must not have moved; at the end the process must exit on its
// own (a keep-alive leaked in the other direction would hang here).
const { getEventLoopStats } = require("bun:internal-for-testing");

const registry = new FinalizationRegistry(() => {});
const { BUN_JSC_collectContinuously, ...childEnv } = process.env;
const cmd = process.platform === "win32" ? ["cmd", "/c", "exit 0"] : ["true"];

const worker = new Worker(
  URL.createObjectURL(new Blob([`setInterval(() => postMessage(0), 1); postMessage(0);`])),
);
let received = 0;
await new Promise(resolve => {
  worker.onmessage = () => {
    received++;
    resolve();
  };
});

const server = Bun.serve({ port: 0, fetch: () => new Response("hi") });
const baseline = getEventLoopStats().numPolls;

for (let iter = 0; iter < 8; iter++) {
  for (let i = 0; i < 2000; i++) registry.register({ i }, i);
  const before = received;
  Bun.spawnSync(cmd, { env: childEnv });
  await new Promise(resolve => setImmediate(resolve));

  let timer;
  const body = await Promise.race([
    fetch(server.url).then(r => r.text()),
    new Promise(resolve => (timer = setTimeout(() => resolve("TIMEOUT"), 5000))),
  ]);
  clearTimeout(timer);
  if (body !== "hi") {
    console.log("HANG " + JSON.stringify({ iter, body, ...getEventLoopStats() }));
    process.exit(1);
  }
  // Worker messages posted during/after spawnSync were delivered.
  const deadline = performance.now() + 5000;
  while (received === before) {
    if (performance.now() > deadline) {
      console.log("NO WORKER MESSAGE " + JSON.stringify({ iter, ...getEventLoopStats() }));
      process.exit(1);
    }
    await new Promise(resolve => setImmediate(resolve));
  }

  const { numPolls } = getEventLoopStats();
  if (numPolls < baseline) {
    console.log("DRIFT " + JSON.stringify({ iter, baseline, ...getEventLoopStats() }));
    process.exit(1);
  }
}

server.stop(true);
worker.terminate();
console.log("OK");
