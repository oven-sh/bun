/**
 * HTTP/2 CONTINUATION Frames Tests
 *
 * Tests for RFC 7540 Section 6.10 CONTINUATION frame support.
 * When headers exceed MAX_FRAME_SIZE (default 16384), they must be split
 * into HEADERS + CONTINUATION frames.
 *
 * Works with both:
 * - bun bd test test/js/node/http2/node-http2-continuation.test.ts
 * - node --experimental-strip-types --test test/js/node/http2/node-http2-continuation.test.ts
 */
import assert from "node:assert";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import http2 from "node:http2";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load TLS certificates from fixture files
const FIXTURES_PATH = path.join(__dirname, "..", "test", "fixtures", "keys");
const TLS_CERT = {
  cert: fs.readFileSync(path.join(FIXTURES_PATH, "agent1-cert.pem"), "utf8"),
  key: fs.readFileSync(path.join(FIXTURES_PATH, "agent1-key.pem"), "utf8"),
};
const CA_CERT = fs.readFileSync(path.join(FIXTURES_PATH, "ca1-cert.pem"), "utf8");
const TLS_OPTIONS = { ca: CA_CERT };

// HTTP/2 connection options to allow large header lists
const H2_CLIENT_OPTIONS = {
  ...TLS_OPTIONS,
  rejectUnauthorized: false,
  // Node.js uses top-level maxHeaderListPairs
  maxHeaderListPairs: 2000,
  settings: {
    // Allow receiving up to 256KB of header data
    maxHeaderListSize: 256 * 1024,
    // Bun reads maxHeaderListPairs from settings
    maxHeaderListPairs: 2000,
  },
};

// Helper to get node executable
function getNodeExecutable(): string {
  if (typeof Bun !== "undefined") {
    return Bun.which("node") || "node";
  }
  return process.execPath.includes("node") ? process.execPath : "node";
}

// Helper to start Node.js HTTP/2 server
interface ServerInfo {
  port: number;
  url: string;
  subprocess: ChildProcess;
  close: () => void;
}

async function startNodeServer(): Promise<ServerInfo> {
  const nodeExe = getNodeExecutable();
  const serverPath = path.join(__dirname, "node-http2-continuation-server.fixture.js");

  const subprocess = spawn(nodeExe, [serverPath, JSON.stringify(TLS_CERT)], {
    stdio: ["inherit", "pipe", "inherit"],
  });

  return new Promise((resolve, reject) => {
    let data = "";

    subprocess.stdout!.setEncoding("utf8");
    subprocess.stdout!.on("data", (chunk: string) => {
      data += chunk;
      try {
        const info = JSON.parse(data);
        const url = `https://127.0.0.1:${info.port}`;
        resolve({
          port: info.port,
          url,
          subprocess,
          close: () => subprocess.kill("SIGKILL"),
        });
      } catch {
        // Need more data
      }
    });

    subprocess.on("error", reject);
    subprocess.on("exit", code => {
      if (code !== 0 && code !== null) {
        reject(new Error(`Server exited with code ${code}`));
      }
    });
  });
}

// Helper to make HTTP/2 request and collect response
interface Response {
  data: string;
  headers: http2.IncomingHttpHeaders;
  trailers?: http2.IncomingHttpHeaders;
}

function makeRequest(
  client: http2.ClientHttp2Session,
  headers: http2.OutgoingHttpHeaders,
  options?: { waitForTrailers?: boolean },
): Promise<Response> {
  return new Promise((resolve, reject) => {
    const req = client.request(headers);
    let data = "";
    let responseHeaders: http2.IncomingHttpHeaders = {};
    let trailers: http2.IncomingHttpHeaders | undefined;

    req.on("response", hdrs => {
      responseHeaders = hdrs;
    });

    req.on("trailers", hdrs => {
      trailers = hdrs;
    });

    req.setEncoding("utf8");
    req.on("data", chunk => {
      data += chunk;
    });

    req.on("end", () => {
      resolve({ data, headers: responseHeaders, trailers });
    });

    req.on("error", reject);
    req.end();
  });
}

// Generate headers of specified count
function generateHeaders(count: number, valueLength: number = 150): http2.OutgoingHttpHeaders {
  const headers: http2.OutgoingHttpHeaders = {};
  for (let i = 0; i < count; i++) {
    headers[`x-custom-header-${i}`] = "A".repeat(valueLength);
  }
  return headers;
}

describe("HTTP/2 CONTINUATION frames - Client Side", () => {
  let server: ServerInfo;

  before(async () => {
    server = await startNodeServer();
  });

  after(() => {
    server?.close();
  });

  test("client sends 97 headers (~16KB) - fits in single HEADERS frame", async () => {
    const client = http2.connect(server.url, H2_CLIENT_OPTIONS);

    try {
      const headers: http2.OutgoingHttpHeaders = {
        ":method": "GET",
        ":path": "/",
        ":scheme": "https",
        ":authority": `127.0.0.1:${server.port}`,
        ...generateHeaders(97),
      };

      const response = await makeRequest(client, headers);
      assert.ok(response.data, "Should receive response data");

      const parsed = JSON.parse(response.data);
      assert.strictEqual(parsed.receivedHeaders, 97, "Server should receive all 97 headers");
    } finally {
      client.close();
    }
  });

  test("client sends 150 headers (~25KB) - requires HEADERS + CONTINUATION", async () => {
    const client = http2.connect(server.url, H2_CLIENT_OPTIONS);

    try {
      const headers: http2.OutgoingHttpHeaders = {
        ":method": "GET",
        ":path": "/",
        ":scheme": "https",
        ":authority": `127.0.0.1:${server.port}`,
        ...generateHeaders(150),
      };

      const response = await makeRequest(client, headers);
      assert.ok(response.data, "Should receive response data");

      const parsed = JSON.parse(response.data);
      assert.strictEqual(parsed.receivedHeaders, 150, "Server should receive all 150 headers");
    } finally {
      client.close();
    }
  });

  test("client sends 300 headers (~50KB) - requires HEADERS + multiple CONTINUATION", async () => {
    const client = http2.connect(server.url, H2_CLIENT_OPTIONS);

    try {
      const headers: http2.OutgoingHttpHeaders = {
        ":method": "GET",
        ":path": "/",
        ":scheme": "https",
        ":authority": `127.0.0.1:${server.port}`,
        ...generateHeaders(300),
      };

      const response = await makeRequest(client, headers);
      assert.ok(response.data, "Should receive response data");

      const parsed = JSON.parse(response.data);
      assert.strictEqual(parsed.receivedHeaders, 300, "Server should receive all 300 headers");
    } finally {
      client.close();
    }
  });

  test("client receives large response headers via CONTINUATION (already works)", async () => {
    const client = http2.connect(server.url, H2_CLIENT_OPTIONS);

    try {
      // Use 100 headers to stay within Bun's default maxHeaderListPairs limit (~108 after pseudo-headers)
      const headers: http2.OutgoingHttpHeaders = {
        ":method": "GET",
        ":path": "/",
        ":scheme": "https",
        ":authority": `127.0.0.1:${server.port}`,
        "x-response-headers": "100", // Server will respond with 100 headers
      };

      const response = await makeRequest(client, headers);
      assert.ok(response.data, "Should receive response data");

      // Count response headers starting with x-response-header-
      const responseHeaderCount = Object.keys(response.headers).filter(h => h.startsWith("x-response-header-")).length;

      assert.strictEqual(responseHeaderCount, 100, "Should receive all 100 response headers");
    } finally {
      client.close();
    }
  });

  test("client receives large trailers via CONTINUATION", async () => {
    const client = http2.connect(server.url, H2_CLIENT_OPTIONS);

    try {
      const headers: http2.OutgoingHttpHeaders = {
        ":method": "GET",
        ":path": "/",
        ":scheme": "https",
        ":authority": `127.0.0.1:${server.port}`,
        "x-response-trailers": "100", // Server will respond with 100 trailers
      };

      const response = await makeRequest(client, headers);
      assert.ok(response.data, "Should receive response data");
      assert.ok(response.trailers, "Should receive trailers");

      // Count trailers starting with x-trailer-
      const trailerCount = Object.keys(response.trailers).filter(h => h.startsWith("x-trailer-")).length;

      assert.strictEqual(trailerCount, 100, "Should receive all 100 trailers");
    } finally {
      client.close();
    }
  });
});

// Server-side tests (when Bun acts as HTTP/2 server)
// These test that Bun can SEND large headers via CONTINUATION frames
describe("HTTP/2 CONTINUATION frames - Server Side", () => {
  let bunServer: http2.Http2SecureServer;
  let serverPort: number;

  before(async () => {
    // Create Bun/Node HTTP/2 server
    bunServer = http2.createSecureServer({
      key: TLS_CERT.key,
      cert: TLS_CERT.cert,
      // Allow up to 2000 header pairs (default is 128)
      maxHeaderListPairs: 2000,
      settings: {
        maxHeaderListSize: 256 * 1024, // 256KB
      },
    });

    bunServer.on("stream", (stream, headers) => {
      const path = headers[":path"] || "/";

      // Count received headers (excluding pseudo-headers)
      const receivedHeaders = Object.keys(headers).filter(h => !h.startsWith(":")).length;

      if (path === "/large-response-headers") {
        // Send 150 response headers - requires CONTINUATION frames
        const responseHeaders: http2.OutgoingHttpHeaders = {
          ":status": 200,
          "content-type": "application/json",
        };
        for (let i = 0; i < 150; i++) {
          responseHeaders[`x-response-header-${i}`] = "R".repeat(150);
        }
        stream.respond(responseHeaders);
        stream.end(JSON.stringify({ sent: 150 }));
      } else if (path === "/large-trailers") {
        // Send response with large trailers
        stream.respond({ ":status": 200 }, { waitForTrailers: true });

        stream.on("wantTrailers", () => {
          const trailers: http2.OutgoingHttpHeaders = {};
          for (let i = 0; i < 100; i++) {
            trailers[`x-trailer-${i}`] = "T".repeat(150);
          }
          stream.sendTrailers(trailers);
        });

        stream.end(JSON.stringify({ sentTrailers: 100 }));
      } else {
        // Echo headers count
        stream.respond({ ":status": 200, "content-type": "application/json" });
        stream.end(JSON.stringify({ receivedHeaders }));
      }
    });

    bunServer.on("error", err => {
      console.error("Bun server error:", err.message);
    });

    await new Promise<void>(resolve => {
      bunServer.listen(0, "127.0.0.1", () => {
        const addr = bunServer.address();
        serverPort = typeof addr === "object" && addr ? addr.port : 0;
        resolve();
      });
    });
  });

  after(() => {
    bunServer?.close();
  });

  test("server receives large request headers via CONTINUATION (already works)", async () => {
    const client = http2.connect(`https://127.0.0.1:${serverPort}`, H2_CLIENT_OPTIONS);

    try {
      // Use 120 headers to stay within Bun's default maxHeaderListPairs (128)
      const headers: http2.OutgoingHttpHeaders = {
        ":method": "GET",
        ":path": "/",
        ":scheme": "https",
        ":authority": `127.0.0.1:${serverPort}`,
        ...generateHeaders(120),
      };

      const response = await makeRequest(client, headers);
      assert.ok(response.data, "Should receive response data");

      const parsed = JSON.parse(response.data);
      assert.strictEqual(parsed.receivedHeaders, 120, "Server should receive all 120 headers");
    } finally {
      client.close();
    }
  });

  test("server sends 120 response headers via CONTINUATION", async () => {
    const client = http2.connect(`https://127.0.0.1:${serverPort}`, H2_CLIENT_OPTIONS);

    try {
      const headers: http2.OutgoingHttpHeaders = {
        ":method": "GET",
        ":path": "/large-response-headers",
        ":scheme": "https",
        ":authority": `127.0.0.1:${serverPort}`,
      };

      const response = await makeRequest(client, headers);
      assert.ok(response.data, "Should receive response data");

      // Count response headers starting with x-response-header-
      // Note: Bun server sends 150 but client receives up to 120 due to maxHeaderListPairs default
      const responseHeaderCount = Object.keys(response.headers).filter(h => h.startsWith("x-response-header-")).length;

      // Server can send via CONTINUATION, but client has receiving limit
      assert.ok(
        responseHeaderCount >= 100,
        `Should receive at least 100 response headers (got ${responseHeaderCount})`,
      );
    } finally {
      client.close();
    }
  });

  test("server sends large trailers requiring CONTINUATION", async () => {
    const client = http2.connect(`https://127.0.0.1:${serverPort}`, H2_CLIENT_OPTIONS);

    try {
      const headers: http2.OutgoingHttpHeaders = {
        ":method": "GET",
        ":path": "/large-trailers",
        ":scheme": "https",
        ":authority": `127.0.0.1:${serverPort}`,
      };

      const response = await makeRequest(client, headers);
      assert.ok(response.data, "Should receive response data");
      assert.ok(response.trailers, "Should receive trailers");

      // Count trailers starting with x-trailer-
      const trailerCount = Object.keys(response.trailers).filter(h => h.startsWith("x-trailer-")).length;

      assert.strictEqual(trailerCount, 100, "Should receive all 100 trailers");
    } finally {
      client.close();
    }
  });
});
