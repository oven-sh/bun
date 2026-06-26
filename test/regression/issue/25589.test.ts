/**
 * Regression test for issue #25589
 *
 * HTTP/2 requests fail with NGHTTP2_FLOW_CONTROL_ERROR when:
 * 1. Server advertises custom window/frame sizes via SETTINGS
 * 2. Client sends data before SETTINGS exchange completes
 *
 * Root cause: Server was enforcing localSettings.initialWindowSize immediately
 * instead of waiting for SETTINGS_ACK from client (per RFC 7540 Section 6.5.1).
 *
 * @see https://github.com/oven-sh/bun/issues/25589
 */

import { afterAll, beforeAll, describe, test } from "bun:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import http2 from "node:http2";
import { join } from "node:path";

// TLS certificates for testing
const fixturesDir = join(import.meta.dirname, "..", "fixtures");
const tls = {
  cert: readFileSync(join(fixturesDir, "cert.pem")),
  key: readFileSync(join(fixturesDir, "cert.key")),
};

interface TestContext {
  server: http2.Http2SecureServer;
  serverPort: number;
  serverUrl: string;
}

/**
 * Creates an HTTP/2 server with specified settings
 */
async function createServer(settings: http2.Settings): Promise<TestContext> {
  const server = http2.createSecureServer({
    ...tls,
    allowHTTP1: false,
    settings,
  });

  server.on("stream", (stream, _headers) => {
    const chunks: Buffer[] = [];

    stream.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });

    stream.on("end", () => {
      const body = Buffer.concat(chunks);
      stream.respond({
        ":status": 200,
        "content-type": "application/json",
      });
      stream.end(JSON.stringify({ receivedBytes: body.length }));
    });

    stream.on("error", err => {
      console.error("Stream error:", err);
    });
  });

  server.on("error", err => {
    console.error("Server error:", err);
  });

  const serverPort = await new Promise<number>((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Failed to get server address"));
        return;
      }
      resolve(address.port);
    });
    server.once("error", reject);
  });

  return {
    server,
    serverPort,
    serverUrl: `https://127.0.0.1:${serverPort}`,
  };
}

/**
 * Sends an HTTP/2 POST request and returns the response
 */
async function sendRequest(
  client: http2.ClientHttp2Session,
  data: Buffer,
  path = "/test",
): Promise<{ receivedBytes: number }> {
  return new Promise((resolve, reject) => {
    const req = client.request({
      ":method": "POST",
      ":path": path,
    });

    let responseData = "";

    req.on("response", headers => {
      if (headers[":status"] !== 200) {
        reject(new Error(`Unexpected status: ${headers[":status"]}`));
      }
    });

    req.on("data", chunk => {
      responseData += chunk;
    });

    req.on("end", () => {
      try {
        resolve(JSON.parse(responseData));
      } catch {
        reject(new Error(`Failed to parse response: ${responseData}`));
      }
    });

    req.on("error", reject);

    req.write(data);
    req.end();
  });
}

/**
 * Waits for remote settings from server
 */
function waitForSettings(client: http2.ClientHttp2Session): Promise<http2.Settings> {
  return new Promise((resolve, reject) => {
    client.once("remoteSettings", resolve);
    client.once("error", reject);
  });
}

/**
 * Closes an HTTP/2 client session
 */
function closeClient(client: http2.ClientHttp2Session): Promise<void> {
  return new Promise(resolve => {
    client.close(resolve);
  });
}

/**
 * Closes an HTTP/2 server
 */
function closeServer(server: http2.Http2SecureServer): Promise<void> {
  return new Promise(resolve => {
    server.close(() => resolve());
  });
}

// =============================================================================
// Test Suite 1: Large frame size (server allows up to 16MB frames)
// =============================================================================
describe("HTTP/2 large frame size", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createServer({
      maxFrameSize: 16777215, // 16MB - 1 (maximum per RFC 7540)
      maxConcurrentStreams: 100,
      initialWindowSize: 1024 * 1024, // 1MB window
    });
  });

  afterAll(async () => {
    if (ctx?.server) {
      await closeServer(ctx.server);
    }
  });

  test("sends 32KB data (larger than default 16KB frame)", async () => {
    const client = http2.connect(ctx.serverUrl, { rejectUnauthorized: false });

    const settings = await waitForSettings(client);
    assert.strictEqual(settings.maxFrameSize, 16777215);

    const data = Buffer.alloc(32 * 1024, "x");
    const response = await sendRequest(client, data);

    assert.strictEqual(response.receivedBytes, 32 * 1024);

    await closeClient(client);
  });

  test("sends 100KB data", async () => {
    const client = http2.connect(ctx.serverUrl, { rejectUnauthorized: false });

    await waitForSettings(client);

    const data = Buffer.alloc(100 * 1024, "y");
    const response = await sendRequest(client, data);

    assert.strictEqual(response.receivedBytes, 100 * 1024);

    await closeClient(client);
  });

  test("sends 512KB data", async () => {
    const client = http2.connect(ctx.serverUrl, { rejectUnauthorized: false });

    await waitForSettings(client);

    const data = Buffer.alloc(512 * 1024, "z");
    const response = await sendRequest(client, data);

    assert.strictEqual(response.receivedBytes, 512 * 1024);

    await closeClient(client);
  });
});

// =============================================================================
// Test Suite 2: Small window size (flow control edge cases)
// This is the key test for issue #25589
// =============================================================================
describe("HTTP/2 small window size (flow control)", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createServer({
      maxFrameSize: 16777215, // Large frame size
      maxConcurrentStreams: 100,
      initialWindowSize: 16384, // Small window (16KB) - triggers flow control
    });
  });

  afterAll(async () => {
    if (ctx?.server) {
      await closeServer(ctx.server);
    }
  });

  test("sends 64KB data with 16KB window (requires WINDOW_UPDATE)", async () => {
    const client = http2.connect(ctx.serverUrl, { rejectUnauthorized: false });

    const settings = await waitForSettings(client);
    assert.strictEqual(settings.maxFrameSize, 16777215);
    assert.strictEqual(settings.initialWindowSize, 16384);

    // Send 64KB - 4x the window size, requires flow control
    const data = Buffer.alloc(64 * 1024, "x");
    const response = await sendRequest(client, data);

    assert.strictEqual(response.receivedBytes, 64 * 1024);

    await closeClient(client);
  });

  test("sends multiple parallel requests exhausting window", async () => {
    const client = http2.connect(ctx.serverUrl, { rejectUnauthorized: false });

    await waitForSettings(client);

    // Send 3 parallel 32KB requests
    const promises = [];
    for (let i = 0; i < 3; i++) {
      const data = Buffer.alloc(32 * 1024, String(i));
      promises.push(sendRequest(client, data));
    }

    const results = await Promise.all(promises);
    for (const result of results) {
      assert.strictEqual(result.receivedBytes, 32 * 1024);
    }

    await closeClient(client);
  });

  test("sends data immediately without waiting for settings (issue #25589)", async () => {
    // This is the critical test for issue #25589
    // Bug: Server was enforcing initialWindowSize=16384 BEFORE client received SETTINGS
    // Fix: Server uses DEFAULT_WINDOW_SIZE (65535) until SETTINGS_ACK is received

    const client = http2.connect(ctx.serverUrl, { rejectUnauthorized: false });

    // Send 32KB immediately (2x server's window) WITHOUT waiting for remoteSettings
    // Per RFC 7540, client can assume default window size (65535) until SETTINGS is received
    // Server must accept this until client ACKs the server's SETTINGS
    const data = Buffer.alloc(32 * 1024, "z");
    const response = await sendRequest(client, data);

    assert.strictEqual(response.receivedBytes, 32 * 1024);

    await closeClient(client);
  });

  test("sends 48KB immediately (3x server window) without waiting for settings", async () => {
    // More data = more likely to trigger flow control error
    const client = http2.connect(ctx.serverUrl, { rejectUnauthorized: false });

    const data = Buffer.alloc(48 * 1024, "a");
    const response = await sendRequest(client, data);

    assert.strictEqual(response.receivedBytes, 48 * 1024);

    await closeClient(client);
  });

  test("sends 60KB immediately (near default window limit) without waiting for settings", async () => {
    // 60KB is close to the default window size (65535 bytes)
    // Should work because client assumes default window until SETTINGS received
    const client = http2.connect(ctx.serverUrl, { rejectUnauthorized: false });

    const data = Buffer.alloc(60 * 1024, "b");
    const response = await sendRequest(client, data);

    assert.strictEqual(response.receivedBytes, 60 * 1024);

    await closeClient(client);
  });

  test("opens multiple streams immediately with small payloads", async () => {
    // Multiple streams opened immediately, each sending data > server's window
    // but total stays within connection window (65535 bytes default)
    const client = http2.connect(ctx.serverUrl, { rejectUnauthorized: false });

    // Send 3 parallel 18KB requests immediately (each > 16KB server window)
    // Total = 54KB < 65535 connection window
    const promises = [];
    for (let i = 0; i < 3; i++) {
      const data = Buffer.alloc(18 * 1024, String(i));
      promises.push(sendRequest(client, data, `/test${i}`));
    }

    const results = await Promise.all(promises);
    for (const result of results) {
      assert.strictEqual(result.receivedBytes, 18 * 1024);
    }

    await closeClient(client);
  });

  test("sequential requests on fresh connection without waiting for settings", async () => {
    // Each request on a fresh connection without waiting for settings
    for (let i = 0; i < 3; i++) {
      const client = http2.connect(ctx.serverUrl, { rejectUnauthorized: false });

      const data = Buffer.alloc(20 * 1024, String.fromCharCode(97 + i));
      const response = await sendRequest(client, data, `/seq${i}`);
      assert.strictEqual(response.receivedBytes, 20 * 1024);

      await closeClient(client);
    }
  });
});

// =============================================================================
// Test Suite 3: gRPC-style framing (5-byte header + payload)
// =============================================================================
describe("HTTP/2 gRPC-style framing", () => {
  let ctx: TestContext;

  function createGrpcMessage(payload: Buffer): Buffer {
    const header = Buffer.alloc(5);
    header[0] = 0; // Not compressed
    header.writeUInt32BE(payload.length, 1); // Message length (big-endian)
    return Buffer.concat([header, payload]);
  }

  function parseGrpcResponse(data: Buffer): { receivedBytes: number } {
    if (data.length < 5) {
      throw new Error("Invalid gRPC response: too short");
    }
    const messageLength = data.readUInt32BE(1);
    const payload = data.subarray(5, 5 + messageLength);
    return JSON.parse(payload.toString());
  }

  async function sendGrpcRequest(
    client: http2.ClientHttp2Session,
    payload: Buffer,
    path = "/test.Service/Method",
  ): Promise<{ receivedBytes: number }> {
    return new Promise((resolve, reject) => {
      const grpcMessage = createGrpcMessage(payload);

      const req = client.request({
        ":method": "POST",
        ":path": path,
        "content-type": "application/grpc",
        te: "trailers",
      });

      let responseData = Buffer.alloc(0);

      req.on("response", headers => {
        if (headers[":status"] !== 200) {
          reject(new Error(`Unexpected status: ${headers[":status"]}`));
        }
      });

      req.on("data", (chunk: Buffer) => {
        responseData = Buffer.concat([responseData, chunk]);
      });

      req.on("end", () => {
        try {
          resolve(parseGrpcResponse(responseData));
        } catch (e) {
          reject(new Error(`Failed to parse gRPC response: ${e}`));
        }
      });

      req.on("error", reject);

      req.write(grpcMessage);
      req.end();
    });
  }

  beforeAll(async () => {
    const server = http2.createSecureServer({
      ...tls,
      allowHTTP1: false,
      settings: {
        maxFrameSize: 16777215,
        maxConcurrentStreams: 100,
        initialWindowSize: 1024 * 1024,
      },
    });

    server.on("stream", (stream, _headers) => {
      const chunks: Buffer[] = [];

      stream.on("data", (chunk: Buffer) => {
        chunks.push(chunk);
      });

      stream.on("end", () => {
        const body = Buffer.concat(chunks);
        // Parse gRPC message (skip 5-byte header)
        if (body.length >= 5) {
          const messageLength = body.readUInt32BE(1);
          const payload = body.subarray(5, 5 + messageLength);
          stream.respond({
            ":status": 200,
            "content-type": "application/grpc",
            "grpc-status": "0",
          });
          // Echo back a gRPC response
          const response = createGrpcMessage(Buffer.from(JSON.stringify({ receivedBytes: payload.length })));
          stream.end(response);
        } else {
          stream.respond({ ":status": 400 });
          stream.end();
        }
      });

      stream.on("error", err => {
        console.error("Stream error:", err);
      });
    });

    server.on("error", err => {
      console.error("Server error:", err);
    });

    const serverPort = await new Promise<number>((resolve, reject) => {
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        if (!address || typeof address === "string") {
          reject(new Error("Failed to get server address"));
          return;
        }
        resolve(address.port);
      });
      server.once("error", reject);
    });

    ctx = {
      server,
      serverPort,
      serverUrl: `https://127.0.0.1:${serverPort}`,
    };
  });

  afterAll(async () => {
    if (ctx?.server) {
      await closeServer(ctx.server);
    }
  });

  test("gRPC message with 32KB payload", async () => {
    const client = http2.connect(ctx.serverUrl, { rejectUnauthorized: false });

    const settings = await waitForSettings(client);
    assert.strictEqual(settings.maxFrameSize, 16777215);

    const payload = Buffer.alloc(32 * 1024, "x");
    const response = await sendGrpcRequest(client, payload);

    assert.strictEqual(response.receivedBytes, 32 * 1024);

    await closeClient(client);
  });

  test("gRPC message with 100KB payload", async () => {
    const client = http2.connect(ctx.serverUrl, { rejectUnauthorized: false });

    await waitForSettings(client);

    const payload = Buffer.alloc(100 * 1024, "y");
    const response = await sendGrpcRequest(client, payload);

    assert.strictEqual(response.receivedBytes, 100 * 1024);

    await closeClient(client);
  });

  test("multiple concurrent gRPC calls", async () => {
    const client = http2.connect(ctx.serverUrl, { rejectUnauthorized: false });

    await waitForSettings(client);

    const promises = [];
    for (let i = 0; i < 5; i++) {
      const payload = Buffer.alloc(32 * 1024, String.fromCharCode(97 + i));
      promises.push(sendGrpcRequest(client, payload, `/test.Service/Method${i}`));
    }

    const results = await Promise.all(promises);
    for (const result of results) {
      assert.strictEqual(result.receivedBytes, 32 * 1024);
    }

    await closeClient(client);
  });
});
