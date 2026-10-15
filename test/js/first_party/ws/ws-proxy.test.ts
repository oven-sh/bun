import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { gc, tls as tlsCerts } from "harness";
import type { HttpsProxyAgent as HttpsProxyAgentType } from "https-proxy-agent";
import { getEventListeners, once } from "node:events";
import type { IncomingMessage } from "node:http";
import net from "node:net";
import WebSocket from "ws";
import { connectRequest, startEchoServer, startRecordingProxy } from "../../web/websocket/proxy-test-utils";

// Use dynamic require to avoid linter removing the import
const { HttpsProxyAgent } = require("https-proxy-agent") as {
  HttpsProxyAgent: typeof HttpsProxyAgentType;
};

// Bun's `ws` also takes the `proxy` and `tls` options of Bun's own WebSocket. npm ws has neither.
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

/** Every message, the message and code of every Error, and the arguments of 'close', which ends the list. */
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

/** The echo server greets first, echoes the message, then answers the client's Close frame. */
function echoed(message: string): ClientEvent[] {
  return ["connected", message, { close: [1000, Buffer.alloc(0)] }];
}

/** A handshake that failed: one Error, then 'close'. */
function failed(error: { error: unknown; code?: string }): ClientEvent[] {
  return [error, { close: [1006, Buffer.alloc(0)] }];
}

/** close() while CONNECTING emits 'error'. */
function abandon(ws: WebSocket) {
  ws.on("error", () => {});
  ws.close();
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
    abandon(ws);
  });

  test("accepts proxy option as string (HTTPS proxy)", () => {
    const ws = new WebSocket("ws://example.com", {
      proxy: `https://127.0.0.1:${proxyPort}`,
      tls: { rejectUnauthorized: false },
    } as ClientOptions);
    expect(ws.readyState).toBe(WebSocket.CONNECTING);
    abandon(ws);
  });

  test("accepts proxy option with object containing url", () => {
    const ws = new WebSocket("ws://example.com", {
      proxy: { url: `http://127.0.0.1:${proxyPort}` },
    } as ClientOptions);
    expect(ws.readyState).toBe(WebSocket.CONNECTING);
    abandon(ws);
  });

  test("accepts proxy URL with credentials", () => {
    const ws = new WebSocket("ws://example.com", {
      proxy: `http://user:pass@127.0.0.1:${proxyPort}`,
    } as ClientOptions);
    expect(ws.readyState).toBe(WebSocket.CONNECTING);
    abandon(ws);
  });

  test("can combine proxy with headers and protocols", () => {
    const ws = new WebSocket("ws://example.com", ["graphql-ws"], {
      proxy: `http://127.0.0.1:${proxyPort}`,
      headers: { Authorization: "Bearer token" },
    } as ClientOptions);
    expect(ws.readyState).toBe(WebSocket.CONNECTING);
    abandon(ws);
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

  // Through a proxy the native client dials, so `signal` is not node:http's to look after. A signal may live much
  // longer than the dials it was given to.
  describe("the `signal` option", () => {
    const refusing = () =>
      Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("no", { status: 503 }) });

    test("abort() while CONNECTING: an AbortError, then 'close' 1006", async () => {
      using recorded = await startRecordingProxy();
      // Accepts the tunnel and never answers the upgrade request.
      const silent = net.createServer(() => {}).listen(0, "127.0.0.1");
      await once(silent, "listening");
      try {
        const controller = new AbortController();
        const ws = new WebSocket(`ws://127.0.0.1:${(silent.address() as net.AddressInfo).port}`, {
          proxy: `http://127.0.0.1:${recorded.port}`,
          signal: controller.signal,
        } as ClientOptions);
        const events = wsEvents(ws);
        await once(silent, "connection");
        controller.abort(new Error("why"));
        expect(await events).toEqual([
          { error: "The operation was aborted", code: "ABORT_ERR" },
          { close: [1006, Buffer.alloc(0)] },
        ]);
        expect(getEventListeners(controller.signal, "abort")).toEqual([]);
      } finally {
        silent.close();
      }
    });

    test.each(["'open'", "'unexpected-response'", "'error'", "a constructor that throws"])(
      "nothing is left on the signal after %s",
      async outcome => {
        using recorded = await startRecordingProxy();
        using target = refusing();
        const { signal } = new AbortController();
        const port = outcome === "'open'" ? wsPort : target.port;
        const options = {
          proxy: `http://127.0.0.1:${recorded.port}`,
          signal,
          headers: outcome === "a constructor that throws" ? { "X-Bad": "a\r\nb" } : {},
        } as ClientOptions;
        if (outcome === "a constructor that throws") {
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

  test("ws:// through HTTP proxy when finishRequest calls req.end() later", async () => {
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

// Bun does not call the agent. It reads the proxy URL, headers and options from it and sends its own CONNECT.
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

  // Not npm ws's behaviour: there the agent's own options reach the proxy only, and the target is refused.
  test("wss:// through HttpsProxyAgent with rejectUnauthorized", async () => {
    using recorded = await startRecordingProxy();
    const agent = new HttpsProxyAgent(`http://127.0.0.1:${recorded.port}`, {
      rejectUnauthorized: false,
    } as any);
    const ws = new WebSocket(`wss://127.0.0.1:${wssPort}`, { agent });
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
