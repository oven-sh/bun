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

// The test above always misses the cache, which makes usockets resolve through a
// us_connecting_socket_t. A completed cache hit whose result is a single
// address takes a different path (us_socket_group_connect connects to it
// directly), and that path has to keep the same eviction promise. Each scenario
// seeds the process-global cache exactly like a real lookup would and runs in
// its own process. Nothing here ever resolves a name for real: `cacheMisses`
// staying 0 proves every connect was served by the seeded entry.
describe.concurrent("eviction through a completed cache hit", () => {
  async function run(body: string) {
    const script = `
      const { dnsCacheSeed } = require("bun:internal-for-testing");
      const stats = () => {
        const { cacheHitsCompleted, cacheMisses, size, errors } = Bun.dns.getCacheStats();
        return { cacheHitsCompleted, cacheMisses, size, errors };
      };
      const connect = (hostname, port, tls = false) =>
        Bun.connect({ hostname, port, tls, socket: { data() {} } }).then(
          socket => {
            socket.end();
            return "connected";
          },
          error => error.code,
        );
      // A port nothing listens on any more: connects to it are refused.
      const closed = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
      const refusedPort = closed.port;
      closed.stop();
      console.log(JSON.stringify(await (async () => { ${body} })()));
    `;
    await using proc = Bun.spawn({ cmd: [bunExe(), "-e", script], env: bunEnv, stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { result: JSON.parse(stdout.trim() || "null"), stderr, exitCode };
  }

  // TLS is attached to the socket up front on this path (there is no later
  // point to do it), so a refused TLS connect is checked as well.
  test("a refused connect to a single-address entry evicts it", async () => {
    expect(
      await run(`
        dnsCacheSeed("single.test", ["127.0.0.1"]);
        dnsCacheSeed("single-tls.test", ["127.0.0.1"]);
        const seeded = stats();
        const plain = await connect("single.test", refusedPort);
        const afterPlain = stats();
        const tls = await connect("single-tls.test", refusedPort, true);
        return { seeded, plain, afterPlain, tls, afterTls: stats() };
      `),
    ).toEqual({
      result: {
        seeded: { cacheHitsCompleted: 0, cacheMisses: 0, size: 2, errors: 0 },
        plain: "ECONNREFUSED",
        afterPlain: { cacheHitsCompleted: 1, cacheMisses: 0, size: 1, errors: 1 },
        tls: "ECONNREFUSED",
        afterTls: { cacheHitsCompleted: 2, cacheMisses: 0, size: 0, errors: 2 },
      },
      stderr: "",
      exitCode: 0,
    });
  });

  test("a refused connect to a multi-address entry evicts it", async () => {
    expect(
      await run(`
        dnsCacheSeed("multi.test", ["127.0.0.1", "127.0.0.1"]);
        const code = await connect("multi.test", refusedPort);
        return { code, after: stats() };
      `),
    ).toEqual({
      result: {
        code: "ECONNREFUSED",
        after: { cacheHitsCompleted: 1, cacheMisses: 0, size: 0, errors: 1 },
      },
      stderr: "",
      exitCode: 0,
    });
  });

  // The entry must survive a successful connect, and that connect must not
  // keep a reference behind: once the host goes down, the entry still leaves.
  test("a successful connect keeps the entry, and it is still evicted once the host goes down", async () => {
    expect(
      await run(`
        const server = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
        dnsCacheSeed("flaky.test", ["127.0.0.1"]);
        const first = await connect("flaky.test", server.port);
        const afterSuccess = stats();
        server.stop(true);
        const second = await connect("flaky.test", server.port);
        return { first, afterSuccess, second, afterRefused: stats() };
      `),
    ).toEqual({
      result: {
        first: "connected",
        afterSuccess: { cacheHitsCompleted: 1, cacheMisses: 0, size: 1, errors: 0 },
        second: "ECONNREFUSED",
        afterRefused: { cacheHitsCompleted: 2, cacheMisses: 0, size: 0, errors: 1 },
      },
      stderr: "",
      exitCode: 0,
    });
  });

  // A connect torn down before it has an outcome says nothing about the host.
  // The worker issues the connect and then never returns to its event loop, so
  // terminating it is the only thing that closes the still-connecting socket;
  // terminate() resolves after the worker's sockets are closed. The entry must
  // stay, and the reference the worker held must be gone, which the refused
  // connect afterwards shows by still being able to remove the entry.
  // (Explicit timeout: starting a worker alone takes ~3s in a debug build.)
  test("a connect abandoned before it completes keeps the entry and drops its reference", async () => {
    expect(
      await run(`
        const { Worker } = require("node:worker_threads");
        dnsCacheSeed("abandoned.test", ["127.0.0.1"]);
        const worker = new Worker(
          'const { parentPort, workerData: port } = require("node:worker_threads");' +
            'Bun.connect({ hostname: "abandoned.test", port, socket: { data() {} } }).catch(() => {});' +
            'parentPort.postMessage("connecting");' +
            "for (;;) {}",
          { eval: true, workerData: refusedPort },
        );
        await new Promise((resolve, reject) => {
          worker.once("message", resolve);
          worker.once("error", reject);
        });
        const whileConnecting = stats();
        await worker.terminate();
        const afterAbandon = stats();
        const code = await connect("abandoned.test", refusedPort);
        return { whileConnecting, afterAbandon, code, afterRefused: stats() };
      `),
    ).toEqual({
      result: {
        whileConnecting: { cacheHitsCompleted: 1, cacheMisses: 0, size: 1, errors: 0 },
        afterAbandon: { cacheHitsCompleted: 1, cacheMisses: 0, size: 1, errors: 0 },
        code: "ECONNREFUSED",
        afterRefused: { cacheHitsCompleted: 2, cacheMisses: 0, size: 0, errors: 1 },
      },
      stderr: "",
      exitCode: 0,
    });
  }, 30_000);
});

describe("dns.prefetch", () => {
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
