import { expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, tempDir } from "harness";

// `AI_V4MAPPED` (+ `AI_ALL`) on an `AF_INET6` lookup: the name's IPv4 addresses come
// back as `::ffff:a.b.c.d`. c-ares implements neither hint, so Bun's c-ares backend has
// to query both families and map the answers itself.
//
// Everything runs inside the child: `dns.setServers` is process-global, and the stub
// server is what keeps the test off the network. `v4only`/`dual` only exist there, so a
// miss is a hard failure rather than a silent fall-through to the real resolver.
const fixture = String.raw`
import dgram from "node:dgram";
import dns from "node:dns";

const v4 = ip => Buffer.from(ip.split(".").map(Number));
const v6 = hex => Buffer.from(hex, "hex");
const A = 1;
const AAAA = 28;
const ZONE = {
  v4only: { [A]: [v4("10.77.0.1")], [AAAA]: [] },
  dual: { [A]: [v4("10.77.0.2")], [AAAA]: [v6("fd770000000000000000000000000002")] },
};

function readName(buf, offset) {
  const labels = [];
  for (let len = buf[offset++]; len !== 0; len = buf[offset++]) {
    labels.push(buf.toString("latin1", offset, offset + len));
    offset += len;
  }
  return [labels, offset];
}

const server = dgram.createSocket("udp4");
server.on("message", (msg, rinfo) => {
  const id = msg.readUInt16BE(0);
  const [labels, nameEnd] = readName(msg, 12);
  const qtype = msg.readUInt16BE(nameEnd);
  const qclass = msg.readUInt16BE(nameEnd + 2);
  const question = msg.subarray(12, nameEnd + 4);

  // Match on the first label so a resolv.conf search domain cannot change the answer.
  const entry = ZONE[labels[0]];
  const records = entry?.[qtype] ?? [];

  const header = Buffer.alloc(12);
  header.writeUInt16BE(id, 0);
  header.writeUInt16BE(entry ? 0x8180 : 0x8183, 2); // QR|RD|RA + NOERROR / NXDOMAIN
  header.writeUInt16BE(1, 4); // QDCOUNT
  header.writeUInt16BE(records.length, 6); // ANCOUNT

  const answers = records.map(rdata => {
    const rr = Buffer.alloc(12 + rdata.length);
    rr.writeUInt16BE(0xc00c, 0); // NAME: compression pointer at the question's QNAME
    rr.writeUInt16BE(qtype, 2);
    rr.writeUInt16BE(qclass, 4);
    rr.writeUInt32BE(30, 6); // TTL
    rr.writeUInt16BE(rdata.length, 10); // RDLENGTH
    rdata.copy(rr, 12);
    return rr;
  });

  server.send(Buffer.concat([header, question, ...answers]), rinfo.port, rinfo.address);
});

await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.bind(0, "127.0.0.1", resolve);
});
dns.setServers(["127.0.0.1:" + server.address().port]);

const fmt = results => results.map(r => r.address + "/" + r.family);
const cares = (host, options) =>
  Bun.dns.lookup(host, { ...options, backend: "c-ares" }).then(fmt, e => e.code);
const lookup = (host, options) =>
  dns.promises.lookup(host, { all: true, ...options }).then(fmt, e => e.code);

const { V4MAPPED, ALL } = dns;
const out = {
  "v4only family:6": await cares("v4only.dnstest", { family: 6 }),
  "v4only family:6 V4MAPPED": await cares("v4only.dnstest", { family: 6, flags: V4MAPPED }),
  "v4only family:6 V4MAPPED|ALL": await cares("v4only.dnstest", { family: 6, flags: V4MAPPED | ALL }),
  "v4only family:0": await cares("v4only.dnstest", { family: 0 }),
  "v4only family:4 V4MAPPED": await cares("v4only.dnstest", { family: 4, flags: V4MAPPED }),
  "dual family:6": await cares("dual.dnstest", { family: 6 }),
  "dual family:6 V4MAPPED": await cares("dual.dnstest", { family: 6, flags: V4MAPPED }),
  "dual family:6 V4MAPPED|ALL": await cares("dual.dnstest", { family: 6, flags: V4MAPPED | ALL }),
  "dual family:6 ALL": await cares("dual.dnstest", { family: 6, flags: ALL }),
};

if (process.env.DEFAULT_BACKEND_IS_CARES === "1") {
  out["node v4only family:6 V4MAPPED"] = await lookup("v4only.dnstest", { family: 6, hints: V4MAPPED });
  out["node dual family:6 V4MAPPED|ALL"] = await lookup("dual.dnstest", { family: 6, hints: V4MAPPED | ALL });
  out["node v4only single"] = await dns.promises
    .lookup("v4only.dnstest", { family: 6, hints: V4MAPPED })
    .then(r => r.address + "/" + r.family, e => e.code);
}

console.log(JSON.stringify(out, null, 2));
server.close();
`;

test("dns.lookup maps IPv4 addresses for AI_V4MAPPED on the c-ares backend", async () => {
  using dir = tempDir("dns-v4mapped", { "fixture.mjs": fixture });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "fixture.mjs"],
    env: { ...bunEnv, DEFAULT_BACKEND_IS_CARES: isLinux ? "1" : "0" },
    cwd: String(dir),
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const expected: Record<string, unknown> = {
    // No hints: c-ares asks for AAAA only and the name has none.
    "v4only family:6": "DNS_ENOTFOUND",
    "v4only family:6 V4MAPPED": ["::ffff:10.77.0.1/6"],
    "v4only family:6 V4MAPPED|ALL": ["::ffff:10.77.0.1/6"],
    "v4only family:0": ["10.77.0.1/4"],
    // AI_V4MAPPED is ignored unless the family is AF_INET6.
    "v4only family:4 V4MAPPED": ["10.77.0.1/4"],
    "dual family:6": ["fd77::2/6"],
    // The name has an IPv6 address, so without AI_ALL nothing is mapped.
    "dual family:6 V4MAPPED": ["fd77::2/6"],
    "dual family:6 V4MAPPED|ALL": ["fd77::2/6", "::ffff:10.77.0.2/6"],
    // AI_ALL is ignored unless AI_V4MAPPED is also set.
    "dual family:6 ALL": ["fd77::2/6"],
  };
  if (isLinux) {
    expected["node v4only family:6 V4MAPPED"] = ["::ffff:10.77.0.1/6"];
    expected["node dual family:6 V4MAPPED|ALL"] = ["fd77::2/6", "::ffff:10.77.0.2/6"];
    expected["node v4only single"] = "::ffff:10.77.0.1/6";
  }

  expect({ stdout: JSON.parse(stdout || "null"), stderr, exitCode }).toEqual({
    stdout: expected,
    stderr: "",
    exitCode: 0,
  });
});
