// A local UDP DNS stub records every QNAME it receives and answers 127.0.0.1.
// dns.setServers() points Bun's c-ares channel at it, so a c-ares lookup that
// reaches the wire shows up in `qnames`, and one rejected in-process does not.
import dgram from "node:dgram";
import dns from "node:dns";
import { once } from "node:events";
import http from "node:http";
import type { AddressInfo } from "node:net";

const qnames: string[] = [];
const stub = dgram.createSocket("udp4");
stub.on("message", (msg, rinfo) => {
  let off = 12;
  const labels: string[] = [];
  while (msg[off]) {
    labels.push(msg.subarray(off + 1, off + 1 + msg[off]).toString("latin1"));
    off += msg[off] + 1;
  }
  qnames.push(labels.join("."));
  // Header (ID, QR|RD, RA, QDCOUNT=1, ANCOUNT=1), the question, one A RR -> 127.0.0.1.
  stub.send(
    Buffer.concat([
      msg.subarray(0, 2),
      Buffer.from([0x81, 0x80]),
      msg.subarray(4, 6),
      Buffer.from([0, 1, 0, 0, 0, 0]),
      msg.subarray(12, off + 5),
      Buffer.from([0xc0, 12, 0, 1, 0, 1, 0, 0, 0, 60, 0, 4, 127, 0, 0, 1]),
    ]),
    rinfo.port,
    rinfo.address,
  );
});
stub.bind(0, "127.0.0.1");
await once(stub, "listening");
dns.setServers([`127.0.0.1:${(stub.address() as AddressInfo).port}`]);

let originHits = 0;
const origin = http.createServer((_req, res) => {
  originHits++;
  res.end();
});
origin.listen(0, "127.0.0.1");
await once(origin, "listening");
const originPort = (origin.address() as AddressInfo).port;

const code = (p: Promise<unknown>) => p.then(() => null, (e: any) => e?.code ?? String(e));

const invalid = ["leak-a.invalid/x", "leak-b*c.invalid", "*.leak-c.invalid"];

// The c-ares backend is the one whose own validation lets `/` and `*` through.
const cares: Record<string, string | null> = {};
for (const hostname of invalid) {
  cares[hostname] = await code(Bun.dns.lookup(hostname, { backend: "c-ares" }));
}

// node:dns lookup() and the http client on top of it use the system backend;
// the name is rejected before that backend is asked, whatever it would do.
const node: Record<string, string | null> = {};
for (const hostname of invalid) {
  node[hostname] = await code(dns.promises.lookup(hostname));
}
const httpGet = await new Promise<string | null>(resolve => {
  http
    .get({ host: "h.invalid/smug", port: originPort, path: "/" }, res => {
      res.resume();
      res.on("end", () => resolve(null));
    })
    .on("error", (e: NodeJS.ErrnoException) => resolve(e.code ?? e.message));
});

// Control: `_` is accepted (glibc accepts it too) and must reach the stub, which
// also proves the stub is wired up. The trailing dot skips search-domain expansion.
const control = await Bun.dns.lookup("ok_name.invalid.", { backend: "c-ares" }).then(
  r => r[0]?.address ?? null,
  (e: any) => e?.code ?? String(e),
);

console.log(JSON.stringify({ cares, node, httpGet, originHits, control, qnames: [...new Set(qnames)] }));

stub.close();
origin.close();
