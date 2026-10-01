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
      { name: "ciphers", options: { ciphers: 123 }, code: "ERR_INVALID_ARG_TYPE" },
      { name: "secureProtocol", options: { secureProtocol: "TLSv9_method" }, code: "ERR_TLS_INVALID_PROTOCOL_METHOD" },
      { name: "checkServerIdentity", options: { checkServerIdentity: "not a function" }, code: "ERR_INVALID_ARG_TYPE" },
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
      for (const { name, options, code } of rejected) {
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
      const { proxy, afterConnect, closed, close } = createHoldingProxy("http");
      const agent = proxiedAgent(`http://127.0.0.1:${await startProxy(proxy)}`);
      try {
        const key = [
          {
            get pem() {
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

    test("http.setGlobalProxyFromEnv()", async () => {
      const { proxy, connects, closed, close } = createHoldingProxy("http");
      const restore = (http as any).setGlobalProxyFromEnv({
        https_proxy: `http://127.0.0.1:${await startProxy(proxy)}`,
      });
      try {
        const req = https.get({ ...target, ...invalidVersion } as any);
        assert.deepStrictEqual(await eventsOf(req), [thrownByTlsConnect(invalidVersion), "close"]);
        await closed;
        assert.deepStrictEqual(connects, ["CONNECT example.invalid:443 HTTP/1.1"]);
      } finally {
        restore();
        close();
      }
    });

    test("a request with a timeout gets the error and no 'timeout'", async () => {
      const { proxy, closed, close } = createHoldingProxy("http");
      const agent = proxiedAgent(`http://127.0.0.1:${await startProxy(proxy)}`);
      try {
        // The tunnel takes the timeout of the request. It is far longer than the test.
        const req = https.get({ ...target, agent, ...invalidVersion, timeout: 600_000 } as any);
        assert.deepStrictEqual(await eventsOf(req), [thrownByTlsConnect(invalidVersion), "close"]);
        await closed;
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
