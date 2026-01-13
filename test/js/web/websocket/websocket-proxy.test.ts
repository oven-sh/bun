import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as harness from "harness";
import { tls as tlsCerts } from "harness";
import type { HttpsProxyAgent as HttpsProxyAgentType } from "https-proxy-agent";
import net from "net";
import tls from "tls";
import { createConnectProxy, createTLSConnectProxy, startProxy } from "./proxy-test-utils";
// Use dynamic require to avoid linter removing the import
const { HttpsProxyAgent } = require("https-proxy-agent") as {
  HttpsProxyAgent: typeof HttpsProxyAgentType;
};

// Use docker-compose infrastructure for squid proxy

const gc = harness.gc;
const isDockerEnabled = harness.isDockerEnabled;

// HTTP CONNECT proxy server for WebSocket tunneling
let proxy: net.Server;
let authProxy: net.Server;
let wsServer: ReturnType<typeof Bun.serve>;
let wssServer: ReturnType<typeof Bun.serve>;
let proxyPort: number;
let authProxyPort: number;
let wsPort: number;
let wssPort: number;

beforeAll(async () => {
  // Create HTTP CONNECT proxy
  proxy = createConnectProxy();
  proxyPort = await startProxy(proxy);

  // Create HTTP CONNECT proxy with auth
  authProxy = createConnectProxy({ requireAuth: true });
  authProxyPort = await startProxy(authProxy);

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
  wsServer?.stop(true);
  wssServer?.stop(true);
});

describe("WebSocket proxy API", () => {
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
    }).toThrow(SyntaxError);
  });
});

describe("WebSocket through HTTP CONNECT proxy", () => {
  test("ws:// through HTTP proxy", async () => {
    const { promise, resolve, reject } = Promise.withResolvers<string[]>();

    const ws = new WebSocket(`ws://127.0.0.1:${wsPort}`, {
      proxy: `http://127.0.0.1:${proxyPort}`,
    });

    const receivedMessages: string[] = [];

    ws.onopen = () => {
      ws.send("hello from client");
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
    expect(messages).toContain("hello from client");
    gc();
  });

  test("ws:// through HTTP proxy with auth", async () => {
    const { promise, resolve, reject } = Promise.withResolvers<string[]>();

    const ws = new WebSocket(`ws://127.0.0.1:${wsPort}`, {
      proxy: `http://proxy_user:proxy_pass@127.0.0.1:${authProxyPort}`,
    });

    const receivedMessages: string[] = [];

    ws.onopen = () => {
      ws.send("hello with auth");
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
    expect(messages).toContain("hello with auth");
    gc();
  });

  test("ws:// through proxy with custom headers", async () => {
    const { promise, resolve, reject } = Promise.withResolvers<void>();

    const ws = new WebSocket(`ws://127.0.0.1:${wsPort}`, {
      proxy: {
        url: `http://127.0.0.1:${proxyPort}`,
        headers: { "X-Custom-Proxy-Header": "test-value" },
      },
    });

    ws.onopen = () => {
      ws.close();
      resolve();
    };

    ws.onerror = event => {
      reject(event);
    };

    await promise;
    gc();
  });

  test("ws:// through proxy with Headers class instance", async () => {
    const { promise, resolve, reject } = Promise.withResolvers<void>();

    const headers = new Headers({ "X-Custom-Proxy-Header": "test-value-from-headers-class" });
    const ws = new WebSocket(`ws://127.0.0.1:${wsPort}`, {
      proxy: {
        url: `http://127.0.0.1:${proxyPort}`,
        headers: headers,
      },
    });

    ws.onopen = () => {
      ws.close();
      resolve();
    };

    ws.onerror = event => {
      reject(event);
    };

    await promise;
    gc();
  });

  test("proxy auth failure returns error", async () => {
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    let sawError = false;

    const ws = new WebSocket(`ws://127.0.0.1:${wsPort}`, {
      proxy: `http://127.0.0.1:${authProxyPort}`, // No auth provided
    });

    ws.onopen = () => {
      ws.close();
      reject(new Error("Expected proxy auth failure, but connection opened"));
    };

    ws.onerror = () => {
      sawError = true;
      ws.close();
    };

    ws.onclose = () => {
      if (sawError) {
        resolve();
      } else {
        reject(new Error("Expected proxy auth failure (error event), got clean close instead"));
      }
    };

    await promise;
    gc();
  });

  test("proxy wrong credentials returns error", async () => {
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    let sawError = false;

    const ws = new WebSocket(`ws://127.0.0.1:${wsPort}`, {
      proxy: `http://wrong_user:wrong_pass@127.0.0.1:${authProxyPort}`,
    });

    ws.onopen = () => {
      ws.close();
      reject(new Error("Expected proxy auth failure, but connection opened"));
    };

    ws.onerror = () => {
      sawError = true;
      ws.close();
    };

    ws.onclose = () => {
      if (sawError) {
        resolve();
      } else {
        reject(new Error("Expected proxy auth failure (error event), got clean close instead"));
      }
    };

    await promise;
    gc();
  });
});

describe("WebSocket wss:// through HTTP proxy (TLS tunnel)", () => {
  // This tests the TLS tunnel: wss:// target through HTTP proxy
  // The outer connection is plain TCP to the HTTP proxy, then TLS is
  // negotiated inside the tunnel to the wss:// target server.

  test("wss:// through HTTP proxy", async () => {
    const { promise, resolve, reject } = Promise.withResolvers<string[]>();

    // Use local wss:// server with self-signed cert
    const ws = new WebSocket(`wss://127.0.0.1:${wssPort}`, {
      proxy: `http://127.0.0.1:${proxyPort}`,
      tls: {
        // Trust the self-signed certificate used by the wss:// server
        rejectUnauthorized: false,
      },
    });

    const receivedMessages: string[] = [];

    ws.onopen = () => {
      ws.send("hello via tls tunnel");
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
    expect(messages).toContain("hello via tls tunnel");
    gc();
  });
});

describe("WebSocket through HTTPS proxy (TLS proxy)", () => {
  // These tests verify WebSocket connections through HTTPS (TLS) proxy servers

  let httpsProxy: tls.Server;
  let httpsProxyPort: number;

  beforeAll(async () => {
    // Create HTTPS CONNECT proxy
    httpsProxy = createTLSConnectProxy();
    httpsProxyPort = await startProxy(httpsProxy);
  });

  afterAll(() => {
    httpsProxy?.close();
  });

  test("ws:// through HTTPS proxy with CA certificate", async () => {
    const { promise, resolve, reject } = Promise.withResolvers<string[]>();

    const ws = new WebSocket(`ws://127.0.0.1:${wsPort}`, {
      proxy: `https://127.0.0.1:${httpsProxyPort}`,
      tls: {
        // Trust the self-signed certificate used by the proxy
        ca: tlsCerts.cert,
      },
    });

    const receivedMessages: string[] = [];

    ws.onopen = () => {
      ws.send("hello via https proxy");
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
    expect(messages).toContain("hello via https proxy");
    gc();
  });

  test("ws:// through HTTPS proxy fails without CA certificate", async () => {
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    let sawError = false;

    const ws = new WebSocket(`ws://127.0.0.1:${wsPort}`, {
      proxy: `https://127.0.0.1:${httpsProxyPort}`,
      // No CA certificate - should fail (self-signed cert not trusted)
    });

    ws.onopen = () => {
      ws.close();
      reject(new Error("Expected TLS verification failure, but connection opened"));
    };

    ws.onerror = () => {
      sawError = true;
      ws.close();
    };

    ws.onclose = () => {
      if (sawError) {
        resolve();
      } else {
        reject(new Error("Expected TLS verification failure (error event), got clean close instead"));
      }
    };

    await promise;
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

    ws.onopen = () => {
      ws.send("hello via https proxy no verify");
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
    expect(messages).toContain("hello via https proxy no verify");
    gc();
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
  }, 120_000);

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
    const { promise, resolve, reject } = Promise.withResolvers<string[]>();

    const agent = new HttpsProxyAgent(`http://127.0.0.1:${proxyPort}`);
    const ws = new WS(`ws://127.0.0.1:${wsPort}`, { agent });

    const receivedMessages: string[] = [];

    ws.on("open", () => {
      ws.send("hello from ws module via agent");
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
    expect(messages).toContain("hello from ws module via agent");
    gc();
  });
});
