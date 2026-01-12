/**
 * All tests in this file run in both Bun and Node.js.
 *
 * Test that TLS options can be inherited from agent.options and agent.connectOpts.
 * This is important for compatibility with libraries like https-proxy-agent.
 *
 * The HttpsProxyAgent tests verify that TLS options are properly passed through
 * the proxy tunnel to the target HTTPS server.
 */

import { describe, test } from "node:test";
import { once } from "node:events";
import http from "node:http";
import https from "node:https";
import { createRequire } from "node:module";
import net from "node:net";
import type { AddressInfo } from "node:net";

// Use createRequire for ESM compatibility
const require = createRequire(import.meta.url);
const { HttpsProxyAgent } = require("https-proxy-agent") as {
  HttpsProxyAgent: new (
    proxyUrl: string,
    options?: Record<string, unknown>
  ) => http.Agent;
};

// Self-signed certificate with SANs for localhost and 127.0.0.1
// This cert is its own CA (self-signed)
const tlsCerts = {
  cert: `-----BEGIN CERTIFICATE-----
MIID4jCCAsqgAwIBAgIUcaRq6J/YF++Bo01Zc+HeQvCbnWMwDQYJKoZIhvcNAQEL
BQAwaTELMAkGA1UEBhMCVVMxCzAJBgNVBAgMAkNBMRYwFAYDVQQHDA1TYW4gRnJh
bmNpc2NvMQ0wCwYDVQQKDARPdmVuMREwDwYDVQQLDAhUZWFtIEJ1bjETMBEGA1UE
AwwKc2VydmVyLWJ1bjAeFw0yNTA5MDYwMzAwNDlaFw0zNTA5MDQwMzAwNDlaMGkx
CzAJBgNVBAYTAlVTMQswCQYDVQQIDAJDQTEWMBQGA1UEBwwNU2FuIEZyYW5jaXNj
bzENMAsGA1UECgwET3ZlbjERMA8GA1UECwwIVGVhbSBCdW4xEzARBgNVBAMMCnNl
cnZlci1idW4wggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQDlYzosgRgX
HL6vMh1V0ERFhsvlZrtRojSw6tafr3SQBphU793/rGiYZlL/lJ9HIlLkx9JMbuTj
Nm5U2eRwHiTQIeWD4aCIESwPlkdaVYtC+IOj55bJN8xNa7h5GyJwF7PnPetAsKyE
8DMBn1gKMhaIis7HHOUtk4/K3Y4peU44d04z0yPt6JtY5Sbvi1E7pGX6T/2c9sHs
dIDeDctWnewpXXs8zkAla0KNWQfpDnpS53wxAfStTA4lSrA9daxC7hZopQlLxFIb
Jk+0BLbEsXtrJ54T5iguHk+2MDVAy4MOqP9XbKV7eGHk73l6+CSwmHyHBxh4ChxR
QeT5BP0MUTn1AgMBAAGjgYEwfzAdBgNVHQ4EFgQUw7nEnh4uOdZVZUapQzdAUaVa
An0wHwYDVR0jBBgwFoAUw7nEnh4uOdZVZUapQzdAUaVaAn0wDwYDVR0TAQH/BAUw
AwEB/zAsBgNVHREEJTAjgglsb2NhbGhvc3SHBH8AAAGHEAAAAAAAAAAAAAAAAAAA
AAEwDQYJKoZIhvcNAQELBQADggEBAEA8r1fvDLMSCb8bkAURpFk8chn8pl5MChzT
YUDaLdCCBjPXJkSXNdyuwS+T/ljAGyZbW5xuDccCNKltawO4CbyEXUEZbYr3w9eq
j8uqymJPhFf0O1rKOI2han5GBCgHwG13QwKI+4uu7390nD+TlzLOhxFfvOG7OadH
QNMNLNyldgF4Nb8vWdz0FtQiGUIrO7iq4LFhhd1lCxe0q+FAYSEYcc74WtF/Yo8V
JQauXuXyoP5FqLzNt/yeNQhceyIXJGKCsjr5/bASBmVlCwgRfsD3jpG37L8YCJs1
L4WEikcY4Lzb2NF9e94IyZdQsRqd9DFBF5zP013MSUiuhiow32k=
-----END CERTIFICATE-----
`,
  key: `-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQDlYzosgRgXHL6v
Mh1V0ERFhsvlZrtRojSw6tafr3SQBphU793/rGiYZlL/lJ9HIlLkx9JMbuTjNm5U
2eRwHiTQIeWD4aCIESwPlkdaVYtC+IOj55bJN8xNa7h5GyJwF7PnPetAsKyE8DMB
n1gKMhaIis7HHOUtk4/K3Y4peU44d04z0yPt6JtY5Sbvi1E7pGX6T/2c9sHsdIDe
DctWnewpXXs8zkAla0KNWQfpDnpS53wxAfStTA4lSrA9daxC7hZopQlLxFIbJk+0
BLbEsXtrJ54T5iguHk+2MDVAy4MOqP9XbKV7eGHk73l6+CSwmHyHBxh4ChxRQeT5
BP0MUTn1AgMBAAECggEABtPvC5uVGr0DjQX2GxONsK8cOxoVec7U+C4pUMwBcXcM
yjxwlHdujpi/IDXtjsm+A2rSPu2vGPdKDfMFanPvPxW/Ne99noc6U0VzHsR8lnP8
wSB328nyJhzOeyZcXk9KTtgIPF7156gZsJLsZTNL+ej90i3xQWvKxCxXmrLuad5O
z/TrgZkC6wC3fgj1d3e8bMljQ7tLxbshJMYVI5o6RFTxy84DLI+rlvPkf7XbiMPf
2lsm4jcJKvfx+164HZJ9QVlx8ncqOHAnGvxb2xHHfqv4JAbz615t7yRvtaw4Paj5
6kQSf0VWnsVzgxNJWvnUZym/i/Qf5nQafjChCyKOEQKBgQD9f4SkvJrp/mFKWLHd
kDvRpSIIltfJsa5KShn1IHsQXFwc0YgyP4SKQb3Ckv+/9UFHK9EzM+WlPxZi7ZOS
hsWhIfkI4c4ORpxUQ+hPi0K2k+HIY7eYyONqDAzw5PGkKBo3mSGMHDXYywSqexhB
CCMHuHdMhwyHdz4PWYOK3C2VMQKBgQDnpsrHK7lM9aVb8wNhTokbK5IlTSzH/5oJ
lAVu6G6H3tM5YQeoDXztbZClvrvKU8DU5UzwaC+8AEWQwaram29QIDpAI3nVQQ0k
dmHHp/pCeADdRG2whaGcl418UJMMv8AUpWTRm+kVLTLqfTHBC0ji4NlCQMHCUCfd
U8TeUi5QBQKBgQDvJNd7mboDOUmLG7VgMetc0Y4T0EnuKsMjrlhimau/OYJkZX84
+BcPXwmnf4nqC3Lzs3B9/12L0MJLvZjUSHQ0mJoZOPxtF0vvasjEEbp0B3qe0wOn
DQ0NRCUJNNKJbJOfE8VEKnDZ/lx+f/XXk9eINwvElDrLqUBQtr+TxjbyYQKBgAxQ
lZ8Y9/TbajsFJDzcC/XhzxckjyjisbGoqNFIkfevJNN8EQgiD24f0Py+swUChtHK
jtiI8WCxMwGLCiYs9THxRKd8O1HW73fswy32BBvcfU9F//7OW9UTSXY+YlLfLrrq
P/3UqAN0L6y/kxGMJAfLpEEdaC+IS1Y8yc531/ZxAoGASYiasDpePtmzXklDxk3h
jEw64QAdXK2p/xTMjSeTtcqJ7fvaEbg+Mfpxq0mdTjfbTdR9U/nzAkwS7OoZZ4Du
ueMVls0IVqcNnBtikG8wgdxN27b5JPXS+GzQ0zDSpWFfRPZiIh37BAXr0D1voluJ
rEHkcals6p7hL98BoxjFIvA=
-----END PRIVATE KEY-----
`,
  // Self-signed cert, so it's its own CA
  get ca() {
    return this.cert;
  },
};

async function createHttpsServer(
  options: https.ServerOptions = {}
): Promise<{ server: https.Server; port: number; hostname: string }> {
  const server = https.createServer(
    { key: tlsCerts.key, cert: tlsCerts.cert, ...options },
    (req, res) => {
      res.writeHead(200);
      res.end("OK");
    }
  );
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
  return net.createServer((clientSocket) => {
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
      const headerBytes = new TextEncoder().encode(
        bufferStr.substring(0, headerEnd + 4)
      ).length;
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
  return new Promise<number>((resolve) => {
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
          (res) => {
            res.on("data", () => {});
            res.on("end", resolve);
          }
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
          (res) => {
            res.on("data", () => {});
            res.on("end", resolve);
          }
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
          (res) => {
            res.on("data", () => {});
            res.on("end", resolve);
          }
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
          (res) => {
            res.on("data", () => {});
            res.on("end", resolve);
          }
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
          (res) => {
            res.on("data", () => {});
            res.on("end", resolve);
          }
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
          (res) => {
            res.on("data", () => {});
            res.on("end", resolve);
          }
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
          (res) => {
            res.on("data", () => {});
            res.on("end", resolve);
          }
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
          (res) => {
            res.on("data", () => {});
            res.on("end", resolve);
          }
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
          (res) => {
            res.on("data", () => {});
            res.on("end", resolve);
          }
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
          (res) => {
            res.on("data", () => {});
            res.on("end", resolve);
          }
        );
        req.on("error", reject);
        req.end();

        await promise;
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
        (res) => {
          res.on("data", () => {});
          res.on("end", resolve);
        }
      );
      req.on("error", reject);
      req.end();

      await promise;
    } finally {
      server.close();
    }
  });
});
