// Fetches SERVER (through PROXY, when set) with a `checkServerIdentity` that returns only once the
// TLS handshake timeout of a later request has fired. That request is to SILENT, which never
// answers a ClientHello, and it starts after the handshake with SERVER.
import { once } from "node:events";
import { isMainThread, parentPort, Worker } from "node:worker_threads";

if (isMainThread) {
  const worker = new Worker(import.meta.path);
  await once(worker, "message");
  // 0 until the worker stores how its request ended.
  const silent = new Int32Array(new SharedArrayBuffer(4));
  const response = await fetch(process.env.SERVER!, {
    keepalive: false,
    proxy: process.env.PROXY || false,
    tls: {
      ca: process.env.CA,
      checkServerIdentity() {
        worker.postMessage(silent);
        Atomics.wait(silent, 0, 0);
      },
    },
  });
  console.log(["checkServerIdentity did not run", "TimeoutError", "not a TimeoutError"][Atomics.load(silent, 0)]);
  console.log(await response.text());
  await worker.terminate();
} else {
  parentPort!.on("message", async (silent: Int32Array) => {
    const outcome = await fetch(process.env.SILENT!, { keepalive: false, proxy: false }).then(
      () => "resolved",
      e => e.name,
    );
    Atomics.store(silent, 0, outcome === "TimeoutError" ? 1 : 2);
    Atomics.notify(silent, 0);
  });
  parentPort!.postMessage("ready");
}
