import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "crypto";
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
  if (prevNoProxy !== undefined) process.env.NO_PROXY = prevNoProxy;
  if (prevNoProxyLower !== undefined) process.env.no_proxy = prevNoProxyLower;
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

  test("server-initiated ping survives through TLS tunnel proxy", async () => {
    // Regression test: sendPong checked socket.isClosed() on the detached tcp
    // field instead of using hasTCP(). For wss:// through HTTP proxy, the
    // WebSocket uses initWithTunnel which sets tcp = detached (all I/O goes
    // through proxy_tunnel). Detached sockets return true for isClosed(), so
    // sendPong would immediately dispatch a 1006 close instead of sending the
    // pong through the tunnel.
    using pingServer = Bun.serve({
      port: 0,
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
      },
    });

    const { promise, resolve, reject } = Promise.withResolvers<void>();

    const ws = new WebSocket(`wss://127.0.0.1:${pingServer.port}`, {
      proxy: `http://127.0.0.1:${proxyPort}`,
      tls: { rejectUnauthorized: false },
    });

    ws.onopen = () => {
      ws.send("ready");
    };

    ws.onmessage = event => {
      if (String(event.data) === "after-ping") {
        ws.close(1000);
      }
    };

    ws.onclose = event => {
      if (event.code === 1000) {
        resolve();
      } else {
        reject(new Error(`Unexpected close code: ${event.code}`));
      }
    };

    ws.onerror = event => {
      reject(event);
    };

    await promise;
    gc();
  });

  // In tunnel mode the connection to the proxy is owned by the upgrade client,
  // not by the WebSocket client that JS talks to, so whether a client-side
  // teardown actually closed it is only observable from the proxy's end.
  async function proxyThatReportsClientClose(kind: "http" | "https") {
    const server = kind === "http" ? createConnectProxy() : createTLSConnectProxy();
    const sockets: net.Socket[] = [];
    const clientClosed = new Promise<void>(resolve => {
      server.once(kind === "http" ? "connection" : "secureConnection", (socket: net.Socket) => {
        sockets.push(socket);
        socket.once("close", () => resolve());
      });
    });
    const port = await startProxy(server);
    return {
      url: `${kind}://127.0.0.1:${port}`,
      clientClosed,
      [Symbol.dispose]() {
        for (const socket of sockets) socket.destroy();
        server.close();
      },
    };
  }

  // A wss:// endpoint that completes the upgrade and then sends one frame with
  // the reserved opcode 0x3, which the client has to fail the connection on.
  // Sent together with the 101, the frame reaches the client as handshake
  // overflow, which it processes from a microtask; sent in reply to a message
  // from the client, it arrives as ordinary tunnel data, so the client fails
  // the connection from inside the upgrade client's own data callback.
  async function wssServerSendingInvalidFrame(delivery: "with the 101" | "in reply to a message") {
    const invalidFrame = Buffer.from([0x83, 0x00]);
    const server = tls.createServer({ key: tlsCerts.key, cert: tlsCerts.cert }, socket => {
      let head = Buffer.alloc(0);
      socket.on("data", chunk => {
        head = Buffer.concat([head, chunk]);
        if (!head.includes("\r\n\r\n")) return;
        const key = /Sec-WebSocket-Key:\s*(\S+)/i.exec(head.toString("latin1"))![1];
        const accept = createHash("sha1")
          .update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
          .digest("base64");
        const response = Buffer.from(
          "HTTP/1.1 101 Switching Protocols\r\n" +
            "Upgrade: websocket\r\n" +
            "Connection: Upgrade\r\n" +
            `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
        );
        socket.removeAllListeners("data");
        if (delivery === "with the 101") {
          socket.on("data", () => {});
          socket.write(Buffer.concat([response, invalidFrame]));
        } else {
          socket.once("data", () => socket.write(invalidFrame));
          socket.write(response);
        }
      });
      socket.on("error", () => {});
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    return {
      port: (server.address() as net.AddressInfo).port,
      [Symbol.dispose]() {
        server.close();
      },
    };
  }

  test.each([
    ["synchronously in onopen", true],
    ["after the open event", false],
  ])("ws.terminate() closes the connection to the proxy (%s)", async (_, terminateInOpen) => {
    using proxy = await proxyThatReportsClientClose("http");
    const opened = Promise.withResolvers<void>();
    const closed = Promise.withResolvers<number>();

    const ws = new WebSocket(`wss://127.0.0.1:${wssPort}`, {
      proxy: proxy.url,
      tls: { rejectUnauthorized: false },
    });
    ws.onopen = () => {
      if (terminateInOpen) ws.terminate();
      opened.resolve();
    };
    ws.onclose = event => closed.resolve(event.code);
    ws.onerror = () => {};

    await opened.promise;
    if (!terminateInOpen) ws.terminate();

    expect(await closed.promise).toBe(1006);
    await proxy.clientClosed;
  });

  test("ws.terminate() closes the connection to an HTTPS proxy", async () => {
    using proxy = await proxyThatReportsClientClose("https");
    const opened = Promise.withResolvers<void>();
    const closed = Promise.withResolvers<number>();

    const ws = new WebSocket(`wss://127.0.0.1:${wssPort}`, {
      proxy: proxy.url,
      // Both the proxy and the wss:// server use the self-signed test cert.
      tls: { ca: tlsCerts.cert },
    });
    ws.onopen = () => opened.resolve();
    ws.onclose = event => closed.resolve(event.code);
    ws.onerror = () => {};

    await opened.promise;
    ws.terminate();

    expect(await closed.promise).toBe(1006);
    await proxy.clientClosed;
  });

  test.each(["with the 101", "in reply to a message"] as const)(
    "failing the connection on a protocol error (invalid frame sent %s) closes the connection to the proxy",
    async delivery => {
      using server = await wssServerSendingInvalidFrame(delivery);
      using proxy = await proxyThatReportsClientClose("http");
      const closed = Promise.withResolvers<number>();

      const ws = new WebSocket(`wss://127.0.0.1:${server.port}`, {
        proxy: proxy.url,
        tls: { rejectUnauthorized: false },
      });
      ws.onopen = () => ws.send("hello");
      ws.onclose = event => closed.resolve(event.code);
      ws.onerror = () => {};

      expect(await closed.promise).toBe(1002);
      await proxy.clientClosed;
    },
  );

  test("process exits after ws.terminate() on a connection through a proxy", async () => {
    // The upgrade client keeps the event loop alive for as long as its socket
    // is open, so leaving the proxy connection open also kept the process up.
    using proxy = await proxyThatReportsClientClose("http");

    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const ws = new WebSocket("wss://127.0.0.1:${wssPort}", {
           proxy: "${proxy.url}",
           tls: { rejectUnauthorized: false },
         });
         ws.onclose = event => console.log("closed", event.code);
         await new Promise(resolve => (ws.onopen = resolve));
         ws.terminate();`,
      ],
      env: { ...bunEnv, NO_PROXY: "", no_proxy: "" },
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout).toBe("closed 1006\n");
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
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

describe.concurrent("WebSocket NO_PROXY bypass", () => {
  test("NO_PROXY matching hostname bypasses explicit proxy for ws://", async () => {
    // authProxy requires credentials; if NO_PROXY works, the WebSocket bypasses
    // the proxy and connects directly. If NO_PROXY doesn't work, the proxy
    // rejects with 407 and the WebSocket errors.
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const ws = new WebSocket("ws://127.0.0.1:${wsPort}", { proxy: "http://127.0.0.1:${authProxyPort}" });
         ws.onopen = () => { ws.close(); process.exit(0); };
         ws.onerror = () => { process.exit(1); };`,
      ],
      env: { ...bunEnv, NO_PROXY: "127.0.0.1" },
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    if (exitCode !== 0) console.error("stderr:", stderr);
    expect(exitCode).toBe(0);
  });

  test("NO_PROXY matching host:port bypasses proxy for ws://", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const ws = new WebSocket("ws://127.0.0.1:${wsPort}", { proxy: "http://127.0.0.1:${authProxyPort}" });
         ws.onopen = () => { ws.close(); process.exit(0); };
         ws.onerror = () => { process.exit(1); };`,
      ],
      env: { ...bunEnv, NO_PROXY: `127.0.0.1:${wsPort}` },
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    if (exitCode !== 0) console.error("stderr:", stderr);
    expect(exitCode).toBe(0);
  });

  test("NO_PROXY not matching still uses proxy (auth fails)", async () => {
    // NO_PROXY doesn't match the target, so the WebSocket should go through
    // the auth proxy without credentials, which rejects with 407.
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const ws = new WebSocket("ws://127.0.0.1:${wsPort}", { proxy: "http://127.0.0.1:${authProxyPort}" });
         ws.onopen = () => { process.exit(1); };
         ws.onerror = () => { process.exit(0); };`,
      ],
      env: { ...bunEnv, NO_PROXY: "other.host.com" },
      stdout: "pipe",
      stderr: "pipe",
    });

    const exitCode = await proc.exited;
    // exit(0) means onerror fired, proving the proxy was used (and auth failed)
    expect(exitCode).toBe(0);
  });

  test("NO_PROXY=* bypasses all proxies", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const ws = new WebSocket("ws://127.0.0.1:${wsPort}", { proxy: "http://127.0.0.1:${authProxyPort}" });
         ws.onopen = () => { ws.close(); process.exit(0); };
         ws.onerror = () => { process.exit(1); };`,
      ],
      env: { ...bunEnv, NO_PROXY: "*" },
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    if (exitCode !== 0) console.error("stderr:", stderr);
    expect(exitCode).toBe(0);
  });
});
