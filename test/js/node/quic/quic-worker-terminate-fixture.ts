// Tearing down a terminated Worker's VM finalizes its endpoints, sessions and streams in arbitrary order.
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

  // JSC allocates the first 8 cells of each type as PreciseAllocations and the rest in a MarkedBlock,
  // and it sweeps MarkedBlocks first. With 12 sessions, some are finalized before the two endpoints.
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
    w.once("exit", code => reject(new Error(`worker exited with code ${code} before posting "up"`)));
  });
  await w.terminate();
}

console.log("PASS");
