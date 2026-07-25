// Terminating a Worker that owns live node:quic endpoints + sessions + streams
// drives the VM's lastChanceToFinalize sweep, which finalizes the QUIC
// wrappers in unspecified order. The endpoint finalizer runs
// lsquic_engine_destroy, whose close path calls back into per-stream and
// per-session context pointers; if the stream/session wrappers were swept
// first, those contexts are freed and the callback is a use-after-free.
import { Worker } from "node:worker_threads";
import { readFileSync } from "node:fs";

const [keyPath, certPath] = process.argv.slice(2);
const workerData = {
  key: readFileSync(keyPath, "utf8"),
  cert: readFileSync(certPath, "utf8"),
};

const src = `
  const { parentPort, workerData } = require("node:worker_threads");
  const { listen, connect } = require("node:quic");
  const { createPrivateKey } = require("node:crypto");

  const key = createPrivateKey(workerData.key);
  const cert = Buffer.from(workerData.cert);

  const server = await listen(
    session => {
      session.onstream = stream => stream.closed.catch(() => {});
      session.closed.catch(() => {});
    },
    { sni: { "*": { keys: [key], certs: [cert] } }, alpn: "wq", transportParams: { maxIdleTimeout: 30 } },
  );

  // Several concurrent sessions, each churning bidi streams with a large body
  // so the lsquic stream is still open when terminate() lands. The sweep
  // order between these wrappers and the endpoint is what the test exercises.
  const payload = Buffer.alloc(1 << 20, 120);
  for (let i = 0; i < 3; i++) (async () => {
    for (;;) {
      try {
        const c = await connect(server.address, {
          alpn: "wq",
          servername: "localhost",
          verifyPeer: "manual",
          transportParams: { maxIdleTimeout: 30 },
        });
        c.closed.catch(() => {});
        await c.createBidirectionalStream({ body: new Uint8Array(payload) });
        await new Promise(r => setTimeout(r, 30));
        try { c.close(); } catch {}
      } catch {}
    }
  })();

  parentPort.postMessage("up");
  await new Promise(() => {});
`;

for (let round = 0; round < 10; round++) {
  const w = new Worker(src, { eval: true, workerData });
  await new Promise<void>((resolve, reject) => {
    w.once("message", () => resolve());
    w.once("error", reject);
  });
  // No observable signal to await: terminate() must land at a varied phase
  // of the connect/stream churn so the sweep sees live wrappers; awaiting a
  // specific worker event would collapse that distribution.
  await Bun.sleep(200 + ((round * 53) % 300));
  await w.terminate();
}

console.log("PASS");
