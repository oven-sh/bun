// Hermetic: scripted in-process DNS server on 127.0.0.1; a dns.promises.Resolver
// pointed at it issues resolve4() twice for the same name. Node re-queries on
// every call (no resolver-level cache); this fixture asserts Bun does too.
import dgram from "node:dgram";
import { promises as dnsp } from "node:dns";

const zone = new Map<string, { ip: string; ttl: number }>();
const hits = new Map<string, number>();

const u16 = (n: number) => [(n >> 8) & 255, n & 255];
const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];

const srv = dgram.createSocket("udp4");
srv.on("message", (m, ri) => {
  // decode QNAME
  let i = 12;
  const labels: string[] = [];
  while (m[i]) {
    labels.push(m.slice(i + 1, i + 1 + m[i]).toString());
    i += 1 + m[i];
  }
  i++; // skip the root label
  const q = labels.join(".").toLowerCase();
  hits.set(q, (hits.get(q) ?? 0) + 1);
  const z = zone.get(q);
  const an = z ? [[0xc0, 12, ...u16(1), 0, 1, ...u32(z.ttl), 0, 4, ...z.ip.split(".").map(Number)]] : [];
  const rcode = z ? 0 : 3; // NOERROR or NXDOMAIN
  const resp = Buffer.concat([
    Buffer.from([...u16(m.readUInt16BE(0)), 0x85, 0x80 | rcode, 0, 1, ...u16(an.length), 0, 0, 0, 0]),
    m.slice(12, i + 4),
    Buffer.from(an.flat()),
  ]);
  srv.send(resp, ri.port, ri.address);
});

await new Promise<void>((resolve, reject) => {
  srv.once("error", reject);
  srv.bind(0, "127.0.0.1", resolve);
});

try {
  const port = (srv.address() as import("node:net").AddressInfo).port;
  const R = new dnsp.Resolver();
  R.setServers([`127.0.0.1:${port}`]);

  // Case 1: two resolve4() calls for the same name must hit the wire twice.
  zone.set("rep.qc.test", { ip: "192.0.2.1", ttl: 300 });
  await R.resolve4("rep.qc.test");
  await R.resolve4("rep.qc.test");
  const wire1 = hits.get("rep.qc.test");

  // Case 2: a zone change within TTL must be observed on the next resolve4().
  zone.set("chg.qc.test", { ip: "192.0.2.10", ttl: 300 });
  const before = await R.resolve4("chg.qc.test");
  zone.set("chg.qc.test", { ip: "192.0.2.20", ttl: 300 });
  const after = await R.resolve4("chg.qc.test");
  const wire2 = hits.get("chg.qc.test");

  console.log(
    JSON.stringify({
      wire1,
      wire2,
      before,
      after,
    }),
  );
} finally {
  srv.close();
}
