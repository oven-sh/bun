import { socketFaultInjection as fault } from "bun:internal-for-testing";
import { afterEach, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tls as certs, isWindows } from "harness";
import crypto from "node:crypto";
import tls from "node:tls";
import { createConnectProxy, startProxy } from "./proxy-test-utils";

const skip = !fault.available() || isWindows;

afterEach(() => fault.clear());

// The WebSocket client (web standard new WebSocket()) lives in src/http/
// websocket_client/ and goes through the same uSockets bsd_recv/bsd_send.
// Server runs in this process (no fault), client runs in a subprocess (faulted).

async function runWSClient(
  url: string,
  rule: import("bun:internal-for-testing").SocketFaultRule | null,
  script: string,
) {
  const fixture = /* js */ `
    const { socketFaultInjection: fault } = require("bun:internal-for-testing");
    const rule = ${JSON.stringify(rule)};
    const url = ${JSON.stringify(url)};
    const out = (o) => console.log(JSON.stringify(o));
    ${script}
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", fixture],
    env: { ...bunEnv, BUN_DEBUG_QUIET_LOGS: "1", NODE_TLS_REJECT_UNAUTHORIZED: "0", CA: certs.cert },
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { ...JSON.parse(stdout.trim() || "{}"), stderr, exitCode, signal: proc.signalCode };
}

function makeEchoServer(opts: { tls?: boolean } = {}) {
  return Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    ...(opts.tls ? { tls: { key: certs.key, cert: certs.cert } } : {}),
    fetch(req, server) {
      if (server.upgrade(req)) return;
      return new Response("upgrade required", { status: 426 });
    },
    websocket: {
      open() {},
      message(ws, msg) {
        ws.send(msg);
      },
      close() {},
    },
  });
}

describe.concurrent.skipIf(skip)("WebSocket client (ws://) under injected syscall faults", () => {
  test("recv → short reads (1 byte) deliver complete echoed text frame", async () => {
    using server = makeEchoServer();
    const r = await runWSClient(
      `ws://127.0.0.1:${server.port}/`,
      { syscall: "recv", action: "short", bytes: 1, repeat: -1 },
      /* js */ `
      if (rule) fault.set(rule);
      const ws = new WebSocket(url);
      ws.onopen = () => ws.send("hello-world");
      ws.onmessage = (e) => { out({ ok: true, data: e.data }); ws.close(); };
      ws.onerror = () => out({ ok: false, error: true });
      ws.onclose = () => process.exit(0);
    `,
    );
    expect(r).toMatchObject({ ok: true, data: "hello-world", signal: null, exitCode: 0 });
  });

  test("recv → short reads deliver complete large binary frame (frame header split)", async () => {
    using server = makeEchoServer();
    const r = await runWSClient(
      `ws://127.0.0.1:${server.port}/`,
      { syscall: "recv", action: "short", bytes: 3, repeat: -1 },
      /* js */ `
      if (rule) fault.set(rule);
      const payload = new Uint8Array(70000).fill(0x55); // forces 8-byte extended length
      const ws = new WebSocket(url);
      ws.binaryType = "arraybuffer";
      ws.onopen = () => ws.send(payload);
      ws.onmessage = (e) => { out({ ok: true, len: e.data.byteLength }); ws.close(); };
      ws.onerror = () => out({ ok: false });
      ws.onclose = () => process.exit(0);
    `,
    );
    expect(r).toMatchObject({ ok: true, len: 70000, signal: null, exitCode: 0 });
  });

  test("send → short writes (1 byte) deliver complete frame to server", async () => {
    using server = makeEchoServer();
    const r = await runWSClient(
      `ws://127.0.0.1:${server.port}/`,
      { syscall: "send", action: "short", bytes: 1, repeat: -1 },
      /* js */ `
      if (rule) fault.set(rule);
      const ws = new WebSocket(url);
      ws.onopen = () => ws.send(Buffer.alloc(2048, 0x41).toString());
      ws.onmessage = (e) => { out({ ok: true, len: e.data.length }); ws.close(); };
      ws.onerror = () => out({ ok: false });
      ws.onclose = () => process.exit(0);
    `,
    );
    expect(r).toMatchObject({ ok: true, len: 2048, signal: null, exitCode: 0 });
  });

  test("recv → ECONNRESET fires onclose with abnormal code (no hang)", async () => {
    using server = makeEchoServer();
    const r = await runWSClient(
      `ws://127.0.0.1:${server.port}/`,
      null,
      /* js */ `
      const ws = new WebSocket(url);
      let errored = false;
      ws.onopen = () => {
        fault.set({ syscall: "recv", action: "errno", errno: "ECONNRESET", repeat: -1 });
        ws.send("ping");
      };
      ws.onmessage = () => out({ ok: false, unexpected: "message" });
      ws.onerror = () => { errored = true; };
      ws.onclose = (e) => { out({ ok: true, errored, code: e.code }); process.exit(0); };
    `,
    );
    expect(r.signal).toBeNull();
    expect(r.ok).toBe(true);
    expect(r.code).toBe(1006);
    // Per WHATWG, onerror during the data-exchange phase is optional; Bun
    // currently does not fire it for a transport reset after open.
    expect(r.errored).toBe(false);
  });

  test("recv → 0 (peer closed) fires onclose", async () => {
    using server = makeEchoServer();
    const r = await runWSClient(
      `ws://127.0.0.1:${server.port}/`,
      null,
      /* js */ `
      const ws = new WebSocket(url);
      let errored = false;
      ws.onopen = () => {
        fault.set({ syscall: "recv", action: "zero", repeat: -1 });
        ws.send("ping");
      };
      ws.onerror = () => { errored = true; };
      ws.onclose = (e) => { out({ ok: true, errored, code: e.code }); process.exit(0); };
    `,
    );
    expect(r.signal).toBeNull();
    expect(r.ok).toBe(true);
    expect(typeof r.errored).toBe("boolean");
  });

  test("connect → ECONNREFUSED fires onerror then onclose", async () => {
    using server = makeEchoServer();
    const r = await runWSClient(
      `ws://127.0.0.1:${server.port}/`,
      { syscall: "connect", action: "errno", errno: "ECONNREFUSED", repeat: -1 },
      /* js */ `
      if (rule) fault.set(rule);
      const ws = new WebSocket(url);
      let errored = false;
      ws.onopen = () => out({ ok: false, unexpected: "open" });
      ws.onerror = () => { errored = true; };
      ws.onclose = () => { out({ ok: true, errored }); process.exit(0); };
    `,
    );
    expect(r).toMatchObject({ ok: true, errored: true, signal: null, exitCode: 0 });
  });
});

describe.concurrent.skipIf(skip)("WebSocket client (wss://) under injected syscall faults", () => {
  test("recv → short reads (1 byte) over TLS deliver complete echoed frame", async () => {
    using server = makeEchoServer({ tls: true });
    const r = await runWSClient(
      `wss://127.0.0.1:${server.port}/`,
      { syscall: "recv", action: "short", bytes: 1, repeat: -1 },
      /* js */ `
      if (rule) fault.set(rule);
      const ws = new WebSocket(url, { tls: { ca: process.env.CA } });
      ws.onopen = () => ws.send("secure-echo");
      ws.onmessage = (e) => { out({ ok: true, data: e.data }); ws.close(); };
      ws.onerror = () => out({ ok: false });
      ws.onclose = () => process.exit(0);
    `,
    );
    expect(r).toMatchObject({ ok: true, data: "secure-echo", signal: null, exitCode: 0 });
  });

  test("send → 3-byte short writes during TLS handshake still opens", async () => {
    using server = makeEchoServer({ tls: true });
    const r = await runWSClient(
      `wss://127.0.0.1:${server.port}/`,
      { syscall: "send", action: "short", bytes: 3, repeat: -1 },
      /* js */ `
      if (rule) fault.set(rule);
      const ws = new WebSocket(url, { tls: { ca: process.env.CA } });
      ws.onopen = () => { out({ ok: true, opened: true }); ws.close(); };
      ws.onerror = () => out({ ok: false });
      ws.onclose = () => process.exit(0);
    `,
    );
    expect(r).toMatchObject({ ok: true, opened: true, signal: null, exitCode: 0 });
  });

  test("send → more bytes than it was given for a frame fires onclose with an abnormal code", async () => {
    using server = makeEchoServer({ tls: true });
    const r = await runWSClient(
      `wss://127.0.0.1:${server.port}/`,
      { syscall: "send", action: "excess" },
      /* js */ `
      const ws = new WebSocket(url, { tls: { ca: process.env.CA } });
      ws.onopen = () => { fault.set(rule); ws.send("x"); };
      ws.onmessage = () => out({ ok: false, unexpected: "message" });
      ws.onclose = (e) => { out({ ok: true, code: e.code }); process.exit(0); };
    `,
    );
    expect(r).toMatchObject({ ok: true, code: 1006, signal: null, exitCode: 0 });
  });

  test("recv → ECONNRESET mid-handshake fires onerror (no hang)", async () => {
    using server = makeEchoServer({ tls: true });
    const r = await runWSClient(
      `wss://127.0.0.1:${server.port}/`,
      { syscall: "recv", action: "errno", errno: "ECONNRESET", repeat: -1 },
      /* js */ `
      if (rule) fault.set(rule);
      const ws = new WebSocket(url, { tls: { ca: process.env.CA } });
      let errored = false;
      ws.onopen = () => out({ ok: false, unexpected: "open" });
      ws.onerror = () => { errored = true; };
      ws.onclose = () => { out({ ok: true, errored }); process.exit(0); };
    `,
    );
    expect(r).toMatchObject({ ok: true, errored: true, signal: null, exitCode: 0 });
  });
});

describe.concurrent.skipIf(skip)("WebSocket client close-frame under faults", () => {
  test("close(code, reason) reaches server intact (no fault — regression)", async () => {
    const { promise: closedP, resolve } = Promise.withResolvers<{ code: number; reason: string }>();
    using server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch(req, s) {
        if (s.upgrade(req)) return;
        return new Response("no", { status: 426 });
      },
      websocket: {
        open() {},
        message() {},
        close(_ws, code, reason) {
          resolve({ code, reason });
        },
      },
    });
    const r = await runWSClient(
      `ws://127.0.0.1:${server.port}/`,
      null,
      /* js */ `
      const ws = new WebSocket(url);
      ws.onopen = () => ws.close(3001, "no-fault-close");
      ws.onclose = () => { out({ ok: true }); };
      ws.onerror = () => out({ ok: false });
    `,
    );
    const closed = await closedP;
    expect(r).toMatchObject({ ok: true, signal: null, exitCode: 0 });
    expect(closed).toEqual({ code: 3001, reason: "no-fault-close" });
  });

  test("send → short writes (1 byte): close(code, reason) reaches server intact", async () => {
    const { promise: closedP, resolve } = Promise.withResolvers<{ code: number; reason: string }>();
    using server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch(req, s) {
        if (s.upgrade(req)) return;
        return new Response("no", { status: 426 });
      },
      websocket: {
        open() {},
        message() {},
        close(_ws, code, reason) {
          resolve({ code, reason });
        },
      },
    });
    const r = await runWSClient(
      `ws://127.0.0.1:${server.port}/`,
      null,
      /* js */ `
      const ws = new WebSocket(url);
      // Arm only after open so the upgrade request/response are full-size; the
      // close frame is the first write under the clamp.
      ws.onopen = () => {
        fault.set({ syscall: "send", action: "short", bytes: 1, repeat: -1 });
        ws.close(3001, "short-write-close");
      };
      ws.onclose = () => { fault.clear(); out({ ok: true }); };
      ws.onerror = () => out({ ok: false });
    `,
    );
    const closed = await closedP;
    expect(r).toMatchObject({ ok: true, signal: null, exitCode: 0 });
    expect(closed).toEqual({ code: 3001, reason: "short-write-close" });
  });
});

describe.concurrent.skipIf(skip)("Bun.serve WebSocket server under injected syscall faults (subprocess)", () => {
  test("send → short writes (1 byte) deliver complete frame to client", async () => {
    const fixture = /* js */ `
      const { socketFaultInjection: fault } = require("bun:internal-for-testing");
      const s = Bun.serve({ port: 0, hostname: "127.0.0.1",
        fetch(req, server) { if (server.upgrade(req)) return; return new Response("no", {status:426}); },
        websocket: { open(ws) {}, message(ws, m) { ws.send(m); }, close() {} } });
      fault.set({ syscall: "send", action: "short", bytes: 1, repeat: -1 });
      const ws = new WebSocket("ws://127.0.0.1:" + s.port);
      ws.onopen = () => ws.send(Buffer.alloc(4096, 0x57).toString());
      ws.onmessage = (e) => { console.log(JSON.stringify({ len: e.data.length })); ws.close(); };
      ws.onclose = () => { fault.clear(); process.exit(0); };
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", fixture],
      env: { ...bunEnv, BUN_DEBUG_QUIET_LOGS: "1" },
      stderr: "pipe",
      stdout: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ out: JSON.parse(stdout.trim() || "{}"), signal: proc.signalCode, stderr }).toEqual({
      out: { len: 4096 },
      signal: null,
      stderr: expect.any(String),
    });
    expect(exitCode).toBe(0);
  });

  test("writev → zero (once) on a ≥16 KB server frame: send() reports backpressure, client receives full payload", async () => {
    // The Bun.serve WS plain-TCP fast path (WebSocket.h send(): ≥16 KB frame,
    // nothing buffered, empty cork buffer) writes header + payload with
    // us_socket_write2 → bsd_write2, which is the writev hook; nothing else in
    // this file reaches it.
    //
    // The send cannot be issued from open(): upgrade() keeps the 101 response
    // corked so it can batch with the first frames, so inside open() the cork
    // buffer is non-empty, send() takes the ordinary send path and a writev
    // rule is never consumed. By the time the client's first frame reaches
    // message() the handshake has been flushed.
    //
    // With writev returning 0 the fast path buffers the whole frame, a 4-byte
    // header (FIN|binary, 126 marker, 16-bit length) plus the 20000 payload
    // bytes, returns -1, and drains it on the next writable event.
    const fixture = /* js */ `
      const { socketFaultInjection: fault } = require("bun:internal-for-testing");
      const payload = Buffer.alloc(20000, 0x57);
      let sent;
      const s = Bun.serve({ port: 0, hostname: "127.0.0.1",
        fetch(req, server) { if (server.upgrade(req)) return; return new Response("no", {status:426}); },
        websocket: {
          open() {},
          message(ws) {
            fault.set({ syscall: "writev", action: "zero", repeat: 1 });
            const status = ws.send(payload);
            fault.clear();
            sent = { status, buffered: ws.getBufferedAmount() };
          },
          close() {},
        } });
      const ws = new WebSocket("ws://127.0.0.1:" + s.port);
      ws.binaryType = "arraybuffer";
      ws.onopen = () => ws.send("go");
      ws.onmessage = (e) => {
        console.log(JSON.stringify({ ...sent, len: e.data.byteLength, intact: Buffer.from(e.data).equals(payload) }));
        ws.close();
      };
      ws.onclose = () => { s.stop(true); process.exit(0); };
      ws.onerror = () => { console.log(JSON.stringify({ ...sent, err: true })); process.exit(1); };
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", fixture],
      env: { ...bunEnv, BUN_DEBUG_QUIET_LOGS: "1" },
      stderr: "pipe",
      stdout: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ out: JSON.parse(stdout.trim() || "{}"), signal: proc.signalCode, stderr }).toEqual({
      out: { status: -1, buffered: 20004, len: 20000, intact: true },
      signal: null,
      stderr: expect.any(String),
    });
    expect(exitCode).toBe(0);
  });

  // Same route to the writev hook as the test above. A paused socket defers the client's hangup, so only the server can close it.
  test.each(["reading", "paused"] as const)(
    "writev → more bytes than it was given on a ≥16 KB frame of a %s server socket: both ends close and the frame is not sent again",
    async state => {
      const fixture = /* js */ `
      const { socketFaultInjection: fault } = require("bun:internal-for-testing");
      const seen = { messages: 0 };
      const done = () => {
        if (seen.server === undefined || seen.client === undefined) return;
        console.log(JSON.stringify(seen));
        s.stop(true);
        process.exit(0);
      };
      const s = Bun.serve({ port: 0, hostname: "127.0.0.1",
        fetch(req, server) { if (server.upgrade(req)) return; return new Response("no", {status:426}); },
        websocket: {
          message(ws) {
            ${state === "paused" ? "ws.pause();" : ""}
            fault.set({ syscall: "writev", action: "excess" });
            ws.send(Buffer.alloc(20000, 0x57));
          },
          close(ws, code) { seen.server = code; done(); },
        } });
      const ws = new WebSocket("ws://127.0.0.1:" + s.port);
      ws.onopen = () => ws.send("go");
      ws.onmessage = () => { seen.messages++; };
      ws.onclose = (e) => { seen.client = e.code; done(); };
    `;
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", fixture],
        env: { ...bunEnv, BUN_DEBUG_QUIET_LOGS: "1" },
        stderr: "pipe",
        stdout: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({ out: JSON.parse(stdout.trim() || "{}"), signal: proc.signalCode, stderr }).toEqual({
        out: { messages: 0, server: 1006, client: 1006 },
        signal: null,
        stderr: expect.any(String),
      });
      expect(exitCode).toBe(0);
    },
  );

  test("client disconnect under server short sends: every ws reaches close()", async () => {
    const fixture = /* js */ `
      const { socketFaultInjection: fault } = require("bun:internal-for-testing");
      let closed = 0;
      let resolveAllClosed;
      const N = 4;
      const allClosed = new Promise(r => { resolveAllClosed = r; });
      const s = Bun.serve({ port: 0, hostname: "127.0.0.1",
        fetch(req, server) { if (server.upgrade(req)) return; return new Response("no", {status:426}); },
        websocket: {
          open(ws) { ws.send(Buffer.alloc(2048, 0x42)); },
          message() {},
          close() { if (++closed === N) resolveAllClosed(); },
        } });
      // 16-byte clamp keeps backpressure deterministic without a 32 KB / 1-byte
      // wall-clock blowout under debug+asan.
      fault.set({ syscall: "send", action: "short", bytes: 16, repeat: -1 });
      await Promise.all(Array.from({ length: N }, () => new Promise(r => {
        const ws = new WebSocket("ws://127.0.0.1:" + s.port);
        ws.binaryType = "arraybuffer";
        ws.onmessage = () => ws.close();
        ws.onclose = r;
        ws.onerror = r;
      })));
      fault.clear();
      await allClosed;
      console.log(JSON.stringify({ closed, N }));
      s.stop(true);
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", fixture],
      env: { ...bunEnv, BUN_DEBUG_QUIET_LOGS: "1" },
      stderr: "pipe",
      stdout: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ out: JSON.parse(stdout.trim() || "{}"), signal: proc.signalCode, stderr }).toEqual({
      out: { closed: 4, N: 4 },
      signal: null,
      stderr: expect.any(String),
    });
    expect(exitCode).toBe(0);
  });
});

describe.concurrent.skipIf(skip)(
  "WebSocket client (wss:// via HTTP CONNECT proxy) under injected syscall faults",
  () => {
    // A Close frame queued behind other frames is sent once handle_tunnel_writable() drains
    // them. The wss endpoint only replies once it has received the whole Close frame.
    test("send → short writes (1 byte): the whole Close frame arrives after the queued frames", async () => {
      // Each client frame's opcode, plus the Close frame's payload.
      const clientFrames: (number | string)[] = [];
      const wss = tls.createServer({ cert: certs.cert, key: certs.key }, sock => {
        let buf = Buffer.alloc(0);
        let upgraded = false;
        sock.on("data", (chunk: Buffer) => {
          buf = Buffer.concat([buf, chunk]);
          while (upgraded && buf.length >= 4) {
            const extended = (buf[1] & 0x7f) === 126;
            const length = extended ? buf.readUInt16BE(2) : buf[1] & 0x7f;
            const payloadOffset = (extended ? 4 : 2) + 4;
            if (buf.length < payloadOffset + length) return;
            clientFrames.push(buf[0] & 0x0f);
            if ((buf[0] & 0x0f) === 0x8) {
              const payload = buf
                .subarray(payloadOffset, payloadOffset + length)
                .map((byte, i) => byte ^ buf[payloadOffset - 4 + (i & 3)]);
              clientFrames.push(`${Buffer.from(payload).readUInt16BE(0)} ${Buffer.from(payload).toString("utf8", 2)}`);
              sock.end(Buffer.from([0x88, 0x02, 0x03, 0xe8]));
            }
            buf = buf.subarray(payloadOffset + length);
          }
          if (upgraded) return;
          const end = buf.indexOf("\r\n\r\n");
          if (end === -1) return;
          const m = /Sec-WebSocket-Key:\s*([A-Za-z0-9+/=]+)/i.exec(buf.subarray(0, end).toString("latin1"));
          if (!m) return sock.destroy();
          const accept = crypto
            .createHash("sha1")
            .update(m[1] + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
            .digest("base64");
          sock.write(
            "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
              `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
          );
          upgraded = true;
          buf = buf.subarray(end + 4);
        });
        sock.on("error", () => {});
      });
      await new Promise<void>(r => wss.listen(0, "127.0.0.1", () => r()));
      const proxy = createConnectProxy();
      const proxyPort = await startProxy(proxy);
      try {
        const url = `wss://127.0.0.1:${(wss.address() as import("node:net").AddressInfo).port}/`;
        const r = await runWSClient(
          url,
          { syscall: "send", action: "short", bytes: 1, repeat: -1 },
          /* js */ `
          const ws = new WebSocket(url, {
            proxy: "http://127.0.0.1:${proxyPort}",
            tls: { rejectUnauthorized: false },
          });
          // Arm only once the tunnel is up so CONNECT + TLS handshake stay fast.
          // Two sends before close(): the 1st short-writes into the tunnel's
          // write_buffer, so the 2nd queues in send_buffer under backpressure,
          // and the Close frame queues behind it.
          ws.onopen = () => {
            fault.set(rule);
            ws.send(Buffer.alloc(256, 0x41));
            ws.send("b");
            ws.close(1000, "bye");
          };
          ws.onerror = () => {};
          ws.onclose = e => { fault.clear(); out({ ok: true, code: e.code }); process.exit(0); };
        `,
        );
        expect(r).toMatchObject({ ok: true, code: 1000, signal: null, exitCode: 0 });
        expect(clientFrames).toEqual([0x2, 0x1, 0x8, "1000 bye"]);
      } finally {
        proxy.close();
        wss.close();
      }
    });
  },
);
