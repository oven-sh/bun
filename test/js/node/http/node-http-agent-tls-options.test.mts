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
import { once } from "node:events";
import { readFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import type { AddressInfo } from "node:net";
import net from "node:net";
import { dirname, join } from "node:path";
import { describe, test } from "node:test";
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

// Only run in Bun to avoid infinite loop when Node.js runs this file
if (typeof Bun !== "undefined") {
  const { bunEnv, nodeExe } = await import("harness");

  describe("Node.js compatibility", () => {
    test("all tests pass in Node.js", async () => {
      const node = nodeExe();
      if (!node) {
        throw new Error("Node.js not found in PATH");
      }

      const testFile = fileURLToPath(import.meta.url);

      await using proc = Bun.spawn({
        cmd: [node, "--test", testFile],
        env: bunEnv,
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
