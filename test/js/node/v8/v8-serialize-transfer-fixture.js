// Each round moves the ArrayBuffer of a v8.serialize() Buffer to a Worker and
// shares the SharedArrayBuffer of a bun:jsc serialize() with it. The Worker
// reads both and drops them. Prints what the Worker read, as one line of JSON.
const { Worker, isMainThread, parentPort } = require("node:worker_threads");
const v8 = require("node:v8");
const jsc = require("bun:jsc");

const ROUNDS = 8;

if (isMainThread) {
  main();
} else {
  parentPort.on("message", ({ moved, shared }) => {
    const round = [v8.deserialize(Buffer.from(moved)).round, jsc.deserialize(shared).round];
    // Collects the buffers of the rounds before this one, on this thread.
    Bun.gc(true);
    parentPort.postMessage(round);
  });
}

async function main() {
  const worker = new Worker(__filename);
  let reply;
  worker.on("message", round => reply.resolve(round));
  worker.on("error", error => reply.reject(error));
  worker.on("exit", code => reply.reject(new Error(`the Worker exited with code ${code}`)));

  const result = { detached: true, moved: [], shared: [] };
  for (let round = 0; round < ROUNDS; round++) {
    const bytes = v8.serialize({ round });
    const shared = jsc.serialize({ round });
    reply = Promise.withResolvers();
    worker.postMessage({ moved: bytes.buffer, shared }, [bytes.buffer]);
    result.detached &&= bytes.byteLength === 0;
    const [fromMoved, fromShared] = await reply.promise;
    result.moved.push(fromMoved);
    result.shared.push(fromShared);
    Bun.gc(true);
  }
  await worker.terminate();
  Bun.gc(true);
  console.log(JSON.stringify(result));
}
