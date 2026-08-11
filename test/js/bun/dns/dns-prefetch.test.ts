import { dns } from "bun";
import { dnsCacheSeed, dnsIsLocalhostName } from "bun:internal-for-testing";
import { describe, expect, it, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// What the system says "localhost" is, unfiltered: the JS-facing lookup passes no
// AI_ADDRCONFIG, so this is the same /etc/hosts content the listeners below bind.
const localhostHasV6Loopback = (await dns.lookup("localhost").catch(() => [])).some(({ address }) => address === "::1");

// The DNS cache is process-global, so this runs in its own process to get
// clean counters. Docs promise that a failed connection evicts the host's
// cache entry; a dead host must never be served as a cache hit.
test("a failed connect evicts the host's DNS cache entry", async () => {
  const script = `
    const listener = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
    const port = listener.port;
    listener.stop();

    const results = [];
    for (let i = 0; i < 3; i++) {
      let code = "none";
      try {
        await Bun.connect({ hostname: "localhost", port, socket: { data() {}, open() {} } });
      } catch (e) {
        code = e.code;
      }
      const { cacheHitsCompleted, size, errors } = Bun.dns.getCacheStats();
      results.push({ code, cacheHitsCompleted, size, errors });
    }
    console.log(JSON.stringify(results));
  `;
  await using proc = Bun.spawn({ cmd: [bunExe(), "-e", script], env: bunEnv, stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  // Each connect fails, evicts the entry (size back to 0, one more eviction in
  // `errors`), so the next attempt is a fresh miss. A dead host must never be
  // served from the cache (cacheHitsCompleted stays 0).
  expect({ results: JSON.parse(stdout.trim() || "null"), stderr, exitCode }).toEqual({
    results: [
      { code: "ECONNREFUSED", cacheHitsCompleted: 0, size: 0, errors: 1 },
      { code: "ECONNREFUSED", cacheHitsCompleted: 0, size: 0, errors: 2 },
      { code: "ECONNREFUSED", cacheHitsCompleted: 0, size: 0, errors: 3 },
    ],
    stderr: "",
    exitCode: 0,
  });
});

// The connect-path resolver (fetch(), Bun.connect(), WebSocket) passes
// AI_ADDRCONFIG to getaddrinfo(). glibc judges each family by the machine's
// non-loopback addresses, so on a host whose only IPv6 address is ::1 (a
// container, typically) it drops the `::1 localhost` line of /etc/hosts, while a
// listener bound to the name "localhost" (or to ::1) sits exactly there. For
// localhost names the resolver now adds the filtered-out loopback family behind
// the family AI_ADDRCONFIG did answer with.
//
// Which names get this, and how the merged list is ordered, are checked
// directly below because a real lookup only shows the difference on such a host.
// The end-to-end tests after that fail without the fix on such a host and are
// plain regression coverage everywhere else.
describe("loopback names and AI_ADDRCONFIG", () => {
  test("names that are exempt from the filter", () => {
    const names = [
      "localhost",
      "LOCALHOST",
      "app.localhost",
      "a.b.LocalHost",
      "notlocalhost",
      "localhost.example",
      "localhost2",
      "127.0.0.1",
      "",
    ];
    expect(Object.fromEntries(names.map(name => [name, dnsIsLocalhostName(name)]))).toEqual({
      "localhost": true,
      "LOCALHOST": true,
      "app.localhost": true,
      "a.b.LocalHost": true,
      "notlocalhost": false,
      "localhost.example": false,
      "localhost2": false,
      "127.0.0.1": false,
      "": false,
    });
  });

  test("the family AI_ADDRCONFIG answered with stays at the head of the unfiltered list", () => {
    // /etc/hosts lists ::1 first; AI_ADDRCONFIG had answered with IPv4 only, so
    // consumers that take the first entry keep connecting to 127.0.0.1 and ::1
    // is added behind it. Symmetric for an IPv6-only answer, and unchanged
    // (the list's own order) when no family is forced.
    expect({
      v4Answered: dnsCacheSeed("addrconfig-v4.invalid", ["::1", "127.0.0.1"], 4),
      v6Answered: dnsCacheSeed("addrconfig-v6.invalid", ["127.0.0.1", "::1"], 6),
      unforced: dnsCacheSeed("addrconfig-unforced.invalid", ["::1", "127.0.0.1"]),
    }).toEqual({
      v4Answered: [4, 6],
      v6Answered: [6, 4],
      unforced: [6, 4],
    });
  });

  test.concurrent("fetch() reaches a server listening on the name it connects to", async () => {
    await using server = Bun.serve({ port: 0, hostname: "localhost", fetch: () => new Response("ok") });
    const response = await fetch(`http://localhost:${server.port}/`);
    expect(await response.text()).toBe("ok");
  });

  // Only meaningful where the system resolver maps localhost to ::1 at all.
  describe.skipIf(!localhostHasV6Loopback)("a server on ::1 is reachable through the name", () => {
    test.concurrent("fetch()", async () => {
      await using server = Bun.serve({
        port: 0,
        hostname: "::1",
        fetch: (request, server) => new Response(server.requestIP(request)!.address),
      });
      const response = await fetch(`http://localhost:${server.port}/`);
      expect(await response.text()).toBe("::1");
    });

    // getaddrinfo() is case-insensitive, so the exemption has to be too.
    test.concurrent.each(["localhost", "LOCALHOST"])("Bun.connect({ hostname: %j })", async hostname => {
      using listener = Bun.listen({ port: 0, hostname: "::1", socket: { data() {} } });
      using socket = await Bun.connect({ hostname, port: listener.port, socket: { data() {} } });
      expect(socket.remoteAddress).toBe("::1");
    });

    test.concurrent("new WebSocket()", async () => {
      await using server = Bun.serve({
        port: 0,
        hostname: "::1",
        fetch(request, server) {
          return server.upgrade(request) ? undefined : new Response(null, { status: 400 });
        },
        websocket: {
          open(ws) {
            ws.send(ws.remoteAddress);
          },
          message() {},
        },
      });
      const { promise, resolve, reject } = Promise.withResolvers<string>();
      const ws = new WebSocket(`ws://localhost:${server.port}/`);
      ws.onmessage = event => resolve(String(event.data));
      ws.onclose = event => reject(new Error(`closed before any message: ${event.code} ${event.reason}`));
      expect(await promise).toBe("::1");
      ws.onclose = null;
      ws.close();
    });
  });
});

describe("dns.prefetch", () => {
  it("should prefetch", async () => {
    // A local server keeps the test off the external network. "localhost" is a
    // real DNS lookup, so prefetch and fetch share the same cache entry.
    await using server = Bun.serve({ port: 0, fetch: () => new Response("ok") });
    const url = `http://localhost:${server.port}/`;

    const currentStats = dns.getCacheStats();
    dns.prefetch("localhost", server.port);

    // No wait is needed: the fetch cannot connect until the prefetched DNS
    // resolution lands, and the check below accepts an inflight or completed hit.
    // Must set keepalive: false to ensure it doesn't reuse the socket.
    await fetch(url, { method: "HEAD", redirect: "manual", keepalive: false });
    const newStats = dns.getCacheStats();
    expect(currentStats).not.toEqual(newStats);
    if (
      newStats.cacheHitsCompleted > currentStats.cacheHitsCompleted ||
      newStats.cacheHitsInflight > currentStats.cacheHitsInflight
    ) {
      expect().pass();
    } else {
      expect().fail("dns.prefetch should have prefetched");
    }

    // Must set keepalive: false to ensure it doesn't reuse the socket.
    await fetch(url, { method: "HEAD", redirect: "manual", keepalive: false });
    const newStats2 = dns.getCacheStats();
    // Ensure it's cached.
    expect(newStats2.cacheHitsCompleted).toBeGreaterThan(currentStats.cacheHitsCompleted);
  });
});
