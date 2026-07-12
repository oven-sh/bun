// Verify that dns.lookup (and net.connect / http.get, which route through it)
// reject hostnames containing characters outside the LDH+underscore set before
// any DNS packet leaves the process, matching Node.js / glibc getaddrinfo.
//
// A local UDP DNS stub records every QNAME it receives and answers 127.0.0.1;
// dns.setServers points the c-ares channel at it. For the invalid names the
// stub must see zero packets; for a valid control name it must see at least one
// so the harness is demonstrably wired up.
import dgram from "node:dgram";
import dns from "node:dns";
import http from "node:http";
import { once } from "node:events";

const qnames: string[] = [];
let originHits = 0;

const stub = dgram.createSocket("udp4");
stub.on("message", (msg, rinfo) => {
  let off = 12;
  const labels: string[] = [];
  while (msg[off]) {
    labels.push(msg.subarray(off + 1, off + 1 + msg[off]).toString("binary"));
    off += msg[off] + 1;
  }
  qnames.push(labels.join("."));
  // Minimal response: copy ID + question, 1 answer A 127.0.0.1.
  const resp = Buffer.concat([
    msg.subarray(0, 2),
    Buffer.from([0x81, 0x80]),
    msg.subarray(4, 6),
    Buffer.from([0, 1, 0, 0, 0, 0]),
    msg.subarray(12, off + 5),
    Buffer.from([0xc0, 12, 0, 1, 0, 1, 0, 0, 0, 60, 0, 4, 127, 0, 0, 1]),
  ]);
  stub.send(resp, rinfo.port, rinfo.address);
});
stub.bind(0, "127.0.0.1");
await once(stub, "listening");
const stubPort = (stub.address() as dgram.AddressInfo).port;
dns.setServers([`127.0.0.1:${stubPort}`]);

const origin = http.createServer((_req, res) => {
  originHits++;
  res.end("x");
});
origin.listen(0, "127.0.0.1");
await once(origin, "listening");
const originPort = (origin.address() as import("node:net").AddressInfo).port;

function lookup(host: string) {
  return new Promise<{ err: NodeJS.ErrnoException | null; address?: string }>(resolve => {
    dns.lookup(host, (err, address) => resolve({ err: err as any, address }));
  });
}

const invalid = [
  "leak-a.invalid/x",
  "leak-b*c.invalid",
  "a b.invalid",
  "a@b.invalid",
  "a#b.invalid",
  "a:b.invalid",
  "a+b.invalid",
];

const lookupCodes: Record<string, string | null> = {};
for (const h of invalid) {
  const { err } = await lookup(h);
  lookupCodes[h] = err ? (err.code ?? err.message) : null;
}

// dns.promises.lookup must reject too.
let promiseCode: string | null;
try {
  await dns.promises.lookup("leak-a.invalid/x");
  promiseCode = null;
} catch (e: any) {
  promiseCode = e.code ?? e.message;
}

// http.get with an invalid host must fail without connecting; the stub answers
// 127.0.0.1 so if the query leaked the request would reach `origin`.
const httpCode = await new Promise<string | null>(resolve => {
  const req = http.get({ host: "h.invalid/smug", port: originPort, path: "/pwned" }, res => {
    res.resume();
    res.on("end", () => resolve(null));
  });
  req.on("error", e => resolve((e as NodeJS.ErrnoException).code ?? e.message));
});

// Underscore is widely used (SRV names etc.) and accepted by glibc; it must
// still reach the resolver. This also proves the stub receives traffic at all.
const underscore = await lookup("ok_name.invalid");

// Numeric literals must still resolve.
const v4 = await lookup("127.0.0.1");
const v6 = await lookup("::1");

// Scoped IPv6 via the system getaddrinfo backend: `:` and `%` fail the charset
// check and `ares_inet_pton` cannot parse the zone suffix, so the guard must
// strip `%zone` before the IP-literal exemption or this regresses.
let v6scopedErr: string | null;
try {
  await Bun.dns.lookup("fe80::1%lo", { backend: "system" });
  v6scopedErr = null;
} catch (e: any) {
  v6scopedErr = e.code ?? e.message;
}

const qnamesAfter = qnames.slice();

console.log(
  JSON.stringify({
    lookupCodes,
    promiseCode,
    httpCode,
    underscore: { err: underscore.err ? underscore.err.code : null, address: underscore.address },
    v4: { err: v4.err ? v4.err.code : null, address: v4.address },
    v6: { err: v6.err ? v6.err.code : null, address: v6.address },
    v6scopedErr,
    qnames: qnamesAfter,
    originHits,
  }),
);

stub.close();
origin.close();
