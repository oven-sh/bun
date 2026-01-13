import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { gc, tls as tlsCerts } from "harness";
import type { HttpsProxyAgent as HttpsProxyAgentType } from "https-proxy-agent";
import net from "net";
import tls from "tls";
import WebSocket from "ws";
import { createConnectProxy, createTLSConnectProxy, startProxy } from "../../web/websocket/proxy-test-utils";

// Use dynamic require to avoid linter removing the import
const { HttpsProxyAgent } = require("https-proxy-agent") as {
  HttpsProxyAgent: typeof HttpsProxyAgentType;
};

// HTTP CONNECT proxy server for WebSocket tunneling
let proxy: net.Server;
let authProxy: net.Server;
let httpsProxy: tls.Server;
let wsServer: ReturnType<typeof Bun.serve>;
let wssServer: ReturnType<typeof Bun.serve>;
let proxyPort: number;
let authProxyPort: number;
let httpsProxyPort: number;
let wsPort: number;
let wssPort: number;

beforeAll(async () => {
  // Create HTTP CONNECT proxy
  proxy = createConnectProxy();
  proxyPort = await startProxy(proxy);

  // Create HTTP CONNECT proxy with auth
  authProxy = createConnectProxy({ requireAuth: true });
  authProxyPort = await startProxy(authProxy);

  // Create HTTPS CONNECT proxy
  httpsProxy = createTLSConnectProxy();
  httpsProxyPort = await startProxy(httpsProxy);

  // Create WebSocket echo server
  wsServer = Bun.serve({
    port: 0,
    fetch(req, server) {
      if (server.upgrade(req)) {
        return;
      }
      return new Response("Expected WebSocket", { status: 400 });
    },
    websocket: {
      message(ws, message) {
        // Echo back
        ws.send(message);
      },
      open(ws) {
        ws.send("connected");
      },
    },
  });
  wsPort = wsServer.port;

  // Create secure WebSocket echo server (wss://)
  wssServer = Bun.serve({
    port: 0,
    tls: {
      key: tlsCerts.key,
      cert: tlsCerts.cert,
    },
    fetch(req, server) {
      if (server.upgrade(req)) {
        return;
      }
      return new Response("Expected WebSocket", { status: 400 });
    },
    websocket: {
      message(ws, message) {
        // Echo back
        ws.send(message);
      },
      open(ws) {
        ws.send("connected");
      },
    },
  });
  wssPort = wssServer.port;
});

afterAll(() => {
  proxy?.close();
  authProxy?.close();
  httpsProxy?.close();
  wsServer?.stop(true);
  wssServer?.stop(true);
});

describe("ws package proxy API", () => {
  test("accepts proxy option as string (HTTP proxy)", () => {
    const ws = new WebSocket("ws://example.com", {
      proxy: `http://127.0.0.1:${proxyPort}`,
    });
    expect(ws.readyState).toBe(WebSocket.CONNECTING);
    ws.close();
  });

  test("accepts proxy option as string (HTTPS proxy)", () => {
    const ws = new WebSocket("ws://example.com", {
      proxy: `https://127.0.0.1:${httpsProxyPort}`,
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
      proxy: `http://user:pass@127.0.0.1:${authProxyPort}`,
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
    }).toThrow(SyntaxError);
  });
});

describe("ws package through HTTP CONNECT proxy", () => {
  test("ws:// through HTTP proxy", async () => {
    const { promise, resolve, reject } = Promise.withResolvers<string[]>();

    const ws = new WebSocket(`ws://127.0.0.1:${wsPort}`, {
      proxy: `http://127.0.0.1:${proxyPort}`,
    });

    const receivedMessages: string[] = [];

    ws.on("open", () => {
      ws.send("hello from ws client");
    });

    ws.on("message", (data: Buffer) => {
      receivedMessages.push(data.toString());
      if (receivedMessages.length === 2) {
        ws.close();
      }
    });

    ws.on("close", () => {
      resolve(receivedMessages);
    });

    ws.on("error", (err: Error) => {
      reject(err);
    });

    const messages = await promise;
    expect(messages).toContain("connected");
    expect(messages).toContain("hello from ws client");
    gc();
  });

  test("ws:// through HTTP proxy with auth", async () => {
    const { promise, resolve, reject } = Promise.withResolvers<string[]>();

    const ws = new WebSocket(`ws://127.0.0.1:${wsPort}`, {
      proxy: `http://proxy_user:proxy_pass@127.0.0.1:${authProxyPort}`,
    });

    const receivedMessages: string[] = [];

    ws.on("open", () => {
      ws.send("hello with auth via ws");
    });

    ws.on("message", (data: Buffer) => {
      receivedMessages.push(data.toString());
      if (receivedMessages.length === 2) {
        ws.close();
      }
    });

    ws.on("close", () => {
      resolve(receivedMessages);
    });

    ws.on("error", (err: Error) => {
      reject(err);
    });

    const messages = await promise;
    expect(messages).toContain("connected");
    expect(messages).toContain("hello with auth via ws");
    gc();
  });

  test("proxy auth failure returns error", async () => {
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    let sawError = false;

    const ws = new WebSocket(`ws://127.0.0.1:${wsPort}`, {
      proxy: `http://127.0.0.1:${authProxyPort}`, // No auth provided
    });

    ws.on("open", () => {
      ws.close();
      reject(new Error("Expected proxy auth failure, but connection opened"));
    });

    ws.on("error", () => {
      sawError = true;
      ws.close();
    });

    ws.on("close", () => {
      if (sawError) {
        resolve();
      } else {
        reject(new Error("Expected proxy auth failure (error event), got clean close instead"));
      }
    });

    await promise;
    gc();
  });

  test("proxy wrong credentials returns error", async () => {
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    let sawError = false;

    const ws = new WebSocket(`ws://127.0.0.1:${wsPort}`, {
      proxy: `http://wrong_user:wrong_pass@127.0.0.1:${authProxyPort}`,
    });

    ws.on("open", () => {
      ws.close();
      reject(new Error("Expected proxy auth failure, but connection opened"));
    });

    ws.on("error", () => {
      sawError = true;
      ws.close();
    });

    ws.on("close", () => {
      if (sawError) {
        resolve();
      } else {
        reject(new Error("Expected proxy auth failure (error event), got clean close instead"));
      }
    });

    await promise;
    gc();
  });
});

describe("ws package wss:// through HTTP proxy (TLS tunnel)", () => {
  test("wss:// through HTTP proxy", async () => {
    const { promise, resolve, reject } = Promise.withResolvers<string[]>();

    const ws = new WebSocket(`wss://127.0.0.1:${wssPort}`, {
      proxy: `http://127.0.0.1:${proxyPort}`,
      tls: {
        rejectUnauthorized: false, // Trust self-signed cert
      },
    });

    const receivedMessages: string[] = [];

    ws.on("open", () => {
      ws.send("hello via tls tunnel from ws");
    });

    ws.on("message", (data: Buffer) => {
      receivedMessages.push(data.toString());
      if (receivedMessages.length === 2) {
        ws.close();
      }
    });

    ws.on("close", () => {
      resolve(receivedMessages);
    });

    ws.on("error", (err: Error) => {
      reject(err);
    });

    const messages = await promise;
    expect(messages).toContain("connected");
    expect(messages).toContain("hello via tls tunnel from ws");
    gc();
  });
});

describe("ws package through HTTPS proxy (TLS proxy)", () => {
  test("ws:// through HTTPS proxy with CA certificate", async () => {
    const { promise, resolve, reject } = Promise.withResolvers<string[]>();

    const ws = new WebSocket(`ws://127.0.0.1:${wsPort}`, {
      proxy: `https://127.0.0.1:${httpsProxyPort}`,
      tls: {
        ca: tlsCerts.cert, // Trust self-signed proxy cert
      },
    });

    const receivedMessages: string[] = [];

    ws.on("open", () => {
      ws.send("hello via https proxy from ws");
    });

    ws.on("message", (data: Buffer) => {
      receivedMessages.push(data.toString());
      if (receivedMessages.length === 2) {
        ws.close();
      }
    });

    ws.on("close", () => {
      resolve(receivedMessages);
    });

    ws.on("error", (err: Error) => {
      reject(err);
    });

    const messages = await promise;
    expect(messages).toContain("connected");
    expect(messages).toContain("hello via https proxy from ws");
    gc();
  });

  test("ws:// through HTTPS proxy with rejectUnauthorized: false", async () => {
    const { promise, resolve, reject } = Promise.withResolvers<string[]>();

    const ws = new WebSocket(`ws://127.0.0.1:${wsPort}`, {
      proxy: `https://127.0.0.1:${httpsProxyPort}`,
      tls: {
        rejectUnauthorized: false, // Skip TLS verification for proxy
      },
    });

    const receivedMessages: string[] = [];

    ws.on("open", () => {
      ws.send("hello via https proxy no verify from ws");
    });

    ws.on("message", (data: Buffer) => {
      receivedMessages.push(data.toString());
      if (receivedMessages.length === 2) {
        ws.close();
      }
    });

    ws.on("close", () => {
      resolve(receivedMessages);
    });

    ws.on("error", (err: Error) => {
      reject(err);
    });

    const messages = await promise;
    expect(messages).toContain("connected");
    expect(messages).toContain("hello via https proxy no verify from ws");
    gc();
  });

  test("ws:// through HTTPS proxy fails without CA certificate", async () => {
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    let sawError = false;

    const ws = new WebSocket(`ws://127.0.0.1:${wsPort}`, {
      proxy: `https://127.0.0.1:${httpsProxyPort}`,
      // No CA certificate - should fail (self-signed cert not trusted)
    });

    ws.on("open", () => {
      ws.close();
      reject(new Error("Expected TLS verification failure, but connection opened"));
    });

    ws.on("error", () => {
      sawError = true;
      ws.close();
    });

    ws.on("close", () => {
      if (sawError) {
        resolve();
      } else {
        reject(new Error("Expected TLS verification failure (error event), got clean close instead"));
      }
    });

    await promise;
    gc();
  });
});

describe("ws package with HttpsProxyAgent", () => {
  test("ws:// through HttpsProxyAgent", async () => {
    const { promise, resolve, reject } = Promise.withResolvers<string[]>();

    const agent = new HttpsProxyAgent(`http://127.0.0.1:${proxyPort}`);
    const ws = new WebSocket(`ws://127.0.0.1:${wsPort}`, { agent });

    const receivedMessages: string[] = [];

    ws.on("open", () => {
      ws.send("hello from ws via HttpsProxyAgent");
    });

    ws.on("message", (data: Buffer) => {
      receivedMessages.push(data.toString());
      if (receivedMessages.length === 2) {
        ws.close();
      }
    });

    ws.on("close", () => {
      resolve(receivedMessages);
    });

    ws.on("error", (err: Error) => {
      reject(err);
    });

    const messages = await promise;
    expect(messages).toContain("connected");
    expect(messages).toContain("hello from ws via HttpsProxyAgent");
    gc();
  });

  test("wss:// through HttpsProxyAgent with rejectUnauthorized", async () => {
    const { promise, resolve, reject } = Promise.withResolvers<string[]>();

    const agent = new HttpsProxyAgent(`http://127.0.0.1:${proxyPort}`, {
      rejectUnauthorized: false,
    });
    const ws = new WebSocket(`wss://127.0.0.1:${wssPort}`, { agent });

    const receivedMessages: string[] = [];

    ws.on("open", () => {
      ws.send("hello from wss via HttpsProxyAgent");
    });

    ws.on("message", (data: Buffer) => {
      receivedMessages.push(data.toString());
      if (receivedMessages.length === 2) {
        ws.close();
      }
    });

    ws.on("close", () => {
      resolve(receivedMessages);
    });

    ws.on("error", (err: Error) => {
      reject(err);
    });

    const messages = await promise;
    expect(messages).toContain("connected");
    expect(messages).toContain("hello from wss via HttpsProxyAgent");
    gc();
  });

  test("HttpsProxyAgent with authentication", async () => {
    const { promise, resolve, reject } = Promise.withResolvers<string[]>();

    const agent = new HttpsProxyAgent(`http://proxy_user:proxy_pass@127.0.0.1:${authProxyPort}`);
    const ws = new WebSocket(`ws://127.0.0.1:${wsPort}`, { agent });

    const receivedMessages: string[] = [];

    ws.on("open", () => {
      ws.send("hello from ws with auth via HttpsProxyAgent");
    });

    ws.on("message", (data: Buffer) => {
      receivedMessages.push(data.toString());
      if (receivedMessages.length === 2) {
        ws.close();
      }
    });

    ws.on("close", () => {
      resolve(receivedMessages);
    });

    ws.on("error", (err: Error) => {
      reject(err);
    });

    const messages = await promise;
    expect(messages).toContain("connected");
    expect(messages).toContain("hello from ws with auth via HttpsProxyAgent");
    gc();
  });

  test("HttpsProxyAgent with agent.proxy as URL object", async () => {
    const { promise, resolve, reject } = Promise.withResolvers<string[]>();

    // HttpsProxyAgent stores the proxy URL as a URL object in agent.proxy
    const agent = new HttpsProxyAgent(`http://127.0.0.1:${proxyPort}`);
    // Verify the agent has the proxy property as a URL object
    expect(agent.proxy).toBeDefined();
    expect(typeof agent.proxy).toBe("object");
    expect(agent.proxy.href).toContain(`127.0.0.1:${proxyPort}`);

    const ws = new WebSocket(`ws://127.0.0.1:${wsPort}`, { agent });

    const receivedMessages: string[] = [];

    ws.on("open", () => {
      ws.send("hello via agent with URL object");
    });

    ws.on("message", (data: Buffer) => {
      receivedMessages.push(data.toString());
      if (receivedMessages.length === 2) {
        ws.close();
      }
    });

    ws.on("close", () => {
      resolve(receivedMessages);
    });

    ws.on("error", (err: Error) => {
      reject(err);
    });

    const messages = await promise;
    expect(messages).toContain("connected");
    expect(messages).toContain("hello via agent with URL object");
    gc();
  });

  test("explicit proxy option takes precedence over agent", async () => {
    const { promise, resolve, reject } = Promise.withResolvers<string[]>();

    // Create agent pointing to wrong port (that doesn't exist)
    const agent = new HttpsProxyAgent(`http://127.0.0.1:1`);
    // But use explicit proxy option with correct port
    const ws = new WebSocket(`ws://127.0.0.1:${wsPort}`, {
      agent,
      proxy: `http://127.0.0.1:${proxyPort}`, // This should take precedence
    });

    const receivedMessages: string[] = [];

    ws.on("open", () => {
      ws.send("explicit proxy wins");
    });

    ws.on("message", (data: Buffer) => {
      receivedMessages.push(data.toString());
      if (receivedMessages.length === 2) {
        ws.close();
      }
    });

    ws.on("close", () => {
      resolve(receivedMessages);
    });

    ws.on("error", (err: Error) => {
      reject(err);
    });

    const messages = await promise;
    expect(messages).toContain("connected");
    expect(messages).toContain("explicit proxy wins");
    gc();
  });
});
