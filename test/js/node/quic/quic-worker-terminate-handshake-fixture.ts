// Terminates a Worker while each of its server sessions is still in its handshake.
import { createSocket } from "node:dgram";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { connect } from "node:quic";
import { Worker } from "node:worker_threads";

const [keyPath, certPath] = process.argv.slice(2);
const key = readFileSync(keyPath, "utf8");
const cert = readFileSync(certPath, "utf8");
const sessions = 12;

const src = `
  const { parentPort, workerData } = require("node:worker_threads");
  const { listen, QuicEndpoint } = require("node:quic");
  const { createPrivateKey } = require("node:crypto");

  const spare = Array.from({ length: workerData.spareEndpoints }, () => new QuicEndpoint());
  let announced = 0;
  const server = await listen(
    session => {
      session.closed.catch(() => {});
      if (++announced === workerData.sessions) parentPort.postMessage("handshaking");
    },
    {
      sni: { "*": { keys: [createPrivateKey(workerData.key)], certs: [Buffer.from(workerData.cert)] } },
      alpn: "wq",
    },
  );
  parentPort.postMessage(server.address.port);
  await new Promise(() => {});
`;

// JSC sweeps the ninth and later cells of a type before the first eight (see
// quic-worker-terminate-fixture.ts). With no spare endpoint the server endpoint
// is swept after some of its sessions. With eight it is swept before all of them.
for (const spareEndpoints of [0, 8]) {
  const worker = new Worker(src, { eval: true, workerData: { key, cert, sessions, spareEndpoints } });
  const [serverPort] = (await once(worker, "message")) as [number];
  const handshaking = once(worker, "message");

  // The relay forwards the clients' packets and drops every answer, so the server starts
  // each handshake and none completes.
  const relay = createSocket("udp4");
  const forward = (packet: Buffer, from: { port: number }) => {
    if (from.port !== serverPort) relay.send(packet, serverPort, "127.0.0.1");
  };
  relay.on("message", forward);
  relay.bind(0, "127.0.0.1");
  await once(relay, "listening");

  const clients: any[] = [];
  for (let i = 0; i < sessions; i++) {
    const client = await connect(`127.0.0.1:${relay.address().port}`, {
      alpn: "wq",
      servername: "localhost",
      verifyPeer: "manual",
    });
    client.opened.catch(() => {});
    client.closed.catch(() => {});
    clients.push(client);
  }

  await handshaking;
  // Sending to the terminated server's closed port would give the relay a socket error.
  relay.off("message", forward);
  await worker.terminate();
  for (const client of clients) client.destroy();
  relay.close();
}

console.log("PASS");
