import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { gc, nodeExe, tls as tlsCerts } from "harness";
import type { HttpsProxyAgent as HttpsProxyAgentType } from "https-proxy-agent";
import { AsyncLocalStorage } from "node:async_hooks";
import { getEventListeners, once } from "node:events";
import { readFileSync } from "node:fs";
import http, { type ClientRequest, type IncomingMessage } from "node:http";
import https from "node:https";
import net from "node:net";
import path from "node:path";
import type { ConnectionOptions } from "node:tls";
import WebSocket from "ws";
import {
  connectRequest,
  forwardRecordsTogether,
  startEchoServer,
  startOriginWithCorruptRecord,
  startRecordingProxy,
  startRenegotiatingWssServer,
  TLS_RECORD,
} from "../../web/websocket/proxy-test-utils";
import { closedPort, createPeer, nextEvent, runScript, scriptTimeout } from "./ws-raw-peer";

// Use dynamic require to avoid linter removing the import
const { HttpsProxyAgent } = require("https-proxy-agent") as {
  HttpsProxyAgent: typeof HttpsProxyAgentType;
};

// Bun's `ws` also accepts the `proxy` and `tls` options of Bun's native WebSocket. npm ws has neither.
type ClientOptions = WebSocket.ClientOptions & Bun.WebSocketOptionsProxy & Bun.WebSocketOptionsTLS;

// The tests below pass an explicit `proxy:` option for 127.0.0.1 and assert on
// the CONNECT request the proxy receives. NO_PROXY applies to explicit proxies
// too, so an ambient NO_PROXY=localhost,127.0.0.1,... must not bypass them.
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

type ClientEvent = string | { error: unknown; code?: string } | { close: unknown[] };

/** Collects every message, each error's message and code, and the 'close' arguments. Resolves on 'close'. */
function wsEvents(ws: WebSocket): Promise<ClientEvent[]> {
  const events: ClientEvent[] = [];
  const { promise, resolve } = Promise.withResolvers<ClientEvent[]>();
  ws.on("message", (data: Buffer) => {
    events.push(data.toString());
  });
  ws.on("error", (err: NodeJS.ErrnoException) => {
    events.push({ error: err instanceof Error ? err.message : err, code: err.code });
  });
  ws.on("close", (...args) => {
    events.push({ close: args });
    resolve(events);
  });
  return promise;
}

/** Sends `message` once open and closes after the echo arrives. A working tunnel produces `echoed(message)`. */
function wsEchoSession(ws: WebSocket, message: string): Promise<ClientEvent[]> {
  ws.on("open", () => ws.send(message));
  ws.on("message", (data: Buffer) => {
    if (data.toString() === message) ws.close(1000);
  });
  return wsEvents(ws);
}

/** For a connection that must fail: an unexpected open is closed at once so the assertion reports it. */
function wsFailingSession(ws: WebSocket): Promise<ClientEvent[]> {
  ws.on("open", () => ws.close(1000));
  return wsEvents(ws);
}

/** The echo server sends a greeting, echoes the message, then replies to the client's Close frame. */
function echoed(message: string): ClientEvent[] {
  return ["connected", message, { close: [1000, Buffer.alloc(0)] }];
}

/** A failed handshake emits one error, then 'close'. */
function failed(error: { error: unknown; code?: string }): ClientEvent[] {
  return [error, { close: [1006, Buffer.alloc(0)] }];
}

/** close() while CONNECTING emits 'error', so this adds a listener first. */
function closeWhileConnecting(ws: WebSocket) {
  ws.on("error", () => {});
  ws.close();
}

/**
 * Runs `script` in a child process, for a polluted Object.prototype or an environment variable. `connect(url, options)`
 * resolves with the server's first message, or with `error <code>`.
 */
function runClientScript(script: string, env: Record<string, string>) {
  const prelude = `
    const connect = (url, options) => new Promise(resolve => {
      const ws = new WebSocket(url, options);
      ws.on("message", data => { resolve(String(data)); ws.terminate(); });
      ws.on("error", error => resolve("error " + error.code));
    });
  `;
  return runScript({ specifier: "ws" }, prelude + script, { NO_PROXY: "", no_proxy: "", ...env });
}

describe("ws package proxy API", () => {
  // These checks only exercise the constructor. close() follows at once, so
  // nothing needs to listen on the proxy port.
  const proxyPort = 1;

  test("accepts proxy option as string (HTTP proxy)", () => {
    const ws = new WebSocket("ws://example.com", {
      proxy: `http://127.0.0.1:${proxyPort}`,
    } as ClientOptions);
    expect(ws.readyState).toBe(WebSocket.CONNECTING);
    closeWhileConnecting(ws);
  });

  test("accepts proxy option as string (HTTPS proxy)", () => {
    const ws = new WebSocket("ws://example.com", {
      proxy: `https://127.0.0.1:${proxyPort}`,
      tls: { rejectUnauthorized: false },
    } as ClientOptions);
    expect(ws.readyState).toBe(WebSocket.CONNECTING);
    closeWhileConnecting(ws);
  });

  test("accepts proxy option with object containing url", () => {
    const ws = new WebSocket("ws://example.com", {
      proxy: { url: `http://127.0.0.1:${proxyPort}` },
    } as ClientOptions);
    expect(ws.readyState).toBe(WebSocket.CONNECTING);
    closeWhileConnecting(ws);
  });

  test("accepts proxy URL with credentials", () => {
    const ws = new WebSocket("ws://example.com", {
      proxy: `http://user:pass@127.0.0.1:${proxyPort}`,
    } as ClientOptions);
    expect(ws.readyState).toBe(WebSocket.CONNECTING);
    closeWhileConnecting(ws);
  });

  test("can combine proxy with headers and protocols", () => {
    const ws = new WebSocket("ws://example.com", ["graphql-ws"], {
      proxy: `http://127.0.0.1:${proxyPort}`,
      headers: { Authorization: "Bearer token" },
    } as ClientOptions);
    expect(ws.readyState).toBe(WebSocket.CONNECTING);
    closeWhileConnecting(ws);
  });

  test("rejects invalid proxy URL", () => {
    expect(() => {
      new WebSocket("ws://example.com", {
        proxy: "not-a-valid-url",
      } as ClientOptions);
    }).toThrow(expect.objectContaining({ name: "SyntaxError", message: "Invalid proxy URL: not-a-valid-url" }));
  });
});

describe("ws package through HTTP CONNECT proxy", () => {
  test("ws:// through HTTP proxy", async () => {
    using recorded = await startRecordingProxy();
    const ws = new WebSocket(`ws://127.0.0.1:${wsPort}`, {
      proxy: `http://127.0.0.1:${recorded.port}`,
    } as ClientOptions);
    expect({ events: await wsEchoSession(ws, "hello from ws client"), requests: recorded.requests }).toEqual({
      events: echoed("hello from ws client"),
      requests: [connectRequest(wsPort)],
    });
    gc();
  });

  // The native client reads inherited properties and getters, so `ws` must not copy the object with a spread.
  test.each<[shape: string, create: (url: string) => object]>([
    [
      "a class instance with `url` and `tls` getters",
      url =>
        new (class {
          get url() {
            return url;
          }
          get tls() {
            return {};
          }
        })(),
    ],
    ["an object that inherits `url` and has its own `tls`", url => Object.assign(Object.create({ url }), { tls: {} })],
    [
      "a Proxy whose traps answer for `url`",
      url => new Proxy({}, { has: (_, key) => key === "url", get: (_, key) => (key === "url" ? url : undefined) }),
    ],
  ])("`proxy` can be %s", async (_, create) => {
    using recorded = await startRecordingProxy();
    const ws = new WebSocket(`ws://127.0.0.1:${wsPort}`, {
      proxy: create(`http://127.0.0.1:${recorded.port}`),
    } as ClientOptions);
    expect({ events: await wsEchoSession(ws, "hello"), requests: recorded.requests }).toEqual({
      events: echoed("hello"),
      requests: [connectRequest(wsPort)],
    });
  });

  test.each([
    ["no `url`", { __proto__: null, headers: { "X-Unused": "1" } }],
    ['`url: ""`', { __proto__: null, url: "" }],
  ])("a null-prototype `proxy` with %s connects directly", async (_, proxy) => {
    const ws = new WebSocket(`ws://127.0.0.1:${wsPort}`, { proxy } as ClientOptions);
    expect(await wsEchoSession(ws, "hello")).toEqual(echoed("hello"));
  });

  test.concurrent(
    "doesn't read `proxy.tls` from Object.prototype",
    async () => {
      using proxy = await startRecordingProxy();
      using secureProxy = await startRecordingProxy({ tls: true });
      const { lines, exitCode } = await runClientScript(
        `
        const { TARGET, PROXY, SECURE_PROXY } = process.env;
        Object.prototype.tls = { rejectUnauthorized: false };
        console.log(await connect(TARGET, { proxy: PROXY }));
        console.log(await connect(TARGET, { proxy: { url: SECURE_PROXY } }));
      `,
        {
          TARGET: `ws://127.0.0.1:${wsPort}`,
          PROXY: `http://127.0.0.1:${proxy.port}`,
          SECURE_PROXY: `https://127.0.0.1:${secureProxy.port}`,
        },
      );
      expect({ lines, requests: proxy.requests, secureRequests: secureProxy.requests }).toEqual({
        lines: ["connected", "error DEPTH_ZERO_SELF_SIGNED_CERT"],
        requests: [connectRequest(wsPort)],
        secureRequests: [],
      });
      expect(exitCode).toBe(0);
    },
    scriptTimeout,
  );

  // With a proxy the native client connects instead of node:http, so `ws` has to handle `signal` itself. A signal can
  // outlive the connections it was passed to, so a listener left on it would leak.
  describe("`signal` option", () => {
    const serve503 = () =>
      Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("no", { status: 503 }) });

    test("abort() while CONNECTING emits an AbortError, then 'close' 1006", async () => {
      using recorded = await startRecordingProxy();
      // Accepts the tunneled connection but never answers the upgrade request.
      const silentServer = net.createServer(() => {}).listen(0, "127.0.0.1");
      await once(silentServer, "listening");
      try {
        const controller = new AbortController();
        const ws = new WebSocket(`ws://127.0.0.1:${(silentServer.address() as net.AddressInfo).port}`, {
          proxy: `http://127.0.0.1:${recorded.port}`,
          signal: controller.signal,
        } as ClientOptions);
        const events = wsEvents(ws);
        await once(silentServer, "connection");
        controller.abort(new Error("why"));
        expect(await events).toEqual([
          { error: "The operation was aborted", code: "ABORT_ERR" },
          { close: [1006, Buffer.alloc(0)] },
        ]);
        expect(getEventListeners(controller.signal, "abort")).toEqual([]);
      } finally {
        silentServer.close();
      }
    });

    test.each(["'open'", "'unexpected-response'", "'error'", "the constructor throws"])(
      "removes the abort listener after %s",
      async outcome => {
        using recorded = await startRecordingProxy();
        using target = serve503();
        const { signal } = new AbortController();
        const port = outcome === "'open'" ? wsPort : target.port;
        const options = {
          proxy: `http://127.0.0.1:${recorded.port}`,
          signal,
          headers: outcome === "the constructor throws" ? { "X-Bad": "a\r\nb" } : {},
        } as ClientOptions;
        if (outcome === "the constructor throws") {
          expect(() => new WebSocket(`ws://127.0.0.1:${port}`, options)).toThrow(TypeError);
        } else {
          const ws = new WebSocket(`ws://127.0.0.1:${port}`, options);
          expect(getEventListeners(signal, "abort")).toHaveLength(1);
          if (outcome === "'unexpected-response'") {
            const [, res] = (await once(ws, "unexpected-response")) as [unknown, IncomingMessage];
            await once(res.resume(), "close");
          } else {
            await once(ws, outcome.slice(1, -1));
          }
          ws.on("error", () => {});
          ws.terminate();
        }
        expect(getEventListeners(signal, "abort")).toEqual([]);
      },
    );
  });

  // The native client has the 101, so giving up on the request has to close the WebSocket too. In an 'upgrade' listener
  // that fails the handshake. npm ws on Node emits 'open' and 'close' 1006 there, and no 'error'.
  test.each<{ call: string; listener: string; events: ClientEvent[]; names: string[] }>([
    {
      call: "controller.abort()",
      listener: "upgrade",
      events: failed({ error: "The operation was aborted", code: "ABORT_ERR" }),
      names: ["upgrade", "error", "close"],
    },
    {
      call: "req.destroy()",
      listener: "upgrade",
      events: failed({ error: "socket hang up", code: "ECONNRESET" }),
      names: ["upgrade", "error", "close"],
    },
    {
      call: "req.destroy()",
      listener: "open",
      events: [{ close: [1006, Buffer.alloc(0)] }],
      names: ["upgrade", "open", "close"],
    },
  ])("$call in an '$listener' listener emits 'close' 1006 once", async ({ call, listener, events, names }) => {
    using recorded = await startRecordingProxy();
    await using target = await createPeer();
    const controller = new AbortController();
    let req!: ClientRequest;
    const ws = new WebSocket(target.url, {
      proxy: `http://127.0.0.1:${recorded.port}`,
      signal: controller.signal,
      finishRequest: request => void (req = request).end(),
    } as ClientOptions);
    const emitted: string[] = [];
    for (const name of ["upgrade", "open", "error", "close"]) ws.on(name, () => emitted.push(name));
    const seen = wsEvents(ws);
    ws.on(listener, () => (call === "req.destroy()" ? req.destroy() : controller.abort()));
    expect(await seen).toEqual(events);
    // Once the target has seen the connection end, nothing is left that could emit another event.
    const connection = await target.connection();
    await connection.ended;
    expect(() => (ws.terminate(), ws.close())).not.toThrow();
    expect(emitted).toEqual(names);
    expect(getEventListeners(controller.signal, "abort")).toEqual([]);
  });

  test("ws:// through HTTP proxy when finishRequest calls req.end() asynchronously", async () => {
    using recorded = await startRecordingProxy();
    const upgrades: (string | null)[] = [];
    using target = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch(req, server) {
        upgrades.push(req.headers.get("authorization"));
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
    const ws = new WebSocket(`ws://127.0.0.1:${target.port}`, {
      proxy: `http://127.0.0.1:${recorded.port}`,
      finishRequest(req) {
        queueMicrotask(() => {
          req.setHeader("authorization", "token");
          req.end();
        });
      },
    } as ClientOptions);
    expect({
      events: await wsEchoSession(ws, "hello after a late end"),
      requests: recorded.requests,
      connections: recorded.connections,
      upgrades,
    }).toEqual({
      events: echoed("hello after a late end"),
      requests: [connectRequest(target.port!)],
      connections: 1,
      upgrades: ["token"],
    });
    gc();
  });

  test("ws:// through HTTP proxy with auth", async () => {
    using recorded = await startRecordingProxy({ requireAuth: true });
    const ws = new WebSocket(`ws://127.0.0.1:${wsPort}`, {
      proxy: `http://proxy_user:proxy_pass@127.0.0.1:${recorded.port}`,
    } as ClientOptions);
    expect({ events: await wsEchoSession(ws, "hello with auth via ws"), requests: recorded.requests }).toEqual({
      events: echoed("hello with auth via ws"),
      requests: [connectRequest(wsPort, { "proxy-authorization": `Basic ${btoa("proxy_user:proxy_pass")}` })],
    });
    gc();
  });

  test("proxy auth failure returns error", async () => {
    using recorded = await startRecordingProxy({ requireAuth: true });
    const ws = new WebSocket(`ws://127.0.0.1:${wsPort}`, {
      proxy: `http://127.0.0.1:${recorded.port}`, // No auth provided
    } as ClientOptions);
    // The proxy answered 407 to a CONNECT without credentials.
    expect({ events: await wsFailingSession(ws), requests: recorded.requests }).toEqual({
      events: failed({ error: expect.stringMatching(/\b407\b/) }),
      requests: [connectRequest(wsPort)],
    });
    gc();
  });

  test("proxy wrong credentials returns error", async () => {
    using recorded = await startRecordingProxy({ requireAuth: true });
    const ws = new WebSocket(`ws://127.0.0.1:${wsPort}`, {
      proxy: `http://wrong_user:wrong_pass@127.0.0.1:${recorded.port}`,
    } as ClientOptions);
    // The credentials were sent, and the proxy answered 403.
    expect({ events: await wsFailingSession(ws), requests: recorded.requests }).toEqual({
      events: failed({ error: expect.stringMatching(/\b403\b/) }),
      requests: [connectRequest(wsPort, { "proxy-authorization": `Basic ${btoa("wrong_user:wrong_pass")}` })],
    });
    gc();
  });
});

describe("ws package wss:// through HTTP proxy (TLS tunnel)", () => {
  test("wss:// through HTTP proxy", async () => {
    using recorded = await startRecordingProxy();
    const ws = new WebSocket(`wss://127.0.0.1:${wssPort}`, {
      proxy: `http://127.0.0.1:${recorded.port}`,
      tls: { rejectUnauthorized: false }, // Trust self-signed cert
    } as ClientOptions);
    expect({ events: await wsEchoSession(ws, "hello via tls tunnel from ws"), requests: recorded.requests }).toEqual({
      events: echoed("hello via tls tunnel from ws"),
      requests: [connectRequest(wssPort)],
    });
    gc();
  });

  // "direct" is the reference.
  describe.concurrent.each(["direct", "http", "https"] as const)(
    "a corrupt TLS record right behind messages that came with the 101 (%s)",
    route => {
      const messages = ["m0", "m1", "m2"];
      const connect = (origin: { url: string; proxy?: string }) =>
        new WebSocket(origin.url, { proxy: origin.proxy, tls: { ca: tlsCerts.cert } } as ClientOptions);

      test.each([
        ["open", "send"],
        ["open", "close"],
        ["open", "pause"],
        ["message", "send"],
      ] as const)("the '%s' listener calls %s(): every message is still delivered", async (listener, method) => {
        await using origin = await startOriginWithCorruptRecord(route, messages);
        const ws = connect(origin);
        ws.once(listener, () => {
          if (method === "close") ws.close(1000);
          else if (method === "pause") ws.pause();
          else ws[method]("never sent");
        });
        expect(await wsEvents(ws)).toEqual([...messages, { close: [1006, Buffer.alloc(0)] }]);
      });

      test("the callback of a send() that could not be written gets an error", async () => {
        await using origin = await startOriginWithCorruptRecord(route, messages);
        const ws = connect(origin);
        const sent = Promise.withResolvers<Error | null | undefined>();
        ws.on("open", () => ws.send("never sent", sent.resolve));
        expect({ events: await wsEvents(ws), sent: await sent.promise }).toEqual({
          events: [...messages, { close: [1006, Buffer.alloc(0)] }],
          sent: expect.objectContaining({ code: "ERR_STREAM_DESTROYED" }),
        });
      });
    },
  );

  test.skipIf(!nodeExe())("a message sent during a TLS renegotiation arrives after it", async () => {
    await using origin = await startRenegotiatingWssServer("behind a message");
    // "renegotiating" and the request to renegotiate. The listener runs once the client has answered the request.
    const request = forwardRecordsTogether(2);
    // The end of the origin's handshake and "after renegotiation".
    const finished = forwardRecordsTogether(3, TLS_RECORD.changeCipherSpec);
    using recorded = await startRecordingProxy({
      onTargetData: (chunk, forward) => request.onTargetData(chunk, bytes => finished.onTargetData(bytes, forward)),
    });
    const ws = new WebSocket(`wss://127.0.0.1:${origin.port}`, {
      proxy: `http://127.0.0.1:${recorded.port}`,
      tls: { ca: tlsCerts.cert },
    } as ClientOptions);
    const events: unknown[] = [];
    ws.on("open", () => {
      request.hold();
      finished.hold();
      ws.send("ready");
    });
    ws.on("message", (data: Buffer) => {
      events.push(data.toString());
      if (data.toString() === "renegotiating") {
        ws.send("sent during the renegotiation", error => events.push({ error, queued: ws.bufferedAmount }));
        events.push({ queued: ws.bufferedAmount });
      }
      if (data.toString() === "sent during the renegotiation") ws.close(1000);
    });
    events.push(await once(ws, "close"));
    const { changeCipherSpec, handshake, applicationData } = TLS_RECORD;
    expect({
      events,
      request: request.forwarded[0].types,
      finished: finished.forwarded.map(({ types }) => types).filter(types => types.includes(changeCipherSpec)),
    }).toEqual({
      events: [
        "renegotiating",
        // The frame: a 2-byte header, the mask and the payload.
        { queued: 2 + 4 + "sent during the renegotiation".length },
        // As on a socket, what came in with the end of the handshake is delivered before the write is retried.
        "after renegotiation",
        { error: null, queued: 0 },
        "sent during the renegotiation",
        [1000, Buffer.alloc(0)],
      ],
      request: [applicationData, handshake],
      finished: [expect.arrayContaining([changeCipherSpec, handshake, applicationData])],
    });
  });
});

describe("ws package through HTTPS proxy (TLS proxy)", () => {
  test("ws:// through HTTPS proxy with CA certificate", async () => {
    using recorded = await startRecordingProxy({ tls: true });
    const ws = new WebSocket(`ws://127.0.0.1:${wsPort}`, {
      proxy: `https://127.0.0.1:${recorded.port}`,
      tls: { ca: tlsCerts.cert }, // Trust self-signed proxy cert
    } as ClientOptions);
    expect({ events: await wsEchoSession(ws, "hello via https proxy from ws"), requests: recorded.requests }).toEqual({
      events: echoed("hello via https proxy from ws"),
      requests: [connectRequest(wsPort)],
    });
    gc();
  });

  test("ws:// through HTTPS proxy with rejectUnauthorized: false", async () => {
    using recorded = await startRecordingProxy({ tls: true });
    const ws = new WebSocket(`ws://127.0.0.1:${wsPort}`, {
      proxy: `https://127.0.0.1:${recorded.port}`,
      tls: { rejectUnauthorized: false }, // Skip TLS verification for proxy
    } as ClientOptions);
    expect({
      events: await wsEchoSession(ws, "hello via https proxy no verify from ws"),
      requests: recorded.requests,
    }).toEqual({
      events: echoed("hello via https proxy no verify from ws"),
      requests: [connectRequest(wsPort)],
    });
    gc();
  });

  test("`proxy.tls: true` verifies the proxy with the defaults instead of `tls`", async () => {
    using recorded = await startRecordingProxy({ tls: true });
    const ws = new WebSocket(`ws://127.0.0.1:${wsPort}`, {
      proxy: { url: `https://127.0.0.1:${recorded.port}`, tls: true },
      tls: { rejectUnauthorized: false },
    } as ClientOptions);
    expect({ events: await wsFailingSession(ws), requests: recorded.requests }).toEqual({
      events: failed({ error: expect.any(String), code: "DEPTH_ZERO_SELF_SIGNED_CERT" }),
      requests: [],
    });
  });

  test("`proxy.tls` accepts `pfx` and `passphrase`, like `tls`", async () => {
    const read = (name: string) => readFileSync(path.join(import.meta.dirname, "../../node/test/fixtures/keys", name));
    using recorded = await startRecordingProxy({
      tls: true,
      tlsOptions: { requestCert: true, rejectUnauthorized: false, ca: read("ca1-cert.pem") },
    });
    const options = (passphrase: string) =>
      ({
        proxy: {
          url: `https://127.0.0.1:${recorded.port}`,
          tls: { ca: tlsCerts.cert, pfx: read("agent1.pfx"), passphrase },
        },
      }) as ClientOptions;
    const ws = new WebSocket(`ws://127.0.0.1:${wsPort}`, options("sample"));
    expect({ events: await wsEchoSession(ws, "hello"), clientCertificates: recorded.clientCertificates }).toEqual({
      events: echoed("hello"),
      clientCertificates: ["agent1"],
    });
    expect(() => new WebSocket(`ws://127.0.0.1:${wsPort}`, options("wrong"))).toThrow(/mac verif/i);
  });

  test("an own `pfx` in `proxy.tls` keeps the inherited options", async () => {
    const read = (name: string) => readFileSync(path.join(import.meta.dirname, "../../node/test/fixtures/keys", name));
    using recorded = await startRecordingProxy({
      tls: true,
      tlsOptions: { requestCert: true, rejectUnauthorized: false, ca: read("ca1-cert.pem") },
    });
    const connect = (inherited: object, own: object) =>
      wsEchoSession(
        new WebSocket(`ws://127.0.0.1:${wsPort}`, {
          proxy: {
            url: `https://127.0.0.1:${recorded.port}`,
            tls: Object.assign(Object.create(inherited), own, { pfx: read("agent1.pfx"), passphrase: "sample" }),
          },
        } as ClientOptions),
        "hello",
      );
    const ca = tlsCerts.cert;
    const pinned = Object.assign(new Error("pinned"), { code: "PINNED" });
    expect({
      ca: await connect({ ca }, {}),
      clientCertificates: [...recorded.clientCertificates],
      checkServerIdentity: await connect({ checkServerIdentity: () => pinned }, { ca }),
      serverName: await connect({ serverName: "other.example" }, { ca }),
    }).toEqual({
      ca: echoed("hello"),
      clientCertificates: ["agent1"],
      checkServerIdentity: failed({ error: "pinned", code: "PINNED" }),
      serverName: failed({ error: expect.any(String), code: "ERR_TLS_CERT_ALTNAME_INVALID" }),
    });
  });

  test("`proxy.tls` accepts a `pfx` and `passphrase` that it inherits or that a spread can't see", async () => {
    const read = (name: string) => readFileSync(path.join(import.meta.dirname, "../../node/test/fixtures/keys", name));
    using recorded = await startRecordingProxy({
      tls: true,
      tlsOptions: { requestCert: true, rejectUnauthorized: false, ca: read("ca1-cert.pem") },
    });
    const connect = (tls: object) =>
      wsEchoSession(
        new WebSocket(`ws://127.0.0.1:${wsPort}`, {
          proxy: { url: `https://127.0.0.1:${recorded.port}`, tls },
        } as ClientOptions),
        "hello",
      );
    const ca = tlsCerts.cert;
    const pfx = read("agent1.pfx");
    expect({
      inherited: await connect(Object.assign(Object.create({ pfx, passphrase: "sample" }), { ca })),
      nonEnumerable: await connect(
        Object.defineProperties({ ca }, { pfx: { value: pfx }, passphrase: { value: "sample" } }),
      ),
      clientCertificates: recorded.clientCertificates,
    }).toEqual({
      inherited: echoed("hello"),
      nonEnumerable: echoed("hello"),
      clientCertificates: ["agent1", "agent1"],
    });
  });

  test.concurrent(
    "`proxy.tls` ignores a `pfx` set on Object.prototype",
    async () => {
      const keys = path.join(import.meta.dirname, "../../node/test/fixtures/keys");
      using recorded = await startRecordingProxy({
        tls: true,
        tlsOptions: { requestCert: true, rejectUnauthorized: false, ca: readFileSync(path.join(keys, "ca1-cert.pem")) },
      });
      const { lines, exitCode } = await runClientScript(
        `
        const { TARGET, PROXY, PROXY_CA, PFX } = process.env;
        Object.prototype.pfx = require("fs").readFileSync(PFX);
        Object.prototype.passphrase = "sample";
        console.log(await connect(TARGET, { proxy: { url: PROXY, tls: { ca: PROXY_CA } } }));
      `,
        {
          TARGET: `ws://127.0.0.1:${wsPort}`,
          PROXY: `https://127.0.0.1:${recorded.port}`,
          PROXY_CA: tlsCerts.cert,
          PFX: path.join(keys, "agent1.pfx"),
        },
      );
      expect({ lines, clientCertificates: recorded.clientCertificates }).toEqual({
        lines: ["connected"],
        clientCertificates: [null],
      });
      expect(exitCode).toBe(0);
    },
    scriptTimeout,
  );

  test("ws:// through HTTPS proxy fails without CA certificate", async () => {
    using recorded = await startRecordingProxy({ tls: true });
    const ws = new WebSocket(`ws://127.0.0.1:${wsPort}`, {
      proxy: `https://127.0.0.1:${recorded.port}`,
      // No CA certificate: the proxy's self-signed certificate is not trusted.
    } as ClientOptions);
    // The client reached the proxy and gave up inside the TLS handshake, before any CONNECT.
    expect({
      events: await wsFailingSession(ws),
      connections: recorded.connections,
      requests: recorded.requests,
    }).toEqual({
      events: failed({ error: expect.any(String), code: "DEPTH_ZERO_SELF_SIGNED_CERT" }),
      connections: 1,
      requests: [],
    });
    gc();
  });
});

// Bun doesn't call the agent. It reads the agent's proxy URL, headers and options and sends its own CONNECT.
describe("ws package with HttpsProxyAgent", () => {
  test("ws:// through HttpsProxyAgent", async () => {
    using recorded = await startRecordingProxy();
    const agent = new HttpsProxyAgent(`http://127.0.0.1:${recorded.port}`);
    const ws = new WebSocket(`ws://127.0.0.1:${wsPort}`, { agent });
    expect({
      events: await wsEchoSession(ws, "hello from ws via HttpsProxyAgent"),
      requests: recorded.requests,
    }).toEqual({
      events: echoed("hello from ws via HttpsProxyAgent"),
      requests: [connectRequest(wsPort)],
    });
    gc();
  });

  test("wss:// through HttpsProxyAgent with rejectUnauthorized", async () => {
    using recorded = await startRecordingProxy();
    const agent = new HttpsProxyAgent(`http://127.0.0.1:${recorded.port}`);
    const ws = new WebSocket(`wss://127.0.0.1:${wssPort}`, { agent, rejectUnauthorized: false });
    expect({
      events: await wsEchoSession(ws, "hello from wss via HttpsProxyAgent"),
      requests: recorded.requests,
    }).toEqual({
      events: echoed("hello from wss via HttpsProxyAgent"),
      requests: [connectRequest(wssPort)],
    });
    gc();
  });

  test("HttpsProxyAgent with authentication", async () => {
    using recorded = await startRecordingProxy({ requireAuth: true });
    const agent = new HttpsProxyAgent(`http://proxy_user:proxy_pass@127.0.0.1:${recorded.port}`);
    const ws = new WebSocket(`ws://127.0.0.1:${wsPort}`, { agent });
    expect({
      events: await wsEchoSession(ws, "hello from ws with auth via HttpsProxyAgent"),
      requests: recorded.requests,
    }).toEqual({
      events: echoed("hello from ws with auth via HttpsProxyAgent"),
      requests: [connectRequest(wsPort, { "proxy-authorization": `Basic ${btoa("proxy_user:proxy_pass")}` })],
    });
    gc();
  });

  // https-proxy-agent overwrites the header with the URL's credentials. In Bun's own `proxy` option the header wins, as
  // in fetch().
  describe("credentials in the proxy URL and a Proxy-Authorization header", () => {
    const valid = "proxy_user:proxy_pass";
    const basic = (credentials: string) => `Basic ${btoa(credentials)}`;

    type Row = { where: string; winner: string; options(port: number): ClientOptions; kept?: Record<string, string> };

    /** What `new (require("hpagent").HttpProxyAgent)({ proxy, proxyRequestOptions })` has. */
    const hpagent = (proxy: string, proxyRequestOptions: http.RequestOptions) =>
      Object.assign(new http.Agent(), { proxy: new URL(proxy), proxyRequestOptions });

    test.each<Row>([
      ...["Proxy-Authorization", "proxy-authorization"].map(name => ({
        where: `\`${name}\` on an HttpsProxyAgent`,
        winner: "the URL's credentials",
        options: (port: number) => ({
          agent: new HttpsProxyAgent(`http://${valid}@127.0.0.1:${port}`, {
            headers: { [name]: basic("other:other") },
          }),
        }),
      })),
      {
        where: "`Proxy-Authorization` in hpagent's `proxyRequestOptions.headers`",
        winner: "the URL's credentials and the other headers",
        options: port => ({
          agent: hpagent(`http://${valid}@127.0.0.1:${port}`, {
            headers: { "Proxy-Authorization": basic("other:other"), "X-Kept": "yes" },
          }),
        }),
        kept: { "x-kept": "yes" },
      },
      {
        where: "no credentials in the URL and `proxy-authorization` in hpagent's `proxyRequestOptions.headers`",
        winner: "the header",
        options: port => ({
          agent: hpagent(`http://127.0.0.1:${port}`, { headers: { "proxy-authorization": basic(valid) } }),
        }),
      },
      // Bun-only: https-proxy-agent itself can't read a Headers object.
      {
        where: "a Headers object on an HttpsProxyAgent",
        winner: "the URL's credentials and the other headers",
        options: port => ({
          agent: new HttpsProxyAgent(`http://${valid}@127.0.0.1:${port}`, {
            headers: new Headers({ "Proxy-Authorization": basic("other:other"), "X-Kept": "yes" }) as {},
          }),
        }),
        kept: { "x-kept": "yes" },
      },
      {
        where: "`Proxy-Authorization` in the `proxy` option",
        winner: "the header",
        options: port => ({
          proxy: { url: `http://other:other@127.0.0.1:${port}`, headers: { "Proxy-Authorization": basic(valid) } },
        }),
      },
    ])("$where: sends $winner", async ({ options, kept }) => {
      using recorded = await startRecordingProxy({ requireAuth: true });
      const ws = new WebSocket(`ws://127.0.0.1:${wsPort}`, options(recorded.port));
      expect({ events: await wsEchoSession(ws, "hello"), requests: recorded.requests }).toEqual({
        events: echoed("hello"),
        requests: [connectRequest(wsPort, { "proxy-authorization": basic(valid), ...kept })],
      });
    });
  });

  test("HttpsProxyAgent with agent.proxy as URL object", async () => {
    using recorded = await startRecordingProxy();
    // HttpsProxyAgent stores the proxy URL as a URL object in agent.proxy
    const agent = new HttpsProxyAgent(`http://127.0.0.1:${recorded.port}`);
    expect(agent.proxy).toBeInstanceOf(URL);
    expect(agent.proxy.href).toBe(`http://127.0.0.1:${recorded.port}/`);

    const ws = new WebSocket(`ws://127.0.0.1:${wsPort}`, { agent });
    expect({ events: await wsEchoSession(ws, "hello via agent with URL object"), requests: recorded.requests }).toEqual(
      {
        events: echoed("hello via agent with URL object"),
        requests: [connectRequest(wsPort)],
      },
    );
    gc();
  });

  test("explicit proxy option takes precedence over agent", async () => {
    using agentProxy = await startRecordingProxy();
    using explicitProxy = await startRecordingProxy();
    const agent = new HttpsProxyAgent(`http://127.0.0.1:${agentProxy.port}`);
    const ws = new WebSocket(`ws://127.0.0.1:${wsPort}`, {
      agent,
      proxy: `http://127.0.0.1:${explicitProxy.port}`, // This should take precedence
    } as ClientOptions);
    expect({
      events: await wsEchoSession(ws, "explicit proxy wins"),
      explicitRequests: explicitProxy.requests,
      agentConnections: agentProxy.connections,
    }).toEqual({
      events: echoed("explicit proxy wins"),
      explicitRequests: [connectRequest(wsPort)],
      agentConnections: 0,
    });
    gc();
  });
});

// The proxy is the only host the client looks up and connects to. Expected values are from Node v26.3.0 with ws 8.18.3
// and https-proxy-agent 7.0.6.
describe("'error' when the proxy can't be reached", () => {
  // getaddrinfo rejects DNS labels longer than 63 bytes without sending a query.
  const unresolvable = (name: string) => `${Buffer.alloc(64, "a")}.${name}.invalid`;
  const details = ({ message, code, syscall, address, port, hostname }: any): object =>
    ({ message, code, syscall, address, port, hostname }); // prettier-ignore
  const refused = (port: number) => ({
    message: `connect ECONNREFUSED 127.0.0.1:${port}`,
    code: "ECONNREFUSED",
    syscall: "connect",
    address: "127.0.0.1",
    port,
  });

  async function connectError(url: string, options: ClientOptions) {
    return details((await nextEvent(new WebSocket(url, options), "error"))[0]);
  }

  describe.each<[how: string, options: (proxy: string) => ClientOptions]>([
    ["an HttpsProxyAgent", proxy => ({ agent: new HttpsProxyAgent(proxy) })],
    ["the `proxy` option as a string", proxy => ({ proxy })],
    ["the `proxy` option as an object", proxy => ({ proxy: { url: proxy } })],
  ])("with %s", (_, options) => {
    test.each([
      { proxy: "http", target: "ws" },
      { proxy: "https", target: "wss" },
    ])("names an $proxy: proxy that refuses the connection", async ({ proxy, target }) => {
      const port = await closedPort();
      expect(
        await connectError(`${target}://${unresolvable("target")}:7777`, options(`${proxy}://127.0.0.1:${port}`)),
      ).toEqual(refused(port));
    });

    test("names a proxy whose hostname doesn't resolve", async () => {
      const hostname = unresolvable("proxy");
      expect(await connectError(`ws://${unresolvable("target")}:7777`, options(`http://${hostname}:9`))).toEqual({
        message: `getaddrinfo ENOTFOUND ${hostname}`,
        code: "ENOTFOUND",
        syscall: "getaddrinfo",
        hostname,
      });
    });
  });

  // For example, a program that reuses one options object and rotates its proxies.
  test.concurrent(
    "names the proxy that was dialled, even if the caller has changed `proxy.url` since",
    async () => {
      const port = await closedPort();
      const { lines, exitCode } = await runClientScript(
        `
        process.on("uncaughtException", () => process.exit(1));
        const changes = [
          proxy => delete proxy.url,
          proxy => (proxy.url = ""),
          proxy => (proxy.url = undefined),
          proxy => (proxy.url = process.env.OTHER_PROXY),
        ];
        for (const change of changes) {
          const proxy = { url: process.env.PROXY };
          const ws = new WebSocket(process.env.TARGET, { proxy });
          change(proxy);
          ws.on("error", error => console.log("error " + error.message));
          await new Promise(resolve => ws.on("close", resolve));
        }
      `,
        {
          TARGET: `ws://${unresolvable("target")}:7777`,
          PROXY: `http://127.0.0.1:${port}`,
          OTHER_PROXY: `http://${unresolvable("other")}:9`,
        },
      );
      expect(lines).toEqual(Array(4).fill(`error connect ECONNREFUSED 127.0.0.1:${port}`));
      expect(exitCode).toBe(0);
    },
    scriptTimeout,
  );

  test.concurrent(
    "names the target when NO_PROXY bypasses the proxy",
    async () => {
      const port = await closedPort();
      const { lines, exitCode } = await runClientScript(
        `
        const ws = new WebSocket(process.env.TARGET, { proxy: process.env.PROXY });
        ws.on("error", error => console.log(JSON.stringify((${details})(error))));
      `,
        // Both spellings: they are one variable on Windows, and runClientScript() clears both.
        {
          NO_PROXY: "127.0.0.1",
          no_proxy: "127.0.0.1",
          TARGET: `ws://127.0.0.1:${port}`,
          PROXY: `http://${unresolvable("proxy")}:9`,
        },
      );
      expect(lines.map(line => JSON.parse(line))).toEqual([refused(port)]);
      expect(exitCode).toBe(0);
    },
    scriptTimeout,
  );
});

// npm ws passes its TLS options to the agent, which uses them for the target. The agent uses its own options to connect
// to the proxy. Expected values are from Node v26.3.0 with ws 8.18.3 and https-proxy-agent 7.0.6.
describe("TLS options with an HttpsProxyAgent", () => {
  const fixture = (name: string) =>
    readFileSync(path.join(import.meta.dirname, "../../node/http/fixtures", name), "utf8");
  // The proxy's certificate is self-signed and the target's is issued by a private CA, so the error code tells which of
  // the two was rejected.
  const proxyCa = tlsCerts.cert;
  const targetCa = fixture("openssl_localhost_ca.pem");
  const proxyRejected = failed({ error: expect.any(String), code: "DEPTH_ZERO_SELF_SIGNED_CERT" });
  const targetRejected = failed({ error: expect.any(String), code: "UNABLE_TO_VERIFY_LEAF_SIGNATURE" });
  const off = { rejectUnauthorized: false };
  type TrustOptions = Pick<ConnectionOptions, "ca" | "rejectUnauthorized">;

  let secureTarget: Bun.Server<undefined>;

  beforeAll(() => {
    secureTarget = Bun.serve({
      port: 0,
      tls: { cert: fixture("openssl_localhost.crt"), key: fixture("openssl_localhost.key") },
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

  const portOf = (target: "ws" | "wss") => (target === "wss" ? secureTarget.port! : wsPort);

  /**
   * The client's events, the CONNECT requests that reached the proxy, and the transport of a connection that opened.
   * The native client's `_socket` isn't a real socket.
   */
  async function connect(proxy: "http" | "https", target: "ws" | "wss", options: (proxyUrl: string) => ClientOptions) {
    using recorded = await startRecordingProxy({ tls: proxy === "https" });
    const url = `${target}://127.0.0.1:${portOf(target)}`;
    const ws = new WebSocket(url, options(`${proxy}://127.0.0.1:${recorded.port}`));
    let transport = null as "native" | "stream" | null;
    ws.on("open", () => {
      transport = (ws as any)._socket instanceof net.Socket ? "stream" : "native";
    });
    const events = await wsEchoSession(ws, "hello");
    return { events, requests: recorded.requests, transport };
  }

  // What connect() returns. `connectRequest()` is the native client's CONNECT. The agent's own has other headers.
  const rejectedProxy = { events: proxyRejected, requests: [], transport: null };
  const rejectedTarget = () => ({ events: targetRejected, requests: [connectRequest(portOf("wss"))], transport: null });
  const opened = (target: "ws" | "wss") => ({
    events: echoed("hello"),
    requests: [connectRequest(portOf(target))],
    transport: "native" as const,
  });

  describe.each([
    { proxy: "http", target: "wss" },
    { proxy: "https", target: "ws" },
    { proxy: "https", target: "wss" },
  ] as const)("$proxy: proxy, $target: target", ({ proxy, target }) => {
    test.each<[options: string, agent: TrustOptions, ws: TrustOptions, trusted: ("proxy" | "target")[]]>([
      ["no options", {}, {}, []],
      ["agent rejectUnauthorized: false", off, {}, ["proxy"]],
      ["WebSocket rejectUnauthorized: false", {}, off, ["target"]],
      ["both rejectUnauthorized: false", off, off, ["proxy", "target"]],
      ["agent ca for the proxy", { ca: proxyCa }, {}, ["proxy"]],
      ["agent ca for the target", { ca: targetCa }, {}, []],
      ["WebSocket ca for the proxy", {}, { ca: proxyCa }, []],
      ["WebSocket ca for the target", {}, { ca: targetCa }, ["target"]],
      ["agent ca for the proxy, WebSocket ca for the target", { ca: proxyCa }, { ca: targetCa }, ["proxy", "target"]],
    ])("%s", async (_, agent, ws, trusted) => {
      expect(await connect(proxy, target, url => ({ agent: new HttpsProxyAgent(url, agent), ...ws }))).toEqual(
        proxy === "https" && !trusted.includes("proxy")
          ? rejectedProxy
          : target === "wss" && !trusted.includes("target")
            ? rejectedTarget()
            : opened(target),
      );
    });
  });

  // Bun-only: npm ws has no `tls` option.
  test("the `tls` option replaces the agent's options and applies to the proxy and the target", async () => {
    expect({
      trusted: await connect("https", "wss", url => ({
        agent: new HttpsProxyAgent(url),
        tls: { ca: [proxyCa, targetCa] },
      })),
      proxyOnly: await connect("https", "wss", url => ({ agent: new HttpsProxyAgent(url, off), tls: { ca: proxyCa } })),
      targetOnly: await connect("https", "wss", url => ({
        agent: new HttpsProxyAgent(url, off),
        tls: { ca: targetCa },
      })),
    }).toEqual({
      trusted: opened("wss"),
      proxyOnly: rejectedTarget(),
      targetOnly: rejectedProxy,
    });
  });

  // Bun-only: Node ignores `proxy` on an agent that doesn't implement it. hpagent calls it `proxyRequestOptions`.
  test.each(["connectOpts", "proxyRequestOptions"])(
    "`%s` of an agent that can't connect on its own only applies to the proxy",
    async name => {
      const agent = (proxy: string, options: TrustOptions) =>
        Object.assign(new http.Agent(), { proxy, [name]: options });
      expect({
        http: await connect("http", "wss", url => ({ agent: agent(url, off) })),
        https: await connect("https", "wss", url => ({ agent: agent(url, off) })),
        empty: await connect("https", "wss", url => ({ agent: agent(url, {}), ...off })),
        trusted: await connect("https", "wss", url => ({ agent: agent(url, { ca: proxyCa }), ca: targetCa })),
      }).toEqual({
        http: rejectedTarget(),
        https: rejectedTarget(),
        empty: rejectedProxy,
        trusted: opened("wss"),
      });
    },
  );

  // Bun can't tell where such an agent keeps its options for the proxy.
  test("without `connectOpts`, the WebSocket's and the agent's options apply to the proxy and the target", async () => {
    const agent = (proxy: string, options?: TrustOptions) => Object.assign(new https.Agent(options), { proxy });
    const both = { ca: [proxyCa, targetCa] };
    expect({
      none: await connect("https", "wss", url => ({ agent: agent(url) })),
      off: await connect("https", "wss", url => ({ agent: agent(url), ...off })),
      both: await connect("https", "wss", url => ({ agent: agent(url), ...both })),
      agentOptions: await connect("https", "wss", url => ({ agent: agent(url, both) })),
      proxyOnly: await connect("https", "wss", url => ({ agent: agent(url), ca: proxyCa })),
      targetOnly: await connect("https", "wss", url => ({ agent: agent(url), ca: targetCa })),
    }).toEqual({
      none: rejectedProxy,
      off: opened("wss"),
      both: opened("wss"),
      agentOptions: opened("wss"),
      proxyOnly: rejectedTarget(),
      targetOnly: rejectedProxy,
    });
  });

  test("an agent's `servername` and `checkServerIdentity` apply to the proxy", async () => {
    const checked: string[] = [];
    const pinned = Object.assign(new Error("pinned"), { code: "PINNED" });
    const withAgent = async (options: ConnectionOptions) => {
      const agent = (url: string) => new HttpsProxyAgent(url, { ca: proxyCa, ...options });
      const { events, transport } = await connect("https", "ws", url => ({ agent: agent(url) }));
      return { events, transport };
    };
    expect({
      servername: await withAgent({ servername: "localhost" }),
      otherName: await withAgent({ servername: "other.example" }),
      accepts: await withAgent({ checkServerIdentity: hostname => void checked.push(hostname) }),
      rejects: await withAgent({ checkServerIdentity: () => pinned }),
      checked,
    }).toEqual({
      servername: { events: echoed("hello"), transport: "native" },
      otherName: {
        events: failed({ error: expect.any(String), code: "ERR_TLS_CERT_ALTNAME_INVALID" }),
        transport: null,
      },
      accepts: { events: echoed("hello"), transport: "native" },
      rejects: { events: failed({ error: "pinned", code: "PINNED" }), transport: null },
      checked: ["127.0.0.1"],
    });
  });

  test("both `checkServerIdentity` callbacks keep the AsyncLocalStorage store of the `new WebSocket()` call", async () => {
    const storage = new AsyncLocalStorage<string>();
    const stores: Record<string, string | undefined> = {};
    // @types/ws declares a boolean result.
    const record = (hop: string) => (): any => void (stores[hop] = storage.getStore());
    const result = await storage.run("the caller's", () =>
      connect("https", "wss", url => ({
        agent: new HttpsProxyAgent(url, { ca: proxyCa, checkServerIdentity: record("proxy") }),
        ca: targetCa,
        checkServerIdentity: record("target"),
      })),
    );
    expect({ result, stores }).toEqual({
      result: opened("wss"),
      stores: { proxy: "the caller's", target: "the caller's" },
    });
  });

  test.concurrent(
    "with NODE_TLS_REJECT_UNAUTHORIZED=0, the ignored verdict on the proxy isn't reported when the target is rejected",
    async () => {
      using recorded = await startRecordingProxy({ tls: true });
      const { lines, exitCode } = await runClientScript(
        `
        const { HttpsProxyAgent } = require(process.env.HTTPS_PROXY_AGENT);
        const { PROXY, PROXY_CA, TARGET, TARGET_CA } = process.env;
        const agent = new HttpsProxyAgent(PROXY, {
          ca: PROXY_CA,
          checkServerIdentity: () => Object.assign(new Error("pinned"), { code: "PINNED" }),
        });
        console.log(await connect(TARGET, { agent, ca: TARGET_CA, rejectUnauthorized: true, servername: "other.example" }));
      `,
        {
          NODE_TLS_REJECT_UNAUTHORIZED: "0",
          HTTPS_PROXY_AGENT: require.resolve("https-proxy-agent"),
          PROXY: `https://127.0.0.1:${recorded.port}`,
          PROXY_CA: proxyCa,
          TARGET: `wss://127.0.0.1:${portOf("wss")}`,
          TARGET_CA: targetCa,
        },
      );
      expect({ lines, requests: recorded.requests }).toEqual({
        lines: ["error ERR_TLS_CERT_ALTNAME_INVALID"],
        requests: [connectRequest(portOf("wss"))],
      });
      expect(exitCode).toBe(0);
    },
    scriptTimeout,
  );
});
