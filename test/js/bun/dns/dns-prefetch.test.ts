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
