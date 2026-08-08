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

  // IsoSubspace lower-tier puts the first numberOfLowerTierPreciseCells (8)
  // cells of each wrapper type into PreciseAllocations and the rest into a
  // MarkedBlock; lastChanceToFinalize sweeps MarkedBlocks first. Twelve
  // live sessions (twenty-four with the server side) push session and
  // stream wrappers past the lower tier so their blocks are swept before
  // the two endpoints, whose finalizer then runs lsquic_engine_destroy.
  const held = [];
  for (let i = 0; i < 12; i++) {
    const c = await connect(server.address, {
      alpn: "wq",
      servername: "localhost",
      verifyPeer: "manual",
      transportParams: { maxIdleTimeout: 30 },
    });
    c.closed.catch(() => {});
    await c.opened;
    const st = await c.createBidirectionalStream({
      body: new Uint8Array(Buffer.alloc(1 << 16, 120)),
    });
    st.closed.catch(() => {});
    held.push(c, st);
  }

  parentPort.postMessage("up");
  await new Promise(() => {});
`;

for (let round = 0; round < 2; round++) {
  const w = new Worker(src, { eval: true, workerData });
  await new Promise<void>((resolve, reject) => {
    w.once("message", () => resolve());
    w.once("error", reject);
  });
  await w.terminate();
}

console.log("PASS");
