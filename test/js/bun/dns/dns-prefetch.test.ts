import { dns } from "bun";
import { describe, expect, it, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// The DNS cache and its counters are process-global, so every test that reads
// `getCacheStats()` runs in a fresh process.
async function runCacheFixture(script: string) {
  await using proc = Bun.spawn({ cmd: [bunExe(), "-e", script], env: bunEnv, stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { result: JSON.parse(stdout.trim() || "null"), stderr, exitCode };
}

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

  it("warms the cache for node:net", async () => {
    const { result, stderr, exitCode } = await runCacheFixture(`
      const net = require("node:net");
      const server = net.createServer(socket => socket.end());
      await new Promise(resolve => server.listen(0, resolve));
      const { port } = server.address();

      const before = Bun.dns.getCacheStats();
      Bun.dns.prefetch("localhost", port);
      const afterPrefetch = Bun.dns.getCacheStats();

      // The prefetch inserts the cache entry synchronously, so the connect below
      // hits it whether or not the resolution has landed yet.
      await new Promise((resolve, reject) => {
        const socket = net.connect(port, "localhost", () => socket.end());
        socket.on("close", resolve);
        socket.on("error", reject);
      });
      const afterConnect = Bun.dns.getCacheStats();
      server.close();

      const hits = s => s.cacheHitsCompleted + s.cacheHitsInflight;
      console.log(
        JSON.stringify({
          prefetchMisses: afterPrefetch.cacheMisses - before.cacheMisses,
          connectHits: hits(afterConnect) - hits(afterPrefetch),
          connectMisses: afterConnect.cacheMisses - afterPrefetch.cacheMisses,
        }),
      );
    `);
    expect({ result, stderr, exitCode }).toEqual({
      result: { prefetchMisses: 1, connectHits: 1, connectMisses: 0 },
      stderr: "",
      exitCode: 0,
    });
  });
});

describe("DNS cache stats", () => {
  // `cacheHitsCompleted + cacheHitsInflight + cacheMisses === totalCount` is the
  // only thing that makes the counters reconcilable. Prefetching an already
  // cached host used to bump `totalCount` and return without counting the hit.
  it("accounts for every getaddrinfo call", async () => {
    const { result, stderr, exitCode } = await runCacheFixture(`
      const before = Bun.dns.getCacheStats();
      Bun.dns.prefetch("localhost", 443);
      Bun.dns.prefetch("localhost", 443);
      Bun.dns.prefetch("localhost", 443);
      const after = Bun.dns.getCacheStats();

      const delta = key => after[key] - before[key];
      console.log(
        JSON.stringify({
          total: delta("totalCount"),
          accounted: delta("cacheHitsCompleted") + delta("cacheHitsInflight") + delta("cacheMisses"),
        }),
      );
    `);
    expect({ result, stderr, exitCode }).toEqual({
      result: { total: 3, accounted: 3 },
      stderr: "",
      exitCode: 0,
    });
  });
});

// `node:tls` and the `node:http` client both connect through `node:net`, so the
// cache that `fetch()`/`Bun.connect` use has to be reachable from there too —
// otherwise `dns.prefetch()` is a no-op for every database/HTTP driver on npm.
// Kept sequential: each `it` spawns a full Bun subprocess that resolves DNS and
// connects, so running them concurrently contends for CPU and makes the slowest
// one exceed the per-test timeout under the debug+ASAN build.
describe("node:net DNS cache", () => {
  // The spawned fixture boots a full Bun (~3.5s under debug+ASAN) and then does
  // two server setups plus a DNS resolution, a node:net connect, and a node:http
  // round-trip, which pushes it past the 5s default per-test timeout on that
  // build. Give it headroom; the CI runner already uses a larger timeout.
  it("resolves node:net and node:http through the shared cache", async () => {
    const { result, stderr, exitCode } = await runCacheFixture(`
      const net = require("node:net");
      const http = require("node:http");

      const netServer = net.createServer(socket => socket.end());
      await new Promise(resolve => netServer.listen(0, resolve));
      const netPort = netServer.address().port;

      const httpServer = http.createServer((req, res) => res.end("ok"));
      await new Promise(resolve => httpServer.listen(0, resolve));
      const httpPort = httpServer.address().port;

      const lookupEvents = [];
      const netConnect = () =>
        new Promise((resolve, reject) => {
          const socket = net.connect(netPort, "localhost", () => socket.end());
          socket.on("lookup", (err, address, family, host) => lookupEvents.push({ err, address, family, host }));
          socket.on("close", resolve);
          socket.on("error", reject);
        });
      const httpRequest = () =>
        new Promise((resolve, reject) => {
          const req = http.request(
            { host: "localhost", port: httpPort, path: "/", headers: { connection: "close" } },
            res => {
              res.resume();
              res.on("end", resolve);
            },
          );
          req.on("error", reject);
          req.end();
        });

      const hits = s => s.cacheHitsCompleted + s.cacheHitsInflight;
      const delta = (before, after) => ({
        hits: hits(after) - hits(before),
        misses: after.cacheMisses - before.cacheMisses,
        total: after.totalCount - before.totalCount,
      });

      const start = Bun.dns.getCacheStats();
      await netConnect();
      const afterNet = Bun.dns.getCacheStats();
      await httpRequest();
      const afterHttp = Bun.dns.getCacheStats();
      netServer.close();
      httpServer.close();

      console.log(
        JSON.stringify({
          net: delta(start, afterNet),
          http: delta(afterNet, afterHttp),
          // The number of addresses "localhost" resolves to is up to the host, but
          // the \`lookup\` event is part of the node:net contract either way.
          lookupEvents: lookupEvents.length > 0,
          lookupEventsValid: lookupEvents.every(
            e => e.err === null && net.isIP(e.address) === e.family && e.host === "localhost",
          ),
        }),
      );
    `);
    expect({ result, stderr, exitCode }).toEqual({
      // "localhost" is resolved once and cached; node:http reuses the entry, even
      // though it connects to a different port.
      result: {
        net: { hits: 0, misses: 1, total: 1 },
        http: { hits: 1, misses: 0, total: 1 },
        lookupEvents: true,
        lookupEventsValid: true,
      },
      stderr: "",
      exitCode: 0,
    });
  }, 30_000);

  it("leaves a user-supplied options.lookup in charge", async () => {
    const { result, stderr, exitCode } = await runCacheFixture(`
      const net = require("node:net");
      const server = net.createServer(socket => socket.end());
      await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
      const { port } = server.address();

      let calls = 0;
      const before = Bun.dns.getCacheStats();
      await new Promise((resolve, reject) => {
        const socket = net.connect(
          {
            port,
            host: "localhost",
            lookup(hostname, options, callback) {
              calls++;
              callback(null, options.all ? [{ address: "127.0.0.1", family: 4 }] : "127.0.0.1", 4);
            },
          },
          () => socket.end(),
        );
        socket.on("close", resolve);
        socket.on("error", reject);
      });
      const after = Bun.dns.getCacheStats();
      server.close();

      console.log(JSON.stringify({ calls, totalCount: after.totalCount - before.totalCount }));
    `);
    expect({ result, stderr, exitCode }).toEqual({
      result: { calls: 1, totalCount: 0 },
      stderr: "",
      exitCode: 0,
    });
  });

  // The cache is keyed on hostname alone and always resolves with AF_UNSPEC +
  // default hints, so a connect that asks for anything else must bypass it and
  // go through dns.lookup (which doesn't touch the getaddrinfo cache counters).
  it.each([
    ["an explicit family", `{ port, host: "localhost", family: 4 }`],
    [
      "non-default hints",
      `{ port, host: "localhost", hints: require("node:dns").ADDRCONFIG | require("node:dns").V4MAPPED }`,
    ],
  ])("bypasses the cache for %s", async (_label, connectOptions) => {
    const { result, stderr, exitCode } = await runCacheFixture(`
      const net = require("node:net");
      const server = net.createServer(socket => socket.end());
      await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
      const { port } = server.address();

      const before = Bun.dns.getCacheStats();
      await new Promise((resolve, reject) => {
        const socket = net.connect(${connectOptions}, () => socket.end());
        socket.on("close", resolve);
        socket.on("error", reject);
      });
      const after = Bun.dns.getCacheStats();
      server.close();

      // The cache was never consulted, so every counter is frozen.
      console.log(JSON.stringify({ totalCount: after.totalCount - before.totalCount }));
    `);
    expect({ result, stderr, exitCode }).toEqual({
      result: { totalCount: 0 },
      stderr: "",
      exitCode: 0,
    });
  });

  // The docs promise a failed connection evicts the host's cache entry, and the
  // Bun.connect test at the top of this file guards that. node:net connects to an
  // address the cache already handed it, so it has to evict by hostname instead of
  // serving a dead IP on every retry until the 30s TTL.
  it("evicts the entry after a failed node:net connect", async () => {
    const { result, stderr, exitCode } = await runCacheFixture(`
      const net = require("node:net");
      const listener = net.createServer(socket => socket.end());
      await new Promise(resolve => listener.listen(0, resolve));
      const { port } = listener.address();
      await new Promise(resolve => listener.close(resolve));

      const results = [];
      for (let i = 0; i < 3; i++) {
        let code = "none";
        await new Promise(resolve => {
          const socket = net.connect(port, "localhost", () => socket.end());
          socket.on("close", resolve);
          socket.on("error", e => {
            code = e.code;
            resolve();
          });
        });
        const { cacheHitsCompleted, size, errors } = Bun.dns.getCacheStats();
        results.push({ code, cacheHitsCompleted, size, errors });
      }
      console.log(JSON.stringify(results));
    `);
    // Each connect fails and evicts (size back to 0, one more eviction in errors),
    // so the next attempt re-resolves as a fresh miss and is never served a dead
    // address from the cache (cacheHitsCompleted stays 0).
    expect({ result, stderr, exitCode }).toEqual({
      result: [
        { code: "ECONNREFUSED", cacheHitsCompleted: 0, size: 0, errors: 1 },
        { code: "ECONNREFUSED", cacheHitsCompleted: 0, size: 0, errors: 2 },
        { code: "ECONNREFUSED", cacheHitsCompleted: 0, size: 0, errors: 3 },
      ],
      stderr: "",
      exitCode: 0,
    });
  });
});
