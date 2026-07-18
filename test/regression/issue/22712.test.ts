import { afterAll, beforeAll, expect, test } from "bun:test";
import dgram from "node:dgram";
import dns from "node:dns";
import { once } from "node:events";

// #22712: dns.resolve()'s callback must be (err, addresses) — two args — and
// dns.promises.resolve() must yield a string[] for A/AAAA. Run against a local
// in-process DNS server so the test is hermetic (no external network).

function buildAnswer(query: Buffer, qtype: number): Buffer {
  let off = 12;
  while (off < query.length && query[off] !== 0) off += query[off] + 1;
  off += 1 + 2 + 2;
  const question = query.subarray(12, off);

  const header = Buffer.alloc(12);
  header[0] = query[0];
  header[1] = query[1];
  header[2] = 0x81; // QR=1 RD=1
  header[3] = 0x80; // RA=1
  header[5] = 1; // QDCOUNT
  header[7] = 1; // ANCOUNT

  let rr: Buffer;
  if (qtype === 28) {
    // AAAA -> 2001:4860:4860::8888
    rr = Buffer.from([
      0xc0, 0x0c, 0x00, 0x1c, 0x00, 0x01, 0x00, 0x00, 0x00, 0x3c, 0x00, 0x10, 0x20, 0x01, 0x48, 0x60, 0x48, 0x60, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x88, 0x88,
    ]);
  } else {
    // A -> 8.8.8.8
    rr = Buffer.from([0xc0, 0x0c, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0x00, 0x3c, 0x00, 0x04, 8, 8, 8, 8]);
  }
  return Buffer.concat([header, question, rr]);
}

let udp: dgram.Socket;
let savedServers: string[];

beforeAll(async () => {
  udp = dgram.createSocket("udp4");
  udp.on("message", (msg, rinfo) => {
    let off = 12;
    while (off < msg.length && msg[off] !== 0) off += msg[off] + 1;
    const qtype = msg.readUInt16BE(off + 1);
    udp.send(buildAnswer(msg, qtype), rinfo.port, rinfo.address);
  });
  udp.bind(0, "127.0.0.1");
  await once(udp, "listening");
  const port = (udp.address() as dgram.AddressInfo).port;

  savedServers = dns.getServers();
  dns.setServers([`127.0.0.1:${port}`]);
});

afterAll(() => {
  try {
    dns.setServers(savedServers);
  } catch {}
  udp?.close();
});

test("dns.resolve callback parameters match Node.js", done => {
  dns.resolve("dns.google", (...args) => {
    // Should receive exactly 2 parameters: error and addresses array
    expect(args.length).toBe(2);
    expect(args[0]).toBe(null); // no error
    expect(Array.isArray(args[1])).toBe(true); // addresses should be array
    expect(args[1].every((addr: any) => typeof addr === "string")).toBe(true); // each address should be string
    done();
  });
});

test("dns.resolve with A record type callback parameters", done => {
  dns.resolve("dns.google", "A", (...args) => {
    expect(args.length).toBe(2);
    expect(args[0]).toBe(null);
    expect(Array.isArray(args[1])).toBe(true);
    expect(args[1].every((addr: any) => typeof addr === "string")).toBe(true);
    done();
  });
});

test("dns.resolve with AAAA record type callback parameters", done => {
  // Use a hostname that has AAAA records
  dns.resolve("google.com", "AAAA", (...args) => {
    expect(args.length).toBe(2);
    expect(args[0]).toBe(null);
    expect(Array.isArray(args[1])).toBe(true);
    expect(args[1].every((addr: any) => typeof addr === "string")).toBe(true);
    done();
  });
});

test("dns.promises.resolve returns array of strings", async () => {
  const result = await dns.promises.resolve("dns.google");
  expect(Array.isArray(result)).toBe(true);
  expect(result.every((addr: any) => typeof addr === "string")).toBe(true);
});

test("dns.promises.resolve with A record returns array of strings", async () => {
  const result = await dns.promises.resolve("dns.google", "A");
  expect(Array.isArray(result)).toBe(true);
  expect(result.every((addr: any) => typeof addr === "string")).toBe(true);
});

test("dns.promises.resolve with AAAA record returns array of strings", async () => {
  const result = await dns.promises.resolve("google.com", "AAAA");
  expect(Array.isArray(result)).toBe(true);
  expect(result.every((addr: any) => typeof addr === "string")).toBe(true);
});
