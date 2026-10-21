import { socketFaultInjection as fault } from "bun:internal-for-testing";
import { afterEach, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tls as certs, isWindows } from "harness";
import { once } from "node:events";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import nodeTls from "node:tls";
import { checkPlan, describePlan, listenTransport, makePlan } from "./node-http-backpressure-invariants";

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
        fault.set({ syscall: "writev", action: "short", bytes: 1, repeat: -1 });

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
    // On a debug build the start of the subprocess, its TLS setup and its exit take about 3.5 s of the default 5 s.
  }, 30_000);

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
      fault.set({ syscall: "writev", action: "short", bytes: 1, repeat: -1 });
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
        fault.set({ syscall: "writev", action: "short", bytes: 1, repeat: -1 });
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
    // On a debug build the subprocess takes about 3 s until its first response, of the default 5 s.
  }, 30_000);
});

describe.skipIf(skip)("node:http pipelining under short sends", () => {
  // Every send() takes at most 12 KB, so each 16 KB response leaves a tail in
  // userspace, and the flush that follows a drain callback sends the next
  // response's tail whole. That response has ended, its buffer is empty and
  // its drain callback has not run: the next pipelined request still has to
  // queue behind it. The last end() callback exits, so a callback that does
  // not wait for its tail cuts that body short.
  test("responses whose tail leaves before their drain callback stay in order and complete (subprocess server)", async () => {
    const COUNT = 8;
    const BODY = Buffer.alloc(16 * 1024, "A");
    const fixture = /* js */ `
      const http = require("node:http");
      const { socketFaultInjection: fault } = require("bun:internal-for-testing");
      const body = Buffer.alloc(${BODY.length}, "A");
      let served = 0;
      const server = http.createServer((req, res) => {
        res.end(body, ++served === ${COUNT} ? () => process.exit(0) : undefined);
      });
      server.listen(0, "127.0.0.1", () => {
        fault.set({ syscall: "send", action: "short", bytes: 12 * 1024, repeat: -1 });
        fault.set({ syscall: "writev", action: "short", bytes: 12 * 1024, repeat: -1 });
        console.log(server.address().port);
      });
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", fixture],
      env: { ...bunEnv, BUN_DEBUG_QUIET_LOGS: "1" },
      stderr: "inherit",
      stdout: "pipe",
    });
    let portLine = "";
    for await (const chunk of proc.stdout.pipeThrough(new TextDecoderStream())) {
      portLine += chunk;
      if (portLine.includes("\n")) break;
    }

    const socket = net.connect(Number(portLine), "127.0.0.1");
    const chunks: Buffer[] = [];
    socket.on("data", (chunk: Buffer) => chunks.push(chunk));
    socket.on("error", () => {});
    const request = "GET / HTTP/1.1\r\nHost: localhost\r\n\r\n";
    socket.on("connect", () => socket.write(Buffer.alloc(request.length * COUNT, request)));
    await once(socket, "close");

    const bytes = Buffer.concat(chunks);
    let complete = 0;
    let offset = 0;
    while (offset < bytes.length) {
      const bodyStart = bytes.indexOf("\r\n\r\n", offset) + 4;
      if (bodyStart < 4 || !bytes.subarray(offset, bodyStart).toString("latin1").startsWith("HTTP/1.1 200 OK\r\n"))
        break;
      if (!bytes.subarray(bodyStart, bodyStart + BODY.length).equals(BODY)) break;
      offset = bodyStart + BODY.length;
      complete++;
    }
    expect({ complete, unparsed: bytes.length - offset }).toEqual({ complete: COUNT, unparsed: 0 });
    expect(await proc.exited).toBe(0);
  });
});

describe.skipIf(skip)("node:http pipelining under stalled sends", () => {
  // The second request is parsed while the first response still has a backlog,
  // so the connection's reads are paused behind it. The next writable events
  // then move nothing (send() reports 0, as it does for ENOBUFS). The client is
  // alive and reading: the server has to retry, not take the stall for a dead
  // peer and close over both responses.
  test("a writable event that moves nothing does not close a live connection whose reads are paused (subprocess server)", async () => {
    const SIZE = 8 * 1024 * 1024;
    const fixture = /* js */ `
      const http = require("node:http");
      const { socketFaultInjection: fault } = require("bun:internal-for-testing");
      const body = Buffer.alloc(${SIZE}, "A");
      const server = http.createServer((req, res) => {
        if (req.url === "/first") return res.end(body);
        fault.set({ syscall: "send", action: "zero", repeat: 6 });
        res.end("second", () => process.exit(0));
      });
      server.listen(0, "127.0.0.1", () => console.log(server.address().port));
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", fixture],
      env: { ...bunEnv, BUN_DEBUG_QUIET_LOGS: "1" },
      stderr: "inherit",
      stdout: "pipe",
    });
    let portLine = "";
    for await (const chunk of proc.stdout.pipeThrough(new TextDecoderStream())) {
      portLine += chunk;
      if (portLine.includes("\n")) break;
    }

    const socket = net.connect(Number(portLine), "127.0.0.1");
    const chunks: Buffer[] = [];
    socket.on("data", (chunk: Buffer) => chunks.push(chunk));
    socket.on("error", () => {});
    socket.on("connect", () =>
      socket.write(
        "GET /first HTTP/1.1\r\nHost: localhost\r\n\r\nGET /second HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n",
      ),
    );
    await once(socket, "close");

    const bytes = Buffer.concat(chunks);
    const firstBody = bytes.indexOf("\r\n\r\n") + 4;
    const secondHead = bytes.indexOf("HTTP/1.1 200 OK\r\n", firstBody);
    const firstEnd = secondHead < 0 ? bytes.length : secondHead;
    expect({
      first: firstEnd - firstBody,
      firstIntact: bytes.subarray(firstBody, firstEnd).equals(Buffer.alloc(SIZE, "A")),
      second: secondHead < 0 ? null : bytes.subarray(bytes.indexOf("\r\n\r\n", secondHead) + 4).toString("latin1"),
    }).toEqual({ first: SIZE, firstIntact: true, second: "second" });
    expect(await proc.exited).toBe(0);
  });
});

// Every send takes a few bytes, so a write backs the socket up at once, with no megabytes and no slow client.
describe.skipIf(skip)("node:http 'drain' under short sends", () => {
  const CHUNK16 = Buffer.alloc(16 * 1024, "b");
  const shortSends = (bytes = 1000) => {
    for (const syscall of ["send", "writev"] as const) fault.set({ syscall, action: "short", bytes, repeat: -1 });
  };
  // Resolves with what came behind the last head. With `chunked`, with everything behind the first one.
  async function receive(server: http.Server, request: string, chunked = false) {
    await once(server.listen(0, "127.0.0.1"), "listening");
    const port = (server.address() as net.AddressInfo).port;
    const secure = server instanceof https.Server;
    const socket = secure
      ? nodeTls.connect({ port, host: "127.0.0.1", rejectUnauthorized: false })
      : net.connect(port, "127.0.0.1");
    const chunks: Buffer[] = [];
    socket.on("data", (chunk: Buffer) => chunks.push(chunk));
    socket.on(secure ? "secureConnect" : "connect", () => socket.write(request));
    await once(socket, "close");
    const bytes = Buffer.concat(chunks);
    return bytes.subarray((chunked ? bytes.indexOf("\r\n\r\n") : bytes.lastIndexOf("\r\n\r\n")) + 4);
  }
  const closing = "GET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n";

  // The chunk and the head fit in the cork buffer, so the write is accepted
  // whole. The socket then takes only part of it. Under the high water mark
  // Node returns true, and runs the callback when the socket has the chunk.
  test("a first write(chunk, callback) that the socket takes only part of returns true, and its callback waits for the socket", async () => {
    const events: string[] = [];
    await using server = http.createServer((req, res) => {
      res.setHeader("Content-Length", CHUNK16.length + 4);
      res.on("drain", () => events.push("'drain'"));
      // One turn later, the write is outside the cork of the request dispatch.
      setImmediate(() => {
        shortSends();
        const returned = res.write(CHUNK16, () => {
          events.push(`write callback: writableLength ${res.writableLength}`);
          res.end("tail");
        });
        events.push(
          `write(chunk, callback) returned ${returned}: writableNeedDrain ${res.writableNeedDrain}, unsent ${res.writableLength > 0}`,
        );
      });
    });
    const body = await receive(server, closing);
    expect({ events, length: body.length, tail: body.subarray(-4).toString() }).toEqual({
      events: [
        "write(chunk, callback) returned true: writableNeedDrain false, unsent true",
        "write callback: writableLength 0",
      ],
      length: CHUNK16.length + 4,
      tail: "tail",
    });
  });

  // The socket takes the first 100000 bytes of the chunk inside write(), and the rest later.
  test.each(["http", "https"] as const)(
    "a write() over the high water mark on an %s server gets one 'drain', when none of its bytes is left",
    async protocol => {
      const events: string[] = [];
      const chunk = Buffer.alloc(256 * 1024, "b");
      const listener: http.RequestListener = (req, res) => {
        setImmediate(() => {
          shortSends(100000);
          events.push(`write() returned ${res.write(chunk)}`);
          res.on("drain", () => {
            events.push(`'drain': writableNeedDrain ${res.writableNeedDrain}, writableLength ${res.writableLength}`);
            // A second 'drain' would come before 'finish'.
            res.on("finish", () => events.push("finish"));
            res.end();
          });
        });
      };
      await using server =
        protocol === "http"
          ? http.createServer(listener)
          : https.createServer({ key: certs.key, cert: certs.cert }, listener);
      const body = await receive(server, closing, true);
      // The chunk in its framing, and the last chunk.
      expect({ events, length: body.length }).toEqual({
        events: ["write() returned false", "'drain': writableNeedDrain false, writableLength 0", "finish"],
        length: chunk.length + "40000\r\n".length + "\r\n0\r\n\r\n".length,
      });
    },
  );

  test("a write() that returned false gets its 'drain' when res._send() follows it, and then the callback of res._send()", async () => {
    const events: string[] = [];
    const chunk = Buffer.alloc(256 * 1024, "b");
    await using server = http.createServer((req, res) => {
      res.setHeader("Content-Length", chunk.length + 4);
      setImmediate(() => {
        shortSends();
        events.push(`write() returned ${res.write(chunk)}`);
        (res as any)._send("tail", "latin1", () => events.push(`_send callback: writableLength ${res.writableLength}`));
        res.on("drain", () => {
          events.push(`'drain': writableLength ${res.writableLength}`);
          res.end();
        });
      });
    });
    const body = await receive(server, closing);
    expect({ events, length: body.length, tail: body.subarray(-4).toString() }).toEqual({
      events: ["write() returned false", "'drain': writableLength 0", "_send callback: writableLength 0"],
      length: chunk.length + 4,
      tail: "tail",
    });
  });

  // The head and the data of a first res._send() go through the cork buffer. What the socket
  // does not take of them stays in the handle when the cork ends.
  test("the callback of a first res._send() waits for the socket", async () => {
    const events: string[] = [];
    await using server = http.createServer((req, res) => {
      res.setHeader("Content-Length", CHUNK16.length);
      setImmediate(() => {
        shortSends();
        (res as any)._send(CHUNK16, undefined, () => {
          events.push(`_send callback: writableLength ${res.writableLength}`);
          res.end();
        });
        events.push(`after _send(): unsent ${res.writableLength > 0}`);
      });
    });
    const body = await receive(server, closing);
    expect({ events, length: body.length }).toEqual({
      events: ["after _send(): unsent true", "_send callback: writableLength 0"],
      length: CHUNK16.length,
    });
  });

  // The buffered writes of a response that waited back the socket up at its
  // turn. The 'drain' that one of them is owed comes from the drain callback
  // of the handle, after the bytes.
  test("a write() that returned false while the response waited gets its 'drain' after the socket took the buffered writes", async () => {
    const events: string[] = [];
    let first: http.ServerResponse;
    let total = 0;
    await using server = http.createServer((req, res) => {
      if (req.url === "/first") return void (first = res);
      // As many chunks as reach the high water mark: the last write() returns false.
      const count = Math.ceil(res.writableHighWaterMark / CHUNK16.length);
      total = count * CHUNK16.length;
      res.setHeader("Content-Length", total + 4);
      let returned = true;
      for (let i = 0; i < count; i++) returned = res.write(CHUNK16);
      events.push(`waits: write() returned ${returned}, writableNeedDrain ${res.writableNeedDrain}`);
      res.on("socket", () => events.push(`'socket': writableNeedDrain ${res.writableNeedDrain}`));
      res.on("drain", () => {
        events.push(`'drain': writableNeedDrain ${res.writableNeedDrain}, writableLength ${res.writableLength}`);
        res.end("tail");
      });
      shortSends();
      first.end("first");
    });
    const body = await receive(
      server,
      "GET /first HTTP/1.1\r\nHost: localhost\r\n\r\nGET /second HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n",
    );
    expect({
      events,
      length: body.length,
      inOrder: body.equals(Buffer.concat([Buffer.alloc(total, "b"), Buffer.from("tail")])),
    }).toEqual({
      events: [
        "waits: write() returned false, writableNeedDrain true",
        "'socket': writableNeedDrain true",
        "'drain': writableNeedDrain false, writableLength 0",
      ],
      length: total + 4,
      inOrder: true,
    });
  });

  // With highWaterMark 0 a small write() returns false while the response
  // waits. At its turn that one write fits the cork buffer, so the handle
  // accepts it whole and reports no backpressure. The socket then takes only
  // part of it.
  test("a small write() that returned false while the response waited gets its 'drain' after the socket took it", async () => {
    const events: string[] = [];
    let first: http.ServerResponse;
    await using server = http.createServer({ highWaterMark: 0 }, (req, res) => {
      if (req.url === "/first") return void (first = res);
      res.setHeader("Content-Length", 100 + 4);
      const returned = res.write(Buffer.alloc(100, "b"));
      events.push(`waits: write() returned ${returned}, writableNeedDrain ${res.writableNeedDrain}`);
      res.on("drain", () => {
        events.push(`'drain': writableNeedDrain ${res.writableNeedDrain}, writableLength ${res.writableLength}`);
        res.end("tail");
      });
      shortSends(50);
      first.end("first");
    });
    const body = await receive(
      server,
      "GET /first HTTP/1.1\r\nHost: localhost\r\n\r\nGET /second HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n",
    );
    expect({ events, body: body.toString() }).toEqual({
      events: [
        "waits: write() returned false, writableNeedDrain true",
        "'drain': writableNeedDrain false, writableLength 0",
      ],
      body: Buffer.alloc(100, "b") + "tail",
    });
  });
});

// The plans of node-http-backpressure-invariants.ts on a listening server. Short sends stand for a slow client.
// Replay a failing plan with BUN_HTTP_DRAIN_FUZZ_SEED=<seed of the plan>. Soak with BUN_HTTP_DRAIN_FUZZ_ITERS=<plans in a group>.
describe.skipIf(skip)("node:http seeded plans of write(), res._send() and end() under short sends", () => {
  const seed = Number(process.env.BUN_HTTP_DRAIN_FUZZ_SEED ?? 1000003);
  const iterations = Number(process.env.BUN_HTTP_DRAIN_FUZZ_ITERS ?? 9);

  test.each([0, 1, 2, 3, 4])(
    "keep the rules of 'drain', write() callbacks and writableLength (group %i)",
    async group => {
      for (let i = 0; i < iterations; i++) {
        const plan = makePlan(seed + group * iterations + i, true);
        const violations = await checkPlan(
          listener => http.createServer({ highWaterMark: plan.hwm }, listener),
          plan,
          listenTransport(plan, fault),
        );
        expect({ seed: plan.seed, plan: describePlan(plan), violations }).toEqual({
          seed: plan.seed,
          plan: describePlan(plan),
          violations: [],
        });
      }
    },
  );
});

// The same plans on a net.Socket that a net.Server accepted and gave to server.emit('connection'). These include
// a client that resets the connection, and one that ends its side, while the socket holds chunks.
describe.skipIf(skip)("node:http seeded plans on a socket from server.emit('connection') under short sends", () => {
  const seed = Number(process.env.BUN_HTTP_DRAIN_FUZZ_SEED ?? 1000003);
  const iterations = Number(process.env.BUN_HTTP_DRAIN_FUZZ_ITERS ?? 9);

  test.each([0, 1, 2, 3, 4])(
    "keep the rules of 'drain', write() callbacks and writableLength (group %i)",
    async group => {
      for (let i = 0; i < iterations; i++) {
        const made = makePlan(seed + group * iterations + i, false);
        // Every second plan without a teardown of its own gets a reset of the client.
        const plan = { ...made, teardown: made.teardown ?? (made.seed % 2 ? ("reset" as const) : null) };
        const violations = await checkPlan(
          listener => http.createServer({ highWaterMark: plan.hwm }, listener),
          plan,
          listenTransport(plan, fault, true),
        );
        expect({ seed: plan.seed, plan: describePlan(plan), violations }).toEqual({
          seed: plan.seed,
          plan: describePlan(plan),
          violations: [],
        });
      }
    },
  );
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
        fault.set({ syscall: "writev", action: "short", bytes, after, repeat: -1 });
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
