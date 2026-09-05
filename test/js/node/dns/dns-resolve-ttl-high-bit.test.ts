// RFC 2181 §8: a DNS TTL is transmitted as a 32-bit unsigned integer but
// "Implementations should treat TTL values received with the most significant
// bit set as if the entire value received was zero." c-ares's legacy API
// exposes TTL as a signed int, so a wire TTL of 0xFFFFFFFF / 0x80000000
// arrives as -1 / INT32_MIN. Bun previously surfaced those negative values
// verbatim to JS.
//
// The fixture runs a hermetic UDP DNS server that answers A/AAAA queries with
// a chosen wire TTL, then asserts on the {ttl} reported by node:dns.
import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

const fixture = /* js */ `
import dgram from "node:dgram";
import { once } from "node:events";
import { promises as dns } from "node:dns";

const TTLS = { "hi.tt.test": 0xffffffff, "mid.tt.test": 0x80000000, "max31.tt.test": 0x7fffffff, "one.tt.test": 1 };
const u16 = n => [(n >>> 8) & 0xff, n & 0xff];
const u32 = n => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];

const srv = dgram.createSocket("udp4");
srv.on("message", (msg, rinfo) => {
  // parse question name + qtype
  let off = 12;
  const labels = [];
  while (msg[off] !== 0) {
    labels.push(msg.subarray(off + 1, off + 1 + msg[off]).toString());
    off += 1 + msg[off];
  }
  off++;
  const qtype = msg.readUInt16BE(off);
  const question = msg.subarray(12, off + 4);
  const name = labels.join(".").toLowerCase();
  const ttl = TTLS[name];

  // one A (type 1) or AAAA (type 28) RR at 0xc00c, TTL = wire TTL
  const rdata = qtype === 28 ? [...u16(16), 0x20, 0x01, 0x0d, 0xb8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 5] : [...u16(4), 192, 0, 2, 5];
  const answer = Buffer.from([0xc0, 0x0c, ...u16(qtype), 0x00, 0x01, ...u32(ttl), ...rdata]);
  const header = Buffer.from([...u16(msg.readUInt16BE(0)), 0x85, 0x80, ...u16(1), ...u16(1), ...u16(0), ...u16(0)]);
  srv.send(Buffer.concat([header, question, answer]), rinfo.port, rinfo.address);
});
srv.bind(0, "127.0.0.1");
await once(srv, "listening");

const r = new dns.Resolver({ timeout: 2000, tries: 1 });
r.setServers(["127.0.0.1:" + srv.address().port]);

const out = {};
for (const name of Object.keys(TTLS)) {
  const [a] = await r.resolve4(name, { ttl: true });
  const [aaaa] = await r.resolve6(name, { ttl: true });
  out[name] = { a: a.ttl, aaaa: aaaa.ttl, addr4: a.address, addr6: aaaa.address };
}
console.log(JSON.stringify(out));
srv.close();
`;

test("dns.resolve4/resolve6 {ttl:true} clamps high-bit wire TTLs to 0 (RFC 2181 §8)", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", fixture],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr.trim()).toBe("");
  expect(JSON.parse(stdout)).toEqual({
    // High bit set: RFC 2181 §8 says treat as zero. Before the fix bun
    // reported -1 / -2147483648 here.
    "hi.tt.test": { a: 0, aaaa: 0, addr4: "192.0.2.5", addr6: "2001:db8::5" },
    "mid.tt.test": { a: 0, aaaa: 0, addr4: "192.0.2.5", addr6: "2001:db8::5" },
    // High bit clear: reported exactly.
    "max31.tt.test": { a: 0x7fffffff, aaaa: 0x7fffffff, addr4: "192.0.2.5", addr6: "2001:db8::5" },
    "one.tt.test": { a: 1, aaaa: 1, addr4: "192.0.2.5", addr6: "2001:db8::5" },
  });
  expect(exitCode).toBe(0);
});
