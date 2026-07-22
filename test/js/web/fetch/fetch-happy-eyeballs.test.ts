// fetch() must not wait for kernel SYN-retry exhaustion (~130 s on Linux) when
// the first batch of resolved addresses is blackholed but a later address in
// the same DNS answer is reachable (RFC 8305 Happy Eyeballs).
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, isMusl } from "harness";

// The blackhole (a backlog-0 listener whose accept queue is kept full so the
// kernel silently drops further SYNs) and the 127.0.0.0/8-on-lo assumption are
// Linux-specific, and the raw-socket setup dlopens glibc's libc.so.6.
const skip = !isLinux || isMusl;

// Raw libc listeners that never accept(). listen(fd, 0) gives a one-entry
// accept queue; the first filler fills it and Linux then drops every further
// SYN to that address:port, leaving connect() in EINPROGRESS until the kernel
// exhausts SYN retransmits (~130 s with the default tcp_syn_retries=6). This
// is the same non-failing EINPROGRESS a filtered network produces.
const blackholePreamble = /* js */ `
  import { dlopen } from "bun:ffi";

  const libc = dlopen("libc.so.6", {
    socket: { args: ["int", "int", "int"], returns: "int" },
    bind: { args: ["int", "ptr", "int"], returns: "int" },
    listen: { args: ["int", "int"], returns: "int" },
    connect: { args: ["int", "ptr", "int"], returns: "int" },
    close: { args: ["int"], returns: "int" },
    setsockopt: { args: ["int", "int", "int", "ptr", "int"], returns: "int" },
  });

  const AF_INET = 2, SOCK_STREAM = 1, SOCK_NONBLOCK = 0o4000;
  const SOL_SOCKET = 1, SO_REUSEADDR = 2;
  function sockaddr_in(ip, port) {
    const b = new Uint8Array(16);
    new DataView(b.buffer).setUint16(0, AF_INET, true);
    b[2] = (port >> 8) & 0xff; b[3] = port & 0xff;
    const o = ip.split(".").map(Number);
    b[4] = o[0]; b[5] = o[1]; b[6] = o[2]; b[7] = o[3];
    return b;
  }
  const fds = [];
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
  function seedOrFail(host, addrs) {
    const internals = require("bun:internal-for-testing");
    if (typeof internals.dnsCacheSeed !== "function") {
      // A build without the hook (e.g. a released bun) has no hermetic way to
      // control the resolved address list, so these tests must FAIL on it,
      // not skip: the parent asserts against this result.
      console.log(JSON.stringify({ ok: false, ms: 0, err: "dnsCacheSeed unavailable" }));
      process.exit(0);
    }
    internals.dnsCacheSeed(host, addrs);
  }
`;

async function runFixture(body: string) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", blackholePreamble + body],
    // The fixture must resolve and connect to the test hostname itself; an
    // inherited HTTP(S)_PROXY would route the request to the proxy instead.
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
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  let out: any;
  try {
    out = JSON.parse(stdout.trim());
  } catch {
    out = { unparseableStdout: stdout };
  }
  return { out, stderr, exitCode, signal: proc.signalCode };
}

test.skipIf(skip)(
  "fetch() advances to the next resolved address before a blackholed connect hard-fails",
  async () => {
    const { out, stderr, exitCode, signal } = await runFixture(/* js */ `
      using server = Bun.serve({
        port: 0,
        hostname: "127.0.0.100",
        fetch: () => new Response("hello from 127.0.0.100"),
      });
      const port = server.port;
      const dead = ["127.0.0.2", "127.0.0.3", "127.0.0.4", "127.0.0.5"];
      for (const ip of dead) blackhole(ip, port);

      // The live address is #5, one past the CONCURRENT_CONNECTIONS (4) batch.
      // 127.0.0.100 is chosen so that an RFC 6724 rule-9 sort by glibc/musl
      // (longest prefix vs the 127.0.0.1 source address) also ranks it last;
      // the order is the same whether getaddrinfo sorts or preserves input order.
      const host = "he-blackhole-" + port + ".test";
      seedOrFail(host, [...dead, "127.0.0.100"]);

      const t0 = performance.now();
      let result;
      try {
        const res = await fetch("http://" + host + ":" + port + "/", {
          signal: AbortSignal.timeout(4000),
        });
        result = { ok: true, ms: Math.round(performance.now() - t0), body: await res.text() };
      } catch (e) {
        result = { ok: false, ms: Math.round(performance.now() - t0), err: e?.name ?? String(e) };
      }
      console.log(JSON.stringify(result));
      for (const fd of fds) libc.symbols.close(fd);
      process.exit(0);
    `);
    // On the unfixed build the four parallel connects to 127.0.0.2-5 sit in
    // EINPROGRESS and 127.0.0.100 is never attempted, so the fetch aborts at
    // 4 s with { ok: false, err: "TimeoutError" }. With the per-attempt timer
    // the fifth address is started ~300 ms in and the fetch succeeds.
    expect({ out, stderr, exitCode, signal }).toEqual({
      out: { ok: true, ms: expect.any(Number), body: "hello from 127.0.0.100" },
      stderr: expect.any(String),
      exitCode: 0,
      signal: null,
    });
    expect(out.ms).toBeLessThan(4000);
    // Nothing can succeed before the first 300 ms attempt tick (the whole
    // initial batch is blackholed), so this proves the success really came
    // through the per-attempt timer rather than some other path.
    expect(out.ms).toBeGreaterThanOrEqual(250);
  },
  // The failure mode under test is a deliberate 4 s connect stall in the
  // spawned fixture, which does not fit in the default 5 s test timeout.
  20_000,
);

test.skipIf(skip)(
  "a live first address succeeds from the initial batch and an abort with attempts still pending tears down cleanly",
  async () => {
    const { out, stderr, exitCode, signal } = await runFixture(/* js */ `
      using server = Bun.serve({
        port: 0,
        hostname: "127.0.0.100",
        fetch: () => new Response("hello from 127.0.0.100"),
      });
      const port = server.port;
      const dead = [2, 3, 4, 5, 6, 7, 8, 9].map(n => "127.0.0." + n);
      for (const ip of dead) blackhole(ip, port);

      // (A) Live address FIRST, 5 addresses. The connect succeeds from the
      // initial CONCURRENT_CONNECTIONS (4) batch, so the request settles with
      // one address still untried and its per-attempt work still pending.
      // That pending work must be torn down with the request: a stale attempt
      // ticking afterwards would start spurious connects or crash. This is
      // the most common production shape for a >4-address hostname.
      const hostA = "he-first-" + port + ".test";
      seedOrFail(hostA, ["127.0.0.100", ...dead.slice(0, 4)]);
      const resA = await fetch("http://" + hostA + ":" + port + "/", {
        signal: AbortSignal.timeout(4000),
      });
      const a = { ok: true, body: await resA.text() };

      // (B) Every address blackholed; abort at 700 ms with attempts still in
      // flight and addresses still untried. The abort must win promptly and
      // cleanly. It also keeps the event loop alive well past (A)'s request,
      // so any per-attempt work (A) leaked would surface here as a crash
      // under the ASAN build.
      const hostB = "he-abort-" + port + ".test";
      seedOrFail(hostB, dead);
      const tB = performance.now();
      let b;
      try {
        await fetch("http://" + hostB + ":" + port + "/", { signal: AbortSignal.timeout(700) });
        b = { ok: true, ms: Math.round(performance.now() - tB) };
      } catch (e) {
        b = { ok: false, ms: Math.round(performance.now() - tB), err: e?.name ?? String(e) };
      }
      console.log(JSON.stringify({ a, b }));
      for (const fd of fds) libc.symbols.close(fd);
      process.exit(0);
    `);
    expect({ out, stderr, exitCode, signal }).toEqual({
      out: {
        a: { ok: true, body: "hello from 127.0.0.100" },
        b: { ok: false, ms: expect.any(Number), err: "TimeoutError" },
      },
      stderr: expect.any(String),
      exitCode: 0,
      signal: null,
    });
    // The abort must win well before any kernel connect timeout.
    expect(out.b.ms).toBeLessThan(5000);
  },
  20_000,
);
