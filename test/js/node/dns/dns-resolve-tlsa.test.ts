import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import dgram from "node:dgram";
import dns from "node:dns";
import dnsPromises from "node:dns/promises";
import util from "node:util";

// https://github.com/oven-sh/bun/issues/6581
// TLSA record support was added to Node.js in v22.15.0 / v23.9.0.

test("dns.resolveTlsa is exposed everywhere node:dns exposes it", () => {
  expect(typeof dns.resolveTlsa).toBe("function");
  expect(typeof dns.promises.resolveTlsa).toBe("function");
  expect(typeof dnsPromises.resolveTlsa).toBe("function");
  expect(typeof dns.Resolver.prototype.resolveTlsa).toBe("function");
  expect(typeof dns.promises.Resolver.prototype.resolveTlsa).toBe("function");

  // util.promisify(dns.resolveTlsa) uses the promises implementation.
  expect(dns.resolveTlsa[util.promisify.custom]).toBe(dns.promises.resolveTlsa);
});

test("resolver.resolve accepts 'TLSA' as an rrtype", () => {
  const resolver = new dns.promises.Resolver({ timeout: 500, tries: 1 });
  // Must not throw ERR_INVALID_ARG_VALUE synchronously.
  const p = resolver.resolve("tlsa.invalid", "TLSA");
  expect(p).toBeInstanceOf(Promise);
  // Swallow the eventual rejection so the test doesn't leave an unhandled rejection.
  p.catch(() => {});
  resolver.cancel();
});

describe("dns.resolveTlsa against a local mock server", () => {
  // SHA-256 of an empty string, used as the certificate association data.
  const certData = Buffer.from("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", "hex");

  let server: dgram.Socket;
  let resolver: InstanceType<typeof dns.promises.Resolver>;

  // Minimal DNS responder: echoes the question, attaches one TLSA answer
  // (type 52, RFC 6698 wire format: u8 cert_usage, u8 selector, u8 matching, data[]).
  function buildTlsaResponse(query: Buffer): Buffer {
    let off = 12;
    while (query[off] !== 0) off += query[off] + 1;
    off += 1; // root label
    off += 4; // QTYPE + QCLASS
    const question = query.subarray(12, off);

    const header = Buffer.alloc(12);
    query.copy(header, 0, 0, 2); // id
    header.writeUInt16BE(0x8180, 2); // standard response, RA
    header.writeUInt16BE(1, 4); // QDCOUNT
    header.writeUInt16BE(1, 6); // ANCOUNT

    const rdata = Buffer.concat([Buffer.from([3, 1, 1]), certData]);
    const answer = Buffer.alloc(12 + rdata.length);
    answer.writeUInt16BE(0xc00c, 0); // name: pointer to question name
    answer.writeUInt16BE(52, 2); // TYPE = TLSA
    answer.writeUInt16BE(1, 4); // CLASS = IN
    answer.writeUInt32BE(60, 6); // TTL
    answer.writeUInt16BE(rdata.length, 10); // RDLENGTH
    rdata.copy(answer, 12);

    return Buffer.concat([header, question, answer]);
  }

  beforeAll(async () => {
    server = dgram.createSocket("udp4");
    server.on("message", (msg, rinfo) => {
      server.send(buildTlsaResponse(msg), rinfo.port, rinfo.address);
    });
    await new Promise<void>(resolve => server.bind(0, "127.0.0.1", resolve));
    resolver = new dns.promises.Resolver();
    resolver.setServers([`127.0.0.1:${server.address().port}`]);
  });

  afterAll(() => {
    resolver?.cancel();
    server?.close();
  });

  test("Resolver.prototype.resolveTlsa returns {certUsage, selector, match, data}", async () => {
    const records = await resolver.resolveTlsa("_443._tcp.example.org");
    expect(Array.isArray(records)).toBe(true);
    expect(records.length).toBe(1);

    const rec = records[0];
    expect(rec.certUsage).toBe(3);
    expect(rec.selector).toBe(1);
    expect(rec.match).toBe(1);
    expect(rec.data).toBeInstanceOf(ArrayBuffer);
    expect(Buffer.from(rec.data).equals(certData)).toBe(true);
  });

  test("resolver.resolve(name, 'TLSA') returns TLSA records", async () => {
    const records = await resolver.resolve("_443._tcp.example.org", "TLSA");
    expect(records.length).toBe(1);
    expect(records[0].certUsage).toBe(3);
    expect(Buffer.from(records[0].data).equals(certData)).toBe(true);
  });
});

test("dns.resolveTlsa error carries syscall=queryTlsa and a translated code", async () => {
  // A >255-byte label is rejected by c-ares before any network I/O.
  const resolver = new dns.promises.Resolver({ timeout: 100, tries: 1 });
  let err: any;
  try {
    await resolver.resolveTlsa(Buffer.alloc(300, "a").toString());
  } catch (e) {
    err = e;
  }
  expect(err).toBeDefined();
  expect(err.syscall).toBe("queryTlsa");
  expect(err.code).not.toStartWith("DNS_");
});
