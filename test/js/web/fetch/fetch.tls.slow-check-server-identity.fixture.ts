// Fetches SERVER (through PROXY, when set) with a `checkServerIdentity` that returns only once a
// timer as long as the TLS handshake timeout has fired. That timer is armed after the handshake
// with SERVER: it is the idle timeout of a request to SILENT, which never answers a ClientHello.
import { once } from "node:events";
import { isMainThread, parentPort, Worker } from "node:worker_threads";

if (isMainThread) {
  const worker = new Worker(import.meta.path);
  await once(worker, "message");
  const expired = new Int32Array(new SharedArrayBuffer(4));
  const response = await fetch(process.env.SERVER!, {
    keepalive: false,
    proxy: process.env.PROXY || false,
    tls: {
      ca: process.env.CA,
      checkServerIdentity() {
        worker.postMessage(expired);
        Atomics.wait(expired, 0, 0);
      },
    },
  });
  console.log(await response.text());
  await worker.terminate();
} else {
  parentPort!.on("message", async (expired: Int32Array) => {
    await fetch(process.env.SILENT!, { keepalive: false, proxy: false, timeout: 10_000 }).catch(() => {});
    Atomics.store(expired, 0, 1);
    Atomics.notify(expired, 0);
  });
  parentPort!.postMessage("ready");
}
