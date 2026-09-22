import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { gc, tls as tlsCerts } from "harness";
import type { HttpsProxyAgent as HttpsProxyAgentType } from "https-proxy-agent";
import WebSocket from "ws";
import {
  type ClientEvent,
  connectRequest,
  echoed,
  failed,
  startEchoServer,
  startRecordingProxy,
} from "../../web/websocket/proxy-test-utils";

// Use dynamic require to avoid linter removing the import
const { HttpsProxyAgent } = require("https-proxy-agent") as {
  HttpsProxyAgent: typeof HttpsProxyAgentType;
};

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
  wsPort = wsServer.port;
  wssServer = startEchoServer({ tls: true });
  wssPort = wssServer.port;
});

afterAll(() => {
  wsServer?.stop(true);
  wssServer?.stop(true);
  if (prevNoProxy !== undefined) process.env.NO_PROXY = prevNoProxy;
  if (prevNoProxyLower !== undefined) process.env.no_proxy = prevNoProxyLower;
});

/**
 * `clientEvents` for the ws package client, which reports through its
 * EventEmitter API: messages as Buffers, and wasClean as a third close argument.
 */
function wsEvents(ws: WebSocket): Promise<ClientEvent[]> {
  const events: ClientEvent[] = [];
  const { promise, resolve } = Promise.withResolvers<ClientEvent[]>();
  ws.on("message", (data: Buffer) => {
    events.push(data.toString());
  });
  ws.on("error", (err: Error) => {
    events.push({ error: err.message });
  });
  ws.on("close", (code: number, reason: Buffer, wasClean?: boolean) => {
    events.push({ code, reason: String(reason), wasClean: wasClean === true });
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

describe("ws package proxy API", () => {
  // These checks only exercise the constructor. close() follows at once, so
  // nothing needs to listen on the proxy port.
  const proxyPort = 1;

  test("accepts proxy option as string (HTTP proxy)", () => {
    const ws = new WebSocket("ws://example.com", {
      proxy: `http://127.0.0.1:${proxyPort}`,
    });
    expect(ws.readyState).toBe(WebSocket.CONNECTING);
    ws.close();
  });

  test("accepts proxy option as string (HTTPS proxy)", () => {
    const ws = new WebSocket("ws://example.com", {
      proxy: `https://127.0.0.1:${proxyPort}`,
      tls: { rejectUnauthorized: false },
    });
    expect(ws.readyState).toBe(WebSocket.CONNECTING);
    ws.close();
  });

  test("accepts proxy option with object containing url", () => {
    const ws = new WebSocket("ws://example.com", {
      proxy: { url: `http://127.0.0.1:${proxyPort}` },
    });
    expect(ws.readyState).toBe(WebSocket.CONNECTING);
    ws.close();
  });

  test("accepts proxy URL with credentials", () => {
    const ws = new WebSocket("ws://example.com", {
      proxy: `http://user:pass@127.0.0.1:${proxyPort}`,
    });
    expect(ws.readyState).toBe(WebSocket.CONNECTING);
    ws.close();
  });

  test("can combine proxy with headers and protocols", () => {
    const ws = new WebSocket("ws://example.com", ["graphql-ws"], {
      proxy: `http://127.0.0.1:${proxyPort}`,
      headers: { Authorization: "Bearer token" },
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
});

describe("ws package through HTTP CONNECT proxy", () => {
  test("ws:// through HTTP proxy", async () => {
    using recorded = await startRecordingProxy();
    const ws = new WebSocket(`ws://127.0.0.1:${wsPort}`, {
      proxy: `http://127.0.0.1:${recorded.port}`,
    });
    expect({ events: await wsEchoSession(ws, "hello from ws client"), requests: recorded.requests }).toEqual({
      events: echoed("hello from ws client"),
      requests: [connectRequest(wsPort)],
    });
    gc();
  });

  test("ws:// through HTTP proxy with auth", async () => {
    using recorded = await startRecordingProxy({ requireAuth: true });
    const ws = new WebSocket(`ws://127.0.0.1:${wsPort}`, {
      proxy: `http://proxy_user:proxy_pass@127.0.0.1:${recorded.port}`,
    });
    expect({ events: await wsEchoSession(ws, "hello with auth via ws"), requests: recorded.requests }).toEqual({
      events: echoed("hello with auth via ws"),
      requests: [connectRequest(wsPort, { "proxy-authorization": `Basic ${btoa("proxy_user:proxy_pass")}` })],
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
    expect({ events: await wsFailingSession(ws), requests: recorded.requests }).toEqual({
      events: failed(url, "Proxy connection failed", 1006),
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
    expect({ events: await wsFailingSession(ws), requests: recorded.requests }).toEqual({
      events: failed(url, "Proxy connection failed", 1006),
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
    });
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
    });
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
    });
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
    const url = `ws://127.0.0.1:${wsPort}`;
    const ws = new WebSocket(url, {
      proxy: `https://127.0.0.1:${recorded.port}`,
      // No CA certificate: the proxy's self-signed certificate is not trusted.
    });
    // The client reached the proxy and gave up inside the TLS handshake, before any CONNECT.
    expect({
      events: await wsFailingSession(ws),
      connections: recorded.connections,
      requests: recorded.requests,
    }).toEqual({
      events: failed(url, "TLS handshake failed", 1015),
      connections: 1,
      requests: [],
    });
    gc();
  });
});

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
    const agent = new HttpsProxyAgent(`http://127.0.0.1:${recorded.port}`, {
      rejectUnauthorized: false,
    });
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
    });
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
