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
      // close frame is the first write under the clamp. onclose fires before
      // the buffered remainder of the close frame flushes (it's queued for the
      // next writable turn), so let the event loop drain instead of exiting.
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
      let resolveServerClosed;
      const serverClosed = new Promise(r => { resolveServerClosed = r; });
      const s = Bun.serve({ port: 0, hostname: "127.0.0.1",
        fetch(req, server) { if (server.upgrade(req)) return; return new Response("no", {status:426}); },
        websocket: { open(ws) {}, message(ws, m) { ws.send(m); }, close() { resolveServerClosed(); } } });
      fault.set({ syscall: "send", action: "short", bytes: 1, repeat: -1 });
      const ws = new WebSocket("ws://127.0.0.1:" + s.port);
      ws.onopen = () => ws.send(Buffer.alloc(4096, 0x57).toString());
      ws.onmessage = (e) => { console.log(JSON.stringify({ len: e.data.length })); ws.close(); };
      ws.onclose = async () => { fault.clear(); await serverClosed; s.stop(true); };
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

  test("writev → zero (once) on a ≥16 KB server frame: client receives full payload", async () => {
    // The Bun.serve WS plain-TCP fast path (≥16 KB, no backpressure) uses
    // us_socket_write2 → bsd_write2/writev — keyed US_FAULT_WRITEV. This is
    // the only test exercising that hook.
    const fixture = /* js */ `
      const { socketFaultInjection: fault } = require("bun:internal-for-testing");
      let resolveServerClosed;
      const serverClosed = new Promise(r => { resolveServerClosed = r; });
      const s = Bun.serve({ port: 0, hostname: "127.0.0.1",
        fetch(req, server) { if (server.upgrade(req)) return; return new Response("no", {status:426}); },
        websocket: {
          open(ws) {
            fault.set({ syscall: "writev", action: "zero", repeat: 1 });
            ws.send(Buffer.alloc(20000, 0x57));
          },
          message() {},
          close() { resolveServerClosed(); },
        } });
      const ws = new WebSocket("ws://127.0.0.1:" + s.port);
      ws.binaryType = "arraybuffer";
      ws.onmessage = (e) => {
        console.log(JSON.stringify({ len: e.data.byteLength }));
        ws.close();
      };
      ws.onclose = async () => { fault.clear(); await serverClosed; s.stop(true); };
      ws.onerror = () => { console.log(JSON.stringify({ err: true })); process.exit(1); };
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", fixture],
      env: { ...bunEnv, BUN_DEBUG_QUIET_LOGS: "1" },
      stderr: "pipe",
      stdout: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ out: JSON.parse(stdout.trim() || "{}"), signal: proc.signalCode, stderr }).toEqual({
      out: { len: 20000 },
      signal: null,
      stderr: expect.any(String),
    });
    expect(exitCode).toBe(0);
  });

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
    // Regression for the proxy-tunnel pending-close path: a close frame that is
    // only partially flushed defers `close` until handle_tunnel_writable() drains
    // it. The wss endpoint below never answers the close frame, so the deferred
    // dispatch is the ONLY way `onclose` can fire — without the drain this hangs.
    test("send → short writes (1 byte): close() still dispatches 'close' once the tunnel drains", async () => {
      const wss = tls.createServer({ cert: certs.cert, key: certs.key }, sock => {
        let buf = Buffer.alloc(0);
        let upgraded = false;
        sock.on("data", chunk => {
          if (upgraded) return; // absorb frames (including close) without replying
          buf = Buffer.concat([buf, chunk]);
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
          // write_buffer, so the 2nd queues in send_buffer under backpressure.
          // That is the only tunnel state where the close dispatch is deferred
          // (the SSL layer always absorbs the close frame itself in full).
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
      } finally {
        proxy.close();
        wss.close();
      }
    });
  },
);
