// Serializes a 2 MiB string 64 times and keeps no result. Prints how much
// the RSS grew, as {"deltaMiB": n}. argv[2] says where each result goes:
//   "node:v8", "bun:jsc": the result of that serialize() is dropped.
//   "worker": a Worker takes the ArrayBuffer of a node:v8 result by transfer
//   and drops it.
const { Worker, isMainThread, parentPort } = require("node:worker_threads");
const v8 = require("node:v8");
const jsc = require("bun:jsc");

if (isMainThread) {
  main(process.argv[2]);
} else {
  // `null` asks for a collection. Every eighth buffer gets one too.
  let taken = 0;
  parentPort.on("message", buffer => {
    if (buffer === null || ++taken % 8 === 0) Bun.gc(true);
    parentPort.postMessage(null);
  });
}

async function main(sink) {
  let worker;
  let reply = Promise.withResolvers();
  if (sink === "worker") {
    worker = new Worker(__filename);
    worker.on("message", () => reply.resolve());
    worker.on("error", error => reply.reject(error));
    worker.on("exit", code => reply.reject(new Error(`the Worker exited with code ${code}`)));
  }
  const send = (message, transfer) => {
    reply = Promise.withResolvers();
    worker.postMessage(message, transfer);
    return reply.promise;
  };

  const value = Buffer.alloc(2 << 20, "a").toString();
  const serialize = sink === "bun:jsc" ? jsc.serialize : v8.serialize;
  const round = async () => {
    const result = serialize(value);
    if (worker) await send(result.buffer, [result.buffer]);
  };
  const collect = async () => {
    if (worker) await send(null);
    Bun.gc(true);
  };

  for (let i = 0; i < 8; i++) await round();
  await collect();
  const before = process.memoryUsage.rss();
  for (let i = 0; i < 64; i++) {
    await round();
    if (i % 8 === 7) Bun.gc(true);
  }
  await collect();
  const deltaMiB = Math.round((process.memoryUsage.rss() - before) / 1048576);
  await worker?.terminate();
  console.log(JSON.stringify({ deltaMiB }));
}
