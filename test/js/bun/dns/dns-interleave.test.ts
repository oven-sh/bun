// The internal DNS cache (used by the usockets connect path for fetch(),
// Bun.connect() and `bun install`) interleaves address families (RFC 8305 §4)
// so the four parallel connection attempts usockets opens always cover both
// families. registry.npmjs.org resolves to 12 AAAA + 12 A; on a dual-stack
// host with blackholed IPv6 a broken interleave leaves all four initial
// attempts on dead IPv6 and every manifest fetch stalls for ~100s waiting on
// kernel SYN-retry exhaustion.
//
// https://github.com/oven-sh/bun/issues/4938
// https://github.com/oven-sh/bun/issues/33278
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, isMusl } from "harness";

// The DNS cache is process-global and a failed connect evicts its entry, so
// each scenario runs in its own process. Every test also does a real fetch()
// through the seeded entry, which is consumed by usockets via
// Bun__addrinfo_getRequestResult and start_connections().
async function run(body: string, timeoutMs = 10_000, execArgs: string[] = []) {
  const fixture = /* js */ `
    const { dnsCacheSeed } = require("bun:internal-for-testing");
    if (typeof dnsCacheSeed !== "function") {
      // A released binary without the hook must FAIL, not skip.
      console.log(JSON.stringify({ ok: false, err: "dnsCacheSeed unavailable" }));
      process.exit(0);
    }
    ${body}
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...execArgs, "-e", fixture],
    env: {
      ...bunEnv,
      HTTP_PROXY: undefined,
      HTTPS_PROXY: undefined,
      http_proxy: undefined,
      https_proxy: undefined,
    },
    stderr: "pipe",
    stdout: "pipe",
  });
  const timer = setTimeout(() => proc.kill(), timeoutMs);
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  clearTimeout(timer);
  let out: any;
  try {
    out = JSON.parse(stdout.trim());
  } catch {
    out = { unparseableStdout: stdout };
  }
  return { out, stderr, exitCode, signal: proc.signalCode };
}

describe.concurrent("getaddrinfo interleave (RFC 8305)", () => {
  test("fetch() through a seeded 4xAAAA + 4xA entry connects via the interleaved order", async () => {
    const { out, stderr, exitCode, signal } = await run(/* js */ `
      using server = Bun.serve({ port: 0, fetch: () => new Response("ok") });
      const port = server.port;
      // Resolver order that used to defeat the old loop: all v6 first.
      const order = dnsCacheSeed("he-grouped-" + port + ".test", [
        "::1", "::1", "::1", "::1", "127.0.0.1", "127.0.0.1", "127.0.0.1", "127.0.0.1",
      ]);
      const res = await fetch("http://he-grouped-" + port + ".test:" + port + "/");
      console.log(JSON.stringify({ ok: true, order, body: await res.text() }));
      process.exit(0);
    `);
    expect({ out, stderr, exitCode, signal }).toEqual({
      out: { ok: true, order: [6, 4, 6, 4, 6, 4, 6, 4], body: "ok" },
      stderr: "",
      exitCode: 0,
      signal: null,
    });
  });

  test("registry.npmjs.org shape: 12 AAAA then 12 A puts IPv4 in the first batch", async () => {
    const { out, stderr, exitCode, signal } = await run(/* js */ `
      using server = Bun.serve({ port: 0, fetch: () => new Response("ok") });
      const port = server.port;
      const v6 = Array(12).fill("::1"), v4 = Array(12).fill("127.0.0.1");
      const order = dnsCacheSeed("he-npm-" + port + ".test", [...v6, ...v4]);
      const res = await fetch("http://he-npm-" + port + ".test:" + port + "/");
      console.log(JSON.stringify({ ok: true, head: order.slice(0, 4), body: await res.text() }));
      process.exit(0);
    `);
    expect({ out, stderr, exitCode, signal }).toEqual({
      out: { ok: true, head: [6, 4, 6, 4], body: "ok" },
      stderr: "",
      exitCode: 0,
      signal: null,
    });
  });

  test("resolver's first address stays first", async () => {
    const { out, stderr, exitCode, signal } = await run(/* js */ `
      using server = Bun.serve({ port: 0, fetch: () => new Response("ok") });
      const port = server.port;
      // v4-first input stays v4-first.
      const order = dnsCacheSeed("he-v4first-" + port + ".test", [
        "127.0.0.1", "127.0.0.1", "127.0.0.1", "127.0.0.1", "::1",
      ]);
      const res = await fetch("http://he-v4first-" + port + ".test:" + port + "/");
      console.log(JSON.stringify({ ok: true, order, body: await res.text() }));
      process.exit(0);
    `);
    expect({ out, stderr, exitCode, signal }).toEqual({
      out: { ok: true, order: [4, 6, 4, 4, 4], body: "ok" },
      stderr: "",
      exitCode: 0,
      signal: null,
    });
  });

  // End-to-end proof: with the first family blackholed (SYNs silently dropped,
  // connect() stuck in EINPROGRESS until kernel SYN-retry exhaustion), fetch()
  // must still succeed because the interleave put the other family in the
  // first CONCURRENT_CONNECTIONS batch. Without the fix all four initial
  // attempts are blackholed and the fetch hangs. The backlog-0 trick and
  // 127.0.0.0/8-on-lo are Linux-specific; the raw setup dlopens glibc.
  test.skipIf(!isLinux || isMusl)(
    "fetch() succeeds when the first family is blackholed and only the other family is reachable",
    async () => {
      const { out, stderr, exitCode, signal } = await run(
        /* js */ `
        const { dlopen } = require("bun:ffi");
        const libc = dlopen("libc.so.6", {
          socket:   { args: ["int","int","int"],           returns: "int" },
          bind:     { args: ["int","ptr","int"],           returns: "int" },
          listen:   { args: ["int","int"],                 returns: "int" },
          connect:  { args: ["int","ptr","int"],           returns: "int" },
          close:    { args: ["int"],                       returns: "int" },
          setsockopt:{args: ["int","int","int","ptr","int"],returns:"int" },
        });
        const AF_INET=2, SOCK_STREAM=1, SOCK_NONBLOCK=0o4000, SOL_SOCKET=1, SO_REUSEADDR=2;
        function sockaddr_in(ip, port) {
          const b = new Uint8Array(16);
          new DataView(b.buffer).setUint16(0, AF_INET, true);
          b[2] = (port>>8)&0xff; b[3] = port&0xff;
          const o = ip.split(".").map(Number); b[4]=o[0]; b[5]=o[1]; b[6]=o[2]; b[7]=o[3];
          return b;
        }
        const fds = [];
        // listen(fd, 0) + fill the one-slot accept queue so further SYNs to
        // ip:port are silently dropped (same EINPROGRESS a filtered network
        // produces).
        function blackhole(ip, port) {
          const fd = libc.symbols.socket(AF_INET, SOCK_STREAM, 0);
          if (fd < 0) throw new Error("socket() failed");
          fds.push(fd);
          const one = new Int32Array([1]);
          libc.symbols.setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, one, 4);
          if (libc.symbols.bind(fd, sockaddr_in(ip, port), 16) !== 0)
            throw new Error("bind(" + ip + ":" + port + ") failed");
          if (libc.symbols.listen(fd, 0) !== 0) throw new Error("listen() failed");
          for (let i = 0; i < 8; i++) {
            const c = libc.symbols.socket(AF_INET, SOCK_STREAM | SOCK_NONBLOCK, 0);
            fds.push(c);
            libc.symbols.connect(c, sockaddr_in(ip, port), 16);
          }
        }

        using server = Bun.serve({ port: 0, hostname: "::1", fetch: () => new Response("ok via ::1") });
        const port = server.port;
        const dead = ["127.0.0.2","127.0.0.3","127.0.0.4","127.0.0.5"];
        for (const ip of dead) blackhole(ip, port);

        // Resolver returned 4 blackholed v4 first, then one reachable v6.
        const host = "he-blackhole-" + port + ".test";
        const order = dnsCacheSeed(host, [...dead, "::1"]);

        const t0 = performance.now();
        let result;
        try {
          const res = await fetch("http://" + host + ":" + port + "/", {
            signal: AbortSignal.timeout(4000),
          });
          result = { ok: true, ms: Math.round(performance.now() - t0), order, body: await res.text() };
        } catch (e) {
          result = { ok: false, ms: Math.round(performance.now() - t0), order, err: e?.name ?? String(e) };
        }
        console.log(JSON.stringify(result));
        for (const fd of fds) libc.symbols.close(fd);
        process.exit(0);
      `,
        20_000,
      );
      // With the broken interleave the order is [4,4,4,4,6]: all four initial
      // attempts sit in EINPROGRESS and the fetch aborts at 4s with
      // TimeoutError. With the fix the order is [4,6,4,4,4]: ::1 is attempted
      // in the first batch and connects immediately.
      expect({ out, stderr, exitCode, signal }).toEqual({
        out: { ok: true, ms: expect.any(Number), order: [4, 6, 4, 4, 4], body: "ok via ::1" },
        stderr: expect.any(String),
        exitCode: 0,
        signal: null,
      });
      expect(out.ms).toBeLessThan(4000);
    },
    20_000,
  );
});

// https://github.com/oven-sh/bun/issues/40178: the connect-path cache ignored
// --dns-result-order and dns.setDefaultResultOrder; the first getaddrinfo
// family always led the interleave.
describe.concurrent("dns result order reaches the connect path", () => {
  test("--dns-result-order=ipv4first leads the interleave with IPv4", async () => {
    const { out, stderr, exitCode, signal } = await run(
      /* js */ `
        const order = dnsCacheSeed("order-v4flag.test", ["::1", "::1", "127.0.0.1", "127.0.0.1"]);
        console.log(JSON.stringify({ ok: true, order }));
        process.exit(0);
      `,
      10_000,
      ["--dns-result-order=ipv4first"],
    );
    expect({ out, stderr, exitCode, signal }).toEqual({
      out: { ok: true, order: [4, 6, 4, 6] },
      stderr: "",
      exitCode: 0,
      signal: null,
    });
  });

  test("--dns-result-order=ipv6first leads the interleave with IPv6", async () => {
    const { out, stderr, exitCode, signal } = await run(
      /* js */ `
        const order = dnsCacheSeed("order-v6flag.test", ["127.0.0.1", "127.0.0.1", "::1", "::1"]);
        console.log(JSON.stringify({ ok: true, order }));
        process.exit(0);
      `,
      10_000,
      ["--dns-result-order=ipv6first"],
    );
    expect({ out, stderr, exitCode, signal }).toEqual({
      out: { ok: true, order: [6, 4, 6, 4] },
      stderr: "",
      exitCode: 0,
      signal: null,
    });
  });

  test("--dns-result-order=verbatim keeps the resolver's first family first", async () => {
    const { out, stderr, exitCode, signal } = await run(
      /* js */ `
        const order = dnsCacheSeed("order-verbatim.test", ["::1", "127.0.0.1"]);
        console.log(JSON.stringify({ ok: true, order }));
        process.exit(0);
      `,
      10_000,
      ["--dns-result-order=verbatim"],
    );
    expect({ out, stderr, exitCode, signal }).toEqual({
      out: { ok: true, order: [6, 4] },
      stderr: "",
      exitCode: 0,
      signal: null,
    });
  });

  test("ipv4first with a single-family answer keeps the answer intact", async () => {
    const { out, stderr, exitCode, signal } = await run(
      /* js */ `
        const order = dnsCacheSeed("order-v6only.test", ["::1", "::1", "::1"]);
        console.log(JSON.stringify({ ok: true, order }));
        process.exit(0);
      `,
      10_000,
      ["--dns-result-order=ipv4first"],
    );
    expect({ out, stderr, exitCode, signal }).toEqual({
      out: { ok: true, order: [6, 6, 6] },
      stderr: "",
      exitCode: 0,
      signal: null,
    });
  });

  test("dns.setDefaultResultOrder('ipv4first') applies to later connect-path lookups", async () => {
    const { out, stderr, exitCode, signal } = await run(/* js */ `
      require("node:dns").setDefaultResultOrder("ipv4first");
      const order = dnsCacheSeed("order-sdro.test", ["::1", "::1", "127.0.0.1", "127.0.0.1"]);
      console.log(JSON.stringify({ ok: true, order }));
      process.exit(0);
    `);
    expect({ out, stderr, exitCode, signal }).toEqual({
      out: { ok: true, order: [4, 6, 4, 6] },
      stderr: "",
      exitCode: 0,
      signal: null,
    });
  });

  test("changing the order drops completed cache entries packed with the old order", async () => {
    const { out, stderr, exitCode, signal } = await run(/* js */ `
      dnsCacheSeed("order-stale.test", ["::1", "127.0.0.1"]);
      const before = Bun.dns.getCacheStats().size;
      require("node:dns").setDefaultResultOrder("ipv4first");
      const after = Bun.dns.getCacheStats().size;
      console.log(JSON.stringify({ ok: true, before, after }));
      process.exit(0);
    `);
    expect({ out, stderr, exitCode, signal }).toEqual({
      out: { ok: true, before: 1, after: 0 },
      stderr: "",
      exitCode: 0,
      signal: null,
    });
  });

  // Deliberate Node divergence: Node scopes setDefaultResultOrder per thread.
  // Bun's connect path shares one process-global DNS cache, so a worker's
  // call changes the dial order for the whole process, while the dns.lookup
  // default stays per-thread. See docs/runtime/nodejs-compat.mdx.
  test("setDefaultResultOrder in a Worker changes the connect-path order process-wide", async () => {
    const { out, stderr, exitCode, signal } = await run(/* js */ `
      const dns = require("node:dns");
      const { Worker } = require("node:worker_threads");
      const worker = new Worker('require("node:dns").setDefaultResultOrder("ipv4first")', { eval: true });
      await new Promise((resolve, reject) => {
        worker.on("exit", resolve);
        worker.on("error", reject);
      });
      const order = dnsCacheSeed("order-worker.test", ["::1", "127.0.0.1"]);
      const lookupDefault = dns.getDefaultResultOrder();
      console.log(JSON.stringify({ ok: true, order, lookupDefault }));
      process.exit(0);
    `);
    expect({ out, stderr, exitCode, signal }).toEqual({
      // The connect path follows the worker's order; the main thread's
      // dns.lookup default is untouched.
      out: { ok: true, order: [4, 6], lookupDefault: "verbatim" },
      stderr: "",
      exitCode: 0,
      signal: null,
    });
  });

  test("--dns-result-order with an invalid value exits with an error", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "--dns-result-order=bogus", "-e", "console.log('reached')"],
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout).toBe("");
    expect(stderr).toContain("Invalid DNS result order");
    expect(exitCode).toBe(1);
  });

  test("fetch() connects through an ipv4first-seeded entry", async () => {
    const { out, stderr, exitCode, signal } = await run(
      /* js */ `
        using server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("ok") });
        const port = server.port;
        const order = dnsCacheSeed("order-fetch-" + port + ".test", ["::1", "127.0.0.1"]);
        const res = await fetch("http://order-fetch-" + port + ".test:" + port + "/");
        console.log(JSON.stringify({ ok: true, order, body: await res.text() }));
        process.exit(0);
      `,
      10_000,
      ["--dns-result-order=ipv4first"],
    );
    expect({ out, stderr, exitCode, signal }).toEqual({
      out: { ok: true, order: [4, 6], body: "ok" },
      stderr: "",
      exitCode: 0,
      signal: null,
    });
  });
});
