import { dns } from "bun";
import { describe, expect, it, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

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
});

// The cache has a fixed number of slots and can only evict entries nothing
// references. Once every slot is referenced, a lookup for another name still
// runs, but its request never becomes an entry, and only entries used to get
// freed: such a request leaked as soon as its last reference went away. Runs in
// its own process because filling the cache is process-global.
test("a lookup the full cache has no room for is freed once nothing references it", async () => {
  const script = /* js */ `
    const { dnsCacheSeed, dnsCacheInternals } = require("bun:internal-for-testing");
    const { liveRequests, acquire, release } = dnsCacheInternals;
    const misses = () => Bun.dns.getCacheStats().cacheMisses;
    const size = () => Bun.dns.getCacheStats().size;

    // Reference every entry the way a connect that has not settled yet does,
    // until seeding (which stores entries the way a lookup does) finds nothing
    // left to evict.
    const held = [];
    for (;;) {
      const host = "held-" + held.length + ".test";
      try {
        dnsCacheSeed(host, ["127.0.0.1"]);
      } catch (e) {
        if (!e.message.includes("full")) throw e;
        break;
      }
      acquire(host);
      held.push(host);
    }
    const out = { held: held.length, size: { full: size() } };

    // Nothing but its own lookup references a prefetch, so its request has to
    // go as soon as the lookup lands (on the work pool, hence the wait).
    let live = liveRequests();
    let missed = misses();
    Bun.dns.prefetch("localhost");
    const deadline = Date.now() + 2_000;
    while (liveRequests() !== live && Date.now() < deadline) await Bun.sleep(1);
    out.prefetch = { misses: misses() - missed, leaked: liveRequests() - live };

    // A connect references its request until it settles. Let it settle once the
    // held entries have been released: the cache is then back under its
    // high-water mark, which is when a settled request that IS an entry is kept.
    using listener = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
    live = liveRequests();
    missed = misses();
    const connecting = Bun.connect({ hostname: "localhost", port: listener.port, socket: { data() {} } });
    out.connect = { misses: misses() - missed, pending: liveRequests() - live };
    for (const host of held) release(host);
    out.size.released = size();
    using socket = await connecting;
    out.connect.leaked = liveRequests() - size() - out.prefetch.leaked;
    console.log(JSON.stringify(out));
  `;
  await using proc = Bun.spawn({ cmd: [bunExe(), "-e", script], env: bunEnv, stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ out: JSON.parse(stdout.trim() || "null"), stderr, exitCode }).toEqual({
    out: {
      // MAX_ENTRIES in dns.rs.
      held: 256,
      // Releasing drops entries until the cache is under 80% full and keeps
      // the rest.
      size: { full: 256, released: 204 },
      // Each lookup missed (so it allocated a request) with the cache full.
      // Without the fix both `leaked` are 1: the prefetch's request once its
      // lookup landed, the connect's once the connect settled.
      prefetch: { misses: 1, leaked: 0 },
      connect: { misses: 1, pending: 1, leaked: 0 },
    },
    stderr: "",
    exitCode: 0,
  });
});
