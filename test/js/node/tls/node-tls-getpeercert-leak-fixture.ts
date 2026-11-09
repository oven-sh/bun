// Fixture for node-tls-getpeercert-leak.test.ts.
//
// Opens one mTLS connection inside this process, then calls every form of
// getPeerCertificate() on the server-side socket in rounds. Each round ends
// with a full GC and one sample of the resident memory. Prints one JSON line
// with the peer certificate the loop saw and the samples. The test decides what
// is a leak.
//
// argv: <rounds> <iterationsPerRound>
import { once } from "node:events";
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import tls, { type TLSSocket } from "node:tls";

const [rounds, iterationsPerRound] = process.argv.slice(2).map(Number);

const pem = (name: string) => readFileSync(join(import.meta.dirname, "fixtures", name), "utf8");

const { promise: serverSocketPromise, resolve: onServerSocket } = Promise.withResolvers<TLSSocket>();
const server = tls.createServer(
  {
    key: pem("agent10-key.pem"),
    cert: pem("agent10-cert.pem"),
    ca: [pem("ca5-cert.pem")],
    requestCert: true,
    rejectUnauthorized: false,
  },
  onServerSocket,
);
await once(server.listen(0, "127.0.0.1"), "listening");

const client = tls.connect({
  host: "127.0.0.1",
  port: (server.address() as AddressInfo).port,
  key: pem("ec10-key.pem"),
  cert: pem("ec10-cert.pem"),
  ca: [pem("ca2-cert.pem")],
  checkServerIdentity: () => undefined,
});
await once(client, "secureConnect");
const serverSocket = await serverSocketPromise;

const { subject, issuer, raw } = serverSocket.getPeerCertificate();
const peer = { subject, issuer, raw: raw.toString("base64") };

// On Linux, process.memoryUsage.rss() reads /proc/self/stat. Since Linux 6.2
// the kernel keeps that counter per CPU and adds each CPU's part to the total
// in batches. On a machine with many cores the total is off by several MB, and
// the error changes from one read to the next. smaps_rollup walks the page
// tables, so it is exact. `Anonymous` leaves out the pages of the bun binary,
// which the kernel can evict at any time.
function residentBytes(): number {
  if (process.platform === "linux") {
    const rollup = readFileSync("/proc/self/smaps_rollup", "utf8");
    return Number(/^Anonymous:\s+(\d+) kB$/m.exec(rollup)![1]) * 1024;
  }
  return process.memoryUsage.rss();
}

const samples: number[] = [];
let iterations = 0;
for (let round = 0; round < rounds; round++) {
  for (let i = 0; i < iterationsPerRound; i++, iterations++) {
    serverSocket.getPeerCertificate();
    serverSocket.getPeerCertificate(false);
    serverSocket.getPeerCertificate(true);
  }
  Bun.gc(true);
  samples.push(residentBytes());
}

console.log(JSON.stringify({ peer, iterations, samples }));

client.end();
serverSocket.end();
server.close();
