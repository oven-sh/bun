import { dns } from "bun";
import { describe, expect, it, test } from "bun:test";
import { bunEnv, bunExe, isMacOS } from "harness";

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

// The macOS `getaddrinfo_async_start` path watches a mach port via
// EVFILT_MACHPORT. If that reply is never observed (seen in CI on one host in
// the hour after its nightly reboot), the cache entry stayed in-flight forever
// and every later connect to the same host:port coalesced onto it. The uws
// timer sweep now cancels the async work unit and re-issues the lookup on the
// work-pool libc path.
//
// BUN_INTERNAL_DNS_LIBINFO_SIMULATE_STALL is the test hook that reproduces the
// lost-reply condition; it is part of this change, so a build without the hook
// has no way to observe the stall.
describe.skipIf(!isMacOS).concurrent("macOS libinfo DNS stale-request fallback", () => {
  // `dt` is measured inside the spawned process around its own fetch; the stall
  // hook leaves the poll unregistered regardless of host load, so concurrent
  // execution here cannot falsely satisfy the lower bound.
  const stallEnv = {
    ...bunEnv,
    BUN_INTERNAL_DNS_LIBINFO_SIMULATE_STALL: "1",
  };

  test("a stalled libinfo DNS request falls back to the work-pool resolver", async () => {
    const script = `
      const server = Bun.serve({ port: 0, fetch: () => new Response("ok") });
      const t0 = performance.now();
      const res = await fetch("http://localhost:" + server.port + "/");
      const body = await res.text();
      const dt = performance.now() - t0;
      await server.stop();
      console.log(JSON.stringify({ body, dt: Math.round(dt) }));
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: stallEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    const out = JSON.parse(stdout.trim() || "null");
    expect({ out, stderr, exitCode }).toEqual({
      out: { body: "ok", dt: expect.any(Number) },
      stderr: "",
      exitCode: 0,
    });
    // The ~4s uws sweep has to fire at least once before the work-pool fallback
    // runs; a sub-second completion would mean the stall was not exercised.
    expect(out.dt).toBeGreaterThan(3000);
  }, 30_000);

  test("fallback unblocks waiters that coalesced on the stalled entry", async () => {
    const script = `
      const server = Bun.serve({ port: 0, fetch: () => new Response("ok") });
      const url = "http://localhost:" + server.port + "/";
      const bodies = await Promise.all([
        fetch(url, { keepalive: false }).then(r => r.text()),
        fetch(url, { keepalive: false }).then(r => r.text()),
        fetch(url, { keepalive: false }).then(r => r.text()),
      ]);
      await server.stop();
      console.log(JSON.stringify(bodies));
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: stallEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect({ out: JSON.parse(stdout.trim() || "null"), stderr, exitCode }).toEqual({
      out: ["ok", "ok", "ok"],
      stderr: "",
      exitCode: 0,
    });
  }, 30_000);
});
