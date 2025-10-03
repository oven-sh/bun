/**
 * SOCKS5 Proxy Tests
 *
 * This test suite validates Bun's SOCKS5 proxy implementation against the spec:
 * - RFC 1928: SOCKS Protocol Version 5
 * - RFC 1929: Username/Password Authentication for SOCKS V5
 *
 * Test coverage includes:
 * 1. Basic SOCKS5 connection (no auth)
 * 2. Username/password authentication
 * 3. socks5:// vs socks5h:// (DNS resolution)
 * 4. HTTP and HTTPS through SOCKS5
 * 5. Error handling (auth failure, connection refused, etc.)
 * 6. Protocol compliance (proper handshake sequence)
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tls as tlsCert } from "harness";
import net from "node:net";
import { once } from "node:events";
import type { Server } from "bun";

// SOCKS5 Protocol Constants (RFC 1928)
const SOCKS5_VERSION = 0x05;
const AUTH_NONE = 0x00;
const AUTH_USERNAME_PASSWORD = 0x02;
const AUTH_NO_ACCEPTABLE = 0xFF;
const CMD_CONNECT = 0x01;
const ATYP_IPV4 = 0x01;
const ATYP_DOMAIN = 0x03;
const ATYP_IPV6 = 0x04;
const REP_SUCCESS = 0x00;
const REP_SERVER_FAILURE = 0x01;
const REP_CONNECTION_REFUSED = 0x05;

interface SOCKS5ProxyOptions {
  requireAuth?: boolean;
  username?: string;
  password?: string;
  failAuth?: boolean;
  failConnection?: boolean;
  logRequests?: boolean;
}

/**
 * Create a SOCKS5 proxy server that implements RFC 1928
 *
 * This server properly handles:
 * - Method negotiation
 * - No authentication (0x00)
 * - Username/password authentication (0x02) per RFC 1929
 * - Connection requests (CONNECT command)
 * - All address types (IPv4, IPv6, domain names)
 */
async function createSOCKS5ProxyServer(options: SOCKS5ProxyOptions = {}) {
  const {
    requireAuth = false,
    username = "testuser",
    password = "testpass",
    failAuth = false,
    failConnection = false,
    logRequests = false,
  } = options;

  const log: string[] = [];

  const server = net.createServer((clientSocket) => {
    let authenticated = !requireAuth;
    let currentStep: "greeting" | "auth" | "request" = "greeting";

    clientSocket.on("data", (data) => {
      try {
        if (currentStep === "greeting") {
          // Step 1: Client greeting
          // +----+----------+----------+
          // |VER | NMETHODS | METHODS  |
          // +----+----------+----------+
          // | 1  |    1     | 1 to 255 |
          // +----+----------+----------+
          const version = data[0];
          const nmethods = data[1];
          const methods = Array.from(data.slice(2, 2 + nmethods));

          if (version !== SOCKS5_VERSION) {
            if (logRequests) log.push(`Invalid version: ${version}`);
            clientSocket.end();
            return;
          }

          if (logRequests) log.push(`Greeting: methods=${methods.map(m => `0x${m.toString(16)}`).join(",")}`);

          // Step 2: Server selects authentication method
          // +----+--------+
          // |VER | METHOD |
          // +----+--------+
          // | 1  |   1    |
          // +----+--------+
          let selectedMethod: number;
          if (requireAuth) {
            if (methods.includes(AUTH_USERNAME_PASSWORD)) {
              selectedMethod = AUTH_USERNAME_PASSWORD;
              currentStep = "auth";
            } else {
              selectedMethod = AUTH_NO_ACCEPTABLE;
            }
          } else {
            if (methods.includes(AUTH_NONE)) {
              selectedMethod = AUTH_NONE;
              currentStep = "request";
              authenticated = true;
            } else {
              selectedMethod = AUTH_NO_ACCEPTABLE;
            }
          }

          const response = Buffer.from([SOCKS5_VERSION, selectedMethod]);
          clientSocket.write(response);

          if (selectedMethod === AUTH_NO_ACCEPTABLE) {
            clientSocket.end();
          }
        } else if (currentStep === "auth") {
          // Step 3: Username/Password authentication (RFC 1929)
          // Client request:
          // +----+------+----------+------+----------+
          // |VER | ULEN |  UNAME   | PLEN |  PASSWD  |
          // +----+------+----------+------+----------+
          // | 1  |  1   | 1 to 255 |  1   | 1 to 255 |
          // +----+------+----------+------+----------+
          const authVersion = data[0];
          if (authVersion !== 0x01) {
            if (logRequests) log.push(`Invalid auth version: ${authVersion}`);
            clientSocket.end();
            return;
          }

          const ulen = data[1];
          const uname = data.slice(2, 2 + ulen).toString();
          const plen = data[2 + ulen];
          const passwd = data.slice(3 + ulen, 3 + ulen + plen).toString();

          if (logRequests) log.push(`Auth: username=${uname}`);

          // Server response:
          // +----+--------+
          // |VER | STATUS |
          // +----+--------+
          // | 1  |   1    |
          // +----+--------+
          // Status: 0x00 = success, non-zero = failure
          let authStatus: number;
          if (failAuth || uname !== username || passwd !== password) {
            authStatus = 0x01; // Auth failed
            if (logRequests) log.push(`Auth failed: expected ${username}/${password}, got ${uname}/${passwd}`);
          } else {
            authStatus = 0x00; // Auth success
            authenticated = true;
            currentStep = "request";
          }

          const response = Buffer.from([0x01, authStatus]);
          clientSocket.write(response);

          if (authStatus !== 0x00) {
            clientSocket.end();
          }
        } else if (currentStep === "request") {
          // Step 4: Connection request
          // +----+-----+-------+------+----------+----------+
          // |VER | CMD |  RSV  | ATYP | DST.ADDR | DST.PORT |
          // +----+-----+-------+------+----------+----------+
          // | 1  |  1  | X'00' |  1   | Variable |    2     |
          // +----+-----+-------+------+----------+----------+
          if (!authenticated) {
            if (logRequests) log.push("Request without authentication");
            clientSocket.end();
            return;
          }

          const version = data[0];
          const cmd = data[1];
          const atyp = data[3];

          if (version !== SOCKS5_VERSION) {
            if (logRequests) log.push(`Invalid version in request: ${version}`);
            clientSocket.end();
            return;
          }

          if (cmd !== CMD_CONNECT) {
            if (logRequests) log.push(`Unsupported command: ${cmd}`);
            // Send command not supported response
            const response = Buffer.from([SOCKS5_VERSION, 0x07, 0x00, ATYP_IPV4, 0, 0, 0, 0, 0, 0]);
            clientSocket.write(response);
            clientSocket.end();
            return;
          }

          // Parse destination address based on type
          let destHost: string;
          let destPort: number;
          let addrEnd: number;

          if (atyp === ATYP_IPV4) {
            // IPv4: 4 bytes
            destHost = `${data[4]}.${data[5]}.${data[6]}.${data[7]}`;
            addrEnd = 8;
          } else if (atyp === ATYP_DOMAIN) {
            // Domain: 1 byte length + domain name
            const domainLen = data[4];
            destHost = data.slice(5, 5 + domainLen).toString();
            addrEnd = 5 + domainLen;
          } else if (atyp === ATYP_IPV6) {
            // IPv6: 16 bytes
            const ipv6Parts = [];
            for (let i = 0; i < 16; i += 2) {
              ipv6Parts.push(((data[4 + i] << 8) | data[5 + i]).toString(16));
            }
            destHost = ipv6Parts.join(":");
            addrEnd = 20;
          } else {
            if (logRequests) log.push(`Unsupported address type: ${atyp}`);
            // Send address type not supported response
            const response = Buffer.from([SOCKS5_VERSION, 0x08, 0x00, ATYP_IPV4, 0, 0, 0, 0, 0, 0]);
            clientSocket.write(response);
            clientSocket.end();
            return;
          }

          // Port is always 2 bytes, big-endian
          destPort = (data[addrEnd] << 8) | data[addrEnd + 1];

          if (logRequests) log.push(`CONNECT ${destHost}:${destPort}`);

          // Step 5: Server response
          // +----+-----+-------+------+----------+----------+
          // |VER | REP |  RSV  | ATYP | BND.ADDR | BND.PORT |
          // +----+-----+-------+------+----------+----------+
          // | 1  |  1  | X'00' |  1   | Variable |    2     |
          // +----+-----+-------+------+----------+----------+

          if (failConnection) {
            // Simulate connection refused
            const response = Buffer.from([
              SOCKS5_VERSION,
              REP_CONNECTION_REFUSED,
              0x00,
              ATYP_IPV4,
              0, 0, 0, 0, // BND.ADDR (0.0.0.0)
              0, 0, // BND.PORT (0)
            ]);
            clientSocket.write(response);
            clientSocket.end();
            return;
          }

          // Establish connection to destination
          const destSocket = net.connect(destPort, destHost, () => {
            if (logRequests) log.push(`Connected to ${destHost}:${destPort}`);

            // Send success response
            const response = Buffer.from([
              SOCKS5_VERSION,
              REP_SUCCESS,
              0x00,
              ATYP_IPV4,
              0, 0, 0, 0, // BND.ADDR (could be actual bind address)
              0, 0, // BND.PORT (could be actual bind port)
            ]);
            clientSocket.write(response);

            // Step 6: Data transfer - pipe data bidirectionally
            clientSocket.pipe(destSocket);
            destSocket.pipe(clientSocket);
          });

          destSocket.on("error", (err) => {
            if (logRequests) log.push(`Connection error: ${err.message}`);
            // Send server failure response
            const response = Buffer.from([
              SOCKS5_VERSION,
              REP_SERVER_FAILURE,
              0x00,
              ATYP_IPV4,
              0, 0, 0, 0,
              0, 0,
            ]);
            clientSocket.write(response);
            clientSocket.end();
          });
        }
      } catch (error) {
        if (logRequests) log.push(`Error: ${error}`);
        clientSocket.end();
      }
    });

    clientSocket.on("error", () => {
      // Ignore client errors
    });
  });

  server.listen(0);
  await once(server, "listening");
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;

  return {
    server,
    port,
    url: `socks5://localhost:${port}`,
    urlWithAuth: requireAuth ? `socks5://${username}:${password}@localhost:${port}` : `socks5://localhost:${port}`,
    log,
  };
}

// Test servers
let httpServer: Server;
let httpsServer: Server;
let socks5Server: Awaited<ReturnType<typeof createSOCKS5ProxyServer>>;
let socks5AuthServer: Awaited<ReturnType<typeof createSOCKS5ProxyServer>>;

beforeAll(async () => {
  // HTTP server for testing
  httpServer = Bun.serve({
    port: 0,
    fetch(req) {
      return new Response(`HTTP response from ${req.url}`, {
        headers: { "X-Test": "http" },
      });
    },
  });

  // HTTPS server for testing
  httpsServer = Bun.serve({
    port: 0,
    tls: tlsCert,
    fetch(req) {
      return new Response(`HTTPS response from ${req.url}`, {
        headers: { "X-Test": "https" },
      });
    },
  });

  // SOCKS5 proxy without authentication
  socks5Server = await createSOCKS5ProxyServer({
    logRequests: true,
  });

  // SOCKS5 proxy with username/password authentication
  socks5AuthServer = await createSOCKS5ProxyServer({
    requireAuth: true,
    username: "testuser",
    password: "testpass",
    logRequests: true,
  });
});

afterAll(() => {
  httpServer?.stop(true);
  httpsServer?.stop(true);
  socks5Server?.server.close();
  socks5AuthServer?.server.close();
});

describe("SOCKS5 Proxy - Basic Functionality", () => {
  test("should connect through SOCKS5 proxy without authentication (HTTP)", async () => {
    const response = await fetch(`http://localhost:${httpServer.port}/test`, {
      proxy: socks5Server.url,
    });

    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain("HTTP response");
    expect(socks5Server.log.length).toBeGreaterThan(0);
    expect(socks5Server.log.some(log => log.includes("CONNECT"))).toBe(true);
  });

  test("should connect through SOCKS5 proxy without authentication (HTTPS)", async () => {
    const response = await fetch(`https://localhost:${httpsServer.port}/test`, {
      proxy: socks5Server.url,
      tls: {
        rejectUnauthorized: false,
      },
    });

    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain("HTTPS response");
    expect(socks5Server.log.some(log => log.includes("CONNECT"))).toBe(true);
  });

  test("should handle POST requests through SOCKS5 proxy", async () => {
    const testData = "test body data";
    const response = await fetch(`http://localhost:${httpServer.port}/post`, {
      method: "POST",
      body: testData,
      proxy: socks5Server.url,
    });

    expect(response.status).toBe(200);
  });
});

describe("SOCKS5 Proxy - Authentication", () => {
  test("should authenticate with username and password", async () => {
    const response = await fetch(`http://localhost:${httpServer.port}/test`, {
      proxy: socks5AuthServer.urlWithAuth,
    });

    expect(response.status).toBe(200);
    expect(socks5AuthServer.log.some(log => log.includes("Auth: username=testuser"))).toBe(true);
  });

  test("should fail with wrong password", async () => {
    const wrongAuthUrl = `socks5://testuser:wrongpass@localhost:${socks5AuthServer.port}`;

    await expect(
      fetch(`http://localhost:${httpServer.port}/test`, {
        proxy: wrongAuthUrl,
      })
    ).rejects.toThrow();
  });

  test("should fail when authentication is required but not provided", async () => {
    // Try without auth when auth is required
    const noAuthUrl = `socks5://localhost:${socks5AuthServer.port}`;

    await expect(
      fetch(`http://localhost:${httpServer.port}/test`, {
        proxy: noAuthUrl,
      })
    ).rejects.toThrow();
  });
});

describe("SOCKS5 Proxy - DNS Resolution", () => {
  test("socks5:// should allow local DNS resolution", async () => {
    // With socks5://, Bun may resolve DNS locally
    const response = await fetch(`http://localhost:${httpServer.port}/test`, {
      proxy: socks5Server.url,
    });

    expect(response.status).toBe(200);
  });

  test("socks5h:// should force remote DNS resolution", async () => {
    // With socks5h://, DNS resolution happens on proxy server
    const socks5hUrl = socks5Server.url.replace("socks5://", "socks5h://");

    const response = await fetch(`http://localhost:${httpServer.port}/test`, {
      proxy: socks5hUrl,
    });

    expect(response.status).toBe(200);
    // With socks5h://, we should see domain name in CONNECT, not IP
    expect(socks5Server.log.some(log => log.includes("localhost"))).toBe(true);
  });
});

describe("SOCKS5 Proxy - Error Handling", () => {
  test("should handle connection refused", async () => {
    const failServer = await createSOCKS5ProxyServer({
      failConnection: true,
    });

    try {
      await expect(
        fetch(`http://localhost:${httpServer.port}/test`, {
          proxy: failServer.url,
        })
      ).rejects.toThrow();
    } finally {
      failServer.server.close();
    }
  });

  test("should handle invalid SOCKS5 proxy URL", async () => {
    await expect(
      fetch(`http://localhost:${httpServer.port}/test`, {
        proxy: "socks5://invalid-host-that-does-not-exist:1080",
      })
    ).rejects.toThrow();
  });

  test("should handle proxy connection timeout", async () => {
    // Create a server that accepts connections but never responds
    const timeoutServer = net.createServer((socket) => {
      // Accept but never send greeting response
      socket.on("data", () => {});
    });

    timeoutServer.listen(0);
    await once(timeoutServer, "listening");
    const address = timeoutServer.address();
    const port = typeof address === "object" && address !== null ? address.port : 0;

    try {
      await expect(
        fetch(`http://localhost:${httpServer.port}/test`, {
          proxy: `socks5://localhost:${port}`,
        })
      ).rejects.toThrow();
    } finally {
      timeoutServer.close();
    }
  }, 10000); // Longer timeout for this test
});

describe("SOCKS5 Proxy - Protocol Compliance", () => {
  test("should send correct SOCKS5 version", async () => {
    const testServer = await createSOCKS5ProxyServer({ logRequests: true });

    try {
      await fetch(`http://localhost:${httpServer.port}/test`, {
        proxy: testServer.url,
      });

      // Check that greeting was received (version check happens in server)
      expect(testServer.log.some(log => log.includes("Greeting"))).toBe(true);
    } finally {
      testServer.server.close();
    }
  });

  test("should handle all address types (IPv4, domain)", async () => {
    const testServer = await createSOCKS5ProxyServer({ logRequests: true });

    try {
      // Test with domain name (localhost)
      await fetch(`http://localhost:${httpServer.port}/test`, {
        proxy: testServer.url,
      });

      expect(testServer.log.some(log => log.includes("CONNECT"))).toBe(true);

      // Test with IPv4 (127.0.0.1)
      await fetch(`http://127.0.0.1:${httpServer.port}/test`, {
        proxy: testServer.url,
      });

      expect(testServer.log.filter(log => log.includes("CONNECT")).length).toBe(2);
    } finally {
      testServer.server.close();
    }
  });
});

describe("SOCKS5 Proxy - Environment Variables", () => {
  test("should use SOCKS5_PROXY environment variable", async () => {
    const env = {
      ...bunEnv,
      SOCKS5_PROXY: socks5Server.url,
    };

    using server = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const response = await fetch("http://localhost:${httpServer.port}/test");
        console.log(response.status);
        `,
      ],
      env,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      server.stdout.text(),
      server.stderr.text(),
      server.exited,
    ]);

    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe("200");
  });

  test("should use HTTP_PROXY with socks5:// protocol", async () => {
    const env = {
      ...bunEnv,
      HTTP_PROXY: socks5Server.url,
    };

    using server = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const response = await fetch("http://localhost:${httpServer.port}/test");
        console.log(response.status);
        `,
      ],
      env,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      server.stdout.text(),
      server.stderr.text(),
      server.exited,
    ]);

    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe("200");
  });
});
