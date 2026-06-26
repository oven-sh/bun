import { socketFaultInjection as fault } from "bun:internal-for-testing";
import { afterEach, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tls as certs, isWindows } from "harness";
import { once } from "node:events";
import http from "node:http";

const skip = !fault.available() || isWindows;

afterEach(() => fault.clear());

// In-process http tests share the process-wide fault table between client
// and server, which makes errno injection ambiguous. Tests that need a
// one-sided fault run the faulted side in a subprocess.

describe.skipIf(skip)("node:http under injected syscall faults", () => {
  test("upRes.pipe(res) with res.destroy() racing a queued drain (subprocess)", async () => {
    // A TLS-terminating proxy re-streams a large upstream body via pipe(),
    // 1-byte sends force backpressure → on_writable/on_drain on every
    // event-loop turn, and the downstream is destroyed while a drain callback
    // is queued. Forcing 1-byte sends makes the backpressure deterministic
    // without depending on kernel buffer sizes.
    //
    // Runs in a subprocess so the outcome is observable as exitCode/signal.
    const upstream = http.createServer((req, res) => {
      res.writeHead(200, { "content-type": "application/octet-stream" });
      res.write(Buffer.alloc(256 * 1024, "U"));
      res.end();
    });
    upstream.listen(0, "127.0.0.1");
    await once(upstream, "listening");
    const upstreamPort = (upstream.address() as import("node:net").AddressInfo).port;

    try {
      const fixture = /* js */ `
      const http = require("node:http");
      const https = require("node:https");
      const { socketFaultInjection: fault } = require("bun:internal-for-testing");

      const proxy = https.createServer({ key: process.env.KEY, cert: process.env.CERT }, (req, res) => {
        const up = http.get({ port: ${upstreamPort}, host: "127.0.0.1" }, upRes => {
          res.writeHead(upRes.statusCode, upRes.headers);
          upRes.pipe(res);
          res.on("close", () => up.destroy());
        });
        up.on("error", () => res.destroy());
      });
      proxy.listen(0, "127.0.0.1", async () => {
        // 1-byte sends → guaranteed backpressure → on_drain is exercised on
        // every event-loop turn for both the proxy→client and upstream→proxy legs.
        fault.set({ syscall: "send", action: "short", bytes: 1, repeat: -1 });

        const port = proxy.address().port;
        const reqs = [];
        for (let i = 0; i < 4; i++) {
          reqs.push(new Promise(resolve => {
            const r = https.get({ port, host: "127.0.0.1", ca: process.env.CERT }, res => {
              let n = 0;
              res.on("data", c => {
                n += c.length;
                if (n > 4096) {
                  // Destroy mid-stream while drain is pending on the server side.
                  r.destroy();
                  resolve();
                }
              });
              res.on("error", resolve);
              res.on("end", resolve);
            });
            r.on("error", resolve);
          }));
        }
        await Promise.all(reqs);
        fault.clear();
        proxy.close(() => {
          console.log("OK");
          process.exit(0);
        });
      });
    `;

      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", fixture],
        env: { ...bunEnv, KEY: certs.key, CERT: certs.cert, BUN_DEBUG_QUIET_LOGS: "1" },
        stderr: "pipe",
        stdout: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect({ stdout: stdout.trim(), stderr, signal: proc.signalCode }).toEqual({
        stdout: "OK",
        stderr: expect.any(String),
        signal: null,
      });
      expect(exitCode).toBe(0);
    } finally {
      upstream.close();
    }
  });

  test("Bun.serve streaming response under 1-byte sends with client abort mid-body (subprocess)", async () => {
    // Covers the uWS HttpResponse path (AsyncSocket → us_socket_write →
    // bsd_send): backpressure on every turn, then the client aborts. The
    // server's onAborted/on_writable must settle and the process exits 0.
    const fixture = /* js */ `
      const { socketFaultInjection: fault } = require("bun:internal-for-testing");
      const body = Buffer.alloc(64 * 1024, 0x42);
      using server = Bun.serve({
        port: 0,
        hostname: "127.0.0.1",
        fetch() {
          return new Response(
            new ReadableStream({
              start(ctrl) { ctrl.enqueue(body); ctrl.close(); },
            }),
            { headers: { "content-type": "application/octet-stream" } },
          );
        },
      });
      fault.set({ syscall: "send", action: "short", bytes: 1, repeat: -1 });
      const ctrl = new AbortController();
      const res = await fetch("http://127.0.0.1:" + server.port, { signal: ctrl.signal });
      const reader = res.body.getReader();
      let n = 0;
      while (n < 1024) {
        const { value, done } = await reader.read();
        if (done) break;
        n += value.length;
      }
      ctrl.abort();
      fault.clear();
      console.log("OK");
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", fixture],
      env: { ...bunEnv, BUN_DEBUG_QUIET_LOGS: "1" },
      stderr: "pipe",
      stdout: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.trim(), signal: proc.signalCode, stderr }).toEqual({
      stdout: "OK",
      signal: null,
      stderr: expect.any(String),
    });
    expect(exitCode).toBe(0);
  });

  test("node:http server: short sends + client destroy at first byte does not leak the response (subprocess)", async () => {
    const fixture = /* js */ `
      const http = require("node:http");
      const { socketFaultInjection: fault } = require("bun:internal-for-testing");
      let closed = 0;
      const N = 8;
      let resolveAllClosed;
      const allClosed = new Promise(r => { resolveAllClosed = r; });
      const server = http.createServer((req, res) => {
        res.on("close", () => { if (++closed === N) resolveAllClosed(); });
        res.on("error", () => {});
        res.writeHead(200);
        res.end(Buffer.alloc(32 * 1024, 0x55));
      });
      server.listen(0, "127.0.0.1", async () => {
        fault.set({ syscall: "send", action: "short", bytes: 1, repeat: -1 });
        const port = server.address().port;
        await Promise.all(Array.from({ length: N }, () => new Promise(resolve => {
          const r = http.get({ port, host: "127.0.0.1" }, res => {
            res.once("data", () => { r.destroy(); resolve(); });
            res.on("error", resolve);
          });
          r.on("error", resolve);
        })));
        fault.clear();
        await allClosed;
        console.log(JSON.stringify({ closed, N }));
        server.close(() => process.exit(0));
      });
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", fixture],
      env: { ...bunEnv, BUN_DEBUG_QUIET_LOGS: "1" },
      stderr: "pipe",
      stdout: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const out = JSON.parse(stdout.trim() || "{}");
    expect({ out, signal: proc.signalCode, stderr }).toEqual({
      out: { closed: 8, N: 8 },
      signal: null,
      stderr: expect.any(String),
    });
    expect(exitCode).toBe(0);
  });
});

describe.skipIf(skip)("node:http seeded backpressure fuzz", () => {
  const seed = Number(process.env.BUN_SOCKET_FUZZ_SEED ?? 0x5e1d) >>> 0 || 1;
  function makePrng(s: number) {
    return () => {
      s ^= s << 13;
      s ^= s >>> 17;
      s ^= s << 5;
      return (s >>> 0) / 0x1_0000_0000;
    };
  }

  test("randomized short-send sizes during streaming response deliver intact (subprocess server)", async () => {
    const rand = makePrng(seed);
    const bodyLen = 8 * 1024;

    const fixture = /* js */ `
      const http = require("node:http");
      const { socketFaultInjection: fault } = require("bun:internal-for-testing");
      const body = Buffer.alloc(${bodyLen}, 0x71);
      const server = http.createServer((req, res) => {
        res.on("error", () => {});
        const url = new URL(req.url, "http://x");
        const bytes = Number(url.searchParams.get("bytes"));
        const after = Number(url.searchParams.get("after"));
        fault.set({ syscall: "send", action: "short", bytes, after, repeat: -1 });
        res.writeHead(200, { "content-length": String(body.length) });
        res.end(body);
        res.on("close", () => fault.clear());
      });
      server.listen(0, "127.0.0.1", () => {
        console.log(server.address().port);
      });
      process.on("SIGTERM", () => server.close(() => process.exit(0)));
    `;

    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", fixture],
      env: { ...bunEnv, BUN_DEBUG_QUIET_LOGS: "1" },
      stderr: "pipe",
      stdout: "pipe",
    });
    const reader = proc.stdout.getReader();
    let portLine = "";
    while (!portLine.includes("\n")) {
      const { value, done } = await reader.read();
      if (done) throw new Error("server exited before printing port: " + (await proc.stderr.text()));
      portLine += new TextDecoder().decode(value);
    }
    reader.releaseLock();
    const port = Number(portLine.trim());

    try {
      for (let i = 0; i < 8; i++) {
        const bytes = 1 + Math.floor(rand() * 64);
        const after = Math.floor(rand() * 4);
        const got = await new Promise<number>((resolve, reject) => {
          const req = http.get({ port, host: "127.0.0.1", path: `/?bytes=${bytes}&after=${after}` }, res => {
            let n = 0;
            res.on("data", c => (n += c.length));
            res.on("end", () => resolve(n));
            res.on("error", reject);
          });
          req.on("error", reject);
        });
        expect(got).toBe(bodyLen);
      }
    } finally {
      proc.kill("SIGTERM");
      await proc.exited;
    }
  });
});
