import { sslCtxLiveCount } from "bun:internal-for-testing";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as harness from "harness";
import { tls as tlsCerts } from "harness";
import type { HttpsProxyAgent as HttpsProxyAgentType } from "https-proxy-agent";
import { createHash, X509Certificate } from "node:crypto";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import net, { type AddressInfo } from "node:net";
import path from "node:path";
import tls from "node:tls";
import { decodeErrorAlert, startMalformedServerHelloServer } from "../../node/tls/tls-handshake-alert-utils";
import {
  type ClientEvent,
  clientEvents,
  connectRequest,
  createConnectProxy,
  echoed,
  echoSession,
  failed,
  failingSession,
  forwardRecordsTogether,
  openOrFailure,
  startEchoServer,
  startOriginWithCorruptRecord,
  startProxy,
  startRawWssServer,
  startRecordingProxy,
  startRenegotiatingWssServer,
  TLS_RECORD,
} from "./proxy-test-utils";
// Use dynamic require to avoid linter removing the import
const { HttpsProxyAgent } = require("https-proxy-agent") as {
  HttpsProxyAgent: typeof HttpsProxyAgentType;
};

// Use docker-compose infrastructure for squid proxy

const gc = harness.gc;
const bunExe = harness.bunExe;
const bunEnv = harness.bunEnv;
const isDockerEnabled = harness.isDockerEnabled;

// The in-process WebSocket tests below pass an explicit `proxy:` option targeting
// 127.0.0.1 and expect the proxy to be hit. NO_PROXY applies to explicit proxies
// too, so an ambient NO_PROXY=localhost,127.0.0.1,... would bypass the proxy and
// break those assertions. The NO_PROXY test block further down spawns subprocesses
// with an explicit env, so clearing the runner's value here doesn't affect it.
const prevNoProxy = process.env.NO_PROXY;
const prevNoProxyLower = process.env.no_proxy;
process.env.NO_PROXY = "";
process.env.no_proxy = "";

// Echo servers. Every proxy is started by the test that uses it, so each test
// can read what reached its proxy.
let wsServer: ReturnType<typeof Bun.serve>;
let wssServer: ReturnType<typeof Bun.serve>;
let wsPort: number;
let wssPort: number;

beforeAll(() => {
  wsServer = startEchoServer();
  wsPort = wsServer.port!;
  wssServer = startEchoServer({ tls: true });
  wssPort = wssServer.port!;
});

afterAll(() => {
  wsServer?.stop(true);
  wssServer?.stop(true);
  if (prevNoProxy !== undefined) process.env.NO_PROXY = prevNoProxy;
  if (prevNoProxyLower !== undefined) process.env.no_proxy = prevNoProxyLower;
});

function closeCodeOf(events: ClientEvent[]): number | undefined {
  const last = events[events.length - 1];
  return typeof last === "object" && "code" in last ? last.code : undefined;
}

describe("WebSocket proxy API", () => {
  // These checks only exercise the constructor. close() follows at once, so
  // nothing needs to listen on the proxy port.
  const proxyPort = 1;
  const authProxyPort = 1;

  test("accepts proxy option as string (HTTP proxy)", () => {
    const ws = new WebSocket("ws://example.com", {
      proxy: `http://127.0.0.1:${proxyPort}`,
    });
    expect(ws.readyState).toBe(WebSocket.CONNECTING);
    ws.close();
  });

  test("accepts proxy option as string (HTTPS proxy)", () => {
    // Note: This test just checks the constructor accepts the option.
    // The actual connection would fail without proper TLS setup for the proxy.
    const ws = new WebSocket("ws://example.com", {
      proxy: `https://127.0.0.1:${proxyPort}`,
      tls: { rejectUnauthorized: false },
    });
    expect(ws.readyState).toBe(WebSocket.CONNECTING);
    ws.close();
  });

  test("accepts HTTPS proxy with wss:// target", () => {
    // Note: This test just checks the constructor accepts the option.
    const ws = new WebSocket("wss://example.com", {
      proxy: `https://127.0.0.1:${proxyPort}`,
      tls: { rejectUnauthorized: false },
    });
    expect(ws.readyState).toBe(WebSocket.CONNECTING);
    ws.close();
  });

  test("accepts proxy option as object with url", () => {
    const ws = new WebSocket("ws://example.com", {
      proxy: { url: `http://127.0.0.1:${proxyPort}` },
    });
    expect(ws.readyState).toBe(WebSocket.CONNECTING);
    ws.close();
  });

  test("accepts proxy option with headers", () => {
    const ws = new WebSocket("ws://example.com", {
      proxy: {
        url: `http://127.0.0.1:${proxyPort}`,
        headers: { "X-Custom-Header": "test-value" },
      },
    });
    expect(ws.readyState).toBe(WebSocket.CONNECTING);
    ws.close();
  });

  test("accepts proxy option with Headers class instance", () => {
    const headers = new Headers({ "X-Custom-Header": "test-value" });
    const ws = new WebSocket("ws://example.com", {
      proxy: {
        url: `http://127.0.0.1:${proxyPort}`,
        headers: headers,
      },
    });
    expect(ws.readyState).toBe(WebSocket.CONNECTING);
    ws.close();
  });

  test("accepts proxy URL with credentials", () => {
    const ws = new WebSocket("ws://example.com", {
      proxy: `http://user:pass@127.0.0.1:${authProxyPort}`,
    });
    expect(ws.readyState).toBe(WebSocket.CONNECTING);
    ws.close();
  });

  test("can combine proxy with other options", () => {
    const ws = new WebSocket("ws://example.com", {
      proxy: `http://127.0.0.1:${proxyPort}`,
      headers: { Authorization: "Bearer token" },
      protocols: ["graphql-ws"],
    });
    expect(ws.readyState).toBe(WebSocket.CONNECTING);
    ws.close();
  });

  test("rejects invalid proxy URL", () => {
    expect(() => {
      new WebSocket("ws://example.com", {
        proxy: "not-a-valid-url",
      });
    }).toThrow(expect.objectContaining({ name: "SyntaxError", message: "Invalid proxy URL: not-a-valid-url" }));
  });

  test.each(["socks5", "socks4", "socks5h", "ftp", "ws", "gopher"])(
    "rejects unsupported proxy protocol %s://",
    scheme => {
      // Matching fetch()'s UnsupportedProxyProtocol rejection: only http:// and
      // https:// proxies are supported, and any other scheme must fail up front
      // instead of silently sending an HTTP CONNECT request.
      expect(() => {
        new WebSocket("ws://example.com", {
          proxy: `${scheme}://127.0.0.1:1`,
        });
      }).toThrow(
        expect.objectContaining({
          name: "SyntaxError",
          message: expect.stringContaining("Unsupported proxy protocol"),
        }),
      );
      // Same rejection via the { url } form.
      expect(() => {
        new WebSocket("ws://example.com", {
          proxy: { url: `${scheme}://127.0.0.1:1` },
        });
      }).toThrow(/Unsupported proxy protocol/);
    },
  );
});

describe("WebSocket through HTTP CONNECT proxy", () => {
  test("ws:// through HTTP proxy", async () => {
    using recorded = await startRecordingProxy();
    const ws = new WebSocket(`ws://127.0.0.1:${wsPort}`, {
      proxy: `http://127.0.0.1:${recorded.port}`,
    });
    expect({ events: await echoSession(ws, "hello from client"), requests: recorded.requests }).toEqual({
      events: echoed("hello from client"),
      requests: [connectRequest(wsPort)],
    });
    gc();
  });

  test("ws:// through HTTP proxy with auth", async () => {
    using recorded = await startRecordingProxy({ requireAuth: true });
    const ws = new WebSocket(`ws://127.0.0.1:${wsPort}`, {
      proxy: `http://proxy_user:proxy_pass@127.0.0.1:${recorded.port}`,
    });
    expect({ events: await echoSession(ws, "hello with auth"), requests: recorded.requests }).toEqual({
      events: echoed("hello with auth"),
      requests: [connectRequest(wsPort, { "proxy-authorization": `Basic ${btoa("proxy_user:proxy_pass")}` })],
    });
    gc();
  });

  test("ws:// through proxy with custom headers", async () => {
    using recorded = await startRecordingProxy();
    const ws = new WebSocket(`ws://127.0.0.1:${wsPort}`, {
      proxy: {
        url: `http://127.0.0.1:${recorded.port}`,
        headers: { "X-Custom-Proxy-Header": "test-value" },
      },
    });
    expect({ events: await echoSession(ws, "hello with a proxy header"), requests: recorded.requests }).toEqual({
      events: echoed("hello with a proxy header"),
      requests: [connectRequest(wsPort, { "x-custom-proxy-header": "test-value" })],
    });
    gc();
  });

  test("ws:// through proxy with Headers class instance", async () => {
    using recorded = await startRecordingProxy();
    const headers = new Headers({ "X-Custom-Proxy-Header": "test-value-from-headers-class" });
    const ws = new WebSocket(`ws://127.0.0.1:${wsPort}`, {
      proxy: {
        url: `http://127.0.0.1:${recorded.port}`,
        headers: headers,
      },
    });
    expect({ events: await echoSession(ws, "hello with a Headers instance"), requests: recorded.requests }).toEqual({
      events: echoed("hello with a Headers instance"),
      requests: [connectRequest(wsPort, { "x-custom-proxy-header": "test-value-from-headers-class" })],
    });
    gc();
  });

  test("proxy auth failure returns error", async () => {
    using recorded = await startRecordingProxy({ requireAuth: true });
    const url = `ws://127.0.0.1:${wsPort}`;
    const ws = new WebSocket(url, {
      proxy: `http://127.0.0.1:${recorded.port}`, // No auth provided
    });
    // The proxy answered 407 to a CONNECT without credentials.
    expect({ events: await failingSession(ws), requests: recorded.requests }).toEqual({
      events: failed(url, "Proxy authentication required: 407 Proxy Authentication Required"),
      requests: [connectRequest(wsPort)],
    });
    gc();
  });

  test("proxy wrong credentials returns error", async () => {
    using recorded = await startRecordingProxy({ requireAuth: true });
    const url = `ws://127.0.0.1:${wsPort}`;
    const ws = new WebSocket(url, {
      proxy: `http://wrong_user:wrong_pass@127.0.0.1:${recorded.port}`,
    });
    // The credentials were sent, and the proxy answered 403.
    expect({ events: await failingSession(ws), requests: recorded.requests }).toEqual({
      events: failed(url, "Proxy connection failed: 403 Forbidden"),
      requests: [connectRequest(wsPort, { "proxy-authorization": `Basic ${btoa("wrong_user:wrong_pass")}` })],
    });
    gc();
  });
});

describe("WebSocket wss:// through HTTP proxy (TLS tunnel)", () => {
  // This tests the TLS tunnel: wss:// target through HTTP proxy
  // The outer connection is plain TCP to the HTTP proxy, then TLS is
  // negotiated inside the tunnel to the wss:// target server.

  test("wss:// through HTTP proxy", async () => {
    using recorded = await startRecordingProxy();
    const ws = new WebSocket(`wss://127.0.0.1:${wssPort}`, {
      proxy: `http://127.0.0.1:${recorded.port}`,
      // The wss:// server uses a self-signed certificate.
      tls: { rejectUnauthorized: false },
    });
    expect({ events: await echoSession(ws, "hello via tls tunnel"), requests: recorded.requests }).toEqual({
      events: echoed("hello via tls tunnel"),
      requests: [connectRequest(wssPort)],
    });
    gc();
  });

  test("an origin that ends the TLS handshake with close_notify fails the connection", async () => {
    // The origin answers the ClientHello with a close_notify alert and keeps the tunnel open, so only the alert
    // says that no TLS session will come.
    await using origin = net.createServer(socket => {
      socket.on("error", () => {});
      socket.once("data", () => socket.write(Buffer.from([0x15, 0x03, 0x03, 0x00, 0x02, 0x01, 0x00])));
    });
    origin.listen(0, "127.0.0.1");
    await once(origin, "listening");
    const originPort = (origin.address() as AddressInfo).port;
    using recorded = await startRecordingProxy();
    const url = `wss://127.0.0.1:${originPort}`;
    const ws = new WebSocket(url, {
      proxy: `http://127.0.0.1:${recorded.port}`,
      tls: { rejectUnauthorized: false },
    });
    expect({ events: await failingSession(ws), requests: recorded.requests }).toEqual({
      events: failed(url, "TLS handshake failed"),
      requests: [connectRequest(originPort)],
    });
  });

  test("a multi-megabyte message round-trips through the TLS tunnel", async () => {
    // The tunnel's TLS engine hands all the ciphertext of one send() to the tunnel at once.
    using recorded = await startRecordingProxy();
    const ws = new WebSocket(`wss://127.0.0.1:${wssPort}`, {
      proxy: `http://127.0.0.1:${recorded.port}`,
      tls: { rejectUnauthorized: false },
    });
    ws.binaryType = "arraybuffer";
    const payload = Buffer.alloc(4 * 1024 * 1024, Buffer.from(Array.from({ length: 251 }, (_, i) => i)));
    const echo = Promise.withResolvers<Buffer>();
    const closed = Promise.withResolvers<{ code: number; wasClean: boolean }>();
    ws.addEventListener("open", () => ws.send(payload));
    ws.addEventListener("message", event => {
      if (typeof event.data !== "string") echo.resolve(Buffer.from(event.data));
    });
    ws.addEventListener("close", event => {
      echo.reject(new Error(`closed before the echo: ${event.code} ${event.reason}`));
      closed.resolve({ code: event.code, wasClean: event.wasClean });
    });

    const echoedBack = await echo.promise;
    ws.close(1000);
    expect({
      length: echoedBack.length,
      intact: echoedBack.equals(payload),
      closed: await closed.promise,
      requests: recorded.requests,
    }).toEqual({
      length: payload.length,
      intact: true,
      closed: { code: 1000, wasClean: true },
      requests: [connectRequest(wssPort)],
    });
    gc();
  });

  test("the target gets the client's TLS alert when the tunneled handshake fails", async () => {
    using target = await startMalformedServerHelloServer();
    using recorded = await startRecordingProxy();
    const url = `wss://127.0.0.1:${target.port}`;
    const ws = new WebSocket(url, {
      proxy: `http://127.0.0.1:${recorded.port}`,
      tls: { rejectUnauthorized: false },
    });
    expect({ events: await failingSession(ws), targetReceived: await target.afterClientHello }).toEqual({
      events: failed(url, "TLS handshake failed"),
      targetReceived: decodeErrorAlert,
    });
  });

  test("server-initiated ping survives through TLS tunnel proxy", async () => {
    // Regression test: sendPong checked socket.isClosed() on the detached tcp
    // field instead of using hasTCP(). For wss:// through HTTP proxy, the
    // WebSocket uses initWithTunnel which sets tcp = detached (all I/O goes
    // through proxy_tunnel). Detached sockets return true for isClosed(), so
    // sendPong would immediately dispatch a 1006 close instead of sending the
    // pong through the tunnel.
    let pongs = 0;
    const serverClosed = Promise.withResolvers<number>();
    using pingServer = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      tls: {
        key: tlsCerts.key,
        cert: tlsCerts.cert,
      },
      fetch(req, server) {
        if (server.upgrade(req)) return;
        return new Response("Expected WebSocket", { status: 400 });
      },
      websocket: {
        message(ws, message) {
          if (String(message) === "ready") {
            // Send a ping after the client confirms it's connected.
            // On the buggy code path, this triggers sendPong on the detached
            // socket → dispatchAbruptClose → 1006.
            ws.ping();
            // Follow up with a text message. If the client receives this,
            // the connection survived the ping/pong exchange.
            ws.send("after-ping");
          }
        },
        pong() {
          pongs++;
        },
        close(_ws, code) {
          serverClosed.resolve(code);
        },
      },
    });

    using recorded = await startRecordingProxy();
    const ws = new WebSocket(`wss://127.0.0.1:${pingServer.port}`, {
      proxy: `http://127.0.0.1:${recorded.port}`,
      tls: { rejectUnauthorized: false },
    });
    ws.addEventListener("open", () => ws.send("ready"));
    ws.addEventListener("message", event => {
      if (String(event.data) === "after-ping") ws.close(1000);
    });

    const events = await clientEvents(ws);
    // A client that failed the connection itself never tells the server
    // anything, so the server's close is only awaited after a clean close.
    const serverCloseCode = closeCodeOf(events) === 1000 ? await serverClosed.promise : "client did not close cleanly";
    // The pong reached the server before the close frame did.
    expect({ events, pongs, serverCloseCode, requests: recorded.requests }).toEqual({
      events: ["after-ping", { code: 1000, reason: "", wasClean: true }],
      pongs: 1,
      serverCloseCode: 1000,
      requests: [connectRequest(pingServer.port!)],
    });
    gc();
  });

  // The tunnel's TLS engine decrypts into a 64 KiB buffer and hands the frame
  // parser one buffer at a time. A write issued while the parser is still inside
  // the first buffer (the automatic pong for a ping, or send() from a message
  // handler) used to pump the engine again from inside that callback, so the rest
  // of the burst reached the parser re-entrantly and mid-frame: payload bytes
  // were read as frame headers and the connection failed.
  //
  // Getting more than one engine buffer into a single read takes two steps: the
  // server first streams a warm-up message so the client's TCP receive window
  // grows past 64 KiB, then the proxy holds the burst and releases it in one
  // write.
  describe.each([
    { reply: "automatic pong for a server ping", lead: "ping" },
    { reply: "send() from the message handler", lead: "message" },
  ])("burst larger than the TLS read buffer while the client replies with $reply", ({ lead }) => {
    test("every frame is delivered intact and the reply reaches the server", async () => {
      const payload = Buffer.alloc(128 * 1024, Buffer.from(Array.from({ length: 256 }, (_, i) => i)));
      // 64 KiB of plaintext plus a whole 16 KiB TLS record of slack, so the
      // released write always decrypts to more than one engine buffer.
      const releaseAt = 96 * 1024;

      // "got reply" is only sent once the client's pong/ack arrived, and the
      // client writes nothing else after replying, so receiving it proves the
      // reply reached the wire on its own instead of riding along with a later
      // write. The server-side close code checks the other write made from
      // inside a message handler: ws.close() writes the close frame and shuts
      // the tunnel down in the same callback, so the frame has to be flushed
      // immediately or the server only ever sees the TCP connection drop (1006).
      const serverClosed = Promise.withResolvers<number>();
      using server = Bun.serve({
        port: 0,
        hostname: "127.0.0.1",
        tls: { key: tlsCerts.key, cert: tlsCerts.cert },
        fetch(req, server) {
          if (server.upgrade(req)) return;
          return new Response("Expected WebSocket", { status: 400 });
        },
        websocket: {
          open(ws) {
            ws.send(payload); // warm-up
          },
          message(ws, message) {
            if (message === "go") {
              if (lead === "ping") ws.ping();
              else ws.send("first");
              ws.send(payload);
              ws.send("marker");
            } else if (message === "ack") {
              ws.send("got reply");
            }
          },
          pong(ws) {
            ws.send("got reply");
          },
          close(_ws, code) {
            serverClosed.resolve(code);
          },
        },
      });

      let held: Buffer[] | null = null;
      const burstProxy = createConnectProxy({
        onTargetData(chunk, forward) {
          if (held === null) {
            forward(chunk);
            return;
          }
          held.push(chunk);
          if (held.reduce((total, part) => total + part.length, 0) >= releaseAt) {
            const burst = Buffer.concat(held);
            held = null;
            forward(burst);
          }
        },
      });
      const burstProxyPort = await startProxy(burstProxy);

      const received: string[] = [];
      const clientClosed = Promise.withResolvers<number>();
      const ws = new WebSocket(`wss://127.0.0.1:${server.port}`, {
        proxy: `http://127.0.0.1:${burstProxyPort}`,
        tls: { rejectUnauthorized: false },
        // Keep the payload at its full size on the wire.
        perMessageDeflate: false,
      });
      ws.binaryType = "arraybuffer";
      try {
        ws.onmessage = event => {
          if (typeof event.data === "string") {
            received.push(event.data);
            if (event.data === "first") ws.send("ack");
            if (event.data === "got reply") ws.close(1000);
            return;
          }
          const data = Buffer.from(event.data as ArrayBuffer);
          received.push(data.equals(payload) ? "payload" : `corrupt payload (${data.length} bytes)`);
          if (received.length === 1) {
            // Warm-up consumed; hold the burst that "go" provokes.
            held = [];
            ws.send("go");
          }
        };
        ws.onclose = event => clientClosed.resolve(event.code);

        const closeCode = await clientClosed.promise;
        // A client that failed the connection itself never tells the server
        // anything, so the server's close is only awaited after a clean close.
        const serverCloseCode = closeCode === 1000 ? await serverClosed.promise : "client did not close cleanly";
        expect({ received, closeCode, serverCloseCode }).toEqual({
          received:
            lead === "ping"
              ? ["payload", "payload", "marker", "got reply"]
              : ["payload", "first", "payload", "marker", "got reply"],
          closeCode: 1000,
          serverCloseCode: 1000,
        });
      } finally {
        ws.close();
        burstProxy.close();
      }
    });
  });

  // The upgrade client keeps owning the proxy socket after the 101 and forwards
  // whatever arrives on it into the tunnel. It used to flip into that forwarding
  // mode only after the open event had been dispatched, so bytes read off the
  // proxy socket while an open handler spins the event loop (expect().resolves
  // here; a debugger pause does the same) were taken for a response to an
  // upgrade that no longer had a WebSocket attached: the upgrade client failed
  // itself and closed the proxy connection, and the WebSocket that had just
  // fired open stayed OPEN forever without ever receiving a message or a close.
  test("frames read off the proxy socket while the open handler spins the event loop are delivered", async () => {
    const serverClosed = Promise.withResolvers<number>();
    using server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      tls: { key: tlsCerts.key, cert: tlsCerts.cert },
      fetch(req, server) {
        if (server.upgrade(req)) return;
        return new Response("Expected WebSocket", { status: 400 });
      },
      websocket: {
        message(ws, message) {
          if (message === "go") ws.send("hello");
        },
        close(_ws, code) {
          serverClosed.resolve(code);
        },
      },
    });

    // Once the client is inside its open handler, everything the server still
    // sends is the reply to "go". setImmediate runs at the start of the next
    // loop iteration and the expect().resolves spin below only re-checks its
    // promise after that iteration has also polled I/O, so by the time the spin
    // ends the client has read the forwarded reply off the proxy socket.
    let inOpenHandler = false;
    const replyReadByClient = Promise.withResolvers<void>();
    const spinProxy = createConnectProxy({
      onTargetData(chunk, forward) {
        forward(chunk);
        if (inOpenHandler) setImmediate(replyReadByClient.resolve);
      },
    });
    const spinProxyPort = await startProxy(spinProxy);

    const received: string[] = [];
    const openReturned = Promise.withResolvers<void>();
    const clientClosed = Promise.withResolvers<number>();
    const ws = new WebSocket(`wss://127.0.0.1:${server.port}`, {
      proxy: `http://127.0.0.1:${spinProxyPort}`,
      tls: { rejectUnauthorized: false },
    });
    try {
      ws.onopen = () => {
        inOpenHandler = true;
        ws.send("go");
        expect(replyReadByClient.promise).resolves.toBeUndefined();
        inOpenHandler = false;
        openReturned.resolve();
      };
      ws.onmessage = event => {
        received.push(String(event.data));
        ws.close(1000);
      };
      ws.onclose = event => clientClosed.resolve(event.code);

      await openReturned.promise;
      // A client that dropped the proxy connection never closes the WebSocket,
      // so only wait for its close event once the server saw a clean close.
      const serverCloseCode = await serverClosed.promise;
      const clientCloseCode =
        serverCloseCode === 1000 ? await clientClosed.promise : "client never closed (server saw the connection drop)";
      expect({ received, serverCloseCode, clientCloseCode }).toEqual({
        received: ["hello"],
        serverCloseCode: 1000,
        clientCloseCode: 1000,
      });
    } finally {
      ws.terminate();
      spinProxy.close();
    }
  });

  // A server that closes does not wait for the echo of its Close frame. It sends
  // the frame and ends the TLS session behind it (ws.close() in Bun.serve does),
  // so the frame and the close_notify alert usually reach the client in one
  // read. The tunnel's TLS engine used to answer the close_notify with its own
  // before it handed over the bytes decrypted ahead of it. The echo of the
  // Close frame then had no TLS session left to go out on, and the client
  // reported 1006 instead of the server's close code.
  describe("server close with the TLS close_notify behind the Close frame", () => {
    const serverClose: ClientEvent[] = ["m1", "m2", { code: 4001, reason: "bye", wasClean: true }];

    // "direct" is the reference: the same server without a proxy.
    test.each(["direct", "http", "https"])("Bun.serve origin that calls ws.close() (%s)", async route => {
      using origin = Bun.serve({
        port: 0,
        hostname: "127.0.0.1",
        tls: { key: tlsCerts.key, cert: tlsCerts.cert },
        fetch(req, server) {
          if (server.upgrade(req)) return;
          return new Response("Expected WebSocket", { status: 400 });
        },
        websocket: {
          message(ws) {
            ws.send("m1");
            ws.send("m2");
            ws.close(4001, "bye");
          },
        },
      });
      using recorded = await startRecordingProxy({ tls: route === "https" });
      const ws = new WebSocket(`wss://127.0.0.1:${origin.port}`, {
        ...(route === "direct" ? {} : { proxy: `${route}://127.0.0.1:${recorded.port}` }),
        tls: { rejectUnauthorized: false },
      });
      ws.addEventListener("open", () => ws.send("go"));
      expect({ events: await clientEvents(ws), requests: recorded.requests }).toEqual({
        events: serverClose,
        requests: route === "direct" ? [] : [connectRequest(origin.port!)],
      });
    });

    // The case above leaves it to the network whether both TLS records reach
    // the client in one read. This one pins it.
    test.each(["http", "https"])("Close frame and close_notify in one read (%s proxy)", async scheme => {
      const frame = (opcode: number, payload: string | Uint8Array) => {
        const body = Buffer.from(payload);
        return Buffer.concat([Buffer.from([0x80 | opcode, body.length]), body]);
      };
      const closePayload = Buffer.concat([Buffer.from([4001 >> 8, 4001 & 0xff]), Buffer.from("bye")]);

      // Completes the upgrade by hand. Whatever the client sends next is its
      // "go": answer with two messages and a Close frame, and end the TLS
      // session in the same call.
      await using origin = tls.createServer({ key: tlsCerts.key, cert: tlsCerts.cert }, socket => {
        let request = "";
        let upgraded = false;
        socket.on("error", () => {});
        socket.on("data", chunk => {
          if (upgraded) {
            if (!socket.writableEnded) {
              socket.end(Buffer.concat([frame(0x1, "m1"), frame(0x1, "m2"), frame(0x8, closePayload)]));
            }
            return;
          }
          request += chunk.toString("latin1");
          if (!request.includes("\r\n\r\n")) return;
          upgraded = true;
          const key = /^sec-websocket-key: (.*)\r$/im.exec(request)![1];
          const accept = createHash("sha1")
            .update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
            .digest("base64");
          socket.write(
            "HTTP/1.1 101 Switching Protocols\r\n" +
              "Upgrade: websocket\r\n" +
              "Connection: Upgrade\r\n" +
              `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
          );
        });
      });
      origin.listen(0, "127.0.0.1");
      await once(origin, "listening");
      const originPort = (origin.address() as AddressInfo).port;

      // Once the client is open, the server sends exactly two TLS records: the frames, then the close_notify alert,
      // which TLS 1.3 encrypts as application data.
      const records = forwardRecordsTogether(2);
      using recorded = await startRecordingProxy({ tls: scheme === "https", onTargetData: records.onTargetData });

      const ws = new WebSocket(`wss://127.0.0.1:${originPort}`, {
        proxy: `${scheme}://127.0.0.1:${recorded.port}`,
        tls: { rejectUnauthorized: false },
      });
      ws.addEventListener("open", () => {
        records.hold();
        ws.send("go");
      });
      expect({ events: await clientEvents(ws), requests: recorded.requests, forwarded: records.forwarded }).toEqual({
        events: serverClose,
        requests: [connectRequest(originPort)],
        // One write to the client carried the record with the frames and the alert.
        forwarded: [{ types: [TLS_RECORD.applicationData, TLS_RECORD.applicationData], trailing: 0 }],
      });
    });
  });
});

// After the upgrade the proxy connection still belongs to the upgrade client, and only the tunnel reaches it.
describe.concurrent("wss:// through a proxy: the end of the proxy connection", () => {
  describe.each(["http", "https"] as const)("%s proxy", scheme => {
    describe.each(["inside the open event", "after the open event"] as const)("%s", when => {
      test.each([
        ["terminate()", [], (ws: WebSocket) => ws.terminate()],
        // The client sends its Text frame, then Close 1002, and disconnects without waiting for a reply.
        ["an invalid frame from the server", [0x1, 0x8], (ws: WebSocket) => ws.send("go")],
      ] as const)("%s closes the proxy connection", async (_label, opcodes, act) => {
        const clientOpcodes: number[] = [];
        using origin = await startRawWssServer((socket, chunk) => {
          clientOpcodes.push(chunk[0] & 0x0f);
          if (socket.writable) socket.write(Buffer.from([0x83, 0x00]));
        });
        using recorded = await startRecordingProxy({ tls: scheme === "https" });
        const codes = await Promise.all(
          Array.from({ length: 4 }, async () => {
            const ws = new WebSocket(`wss://127.0.0.1:${origin.port}`, {
              proxy: `${scheme}://127.0.0.1:${recorded.port}`,
              tls: { rejectUnauthorized: false },
            });
            ws.addEventListener("open", () => (when === "inside the open event" ? act(ws) : setImmediate(act, ws)));
            return closeCodeOf(await clientEvents(ws));
          }),
        );
        expect(codes).toEqual([1006, 1006, 1006, 1006]);
        expect(await Promise.all(recorded.departures)).toHaveLength(4);
        await Promise.all(origin.departures);
        expect(clientOpcodes.sort()).toEqual([...opcodes, ...opcodes, ...opcodes, ...opcodes].sort());
      });
    });
  });

  const CLOSE_1000 = Buffer.from([0x88, 0x02, 0x03, 0xe8]);
  test.each([
    ["terminate()", "terminate", undefined, "1006 false\n"],
    // The server closes the connection when it reads the client's close_notify.
    ["close() when the server replies", "close", CLOSE_1000, "1000 true\n"],
  ] as const)(
    "the process exits after %s",
    async (_label, method, reply, output) => {
      using origin = await startRawWssServer(socket => void (reply && socket.write(reply)));
      using recorded = await startRecordingProxy();
      await using client = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `
          const ws = new WebSocket(process.env.WS_URL, { proxy: process.env.WS_PROXY, tls: { rejectUnauthorized: false } });
          ws.onopen = () => setImmediate(() => ws.${method}());
          ws.onclose = event => console.log(event.code, event.wasClean);
        `,
        ],
        env: {
          ...bunEnv,
          NO_PROXY: "",
          no_proxy: "",
          WS_URL: `wss://127.0.0.1:${origin.port}`,
          WS_PROXY: `http://127.0.0.1:${recorded.port}`,
        },
        stdout: "pipe",
        stderr: "inherit",
      });
      const [stdout, exitCode] = await Promise.all([client.stdout.text(), client.exited]);
      expect(stdout).toBe(output);
      expect(exitCode).toBe(0);
    },
    20_000,
  );
});

// Whoever owns the connection when the origin renegotiates, the verdict of the first handshake stands:
// BoringSSL refuses a changed certificate. tls.connect() in Node calls checkServerIdentity once too.
describe.concurrent.skipIf(!harness.nodeExe())("wss:// origin that renegotiates", () => {
  test.each([
    ["before the 101", "direct"],
    ["before the 101", "http proxy"],
    ["after the 101", "http proxy"],
  ] as const)("%s, %s: the connection stays open and checkServerIdentity runs once", async (when, route) => {
    await using origin = await startRenegotiatingWssServer(when);
    using recorded = await startRecordingProxy();
    const calls: string[] = [];
    const ws = new WebSocket(`wss://127.0.0.1:${origin.port}`, {
      proxy: route === "direct" ? undefined : `http://127.0.0.1:${recorded.port}`,
      tls: { ca: tlsCerts.cert, checkServerIdentity: hostname => void calls.push(hostname) },
    });
    ws.addEventListener("open", () => ws.send("ready"));
    ws.addEventListener("message", () => ws.close(1000));
    expect({ events: await clientEvents(ws), calls }).toEqual({
      events: ["after renegotiation", { code: 1000, reason: "", wasClean: true }],
      calls: ["127.0.0.1"],
    });
  });

  // The tunnel's TLS engine takes no writes until the renegotiation ends.
  test.each(["http", "https"])("a message sent during the renegotiation arrives after it (%s proxy)", async scheme => {
    await using origin = await startRenegotiatingWssServer("behind a message");
    // "renegotiating" and the request to renegotiate. The listener runs once the client has answered the request.
    const records = forwardRecordsTogether(2);
    using recorded = await startRecordingProxy({ tls: scheme === "https", onTargetData: records.onTargetData });
    const ws = new WebSocket(`wss://127.0.0.1:${origin.port}`, {
      proxy: `${scheme}://127.0.0.1:${recorded.port}`,
      tls: { ca: tlsCerts.cert },
    });
    ws.addEventListener("open", () => {
      records.hold();
      ws.send("ready");
    });
    let queued = false;
    ws.addEventListener("message", event => {
      if (event.data === "renegotiating") {
        ws.send("sent during the renegotiation");
        queued = ws.bufferedAmount > 0;
      }
      if (event.data === "sent during the renegotiation") ws.close(1000);
    });
    expect({ events: await clientEvents(ws), together: records.forwarded[0], queued }).toEqual({
      events: [
        "renegotiating",
        "after renegotiation",
        "sent during the renegotiation",
        { code: 1000, reason: "", wasClean: true },
      ],
      together: { types: [TLS_RECORD.applicationData, TLS_RECORD.handshake], trailing: 0 },
      queued: true,
    });
  });
});

// What was decrypted before a read failed is delivered, whatever a listener does meanwhile. The tunnel's TLS engine
// refuses writes as soon as the read fails, so these listeners run while it refuses. "direct" is the reference.
describe.concurrent("wss://: a corrupt TLS record right behind the messages", () => {
  const messages = ["m0", "m1", "m2"];
  const connect = (origin: { url: string; proxy?: string }) =>
    new WebSocket(origin.url, { proxy: origin.proxy, tls: { ca: tlsCerts.cert } });

  describe.each(["direct", "http", "https"] as const)("%s", route => {
    // Only a direct connection reports the failed read.
    const failure: ClientEvent[] =
      route === "direct" ? [{ error: expect.stringMatching(/ failed: TLS handshake failed$/) }] : [];

    test.each([
      ["open", "send"],
      ["open", "pause"],
      ["message", "send"],
    ] as const)("the '%s' listener calls %s(): every message is still delivered", async (listener, method) => {
      await using origin = await startOriginWithCorruptRecord(route, messages);
      const ws = connect(origin);
      ws.addEventListener(listener, () => ws[method]("never sent"), { once: true });
      expect(await clientEvents(ws)).toEqual([...messages, ...failure, { code: 1006, reason: "", wasClean: false }]);
    });

    test("what send() could not write stays in bufferedAmount", async () => {
      await using origin = await startOriginWithCorruptRecord(route, messages);
      const ws = connect(origin);
      ws.addEventListener("open", () => ws.send("never sent"));
      await clientEvents(ws);
      // The whole frame: a 2-byte header, the mask and the payload.
      expect(ws.bufferedAmount).toBe(2 + 4 + "never sent".length);
    });
  });
});

// Not concurrent: it counts every live SSL_CTX in the process.
test("wss:// through a proxy: terminate() frees the SSL_CTX of the tunnel", async () => {
  using recorded = await startRecordingProxy();
  const terminated = async () => {
    const ws = new WebSocket(`wss://127.0.0.1:${wssPort}`, {
      proxy: `http://127.0.0.1:${recorded.port}`,
      tls: { rejectUnauthorized: false },
    });
    ws.addEventListener("message", () => ws.terminate());
    return closeCodeOf(await clientEvents(ws));
  };
  expect(await terminated()).toBe(1006);
  const before = sslCtxLiveCount();
  expect(await Promise.all([terminated(), terminated(), terminated(), terminated()])).toEqual([1006, 1006, 1006, 1006]);
  // Not toBe: a GC may free a context that an earlier test left behind.
  expect(sslCtxLiveCount()).toBeLessThanOrEqual(before);
});

describe("WebSocket through HTTPS proxy (TLS proxy)", () => {
  // These tests verify WebSocket connections through HTTPS (TLS) proxy servers

  test("ws:// through HTTPS proxy with CA certificate", async () => {
    using recorded = await startRecordingProxy({ tls: true });
    const ws = new WebSocket(`ws://127.0.0.1:${wsPort}`, {
      proxy: `https://127.0.0.1:${recorded.port}`,
      // Trust the self-signed certificate used by the proxy
      tls: { ca: tlsCerts.cert },
    });
    expect({ events: await echoSession(ws, "hello via https proxy"), requests: recorded.requests }).toEqual({
      events: echoed("hello via https proxy"),
      requests: [connectRequest(wsPort)],
    });
    gc();
  });

  test("ws:// through HTTPS proxy fails without CA certificate", async () => {
    using recorded = await startRecordingProxy({ tls: true });
    const url = `ws://127.0.0.1:${wsPort}`;
    const ws = new WebSocket(url, {
      proxy: `https://127.0.0.1:${recorded.port}`,
      // No CA certificate: the proxy's self-signed certificate is not trusted.
    });
    // The client reached the proxy and gave up inside the TLS handshake, before any CONNECT.
    expect({
      events: await failingSession(ws),
      connections: recorded.connections,
      requests: recorded.requests,
    }).toEqual({
      events: failed(url, "TLS handshake failed"),
      connections: 1,
      requests: [],
    });
    gc();
  });

  test("ws:// through HTTPS proxy with rejectUnauthorized: false", async () => {
    using recorded = await startRecordingProxy({ tls: true });
    const ws = new WebSocket(`ws://127.0.0.1:${wsPort}`, {
      proxy: `https://127.0.0.1:${recorded.port}`,
      tls: { rejectUnauthorized: false }, // Skip TLS verification for the proxy
    });
    expect({ events: await echoSession(ws, "hello via https proxy no verify"), requests: recorded.requests }).toEqual({
      events: echoed("hello via https proxy no verify"),
      requests: [connectRequest(wsPort)],
    });
    gc();
  });
});

describe("`proxy.tls`", () => {
  const read = (file: string) => readFileSync(path.join(import.meta.dirname, "../../node", file), "utf8");
  // The proxy's certificate is self-signed and the target's is issued by a private CA, so trusting one doesn't trust the
  // other.
  const proxyCa = tlsCerts.cert;
  const targetCa = read("http/fixtures/openssl_localhost_ca.pem");
  const off = { rejectUnauthorized: false };

  let secureTarget: Bun.Server<undefined>;

  beforeAll(() => {
    secureTarget = Bun.serve({
      port: 0,
      tls: { cert: read("http/fixtures/openssl_localhost.crt"), key: read("http/fixtures/openssl_localhost.key") },
      fetch(req, server) {
        if (server.upgrade(req)) return;
        return new Response("Expected WebSocket", { status: 400 });
      },
      websocket: {
        open(ws) {
          ws.send("connected");
        },
        message(ws, message) {
          ws.send(message);
        },
      },
    });
  });

  afterAll(() => {
    secureTarget?.stop(true);
  });

  describe.each([
    { proxy: "http", target: "wss" },
    { proxy: "https", target: "ws" },
    { proxy: "https", target: "wss" },
  ] as const)("$proxy: proxy, $target: target", ({ proxy, target }) => {
    type Row = [options: string, proxyTls: unknown, tls: Bun.TLSOptions, trusted: string[]];

    test.each<Row>([
      ["proxy.tls: {}", {}, {}, []],
      ["proxy.tls.rejectUnauthorized: false", off, {}, ["proxy"]],
      ["proxy.tls: {}, tls.rejectUnauthorized: false", {}, off, ["target"]],
      ["rejectUnauthorized: false in both", off, off, ["proxy", "target"]],
      ["proxy.tls.ca for the proxy, tls.ca for the target", { ca: proxyCa }, { ca: targetCa }, ["proxy", "target"]],
      ["proxy.tls.ca for the target, tls.ca for the proxy", { ca: targetCa }, { ca: proxyCa }, []],
      ["no proxy.tls, tls.rejectUnauthorized: false", undefined, off, ["proxy", "target"]],
      ["no proxy.tls, tls.ca for both", undefined, { ca: [proxyCa, targetCa] }, ["proxy", "target"]],
      ["no proxy.tls, tls.ca for the proxy", undefined, { ca: proxyCa }, ["proxy"]],
      // `true` means TLS with the defaults, as in Bun.connect(). A falsy value means "not set".
      ["proxy.tls: true, tls.rejectUnauthorized: false", true, off, ["target"]],
      ...[false, null, 0, ""].map(
        (value): Row => [`proxy.tls: ${JSON.stringify(value)}, tls.rejectUnauthorized: false`, value, off, ["proxy", "target"]], // prettier-ignore
      ),
    ])("%s", async (_, proxyTls, tlsOptions, trusted) => {
      using recorded = await startRecordingProxy({ tls: proxy === "https" });
      const port = target === "wss" ? secureTarget.port! : wsPort;
      const url = `${target}://127.0.0.1:${port}`;
      const ws = new WebSocket(url, {
        proxy: { url: `${proxy}://127.0.0.1:${recorded.port}`, tls: proxyTls as Bun.TLSOptions },
        tls: tlsOptions,
      });
      // A rejected proxy never gets the CONNECT request.
      expect({ events: await echoSession(ws, "hello"), requests: recorded.requests }).toEqual(
        proxy === "https" && !trusted.includes("proxy")
          ? { events: failed(url, "TLS handshake failed"), requests: [] }
          : target === "wss" && !trusted.includes("target")
            ? { events: failed(url, "TLS handshake failed"), requests: [connectRequest(port)] }
            : { events: echoed("hello"), requests: [connectRequest(port)] },
      );
    });
  });

  test.each([1, "x"])("proxy.tls: %j throws", value => {
    const proxy = { url: "https://127.0.0.1:1", tls: value as unknown as Bun.TLSOptions };
    expect(() => new WebSocket("ws://127.0.0.1:1", { proxy })).toThrow(
      expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE", message: expect.stringContaining("proxy.tls") }),
    );
  });

  test("each client certificate is only sent to the peer it was configured for", async () => {
    const identity = (name: string) => ({
      ca: tlsCerts.cert,
      cert: read(`test/fixtures/keys/${name}-cert.pem`),
      key: read(`test/fixtures/keys/${name}-key.pem`),
    });
    const anonymous = { ca: tlsCerts.cert };
    const requestCertificate = { requestCert: true, rejectUnauthorized: false };
    const nameOf = (socket: tls.TLSSocket) => String(socket.getPeerCertificate().subject?.CN ?? "nobody");

    const seenByProxy: string[] = [];
    const connectProxy = createConnectProxy();
    const proxy = tls.createServer({ ...tlsCerts, ...requestCertificate }, socket => {
      seenByProxy.push(nameOf(socket));
      connectProxy.emit("connection", socket);
    });
    const proxyPort = await startProxy(proxy);
    // Answers the client's first frame with the name on the client's certificate.
    using target = await startRawWssServer(socket => {
      const name = Buffer.from(nameOf(socket));
      socket.write(Buffer.concat([Buffer.from([0x81, name.length]), name]));
    }, requestCertificate);

    async function seenBy(proxyTls: Bun.TLSOptions | undefined, tlsOptions: Bun.TLSOptions) {
      const ws = new WebSocket(`wss://127.0.0.1:${target.port}`, {
        proxy: { url: `https://127.0.0.1:${proxyPort}`, tls: proxyTls },
        tls: tlsOptions,
      });
      ws.addEventListener("open", () => ws.send("who am I?"));
      return { target: await openOrFailure(ws, "message"), proxy: seenByProxy.splice(0) };
    }

    try {
      expect({
        both: await seenBy(identity("agent1"), identity("agent3")),
        proxyOnly: await seenBy(identity("agent1"), anonymous),
        targetOnly: await seenBy(anonymous, identity("agent3")),
        shared: await seenBy(undefined, identity("agent3")),
      }).toEqual({
        both: { proxy: ["agent1"], target: "agent3" },
        proxyOnly: { proxy: ["agent1"], target: "nobody" },
        targetOnly: { proxy: ["nobody"], target: "agent3" },
        shared: { proxy: ["agent3"], target: "agent3" },
      });
    } finally {
      proxy.close();
    }
  });

  describe("checkServerIdentity", () => {
    const owners = new Map([
      [new X509Certificate(tlsCerts.cert).fingerprint256, "the proxy's certificate"],
      [new X509Certificate(read("http/fixtures/openssl_localhost.crt")).fingerprint256, "the target's certificate"],
    ]);
    const proxyCall = "proxy.tls: 127.0.0.1, the proxy's certificate";
    const targetCall = "tls: 127.0.0.1, the target's certificate";
    /** TLS options, plus what their `checkServerIdentity` returns. Without a `verdict` there is no callback. */
    type Checked = Bun.TLSOptions & { verdict?: "accept" | "reject" };
    type Row = [
      name: string,
      proxyTls: Checked | undefined,
      tls: Checked,
      calls: string[],
      outcome: "opens" | "rejects the proxy" | "rejects the target",
    ];

    test.each<Row>([
      [
        "each callback gets its own peer's certificate",
        { ca: proxyCa, verdict: "accept" },
        { ca: targetCa, verdict: "accept" },
        [proxyCall, targetCall],
        "opens",
      ],
      ["tls's isn't called for the proxy", { ca: proxyCa }, { ca: targetCa, verdict: "accept" }, [targetCall], "opens"],
      [
        "tls's isn't called for the proxy without proxy.tls",
        undefined,
        { ca: [proxyCa, targetCa], verdict: "accept" },
        [targetCall],
        "opens",
      ],
      [
        "proxy.tls's can reject the proxy",
        { ca: proxyCa, verdict: "reject" },
        { ca: targetCa, verdict: "accept" },
        [proxyCall],
        "rejects the proxy",
      ],
      [
        "tls's can reject the target",
        { ca: proxyCa, verdict: "accept" },
        { ca: targetCa, verdict: "reject" },
        [proxyCall, targetCall],
        "rejects the target",
      ],
      [
        "proxy.tls.rejectUnauthorized: false drops its verdict",
        { ca: proxyCa, rejectUnauthorized: false, verdict: "reject" },
        { ca: targetCa },
        [proxyCall],
        "opens",
      ],
      ["it never sees a chain that didn't verify", { verdict: "accept" }, { ca: targetCa }, [], "rejects the proxy"],
      [
        "it replaces the check against proxy.tls.serverName",
        { ca: proxyCa, serverName: "proxy.test", verdict: "accept" },
        { ca: targetCa },
        ["proxy.tls: proxy.test, the proxy's certificate"],
        "opens",
      ],
    ])("%s", async (_, proxyTls, tlsOptions, expectedCalls, outcome) => {
      using recorded = await startRecordingProxy({ tls: true });
      const calls: string[] = [];
      const withCallback = (option: string, { verdict, ...options }: Checked) => ({
        ...options,
        checkServerIdentity:
          verdict &&
          ((hostname: string, cert: tls.PeerCertificate) => {
            calls.push(`${option}: ${hostname}, ${owners.get(cert.fingerprint256)}`);
            return verdict === "reject" ? new Error("PIN-REJECT") : undefined;
          }),
      });
      const port = secureTarget.port!;
      const url = `wss://127.0.0.1:${port}`;
      const ws = new WebSocket(url, {
        proxy: { url: `https://127.0.0.1:${recorded.port}`, tls: proxyTls && withCallback("proxy.tls", proxyTls) },
        tls: withCallback("tls", tlsOptions),
      });
      expect({ events: await echoSession(ws, "hello"), requests: recorded.requests, calls }).toEqual({
        events: outcome === "opens" ? echoed("hello") : failed(url, "TLS handshake failed"),
        // A rejected proxy never gets the CONNECT request.
        requests: outcome === "rejects the proxy" ? [] : [connectRequest(port)],
        calls: expectedCalls,
      });
    });
  });

  test.each(["http", "https"])("throws on invalid options like `tls` does, with an %s: proxy", scheme => {
    for (const invalid of [{ ca: 123 }, { key: {} }, { rejectUnauthorized: "no" }] as unknown as Bun.TLSOptions[]) {
      let error: unknown;
      try {
        new WebSocket("wss://127.0.0.1:1", { tls: invalid });
      } catch (thrown) {
        error = thrown;
      }
      expect(error).toBeInstanceOf(TypeError);
      expect(
        () => new WebSocket("wss://127.0.0.1:1", { proxy: { url: `${scheme}://127.0.0.1:1`, tls: invalid } }),
      ).toThrow(error as TypeError);
    }
  });
});

// Squid proxy tests - run when Docker is enabled
// Uses docker-compose infrastructure to run squid proxy
// Import docker-compose dynamically to avoid issues when not using docker
const dockerCompose = require("../../../docker/index.ts");

describe.skipIf(!isDockerEnabled())("WebSocket through Squid proxy (Docker)", () => {
  let squidInfo: { host: string; ports: Record<number, number>; proxyUrl?: string };

  beforeAll(async () => {
    console.log("Starting squid proxy container...");
    squidInfo = await dockerCompose.ensure("squid");
    console.log(`Squid proxy ready at: ${squidInfo.host}:${squidInfo.ports[3128]}`);
  }, 240_000);

  afterAll(async () => {
    if (!process.env.BUN_KEEP_DOCKER) {
      await dockerCompose.down();
    }
  }, 30_000);

  test("ws:// through squid proxy to local server", async () => {
    const { promise, resolve, reject } = Promise.withResolvers<string[]>();
    const proxyUrl = `http://${squidInfo.host}:${squidInfo.ports[3128]}`;

    // Connect to our local WebSocket server through squid
    const ws = new WebSocket(`ws://host.docker.internal:${wsPort}`, {
      proxy: proxyUrl,
    });

    const receivedMessages: string[] = [];

    ws.onopen = () => {
      ws.send("hello from bun via squid");
    };

    ws.onmessage = event => {
      receivedMessages.push(String(event.data));
      if (receivedMessages.length === 2) {
        ws.close();
      }
    };

    ws.onclose = () => {
      resolve(receivedMessages);
    };

    ws.onerror = event => {
      reject(event);
    };

    const messages = await promise;
    expect(messages).toContain("connected");
    expect(messages).toContain("hello from bun via squid");
    gc();
  }, 30_000);

  test("wss:// through squid proxy to local server", async () => {
    const { promise, resolve, reject } = Promise.withResolvers<string[]>();
    const proxyUrl = `http://${squidInfo.host}:${squidInfo.ports[3128]}`;

    // Connect to our local secure WebSocket server through squid
    const ws = new WebSocket(`wss://host.docker.internal:${wssPort}`, {
      proxy: proxyUrl,
      tls: {
        rejectUnauthorized: false, // Accept self-signed cert
      },
    });

    const receivedMessages: string[] = [];

    ws.onopen = () => {
      ws.send("hello wss from bun via squid");
    };

    ws.onmessage = event => {
      receivedMessages.push(String(event.data));
      if (receivedMessages.length === 2) {
        ws.close();
      }
    };

    ws.onclose = () => {
      resolve(receivedMessages);
    };

    ws.onerror = event => {
      reject(event);
    };

    const messages = await promise;
    expect(messages).toContain("connected");
    expect(messages).toContain("hello wss from bun via squid");
    gc();
  }, 30_000);
});

describe("ws module with HttpsProxyAgent", () => {
  // These tests verify that the ws module (src/js/thirdparty/ws.js) correctly
  // passes the agent property to the native WebSocket

  const WS = require("ws");

  test("ws module passes agent to native WebSocket", async () => {
    using recorded = await startRecordingProxy();
    const agent = new HttpsProxyAgent(`http://127.0.0.1:${recorded.port}`);
    const ws = new WS(`ws://127.0.0.1:${wsPort}`, { agent });

    const events: unknown[] = [];
    const { promise, resolve } = Promise.withResolvers<void>();
    ws.on("open", () => ws.send("hello from ws module via agent"));
    ws.on("message", (data: Buffer) => {
      events.push(data.toString());
      if (events.length === 2) ws.close(1000);
    });
    ws.on("error", (err: Error) => events.push({ error: err.message }));
    ws.on("close", (code: number, reason: Buffer) => {
      events.push({ code, reason: String(reason) });
      resolve();
    });
    await promise;

    // The CONNECT request proves the connection went through the agent's proxy.
    expect({ events, requests: recorded.requests }).toEqual({
      events: ["connected", "hello from ws module via agent", { code: 1000, reason: "" }],
      requests: [connectRequest(wsPort)],
    });
    gc();
  });
});

describe.concurrent("WebSocket NO_PROXY bypass", () => {
  // Each child connects to the echo server through an auth proxy it has no
  // credentials for. When NO_PROXY applies, the proxy never sees a connection
  // and the echo server greets the child. When it does not apply, the proxy
  // answers the CONNECT with 407 and the child reports the failure.
  const childScript = (proxyPort: number) => `
    const ws = new WebSocket("ws://127.0.0.1:${wsPort}", { proxy: "http://127.0.0.1:${proxyPort}" });
    ws.onmessage = event => { console.log("message:", event.data); ws.close(1000); };
    ws.onerror = event => console.log("error:", event.message);
    ws.onclose = event => console.log("close:", event.code, JSON.stringify(event.reason));
  `;

  test.each([
    ["NO_PROXY matching hostname bypasses explicit proxy for ws://", () => "127.0.0.1", "direct"],
    ["NO_PROXY matching host:port bypasses proxy for ws://", () => `127.0.0.1:${wsPort}`, "direct"],
    ["NO_PROXY not matching still uses proxy (auth fails)", () => "other.host.com", "proxied"],
    ["NO_PROXY=* bypasses all proxies", () => "*", "direct"],
  ] as const)("%s", async (_, noProxy, outcome) => {
    using recorded = await startRecordingProxy({ requireAuth: true });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", childScript(recorded.port)],
      // The lowercase variable takes precedence over NO_PROXY, so an ambient
      // no_proxy=127.0.0.1 must not reach the child.
      env: { ...bunEnv, NO_PROXY: noProxy(), no_proxy: undefined },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect({ stdout, stderr, exitCode, proxyConnections: recorded.connections }).toEqual(
      outcome === "direct"
        ? { stdout: `message: connected\nclose: 1000 ""\n`, stderr: "", exitCode: 0, proxyConnections: 0 }
        : {
            stdout:
              `error: WebSocket connection to 'ws://127.0.0.1:${wsPort}/' failed: ` +
              `Proxy authentication required: 407 Proxy Authentication Required\n` +
              `close: 1006 ""\n`,
            stderr: "",
            exitCode: 0,
            proxyConnections: 1,
          },
    );
  });
});
