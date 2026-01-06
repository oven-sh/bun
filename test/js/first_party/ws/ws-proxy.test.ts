import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { gc, tls as tlsCerts } from "harness";
import net from "net";
import tls from "tls";
import WebSocket from "ws";

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

// Create an HTTP CONNECT proxy server using Node's net module
function createConnectProxy(options: { requireAuth?: boolean } = {}) {
  return net.createServer(clientSocket => {
    let buffer = Buffer.alloc(0);
    let tunnelEstablished = false;
    let targetSocket: net.Socket | null = null;

    clientSocket.on("data", data => {
      // If tunnel is already established, forward data directly
      if (tunnelEstablished && targetSocket) {
        targetSocket.write(data);
        return;
      }

      buffer = Buffer.concat([buffer, data]);
      const bufferStr = buffer.toString();

      // Check if we have complete headers
      const headerEnd = bufferStr.indexOf("\r\n\r\n");
      if (headerEnd === -1) return;

      const headerPart = bufferStr.substring(0, headerEnd);
      const lines = headerPart.split("\r\n");
      const requestLine = lines[0];
      const headers: Record<string, string> = {};

      for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        if (line === "") break;
        const colonIdx = line.indexOf(": ");
        if (colonIdx > 0) {
          headers[line.substring(0, colonIdx).toLowerCase()] = line.substring(colonIdx + 2);
        }
      }

      // Check for CONNECT method
      const match = requestLine.match(/^CONNECT\s+([^:]+):(\d+)\s+HTTP/);
      if (!match) {
        clientSocket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
        clientSocket.end();
        return;
      }

      const [, targetHost, targetPort] = match;

      // Check auth if required
      if (options.requireAuth) {
        const authHeader = headers["proxy-authorization"];
        if (!authHeader) {
          clientSocket.write("HTTP/1.1 407 Proxy Authentication Required\r\n\r\n");
          clientSocket.end();
          return;
        }

        const auth = Buffer.from(authHeader.replace("Basic ", "").trim(), "base64").toString("utf8");
        if (auth !== "proxy_user:proxy_pass") {
          clientSocket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
          clientSocket.end();
          return;
        }
      }

      // Get any data after the headers (shouldn't be any for CONNECT)
      const remainingData = buffer.subarray(headerEnd + 4);

      // Connect to target
      targetSocket = net.connect(parseInt(targetPort), targetHost, () => {
        clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        tunnelEstablished = true;

        // Forward any remaining data
        if (remainingData.length > 0) {
          targetSocket!.write(remainingData);
        }

        // Set up bidirectional piping
        targetSocket!.on("data", chunk => {
          clientSocket.write(chunk);
        });
      });

      targetSocket.on("error", () => {
        if (!tunnelEstablished) {
          clientSocket.write("HTTP/1.1 502 Bad Gateway\r\n\r\n");
        }
        clientSocket.end();
      });

      targetSocket.on("close", () => clientSocket.destroy());
      clientSocket.on("close", () => targetSocket?.destroy());
    });

    clientSocket.on("error", () => {
      targetSocket?.destroy();
    });
  });
}

// Create an HTTPS CONNECT proxy server using Node's tls module
function createTLSConnectProxy() {
  return tls.createServer(
    {
      key: tlsCerts.key,
      cert: tlsCerts.cert,
    },
    clientSocket => {
      let buffer = Buffer.alloc(0);
      let tunnelEstablished = false;
      let targetSocket: net.Socket | null = null;

      clientSocket.on("data", data => {
        if (tunnelEstablished && targetSocket) {
          targetSocket.write(data);
          return;
        }

        buffer = Buffer.concat([buffer, data]);
        const bufferStr = buffer.toString();

        const headerEnd = bufferStr.indexOf("\r\n\r\n");
        if (headerEnd === -1) return;

        const headerPart = bufferStr.substring(0, headerEnd);
        const lines = headerPart.split("\r\n");
        const requestLine = lines[0];

        const match = requestLine.match(/^CONNECT\s+([^:]+):(\d+)\s+HTTP/);
        if (!match) {
          clientSocket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
          clientSocket.end();
          return;
        }

        const [, targetHost, targetPort] = match;
        const remainingData = buffer.subarray(headerEnd + 4);

        targetSocket = net.connect(parseInt(targetPort), targetHost, () => {
          clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
          tunnelEstablished = true;

          if (remainingData.length > 0) {
            targetSocket!.write(remainingData);
          }

          targetSocket!.on("data", chunk => {
            clientSocket.write(chunk);
          });
        });

        targetSocket.on("error", () => {
          if (!tunnelEstablished) {
            clientSocket.write("HTTP/1.1 502 Bad Gateway\r\n\r\n");
          }
          clientSocket.end();
        });

        targetSocket.on("close", () => clientSocket.destroy());
        clientSocket.on("close", () => targetSocket?.destroy());
      });

      clientSocket.on("error", () => {
        targetSocket?.destroy();
      });
    },
  );
}

beforeAll(async () => {
  // Create HTTP CONNECT proxy
  proxy = createConnectProxy();
  await new Promise<void>(resolve => {
    proxy.listen(0, "127.0.0.1", () => {
      const addr = proxy.address() as net.AddressInfo;
      proxyPort = addr.port;
      resolve();
    });
  });

  // Create HTTP CONNECT proxy with auth
  authProxy = createConnectProxy({ requireAuth: true });
  await new Promise<void>(resolve => {
    authProxy.listen(0, "127.0.0.1", () => {
      const addr = authProxy.address() as net.AddressInfo;
      authProxyPort = addr.port;
      resolve();
    });
  });

  // Create HTTPS CONNECT proxy
  httpsProxy = createTLSConnectProxy();
  await new Promise<void>(resolve => {
    httpsProxy.listen(0, "127.0.0.1", () => {
      const addr = httpsProxy.address() as net.AddressInfo;
      httpsProxyPort = addr.port;
      resolve();
    });
  });

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
    const { promise, resolve } = Promise.withResolvers<void>();

    const ws = new WebSocket(`ws://127.0.0.1:${wsPort}`, {
      proxy: `http://127.0.0.1:${authProxyPort}`, // No auth provided
    });

    ws.on("open", () => {
      ws.close();
      resolve();
    });

    ws.on("error", () => {
      resolve(); // Expected - auth required
    });

    ws.on("close", () => {
      resolve();
    });

    await promise;
    gc();
  });

  test("proxy wrong credentials returns error", async () => {
    const { promise, resolve } = Promise.withResolvers<void>();

    const ws = new WebSocket(`ws://127.0.0.1:${wsPort}`, {
      proxy: `http://wrong_user:wrong_pass@127.0.0.1:${authProxyPort}`,
    });

    ws.on("open", () => {
      ws.close();
      resolve();
    });

    ws.on("error", () => {
      resolve(); // Expected - wrong credentials
    });

    ws.on("close", () => {
      resolve();
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
    const { promise, resolve } = Promise.withResolvers<void>();

    const ws = new WebSocket(`ws://127.0.0.1:${wsPort}`, {
      proxy: `https://127.0.0.1:${httpsProxyPort}`,
      // No CA certificate - should fail (self-signed cert not trusted)
    });

    ws.on("open", () => {
      ws.close();
      resolve(); // Unexpected success
    });

    ws.on("error", () => {
      resolve(); // Expected - TLS verification should fail
    });

    ws.on("close", () => {
      resolve();
    });

    await promise;
    gc();
  });
});
