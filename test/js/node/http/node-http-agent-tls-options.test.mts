/**
 * All tests in this file run in both Bun and Node.js.
 *
 * Test that TLS options can be inherited from agent.options and agent.connectOpts.
 * This is important for compatibility with libraries like https-proxy-agent.
 *
 * The HttpsProxyAgent tests verify that TLS options are properly passed through
 * the proxy tunnel to the target HTTPS server.
 */

import { HttpsProxyAgent } from "https-proxy-agent";
import assert from "node:assert";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import type { AddressInfo } from "node:net";
import net from "node:net";
import { dirname, join } from "node:path";
import { describe, test } from "node:test";
import tls from "node:tls";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Self-signed certificate with SANs for localhost and 127.0.0.1
// This cert is its own CA (self-signed)
const tlsCerts = {
  cert: readFileSync(join(__dirname, "fixtures", "cert.pem"), "utf8"),
  key: readFileSync(join(__dirname, "fixtures", "cert.key"), "utf8"),
  encryptedKey: readFileSync(join(__dirname, "fixtures", "cert.encrypted.key"), "utf8"),
  passphrase: "testpassword",
  // Self-signed cert, so it's its own CA
  get ca() {
    return this.cert;
  },
};

async function createHttpsServer(
  options: https.ServerOptions = {},
): Promise<{ server: https.Server; port: number; hostname: string }> {
  const server = https.createServer({ key: tlsCerts.key, cert: tlsCerts.cert, ...options }, (req, res) => {
    res.writeHead(200);
    res.end("OK");
  });
  await once(server.listen(0, "127.0.0.1"), "listening");
  const { port } = server.address() as AddressInfo;
  return { server, port, hostname: "127.0.0.1" };
}

async function createHttpServer(): Promise<{
  server: http.Server;
  port: number;
  hostname: string;
}> {
  const server = http.createServer((req, res) => {
    res.writeHead(200);
    res.end("OK");
  });
  await once(server.listen(0, "127.0.0.1"), "listening");
  const { port } = server.address() as AddressInfo;
  return { server, port, hostname: "127.0.0.1" };
}

/**
 * Create an HTTP CONNECT proxy server.
 * This proxy handles the CONNECT method to establish tunnels for HTTPS connections.
 */
function createConnectProxy(): net.Server {
  return net.createServer(clientSocket => {
    let buffer: Uint8Array = new Uint8Array(0);
    let tunnelEstablished = false;
    let targetSocket: net.Socket | null = null;

    clientSocket.on("data", (data: Uint8Array) => {
      // If tunnel is already established, forward data directly
      if (tunnelEstablished && targetSocket) {
        targetSocket.write(data);
        return;
      }

      // Concatenate buffers
      const newBuffer = new Uint8Array(buffer.length + data.length);
      newBuffer.set(buffer);
      newBuffer.set(data, buffer.length);
      buffer = newBuffer;

      const bufferStr = new TextDecoder().decode(buffer);

      // Check if we have complete headers
      const headerEnd = bufferStr.indexOf("\r\n\r\n");
      if (headerEnd === -1) return;

      const headerPart = bufferStr.substring(0, headerEnd);
      const lines = headerPart.split("\r\n");
      const requestLine = lines[0];

      // Check for CONNECT method
      const match = requestLine.match(/^CONNECT\s+([^:]+):(\d+)\s+HTTP/);
      if (!match) {
        clientSocket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
        clientSocket.end();
        return;
      }

      const [, targetHost, targetPort] = match;

      // Get any data after the headers (shouldn't be any for CONNECT)
      // headerEnd is byte position in the string, need to account for UTF-8
      const headerBytes = new TextEncoder().encode(bufferStr.substring(0, headerEnd + 4)).length;
      const remainingData = buffer.subarray(headerBytes);

      // Connect to target
      targetSocket = net.connect(parseInt(targetPort, 10), targetHost, () => {
        clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        tunnelEstablished = true;

        // Forward any remaining data
        if (remainingData.length > 0) {
          targetSocket!.write(remainingData);
        }

        // Set up bidirectional piping
        targetSocket!.on("data", (chunk: Uint8Array) => {
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

/**
 * Helper to start a proxy server and get its port.
 */
async function startProxy(server: net.Server): Promise<number> {
  return new Promise<number>(resolve => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as AddressInfo;
      resolve(addr.port);
    });
  });
}

describe("https.request agent TLS options inheritance", () => {
  describe("agent.options", () => {
    test("inherits ca from agent.options", async () => {
      const { server, port, hostname } = await createHttpsServer();

      try {
        // Create an agent with ca in options
        const agent = new https.Agent({
          ca: tlsCerts.ca,
        });

        const { promise, resolve, reject } = Promise.withResolvers<void>();
        const req = https.request(
          {
            hostname,
            port,
            path: "/",
            method: "GET",
            agent,
            // NO ca here - should inherit from agent.options
          },
          res => {
            res.on("data", () => {});
            res.on("end", resolve);
          },
        );
        req.on("error", reject);
        req.end();

        await promise;
      } finally {
        server.close();
      }
    });

    test("inherits rejectUnauthorized from agent.options", async () => {
      const { server, port, hostname } = await createHttpsServer();

      try {
        // Create an agent with rejectUnauthorized: false in options
        const agent = new https.Agent({
          rejectUnauthorized: false,
        });

        const { promise, resolve, reject } = Promise.withResolvers<void>();
        const req = https.request(
          {
            hostname,
            port,
            path: "/",
            method: "GET",
            agent,
            // NO rejectUnauthorized here - should inherit from agent.options
          },
          res => {
            res.on("data", () => {});
            res.on("end", resolve);
          },
        );
        req.on("error", reject);
        req.end();

        await promise;
      } finally {
        server.close();
      }
    });

    test("inherits cert and key from agent.options", async () => {
      // Create a server that uses TLS
      const { server, port, hostname } = await createHttpsServer();

      try {
        // Create an agent with cert/key in options
        const agent = new https.Agent({
          rejectUnauthorized: false,
          cert: tlsCerts.cert,
          key: tlsCerts.key,
        });

        const { promise, resolve, reject } = Promise.withResolvers<void>();
        const req = https.request(
          {
            hostname,
            port,
            path: "/",
            method: "GET",
            agent,
            // NO cert/key here - should inherit from agent.options
          },
          res => {
            res.on("data", () => {});
            res.on("end", resolve);
          },
        );
        req.on("error", reject);
        req.end();

        await promise;
      } finally {
        server.close();
      }
    });
  });

  // Test HttpsProxyAgent compatibility - these tests use real HttpsProxyAgent
  // to verify HTTPS requests work through the proxy tunnel with TLS options
  describe("HttpsProxyAgent TLS options", () => {
    test("HttpsProxyAgent with rejectUnauthorized: false", async () => {
      const { server, port, hostname } = await createHttpsServer();
      const proxy = createConnectProxy();
      const proxyPort = await startProxy(proxy);

      try {
        // Create HttpsProxyAgent for the proxy connection
        const agent = new HttpsProxyAgent(`http://127.0.0.1:${proxyPort}`, {
          rejectUnauthorized: false,
        });

        const { promise, resolve, reject } = Promise.withResolvers<void>();
        const req = https.request(
          {
            hostname,
            port,
            path: "/",
            method: "GET",
            agent,
            // TLS options must also be passed here for Node.js compatibility
            // https-proxy-agent doesn't propagate these to target connection in Node.js
            // See: https://github.com/TooTallNate/node-https-proxy-agent/issues/35
            rejectUnauthorized: false,
          },
          res => {
            res.on("data", () => {});
            res.on("end", resolve);
          },
        );
        req.on("error", reject);
        req.end();

        await promise;
      } finally {
        server.close();
        proxy.close();
      }
    });

    test("HttpsProxyAgent with ca option", async () => {
      const { server, port, hostname } = await createHttpsServer();
      const proxy = createConnectProxy();
      const proxyPort = await startProxy(proxy);

      try {
        // Create HttpsProxyAgent for the proxy connection
        const agent = new HttpsProxyAgent(`http://127.0.0.1:${proxyPort}`, {
          ca: tlsCerts.ca,
        });

        const { promise, resolve, reject } = Promise.withResolvers<void>();
        const req = https.request(
          {
            hostname,
            port,
            path: "/",
            method: "GET",
            agent,
            // TLS options must also be passed here for Node.js compatibility
            ca: tlsCerts.ca,
          },
          res => {
            res.on("data", () => {});
            res.on("end", resolve);
          },
        );
        req.on("error", reject);
        req.end();

        await promise;
      } finally {
        server.close();
        proxy.close();
      }
    });

    test("HttpsProxyAgent with cert and key options", async () => {
      const { server, port, hostname } = await createHttpsServer();
      const proxy = createConnectProxy();
      const proxyPort = await startProxy(proxy);

      try {
        // Create HttpsProxyAgent for the proxy connection
        const agent = new HttpsProxyAgent(`http://127.0.0.1:${proxyPort}`, {
          rejectUnauthorized: false,
          cert: tlsCerts.cert,
          key: tlsCerts.key,
        });

        const { promise, resolve, reject } = Promise.withResolvers<void>();
        const req = https.request(
          {
            hostname,
            port,
            path: "/",
            method: "GET",
            agent,
            // TLS options must also be passed here for Node.js compatibility
            rejectUnauthorized: false,
            cert: tlsCerts.cert,
            key: tlsCerts.key,
          },
          res => {
            res.on("data", () => {});
            res.on("end", resolve);
          },
        );
        req.on("error", reject);
        req.end();

        await promise;
      } finally {
        server.close();
        proxy.close();
      }
    });
  });

  describe("option precedence (matches Node.js)", () => {
    // In Node.js, options are merged via spread in createSocket:
    //   options = { __proto__: null, ...options, ...this.options };
    // https://github.com/nodejs/node/blob/v23.6.0/lib/_http_agent.js#L365
    // With spread, the last one wins, so agent.options overwrites request options.

    test("agent.options takes precedence over direct options", async () => {
      const { server, port, hostname } = await createHttpsServer();

      try {
        // Create an agent with correct CA
        const agent = new https.Agent({
          ca: tlsCerts.ca, // Correct CA in agent.options - should be used
        });

        const { promise, resolve, reject } = Promise.withResolvers<void>();
        const req = https.request(
          {
            hostname,
            port,
            path: "/",
            method: "GET",
            agent,
            ca: "wrong-ca-that-would-fail", // Wrong CA in request - should be ignored
          },
          res => {
            res.on("data", () => {});
            res.on("end", resolve);
          },
        );
        req.on("error", reject);
        req.end();

        await promise;
      } finally {
        server.close();
      }
    });

    test("direct options used when agent.options not set", async () => {
      const { server, port, hostname } = await createHttpsServer();

      try {
        // Create an agent without ca
        const agent = new https.Agent({});

        const { promise, resolve, reject } = Promise.withResolvers<void>();
        const req = https.request(
          {
            hostname,
            port,
            path: "/",
            method: "GET",
            agent,
            ca: tlsCerts.ca, // Direct option should be used since agent.options.ca is not set
          },
          res => {
            res.on("data", () => {});
            res.on("end", resolve);
          },
        );
        req.on("error", reject);
        req.end();

        await promise;
      } finally {
        server.close();
      }
    });
  });

  describe("other TLS options", () => {
    test("inherits servername from agent.options", async () => {
      const { server, port, hostname } = await createHttpsServer();

      try {
        const agent = new https.Agent({
          rejectUnauthorized: false,
          servername: "localhost", // Should be passed to TLS
        });

        const { promise, resolve, reject } = Promise.withResolvers<void>();
        const req = https.request(
          {
            hostname,
            port,
            path: "/",
            method: "GET",
            agent,
          },
          res => {
            res.on("data", () => {});
            res.on("end", resolve);
          },
        );
        req.on("error", reject);
        req.end();

        await promise;
      } finally {
        server.close();
      }
    });

    test("inherits ciphers from agent.options", async () => {
      const { server, port, hostname } = await createHttpsServer();

      try {
        const agent = new https.Agent({
          rejectUnauthorized: false,
          ciphers: "HIGH:!aNULL:!MD5", // Custom cipher suite
        });

        const { promise, resolve, reject } = Promise.withResolvers<void>();
        const req = https.request(
          {
            hostname,
            port,
            path: "/",
            method: "GET",
            agent,
          },
          res => {
            res.on("data", () => {});
            res.on("end", resolve);
          },
        );
        req.on("error", reject);
        req.end();

        await promise;
      } finally {
        server.close();
      }
    });

    test("inherits passphrase from agent.options", async () => {
      // Create server that accepts connections with encrypted key
      const { server, port, hostname } = await createHttpsServer({
        key: tlsCerts.encryptedKey,
        passphrase: tlsCerts.passphrase,
      });

      try {
        // Create an agent with encrypted key and passphrase in options
        const agent = new https.Agent({
          ca: tlsCerts.ca,
          cert: tlsCerts.cert,
          key: tlsCerts.encryptedKey,
          passphrase: tlsCerts.passphrase,
        });

        const { promise, resolve, reject } = Promise.withResolvers<void>();
        const req = https.request(
          {
            hostname,
            port,
            path: "/",
            method: "GET",
            agent,
            // NO passphrase here - should inherit from agent.options
          },
          res => {
            res.on("data", () => {});
            res.on("end", resolve);
          },
        );
        req.on("error", reject);
        req.end();

        await promise;
      } finally {
        server.close();
      }
    });

    test("supports multiple CAs (array)", async () => {
      const { server, port, hostname } = await createHttpsServer();

      try {
        // Create an agent with CA as an array
        const agent = new https.Agent({
          ca: [tlsCerts.ca], // Array of CAs
        });

        const { promise, resolve, reject } = Promise.withResolvers<void>();
        const req = https.request(
          {
            hostname,
            port,
            path: "/",
            method: "GET",
            agent,
          },
          res => {
            res.on("data", () => {});
            res.on("end", resolve);
          },
        );
        req.on("error", reject);
        req.end();

        await promise;
      } finally {
        server.close();
      }
    });
  });

  describe("TLS error handling", () => {
    test("rejects self-signed cert when rejectUnauthorized is true", async () => {
      const { server, port, hostname } = await createHttpsServer();

      try {
        // Create an agent without CA and with rejectUnauthorized: true (default)
        const agent = new https.Agent({
          rejectUnauthorized: true,
          // NO ca - should fail because cert is self-signed
        });

        const { promise, resolve, reject } = Promise.withResolvers<Error>();
        const req = https.request(
          {
            hostname,
            port,
            path: "/",
            method: "GET",
            agent,
          },
          () => {
            reject(new Error("Expected request to fail"));
          },
        );
        req.on("error", resolve);
        req.end();

        const error = await promise;
        // Should get a certificate error (self-signed cert not trusted)
        if (
          !(
            error.message.includes("self-signed") ||
            error.message.includes("SELF_SIGNED") ||
            error.message.includes("certificate") ||
            error.message.includes("unable to verify")
          )
        ) {
          throw new Error(`Expected certificate error, got: ${error.message}`);
        }
      } finally {
        server.close();
      }
    });
  });
});

describe("http.request agent options", () => {
  test("does not fail when agent has TLS options (they are ignored for HTTP)", async () => {
    const { server, port, hostname } = await createHttpServer();

    try {
      // Create an agent - TLS options passed via constructor should be ignored for HTTP
      // Using type assertion since http.Agent doesn't normally accept TLS options
      const agent = new (http.Agent as any)({
        rejectUnauthorized: false,
        ca: "some-ca",
      });

      const { promise, resolve, reject } = Promise.withResolvers<void>();
      const req = http.request(
        {
          hostname,
          port,
          path: "/",
          method: "GET",
          agent,
        },
        res => {
          res.on("data", () => {});
          res.on("end", resolve);
        },
      );
      req.on("error", reject);
      req.end();

      await promise;
    } finally {
      server.close();
    }
  });
});

describe(
  "https.request through a proxy from proxyEnv, with TLS options that tls.connect() rejects",
  // tls.connect() runs when the proxy has answered the CONNECT, after https.request() returned. nodejs/node#66096 gives
  // what it throws there to the request. No Node release has that change (v26.10.0 throws it uncaught). It is on Node
  // main, so v27 runs this block, and on v26.x-staging (33e4ba358b), which is not in a v26 release.
  { skip: typeof Bun === "undefined" && Number(process.versions.node.split(".")[0]) < 27 },
  () => {
    const target = { host: "example.invalid", port: 443, path: "/" };
    const invalidVersion = { minVersion: "TLSv9" };
    const rejected = [
      { name: "minVersion", options: invalidVersion, code: "ERR_TLS_INVALID_PROTOCOL_VERSION" },
      {
        name: "wrong passphrase",
        options: { key: tlsCerts.encryptedKey, cert: tlsCerts.cert, passphrase: "wrong" },
        code: "ERR_OSSL_BAD_DECRYPT",
      },
    ];

    function proxiedAgent(proxyUrl: string, options: https.AgentOptions = {}) {
      return new https.Agent({ ...options, proxyEnv: { https_proxy: proxyUrl } } as any);
    }

    // The error that tls.connect() throws for these options when nothing is between it and its caller.
    function thrownByTlsConnect(options: object) {
      try {
        tls.connect({ ...options } as any);
      } catch (err: any) {
        return { code: err.code, message: err.message };
      }
    }

    // A proxy that answers each CONNECT with 200 and then holds the connection.
    function createHoldingProxy(scheme: string) {
      const sockets = new Set<net.Socket>();
      const connects: string[] = [];
      // What the client sent after the CONNECT.
      const afterConnect: Buffer[] = [];
      // Settles when the first connection is closed. The proxy does not close it, so the client did.
      const { promise: closed, resolve: onClosed } = Promise.withResolvers<void>();

      function onTunnel(socket: net.Socket) {
        let head = "";
        socket.on("error", () => {});
        socket.on("data", function onHead(chunk: Buffer) {
          head += chunk.toString("latin1");
          if (!head.includes("\r\n\r\n")) return;
          socket.removeListener("data", onHead);
          connects.push(head.slice(0, head.indexOf("\r\n")));
          socket.on("data", (chunk: Buffer) => afterConnect.push(chunk));
          socket.write("HTTP/1.1 200 Connection established\r\n\r\n");
        });
      }

      const proxy =
        scheme === "https"
          ? tls.createServer({ key: tlsCerts.key, cert: tlsCerts.cert }, onTunnel)
          : net.createServer(onTunnel);
      // The TCP connection, for an https proxy too.
      proxy.on("connection", (socket: net.Socket) => {
        sockets.add(socket);
        socket.on("close", () => {
          sockets.delete(socket);
          onClosed();
        });
      });

      function close() {
        for (const socket of sockets) socket.destroy();
        proxy.close();
      }
      return { proxy, connects, afterConnect, closed, close };
    }

    // What the request emits, in order, up to and including its 'close'.
    function eventsOf(req: http.ClientRequest) {
      const events: unknown[] = [];
      const { promise, resolve } = Promise.withResolvers<unknown[]>();
      req.on("socket", () => events.push("socket"));
      req.on("response", res => {
        events.push(`response ${res.statusCode}`);
        res.resume();
      });
      req.on("timeout", () => events.push("timeout"));
      req.on("error", (err: NodeJS.ErrnoException) => events.push({ code: err.code, message: err.message }));
      req.on("close", () => {
        events.push("close");
        resolve(events);
      });
      return promise;
    }

    for (const scheme of ["http", "https"]) {
      for (const { name, options, code } of scheme === "http" ? rejected : rejected.slice(0, 1)) {
        test(`${scheme} proxy: ${name}`, async () => {
          const defaults = scheme === "https" ? tls.getCACertificates("default") : undefined;
          const { proxy, connects, closed, close } = createHoldingProxy(scheme);
          const agent = proxiedAgent(`${scheme}://127.0.0.1:${await startProxy(proxy)}`);
          try {
            // The client has to trust the certificate of an https proxy.
            if (defaults) tls.setDefaultCACertificates([...defaults, tlsCerts.cert]);
            const expected = { code, message: thrownByTlsConnect(options)?.message };
            const req = https.get({ ...target, agent, ...options } as any);
            assert.deepStrictEqual(await eventsOf(req), [expected, "close"]);
            await closed;
            assert.deepStrictEqual(connects, ["CONNECT example.invalid:443 HTTP/1.1"]);
          } finally {
            agent.destroy();
            close();
            if (defaults) tls.setDefaultCACertificates(defaults);
          }
        });
      }
    }

    test("agent.createConnection() gives its callback the error and the closed proxy socket", async () => {
      const { proxy, closed, close } = createHoldingProxy("http");
      const agent = proxiedAgent(`http://127.0.0.1:${await startProxy(proxy)}`);
      try {
        const calls: unknown[] = [];
        const { promise: called, resolve: onCalled } = Promise.withResolvers<void>();
        const proxySocket = (agent as any).createConnection(
          { ...target, ...invalidVersion },
          (err: NodeJS.ErrnoException, socket: net.Socket) => {
            calls.push({ code: err.code, proxySocket: socket === proxySocket, destroyed: socket.destroyed });
            onCalled();
          },
        );
        await called;
        assert.deepStrictEqual(calls, [
          { code: "ERR_TLS_INVALID_PROTOCOL_VERSION", proxySocket: true, destroyed: true },
        ]);
        await closed;
      } finally {
        agent.destroy();
        close();
      }
    });

    test("a falsy value thrown by tls.connect(): the proxy gets nothing of the request", async () => {
      const { proxy, connects, afterConnect, closed, close } = createHoldingProxy("http");
      const agent = proxiedAgent(`http://127.0.0.1:${await startProxy(proxy)}`);
      try {
        // agent.getName() reads the key too: throw at the first read after the CONNECT, which is tls.connect()'s.
        let thrown = false;
        const key = [
          {
            get pem() {
              if (connects.length === 0 || thrown) return tlsCerts.key;
              thrown = true;
              throw null;
            },
          },
        ];
        const req = https.request({ ...target, agent, method: "POST", key } as any);
        const events = eventsOf(req);
        req.end("for the target only");
        // The Agent takes a falsy error for success. The socket that it gives the request is closed.
        const [socket] = await once(req, "socket");
        assert.strictEqual(socket.destroyed, true);
        assert.deepStrictEqual(await events, ["socket", { code: "ECONNRESET", message: "socket hang up" }, "close"]);
        await closed;
        assert.strictEqual(Buffer.concat(afterConnect).toString("latin1"), "");
      } finally {
        agent.destroy();
        close();
      }
    });

    test("a request that waited behind maxTotalSockets", async () => {
      const { server, port, hostname } = await createHttpsServer();
      const proxy = createConnectProxy();
      let tunnels = 0;
      proxy.on("connection", () => tunnels++);
      const agent = proxiedAgent(`http://127.0.0.1:${await startProxy(proxy)}`, {
        ca: tlsCerts.ca,
        maxTotalSockets: 1,
      });
      try {
        const request = { hostname, port, path: "/", agent };
        const first = https.get(request);
        const firstEvents = eventsOf(first);
        // The Agent counts the socket of a tunnel from when the tunnel is there. Later requests then wait.
        await once(first, "socket");
        const rejectedEvents = eventsOf(https.get({ ...request, ...invalidVersion } as any));
        const lastEvents = eventsOf(https.get(request));
        assert.strictEqual(Object.values(agent.requests).flat().length, 2);

        assert.deepStrictEqual(await rejectedEvents, [thrownByTlsConnect(invalidVersion), "close"]);
        assert.deepStrictEqual(await firstEvents, ["socket", "response 200", "close"]);
        assert.deepStrictEqual(await lastEvents, ["socket", "response 200", "close"]);
        assert.strictEqual(tunnels, 3);
      } finally {
        agent.destroy();
        server.close();
        proxy.close();
      }
    });
  },
);

// https.Agent#getName() names the socket pool and the TLS session cache, so two requests whose options make a different
// connection must get different names, whatever form the options take. Node fixed the `pfx: [{ buf, passphrase }]` form
// in nodejs/node 9f03017f38 (CVE-2026-56850).
const isBun = !!process.versions.bun;
// Node ships the fix from v22.23.2, v24.18.1 and v26.5.1. An older Node shares the pool, so
// the pfx cases only describe it from those versions on. Bun always runs them.
const runtimeHasFix = (() => {
  if (isBun) return true;
  const [major, minor, patch] = process.versions.node.split(".").map(Number);
  const atLeast = (fixedMinor: number, fixedPatch: number) =>
    minor > fixedMinor || (minor === fixedMinor && patch >= fixedPatch);
  if (major === 22) return atLeast(23, 2);
  if (major === 24) return atLeast(18, 1);
  if (major === 26) return atLeast(5, 1);
  return major > 26;
})();
const fixedTest = runtimeHasFix ? test : test.skip;
const bunTest = isBun ? test : test.skip;

const keys = join(__dirname, "..", "test", "fixtures", "keys");
const read = (name: string) => readFileSync(join(keys, name));
const readArrayBuffer = (name: string) => {
  const buffer = read(name);
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
};

// agent1 is CN=agent1, agent10 is CN=agent10.example.com. Both .pfx files use "sample".
type Identity = "agent1" | "agent10";
type Forms = Record<string, (id: Identity) => object>;
const commonName = { agent1: "agent1", agent10: "agent10.example.com" };

const nodeForms: Forms = {
  "pfx: [{ buf, passphrase }]": id => ({ pfx: [{ buf: read(`${id}.pfx`), passphrase: "sample" }] }),
};
const bunForms: Forms = {
  "pfx: { buf, passphrase }": id => ({ pfx: { buf: read(`${id}.pfx`), passphrase: "sample" } }),
  "pfx: [ArrayBuffer]": id => ({ pfx: [readArrayBuffer(`${id}.pfx`)], passphrase: "sample" }),
  "cert, key: ArrayBuffer": id => ({
    cert: readArrayBuffer(`${id}-cert.pem`),
    key: readArrayBuffer(`${id}-key.pem`),
  }),
  "cert, key: BunFile": id => ({
    cert: Bun.file(join(keys, `${id}-cert.pem`)),
    key: Bun.file(join(keys, `${id}-key.pem`)),
  }),
  "certFile, keyFile": id => ({ certFile: join(keys, `${id}-cert.pem`), keyFile: join(keys, `${id}-key.pem`) }),
  // Node v26.5.1 shares the connection.
  "secureContext": id => ({
    secureContext: tls.createSecureContext({ cert: read(`${id}-cert.pem`), key: read(`${id}-key.pem`) }),
  }),
};
const forms: Forms = isBun ? { ...nodeForms, ...bunForms } : nodeForms;

// Answers every request with the CN of the client certificate the connection authenticated with.
async function listen() {
  const server = tls.createServer(
    { key: read("agent2-key.pem"), cert: read("agent2-cert.pem"), requestCert: true, rejectUnauthorized: false },
    socket => {
      socket.on("error", () => {});
      socket.on("data", () => {
        const body = String(socket.getPeerCertificate().subject?.CN);
        socket.write(`HTTP/1.1 200 OK\r\nContent-Length: ${body.length}\r\n\r\n${body}`);
      });
    },
  );
  await once(server.listen(0, "127.0.0.1"), "listening");
  return { server, port: (server.address() as AddressInfo).port };
}

async function get(agent: https.Agent, port: number, options: object) {
  const req = https.get({ host: "127.0.0.1", port, agent, rejectUnauthorized: false, ...options });
  const [res] = await once(req, "response");
  res.setEncoding("utf8");
  let peer = "";
  res.on("data", (chunk: string) => (peer += chunk));
  await once(res, "end");
  return { peer, reusedSocket: req.reusedSocket };
}

// One agent per form, all forms at once: { [form]: the answers to `identities` in order }.
async function answersByForm(agentOptions: https.AgentOptions, identities: Identity[], reuseOptions: boolean) {
  const { server, port } = await listen();
  try {
    const entries = await Promise.all(
      Object.entries(forms).map(async ([form, optionsFor]) => {
        const agent = new https.Agent(agentOptions);
        const cached: Partial<Record<Identity, object>> = {};
        try {
          const answers: object[] = [];
          for (const id of identities) {
            const options = reuseOptions ? (cached[id] ??= optionsFor(id)) : optionsFor(id);
            answers.push(await get(agent, port, options));
          }
          return [form, answers];
        } finally {
          agent.destroy();
        }
      }),
    );
    return Object.fromEntries(entries);
  } finally {
    server.close();
  }
}
const expectedByForm = (answers: object[]) => Object.fromEntries(Object.keys(forms).map(form => [form, answers]));

describe("https.Agent keeps client certificates apart", () => {
  fixedTest("a pooled socket is not shared across client certificates", async () => {
    // The third request passes the first request's option values again, so it pools.
    assert.deepStrictEqual(
      await answersByForm({ keepAlive: true }, ["agent1", "agent10", "agent1"], true),
      expectedByForm([
        { peer: commonName.agent1, reusedSocket: false },
        { peer: commonName.agent10, reusedSocket: false },
        { peer: commonName.agent1, reusedSocket: true },
      ]),
    );
  });

  // Without keepAlive every request opens a connection, but the agent still offers the
  // session it cached under the same name, and a resumed session keeps its first identity.
  fixedTest("a cached TLS session is not resumed across client certificates", async () => {
    assert.deepStrictEqual(
      await answersByForm({ keepAlive: false }, ["agent1", "agent10"], false),
      expectedByForm([
        { peer: commonName.agent1, reusedSocket: false },
        { peer: commonName.agent10, reusedSocket: false },
      ]),
    );
  });
});

// The server sends agent6 and ca3, the intermediate that signed it. ca1 signed ca3, ca2 signed neither.
describe("https.Agent keeps trust settings apart", () => {
  const rows: [string, () => object, () => object, string][] = [
    [
      "allowPartialTrustChain",
      () => ({ ca: read("ca3-cert.pem"), allowPartialTrustChain: true }),
      () => ({ ca: read("ca3-cert.pem") }),
      "UNABLE_TO_GET_ISSUER_CERT",
    ],
    [
      "caFile",
      () => ({ caFile: join(keys, "ca1-cert.pem") }),
      () => ({ caFile: join(keys, "ca2-cert.pem") }),
      "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
    ],
    [
      "secureContext",
      () => ({ secureContext: tls.createSecureContext({ ca: read("ca1-cert.pem") }) }),
      () => ({ secureContext: tls.createSecureContext({ ca: read("ca2-cert.pem") }) }),
      "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
    ],
  ];
  for (const [option, trusting, distrusting, code] of rows) {
    for (const keepAlive of [true, false]) {
      bunTest(`${option}: the second request is verified again, keepAlive: ${keepAlive}`, async () => {
        const server = tls.createServer({ key: read("agent6-key.pem"), cert: read("agent6-cert.pem") }, socket => {
          socket.on("error", () => {});
          socket.on("data", () => socket.write("HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nok"));
        });
        await once(server.listen(0, "127.0.0.1"), "listening");
        // On the Agent: a request with its own checkServerIdentity never shares a connection.
        const agent = new https.Agent({ keepAlive, checkServerIdentity: () => undefined });
        const outcome = async (options: object) => {
          const req = https.get({ host: "127.0.0.1", port: (server.address() as AddressInfo).port, agent, ...options });
          try {
            const [res] = await once(req, "response");
            res.resume();
            await once(res, "end");
            return res.statusCode;
          } catch (error) {
            return (error as NodeJS.ErrnoException).code;
          }
        };
        try {
          assert.deepStrictEqual([await outcome(trusting()), await outcome(distrusting())], [200, code]);
        } finally {
          agent.destroy();
          server.close();
        }
      });
    }
  }
});

describe("https.Agent#getName", () => {
  const agent = new https.Agent();
  const name = (options: object) => agent.getName({ host: "localhost", port: 443, ...options });

  // The names Node v26.5.1 gives, from getPfxAgentKey().
  fixedTest("a pfx array has Node's name", () => {
    assert.strictEqual(
      name({ pfx: [Buffer.from("a"), { buf: "b", passphrase: "p" }], passphrase: "q" }),
      "localhost:443::::::::a:q:b:p::::::::::::::",
    );
    assert.strictEqual(
      name({ pfx: [Buffer.from("a"), Buffer.from("b")] }),
      "localhost:443::::::::a:undefined:b:undefined::::::::::::::",
    );
    assert.strictEqual(name({ pfx: Buffer.from("a"), passphrase: "q" }), "localhost:443:::::::a::::::::::::::");
  });

  fixedTest("`pfx: [{ buf, passphrase }]` is keyed by buf and passphrase", () => {
    const buf = read("agent1.pfx");
    const base = name({ pfx: [{ buf, passphrase: "sample" }] });
    assert.strictEqual(name({ pfx: [{ buf: Buffer.from(buf), passphrase: "sample" }] }), base);
    assert.strictEqual(name({ pfx: [{ buf }], passphrase: "sample" }), base);
    assert.notStrictEqual(name({ pfx: [{ buf: read("agent10.pfx"), passphrase: "sample" }] }), base);
    assert.notStrictEqual(name({ pfx: [{ buf, passphrase: "different" }] }), base);
    assert.notStrictEqual(
      name({ pfx: [{ __proto__: { buf, passphrase: "sample" } }] }),
      name({ pfx: [{ __proto__: { buf: read("agent10.pfx"), passphrase: "sample" } }] }),
    );
  });

  for (const form of Object.keys(bunForms)) {
    bunTest(`differs by content or identity, ${form}`, () => {
      const agent1 = bunForms[form]("agent1");
      assert.strictEqual(name(agent1), name(agent1));
      assert.notStrictEqual(name(agent1), name(bunForms[form]("agent10")));
    });
  }

  bunTest("`key: [{ pem, passphrase }]` is keyed by pem and not by passphrase", () => {
    const pem = read("agent1-key.pem");
    const base = name({ key: pem });
    assert.strictEqual(name({ key: [{ pem, passphrase: "a" }] }), base);
    assert.strictEqual(name({ key: [{ pem: readArrayBuffer("agent1-key.pem"), passphrase: "b" }] }), base);
    assert.strictEqual(name({ key: { pem } }), base);
    assert.notStrictEqual(name({ key: [{ pem: read("agent10-key.pem"), passphrase: "a" }] }), base);
  });

  bunTest("equal bytes share a name across string, Buffer, ArrayBuffer, DataView and array forms", () => {
    const cert = read("agent1-cert.pem");
    const base = name({ cert: cert.toString() });
    assert.strictEqual(name({ cert }), base);
    assert.strictEqual(name({ cert: readArrayBuffer("agent1-cert.pem") }), base);
    assert.strictEqual(name({ cert: [readArrayBuffer("agent1-cert.pem")] }), base);
    assert.strictEqual(
      name({ pfx: [{ buf: readArrayBuffer("agent1.pfx"), passphrase: "sample" }] }),
      name({ pfx: [{ buf: read("agent1.pfx"), passphrase: "sample" }] }),
    );
    const pfx = read("agent1.pfx");
    assert.strictEqual(name({ pfx: new DataView(pfx.buffer, pfx.byteOffset, pfx.byteLength) }), name({ pfx }));
    // What Node names by contents keeps Node's name.
    assert.strictEqual(
      name({ ca: ["a", null, undefined, Buffer.from("b")], key: ["k1", new Uint8Array([1, 2])], pfx: "pfx" }),
      "localhost:443::a,,,b::::k1,1,2:pfx::::::::::::::",
    );
  });

  bunTest("certFile, keyFile and caFile are labelled parts of the name", () => {
    const base = name({});
    assert.strictEqual(
      name({ certFile: "a", keyFile: "b", caFile: "c" }),
      `${base}:certFile="a":keyFile="b":caFile="c"`,
    );
    assert.notStrictEqual(name({ certFile: "a" }), name({ keyFile: "a" }));
    assert.notStrictEqual(name({ caFile: "a" }), name({ caFile: "b" }));
    // A path cannot spell the next part.
    assert.notStrictEqual(name({ certFile: 'a":keyFile="b' }), name({ certFile: "a", keyFile: "b" }));
  });

  bunTest("allowPartialTrustChain and secureContext are parts of the name when they are set", () => {
    const base = name({});
    assert.strictEqual(name({ allowPartialTrustChain: true }), `${base}:allowPartialTrustChain`);
    assert.strictEqual(name({ allowPartialTrustChain: false, secureContext: undefined }), base);
    const secureContext = tls.createSecureContext();
    assert.strictEqual(name({ secureContext }), name({ secureContext }));
    assert.notStrictEqual(name({ secureContext }), name({ secureContext: tls.createSecureContext() }));
    assert.notStrictEqual(name({ secureContext }), base);
  });
});

// Only run in Bun to avoid infinite loop when Node.js runs this file
if (typeof Bun !== "undefined") {
  const { bunEnv, bunExe, nodeExe } = await import("harness");

  describe("https.request through a proxy from NODE_USE_ENV_PROXY=1", () => {
    test("the request gets what tls.connect() throws, and the process exits", async () => {
      // Answers each CONNECT with 200 and then holds the connection.
      const sockets = new Set<net.Socket>();
      const proxy = net.createServer(socket => {
        sockets.add(socket);
        socket.on("error", () => {});
        socket.once("data", () => socket.write("HTTP/1.1 200 Connection established\r\n\r\n"));
      });
      const port = await startProxy(proxy);
      try {
        // The global agent takes the proxy from the environment when node:https loads.
        const script = `
          const events = [];
          const req = require("node:https").get("https://example.invalid/", { minVersion: "TLSv9" });
          req.on("error", err => events.push(err.code));
          req.on("close", () => {
            events.push("close");
            console.log(JSON.stringify(events));
          });
        `;
        await using proc = Bun.spawn({
          cmd: [bunExe(), "-e", script],
          env: {
            ...bunEnv,
            NODE_USE_ENV_PROXY: "1",
            HTTPS_PROXY: `http://127.0.0.1:${port}`,
            https_proxy: undefined,
            NO_PROXY: undefined,
            no_proxy: undefined,
          },
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        // The proxy holds the connection. The process can only exit when the client closed it.
        assert.deepStrictEqual(
          { stdout: stdout.trim(), stderr, exitCode },
          { stdout: JSON.stringify(["ERR_TLS_INVALID_PROTOCOL_VERSION", "close"]), stderr: "", exitCode: 0 },
        );
      } finally {
        for (const socket of sockets) socket.destroy();
        proxy.close();
      }
    });
  });

  describe("Node.js compatibility", () => {
    test("all tests pass in Node.js", async () => {
      const node = nodeExe();
      if (!node) {
        throw new Error("Node.js not found in PATH");
      }

      const testFile = fileURLToPath(import.meta.url);

      // Run the file directly rather than via `node --test`: the runner mode
      // forks a second node process for the file, and under CI's parallel
      // batch that extra process frequently fails uv_thread_create (EAGAIN)
      // at startup. A direct run uses one process and still exits non-zero on
      // any node:test failure. The pool-size knobs keep Node's V8 and libuv
      // worker pools minimal for the same reason.
      await using proc = Bun.spawn({
        cmd: [node, "--v8-pool-size=1", testFile],
        env: { ...bunEnv, UV_THREADPOOL_SIZE: "2" },
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);

      if (exitCode !== 0) {
        throw new Error(`Node.js tests failed with code ${exitCode}\n${stderr}\n${stdout}`);
      }
    });
  });
}
