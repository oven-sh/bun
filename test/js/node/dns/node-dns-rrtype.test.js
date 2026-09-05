import { describe, expect, it } from "bun:test";
import * as dgram from "node:dgram";
import * as dns from "node:dns";
import * as dns_promises from "node:dns/promises";
import { once } from "node:events";

// https://github.com/oven-sh/bun/issues/39553
// Node validates rrtype case-sensitively: 'a' is invalid, only 'A' works.
// These tests are in their own file because they do not depend on a working
// resolver: an invalid rrtype throws before any query is issued, the dispatch
// tests at the end talk to a socket on 127.0.0.1, and the module-level
// positive checks discard their query's result.
describe.each([
  ["dns.resolve", rrtype => dns.resolve("localhost", rrtype, () => {})],
  ["dns.Resolver#resolve", rrtype => new dns.Resolver().resolve("localhost", rrtype, () => {})],
  ["dns.promises.resolve", rrtype => dns_promises.resolve("localhost", rrtype)],
  ["dns.promises.Resolver#resolve", rrtype => new dns_promises.Resolver().resolve("localhost", rrtype)],
])("%s", (_, fn) => {
  // "constructor" and "toString" would match an inherited property if the
  // dispatch ever became a plain-object lookup.
  it.each(["a", "aaaa", "txt", "Mx", "", "BOGUS", "constructor", "toString"])(
    "with rrtype %p throws ERR_INVALID_ARG_VALUE",
    rrtype => {
      expect(() => fn(rrtype)).toThrow(
        expect.objectContaining({
          code: "ERR_INVALID_ARG_VALUE",
          message: `The argument 'rrtype' is invalid. Received '${rrtype}'`,
        }),
      );
    },
  );
});

// Only the module-level entry points, which share the default resolver and so
// cannot be pointed at a local socket. The Resolver surfaces are covered for
// every rrtype by the QTYPE dispatch tests below, with a cancel.
describe.each([
  ["dns.resolve", rrtype => dns.resolve("localhost", rrtype, () => {})],
  ["dns.promises.resolve", rrtype => dns_promises.resolve("localhost", rrtype).catch(() => {})],
])("%s", (_, fn) => {
  it.each(["A", "AAAA", "ANY", "CAA", "CNAME", "MX", "NAPTR", "NS", "PTR", "SOA", "SRV", "TXT"])(
    "with rrtype %p does not throw synchronously",
    rrtype => {
      // The query itself may fail depending on the environment's resolver.
      // Only the synchronous validation is under test here.
      fn(rrtype);
    },
  );
});

it("dns.promises.Resolver#resolve with non-string rrtype throws ERR_INVALID_ARG_TYPE", () => {
  expect(() => new dns_promises.Resolver().resolve("localhost", 1)).toThrow(
    expect.objectContaining({
      code: "ERR_INVALID_ARG_TYPE",
      message: expect.stringContaining('The "rrtype" argument must be of type string'),
    }),
  );
});

it.each([
  ["dns.resolve", () => dns.resolve(1, "a", () => {})],
  ["dns.Resolver#resolve", () => new dns.Resolver().resolve(1, "a", () => {})],
  ["dns.promises.resolve", () => dns_promises.resolve(1, "a")],
  ["dns.promises.Resolver#resolve", () => new dns_promises.Resolver().resolve(1, "a")],
])("%s checks rrtype before hostname, like Node", (_, fn) => {
  expect(fn).toThrow(expect.objectContaining({ code: "ERR_INVALID_ARG_VALUE" }));
});

// QTYPE of each record type, from the IANA DNS parameters registry.
const qtypes = {
  A: 1,
  AAAA: 28,
  ANY: 255,
  CAA: 257,
  CNAME: 5,
  MX: 15,
  NAPTR: 35,
  NS: 2,
  PTR: 12,
  SOA: 6,
  SRV: 33,
  TXT: 16,
};

// The fake server never answers. The QTYPE of the query that reaches it shows
// which query resolve(hostname, rrtype) issues. The trailing dot in the name
// keeps c-ares from also trying the host's search domains.
async function querySentBy(startQuery) {
  const socket = dgram.createSocket("udp4");
  try {
    socket.bind(0, "127.0.0.1");
    await once(socket, "listening");
    const received = once(socket, "message");
    const { resolver, settled } = startQuery("127.0.0.1:" + socket.address().port, "rrtype.example.test.");
    const [query] = await received;
    resolver.cancel();
    const { code, syscall } = await settled;
    // QNAME ends at the first zero byte after the 12-byte header. QTYPE follows it.
    return { qtype: query.readUInt16BE(query.indexOf(0, 12) + 1), code, syscall };
  } finally {
    socket.close();
  }
}

describe.each(Object.entries(qtypes))("resolve(hostname, %p)", (rrtype, qtype) => {
  const expected = { qtype, code: "ECANCELLED", syscall: "query" + rrtype[0] + rrtype.slice(1).toLowerCase() };

  it.concurrent("dns.Resolver#resolve issues that query", async () => {
    const sent = await querySentBy((server, hostname) => {
      const resolver = new dns.Resolver({ timeout: 1000, tries: 1 });
      resolver.setServers([server]);
      const { promise, resolve } = Promise.withResolvers();
      resolver.resolve(hostname, rrtype, resolve);
      return { resolver, settled: promise };
    });
    expect(sent).toEqual(expected);
  });

  it.concurrent("dns.promises.Resolver#resolve issues that query", async () => {
    const sent = await querySentBy((server, hostname) => {
      const resolver = new dns_promises.Resolver({ timeout: 1000, tries: 1 });
      resolver.setServers([server]);
      return { resolver, settled: resolver.resolve(hostname, rrtype).catch(err => err) };
    });
    expect(sent).toEqual(expected);
  });
});
