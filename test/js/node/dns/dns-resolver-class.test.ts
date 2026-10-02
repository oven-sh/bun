// node-dns.test.js resolves public hostnames. These tests need no network.
import { describe, expect, test } from "bun:test";
import { isWindows } from "harness";
import dgram from "node:dgram";
import dns from "node:dns";
import { once } from "node:events";

describe.each([
  ["dns.Resolver", dns.Resolver],
  ["dns.promises.Resolver", dns.promises.Resolver],
])("%s", (_name, Resolver: any) => {
  test("an instance has Resolver.prototype", () => {
    const resolver = new Resolver();
    expect(Object.getPrototypeOf(resolver)).toBe(Resolver.prototype);
    expect(resolver.constructor).toBe(Resolver);
  });

  test("a subclass instance has the subclass prototype and its own servers", () => {
    class PinnedResolver extends Resolver {
      getServers() {
        return super.getServers().map((server: string) => `pinned ${server}`);
      }
    }

    const resolver = new PinnedResolver({ timeout: 1000, tries: 1 });
    expect(Object.getPrototypeOf(resolver)).toBe(PinnedResolver.prototype);
    expect(resolver).toBeInstanceOf(Resolver);

    resolver.setServers(["192.0.2.1"]);
    expect(resolver.getServers()).toEqual(["pinned 192.0.2.1"]);
    expect(dns.getServers()).not.toContain("192.0.2.1");
  });

  test("throws a TypeError when called without new", () => {
    expect(() => Resolver()).toThrow(TypeError);
  });
});

// https://github.com/oven-sh/bun/issues/32164
//
// A query sent to a UDP port with no listener comes back as an ICMP port
// unreachable. The kernel keeps that error on the connected query socket until
// the next recv() or send(), and epoll reports it as EPOLLERR with no readable
// or writable bit. c-ares finds the error only when it is handed the socket.
//
// Not on Windows: its poll path is a different one, and a port that refuses
// for the whole test is not verified there.
describe.skipIf(isWindows)("a nameserver that nothing listens on", () => {
  // A UDP port of 127.0.0.1 that refuses datagrams. The socket that has the
  // port is connected to port 1, so a datagram from any other sender has no
  // socket to go to, and no other socket can get the port while the test runs.
  // A port that is only closed again can become the source port of the query
  // socket, which then receives its own query as the answer.
  async function refusingUdpPort() {
    const socket = dgram.createSocket("udp4");
    socket.bind(0, "127.0.0.1");
    await once(socket, "listening");
    const address = `127.0.0.1:${socket.address().port}`;
    socket.connect(1, "127.0.0.1");
    await once(socket, "connect");
    return { address, [Symbol.dispose]: () => socket.close() };
  }

  // Answers every query with one A record, 10.20.0.1.
  async function liveNameserver() {
    const socket = dgram.createSocket("udp4");
    socket.on("message", (query, rinfo) => {
      let end = 12;
      while (end < query.length && query[end] !== 0) end += query[end] + 1;
      end += 1 + 2 + 2;
      const question = query.subarray(12, end);
      const header = Buffer.from([query[0], query[1], 0x81, 0x80, 0, 1, 0, 1, 0, 0, 0, 0]);
      const answer = Buffer.from([0xc0, 0x0c, 0, 1, 0, 1, 0, 0, 0, 60, 0, 4, 10, 20, 0, 1]);
      socket.send(Buffer.concat([header, question, answer]), rinfo.port, rinfo.address);
    });
    socket.bind(0, "127.0.0.1");
    await once(socket, "listening");
    return {
      address: `127.0.0.1:${socket.address().port}`,
      [Symbol.dispose]: () => socket.close(),
    };
  }

  // With `tries: 1`, an error that c-ares never sees ends as ETIMEOUT.
  const options = { timeout: 1000, tries: 1 };

  test("dns.promises.Resolver rejects with ECONNREFUSED", async () => {
    using dead = await refusingUdpPort();
    const resolver = new dns.promises.Resolver(options);
    resolver.setServers([dead.address]);
    const error = await resolver.resolve4("refused.example.test").then(
      addresses => ({ addresses }),
      e => e,
    );
    expect({ code: error.code, syscall: error.syscall, hostname: error.hostname, message: error.message }).toEqual({
      code: "ECONNREFUSED",
      syscall: "queryA",
      hostname: "refused.example.test",
      message: "queryA ECONNREFUSED refused.example.test",
    });
  });

  test("dns.Resolver calls back with ECONNREFUSED", async () => {
    using dead = await refusingUdpPort();
    const resolver = new dns.Resolver(options);
    resolver.setServers([dead.address]);
    const { promise, resolve } = Promise.withResolvers<{ code?: string; addresses?: string[] }>();
    resolver.resolve4("refused.example.test", (err, addresses) => resolve({ code: err?.code, addresses }));
    expect(await promise).toEqual({ code: "ECONNREFUSED", addresses: undefined });
  });

  test("every record type reports ECONNREFUSED", async () => {
    using dead = await refusingUdpPort();
    const resolver = new dns.promises.Resolver(options);
    resolver.setServers([dead.address]);
    const outcome = (query: Promise<unknown>) =>
      query.then(
        () => "answered",
        e => e.code,
      );
    const name = "refused.example.test";
    expect(
      await Promise.all([
        outcome(resolver.resolve6(name)),
        outcome(resolver.resolveAny(name)),
        outcome(resolver.resolveCaa(name)),
        outcome(resolver.resolveCname(name)),
        outcome(resolver.resolveMx(name)),
        outcome(resolver.resolveNaptr(name)),
        outcome(resolver.resolveNs(name)),
        outcome(resolver.resolvePtr(name)),
        outcome(resolver.resolveSoa(name)),
        outcome(resolver.resolveSrv(name)),
        outcome(resolver.resolveTxt(name)),
      ]),
    ).toEqual(Array(11).fill("ECONNREFUSED"));
  });

  // Each dead server is given up at once. If the query waited for their
  // timeouts (2 x 30 s), this test would run into its own time limit.
  test("the query moves on to the next nameserver", async () => {
    using live = await liveNameserver();
    using dead = await refusingUdpPort();
    using alsoDead = await refusingUdpPort();
    const resolver = new dns.promises.Resolver({ timeout: 30_000, tries: 1 });
    resolver.setServers([dead.address, alsoDead.address, live.address]);
    expect(await resolver.resolve4("failover.example.test")).toEqual(["10.20.0.1"]);
  });
});
