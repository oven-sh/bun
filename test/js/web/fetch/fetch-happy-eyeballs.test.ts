// fetch() must not wait for kernel SYN-retry exhaustion (~130 s on Linux) when
// the first batch of resolved addresses is blackholed but a later address in
// the same DNS answer is reachable (RFC 8305 Happy Eyeballs).
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, isMusl } from "harness";

// The blackhole (a backlog-0 listener whose accept queue is kept full so the
// kernel silently drops further SYNs) and the 127.0.0.0/8-on-lo assumption are
// Linux-specific, and the raw-socket setup dlopens glibc's libc.so.6.
test.skipIf(!isLinux || isMusl)(
  "fetch() advances to the next resolved address before a blackholed connect hard-fails",
  async () => {
    const fixture = /* js */ `
      import { dlopen } from "bun:ffi";
      import fs from "node:fs";

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
      // A listener that never calls accept(). listen(fd, 0) gives a one-entry
      // accept queue; the first filler fills it and Linux then drops every
      // further SYN to this address:port, leaving connect() in EINPROGRESS
      // until the kernel exhausts SYN retransmits (~130 s, tcp_syn_retries=6).
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
      const addrs = [...dead, "127.0.0.100"];

      let restoreHosts;
      const internals = require("bun:internal-for-testing");
      if (typeof internals.dnsCacheSeed === "function") {
        internals.dnsCacheSeed(host, addrs);
      } else if (typeof process.getuid === "function" && process.getuid() === 0) {
        // Build predates the dnsCacheSeed test hook: feed the same address
        // list through the real getaddrinfo path via the system hosts file.
        const saved = fs.readFileSync("/etc/hosts", "utf8");
        restoreHosts = () => { try { fs.writeFileSync("/etc/hosts", saved); } catch {} };
        process.on("exit", restoreHosts);
        fs.writeFileSync("/etc/hosts", saved + "\\n" + addrs.map(a => a + " " + host).join("\\n") + "\\n");
      } else {
        // No skip here on purpose: a build without the hook must fail this
        // test loudly, not report a silent pass.
        throw new Error("dnsCacheSeed is unavailable and the process is not root");
      }

      const t0 = performance.now();
      let result;
      try {
        const res = await fetch("http://" + host + ":" + port + "/", {
          signal: AbortSignal.timeout(4000),
        });
        result = { ok: true, ms: Math.round(performance.now() - t0), body: await res.text() };
      } catch (e) {
        result = { ok: false, ms: Math.round(performance.now() - t0), err: e?.name ?? String(e) };
      } finally {
        restoreHosts?.();
      }
      console.log(JSON.stringify(result));
      for (const fd of fds) libc.symbols.close(fd);
      process.exit(0);
    `;

    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", fixture],
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
    // On the unfixed build the four parallel connects to 127.0.0.2-5 sit in
    // EINPROGRESS and 127.0.0.100 is never attempted, so the fetch aborts at
    // 4 s with { ok: false, err: "TimeoutError" }. With the per-attempt timer
    // the fifth address is started ~300 ms in and the fetch succeeds.
    expect({ out, stderr, exitCode, signal: proc.signalCode }).toEqual({
      out: { ok: true, ms: expect.any(Number), body: "hello from 127.0.0.100" },
      stderr: expect.any(String),
      exitCode: 0,
      signal: null,
    });
    expect(out.ms).toBeLessThan(4000);
  },
  // The failure mode under test is a deliberate 4 s connect stall in the
  // spawned fixture, which does not fit in the default 5 s test timeout.
  20_000,
);
