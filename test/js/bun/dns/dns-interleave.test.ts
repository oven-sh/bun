// The internal DNS cache (used by the usockets connect path for fetch(),
// WebSocket, Bun.connect() and `bun install`) decides which addresses the
// parallel connection attempts usockets opens get to try.
//
// Interleave: it interleaves address families (RFC 8305 §4) so the four
// parallel attempts always cover both families. registry.npmjs.org resolves to
// 12 AAAA + 12 A; on a dual-stack host with blackholed IPv6 a broken interleave
// leaves all four initial attempts on dead IPv6 and every manifest fetch stalls
// for ~100s waiting on kernel SYN-retry exhaustion.
//
// https://github.com/oven-sh/bun/issues/4938
// https://github.com/oven-sh/bun/issues/33278
import { dns } from "bun";
import { dnsIsAllLoopbackOfOneFamily, dnsIsLocalhostName } from "bun:internal-for-testing";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, isMusl } from "harness";

// The DNS cache is process-global and a failed connect evicts its entry, so
// each scenario runs in its own process. Every test also does a real fetch()
// through the seeded entry, which is consumed by usockets via
// Bun__addrinfo_getRequestResult and start_connections().
async function run(body: string, timeoutMs = 10_000) {
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
    cmd: [bunExe(), "-e", fixture],
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

// Loopback: the connect-path resolver asks getaddrinfo with AI_ADDRCONFIG, and
// glibc does not count loopback addresses as "configured". On a host whose only
// IPv6 address is ::1 (a container on an IPv4-only Docker network) it answers
// "localhost" with 127.0.0.1 only, while Bun.serve()/Bun.listen() on "localhost"
// resolve without the flag and bind ::1, so nothing in Bun can connect to them
// by name. The resolver does what Chrome's does about it:
//   1. localhost names (RFC 6761) are answered with [::1, 127.0.0.1] without
//      asking the resolver at all, and
//   2. any other name whose answer is loopback addresses of a single family is
//      looked up again without AI_ADDRCONFIG.
// The tables below pin both rules; the fixtures then bind listeners to specific
// loopback addresses and connect to them through a name with every client that
// goes through this resolver. An address the kernel refuses to bind (IPv6
// disabled outright) is skipped: nothing could be listening there.
describe("loopback names", () => {
  test("localhost names (rule 1): Chrome's IsLocalHostname", () => {
    const names = {
      "localhost": true,
      "LOCALHOST": true,
      "localhost.": true,
      "app.localhost": true,
      "app.localhost.": true,
      "a.b.LocalHost": true,
      // Chrome's EndsWith(".localhost") accepts the bare suffix too.
      ".localhost": true,
      ".localhost.": true,
      "notlocalhost": false,
      "localhost.example": false,
      "localhost2": false,
      "localhost..": false,
      "127.0.0.1": false,
      "::1": false,
      "": false,
    };
    expect(Object.fromEntries(Object.keys(names).map(name => [name, dnsIsLocalhostName(name)]))).toEqual(names);
  });

  test("answers that are retried without AI_ADDRCONFIG (rule 2): Chrome's IsAllLocalhostOfOneFamily", () => {
    const answers: [answer: string[], retried: boolean][] = [
      [["127.0.0.1"], true],
      // glibc's AI_ADDRCONFIG answer for a hosts-file name listed for both families.
      [["127.0.0.1", "127.0.0.1"], true],
      [["127.0.0.2"], true],
      [["::1"], true],
      [["::1", "127.0.0.1"], false],
      [["127.0.0.1", "10.0.0.1"], false],
      // Ordinary names keep costing one getaddrinfo() call.
      [["93.184.216.34"], false],
      [["2606:2800:21f:cb07::1"], false],
      [[], false],
    ];
    expect(answers.map(([answer]) => [answer, dnsIsAllLoopbackOfOneFamily(answer)])).toEqual(answers);
  });
});

// The dial through the name tries both loopback addresses at once. The
// fixture's server listens on one of them, so it has to hold the same port on
// the other one too: a port 0 bind in another process (a sibling fixture, any
// test in the batch) can land on the same number, and a listener there would
// answer the dial. A client socket bound to that address and port holds it
// without a listener, so the dial to it is refused as on an idle host. The
// socket stays bound while it is connected to a helper listener on some other
// port. If the other address is already taken, the server takes a new port.
function reachThroughName(name: string, addresses: string[]) {
  return /* js */ `
    const net = require("node:net");
    const name = ${JSON.stringify(name)};
    const bound = [];
    const results = [];
    for (const address of ${JSON.stringify(addresses)}) {
      const other = address.includes(":") ? "127.0.0.1" : "::1";
      const serve = () => Bun.serve({
        hostname: address,
        port: 0,
        fetch(req, server) {
          if (server.upgrade(req)) return;
          return new Response("http via " + address);
        },
        websocket: { open(ws) { ws.send("ws via " + address); }, message() {} },
      });
      let server;
      try {
        server = serve();
      } catch {
        continue;
      }
      // An address the kernel refuses to bind has no listener in any process,
      // so there is nothing to hold there.
      let helper;
      try {
        helper = Bun.listen({ hostname: other, port: 0, socket: { open() {}, data() {} } });
      } catch {}
      let guard;
      while (helper && !guard) {
        try {
          guard = await new Promise((resolve, reject) => {
            const socket = net.connect({ host: other, port: helper.port, localAddress: other, localPort: server.port });
            socket.once("connect", () => resolve(socket));
            socket.once("error", reject);
          });
        } catch (e) {
          if (e.code !== "EADDRINUSE") throw e;
          server.stop(true);
          server = serve();
        }
      }
      bound.push(address);
      const result = { address };
      try {
        result.fetch = await (await fetch("http://" + name + ":" + server.port + "/")).text();
      } catch (e) {
        result.fetch = e.code ?? e.name;
      }
      result.websocket = await new Promise(resolve => {
        const ws = new WebSocket("ws://" + name + ":" + server.port + "/");
        ws.onmessage = e => { resolve(e.data); ws.close(); };
        ws.onclose = e => resolve("closed: " + e.code);
      });
      result.connect = await new Promise(resolve => {
        Bun.connect({
          hostname: name,
          port: server.port,
          socket: {
            open(s) { resolve(s.remoteAddress); s.end(); },
            connectError(_s, e) { resolve(e.code); },
            data() {},
          },
        }).catch(e => resolve(e.code));
      });
      results.push(result);
      guard?.destroy();
      helper?.stop(true);
      server.stop(true);
    }
    console.log(JSON.stringify({ bound, results }));
    process.exit(0);
  `;
}

function reached(bound: string[]) {
  return bound.map(address => ({
    address,
    fetch: `http via ${address}`,
    websocket: `ws via ${address}`,
    connect: address,
  }));
}

// Whatever the system resolver says about these names (most answer neither
// `localhost.` nor `*.localhost`), a listener on either loopback address is
// reachable through them.
describe.concurrent(
  "fetch(), WebSocket and Bun.connect() reach a listener on 127.0.0.1 or ::1 through a localhost name",
  () => {
    test.each(["localhost", "localhost.", "bun-dns-test.localhost", "bun-dns-test.localhost."])("%s", async name => {
      const { out, stderr, exitCode, signal } = await run(reachThroughName(name, ["127.0.0.1", "::1"]));
      expect({ out, stderr, exitCode, signal }).toEqual({
        out: { bound: expect.arrayContaining(["127.0.0.1"]), results: reached(out.bound ?? []) },
        stderr: "",
        exitCode: 0,
        signal: null,
      });
    });
  },
);

// Debian, Ubuntu, Alpine and every Docker container list these names for ::1 in
// /etc/hosts (Fedora uses localhost6). On a host whose only IPv6 address is ::1,
// glibc answers them with 127.0.0.1 under AI_ADDRCONFIG; rule 2 asks again and
// gets ::1. The system's own unfiltered answer says which listener the name has
// to reach; a host whose hosts file lacks the name has nothing to test.
const hostsFileLoopbackNames = await Promise.all(
  ["ip6-localhost", "ip6-loopback", "localhost6"].map(async name => {
    const addresses = await dns.lookup(name, { backend: "system" }).then(
      records => [...new Set(records.map(record => record.address))],
      () => [],
    );
    return { name, addresses };
  }),
);

describe.concurrent(
  "fetch(), WebSocket and Bun.connect() reach the listener a hosts-file loopback name maps to",
  () => {
    for (const { name, addresses } of hostsFileLoopbackNames) {
      test.skipIf(addresses.length === 0)(
        `${name} -> ${addresses.join(", ") || "(not in this host's hosts file)"}`,
        async () => {
          const { out, stderr, exitCode, signal } = await run(reachThroughName(name, addresses));
          expect({ out, stderr, exitCode, signal }).toEqual({
            out: { bound: out.bound ?? [], results: reached(out.bound ?? []) },
            stderr: "",
            exitCode: 0,
            signal: null,
          });
        },
      );
    }
  },
);
