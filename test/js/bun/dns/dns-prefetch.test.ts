import { dns } from "bun";
import { describe, expect, it, test } from "bun:test";
import { bunEnv, bunExe, compileFixture, isLinux, tempDir } from "harness";
import { join } from "node:path";

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

// Every connection to a name joins the entry's lookup while it runs. A caller
// that gave up on the lookup (here an aborted fetch) used to leave the entry in
// place, so every later connection to the name waited out the whole lookup.
// Giving up now invalidates the entry, and the next connection starts a fresh
// lookup. The fixture is an LD_PRELOAD shim that holds the first getaddrinfo(3)
// of one name, so this runs on Linux with a C compiler only.
const cc = Bun.which("cc") || Bun.which("clang") || Bun.which("gcc");
test.skipIf(!isLinux || !cc)(
  "a connection that gives up on a running lookup does not hold up the next one",
  async () => {
    const shim = compileFixture(join(import.meta.dir, "hold-getaddrinfo-fixture.c"), { flags: ["-ldl", "-lpthread"] });
    using dir = tempDir("hold-dns", {});
    // The shim creates the signal file as it begins holding the first lookup, and
    // holds it until the release file exists.
    const signalFile = join(String(dir), "holding");
    const releaseFile = join(String(dir), "release");
    const script = `
    using server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("ok") });
    const url = "http://held.test:" + server.port + "/";
    // Abort the first fetch once the shim reports that it holds its lookup; the
    // lookup stays held until the release file exists, so the abort can never
    // land after getaddrinfo has returned.
    const controller = new AbortController();
    const first = fetch(url, { signal: controller.signal }).then(r => r.status, e => e.name);
    const { existsSync, writeFileSync } = require("node:fs");
    const deadline = Date.now() + 5_000;
    while (!existsSync(process.env.HOLD_DNS_SIGNAL_FILE) && Date.now() < deadline) await Bun.sleep(1);
    controller.abort();
    await first;
    const second = await fetch(url).then(r => r.status, e => e.name);
    // The second fetch completed while the first lookup was still held: release it.
    writeFileSync(process.env.HOLD_DNS_RELEASE_FILE, "");
    const { size, ...stats } = Bun.dns.getCacheStats();
    console.log(JSON.stringify({ first: await first, second, ...stats }));
  `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: {
        ...bunEnv,
        LD_PRELOAD: bunEnv.LD_PRELOAD ? `${shim}:${bunEnv.LD_PRELOAD}` : shim,
        HOLD_DNS_NAME: "held.test",
        HOLD_DNS_SIGNAL_FILE: signalFile,
        HOLD_DNS_RELEASE_FILE: releaseFile,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const result = JSON.parse(stdout.trim() || "{}");
    // The second connection is a fresh lookup (a second cache miss), not an
    // inflight hit on the held one.
    expect({ result, stderr, exitCode }).toEqual({
      result: {
        first: "AbortError",
        second: 200,
        cacheHitsCompleted: 0,
        cacheHitsInflight: 0,
        cacheMisses: 2,
        errors: 0,
        totalCount: 2,
      },
      stderr: "",
      exitCode: 0,
    });
  },
);

test("dns.getCacheStats returns a new plain object of integers", () => {
  const stats = dns.getCacheStats();
  expect(Object.getPrototypeOf(stats)).toBe(Object.prototype);
  expect(Object.keys(stats)).toEqual([
    "cacheHitsCompleted",
    "cacheHitsInflight",
    "cacheMisses",
    "size",
    "errors",
    "totalCount",
  ]);
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(stats))) {
    expect(descriptor).toEqual({ value: expect.any(Number), writable: true, enumerable: true, configurable: true });
    expect(descriptor.value).toBeInteger();
  }
  expect(dns.getCacheStats()).not.toBe(stats);
});

describe("dns.prefetch", () => {
  it("checks its arguments", () => {
    for (const hostname of [undefined, null, 1, {}, [], Symbol(), { toString: () => "localhost" }] as any[]) {
      expect(() => dns.prefetch(hostname)).toThrow(
        expect.objectContaining({
          name: "TypeError",
          code: "ERR_INVALID_ARG_TYPE",
          message: "hostname must be a string",
        }),
      );
    }
    for (const [port, received] of [
      ["80", "type string ('80')"],
      [true, "type boolean (true)"],
      [80n, "type bigint (80n)"],
      [{ valueOf: () => 80 }, "an instance of Object"],
    ] as any[]) {
      expect(() => dns.prefetch("localhost", port)).toThrow(
        expect.objectContaining({
          name: "TypeError",
          code: "ERR_INVALID_ARG_TYPE",
          message: `The "port" argument must be of type number. Received ${received}`,
        }),
      );
    }
    for (const port of [80.5, NaN, Infinity]) {
      expect(() => dns.prefetch("localhost", port)).toThrow(
        expect.objectContaining({
          name: "RangeError",
          code: "ERR_OUT_OF_RANGE",
          message: `The value of "port" is out of range. It must be an integer. Received ${port}`,
        }),
      );
    }
    for (const [port, received] of [
      [-1, "-1"],
      [65536, "65536"],
      [2 ** 53, "9_007_199_254_740_992"],
    ]) {
      expect(() => dns.prefetch("localhost", port as number)).toThrow(
        expect.objectContaining({
          name: "RangeError",
          code: "ERR_OUT_OF_RANGE",
          message: `The value of "port" is out of range. It must be >= 0 && <= 65535. Received ${received}`,
        }),
      );
    }
    // Not "localhost": the cache is keyed by the name, and the next test needs it cold.
    for (const port of [undefined, null, 0, 65535] as any[]) expect(dns.prefetch("127.0.0.1", port)).toBeUndefined();
  });

  it("should prefetch", async () => {
    // A local server keeps the test off the external network. "localhost" gets a
    // cache entry like any other name, which prefetch and fetch share.
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
