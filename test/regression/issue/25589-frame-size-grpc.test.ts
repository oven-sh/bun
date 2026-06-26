/**
 * Test for GitHub Issue #25589: NGHTTP2_FRAME_SIZE_ERROR with gRPC
 * Tests using @grpc/grpc-js client
 *
 * This test verifies that Bun's HTTP/2 client correctly handles:
 * 1. Large response headers from server
 * 2. Large trailers (gRPC status details)
 * 3. Large request headers from client
 * 4. Large DATA frames
 */

import { afterAll, beforeAll, describe, test } from "bun:test";
import assert from "node:assert";
import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// @ts-ignore - @grpc/grpc-js types
import * as grpc from "@grpc/grpc-js";
// @ts-ignore - @grpc/proto-loader types
import * as loader from "@grpc/proto-loader";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const protoLoaderOptions = {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
};

function loadProtoFile(file: string) {
  const packageDefinition = loader.loadSync(file, protoLoaderOptions);
  return grpc.loadPackageDefinition(packageDefinition);
}

const protoFile = join(__dirname, "../../js/third_party/grpc-js/fixtures/echo_service.proto");
const echoService = loadProtoFile(protoFile).EchoService as grpc.ServiceClientConstructor;
const ca = readFileSync(join(__dirname, "../../js/third_party/grpc-js/fixtures/ca.pem"));

interface ServerAddress {
  address: string;
  family: string;
  port: number;
}

let serverProcess: ChildProcess | null = null;
let serverAddress: ServerAddress | null = null;

async function startServer(): Promise<ServerAddress> {
  return new Promise((resolve, reject) => {
    const serverPath = join(__dirname, "25589-frame-size-server.js");

    serverProcess = spawn("node", [serverPath], {
      env: {
        ...process.env,
        GRPC_TEST_USE_TLS: "true",
        // Note: @grpc/grpc-js doesn't directly expose HTTP/2 settings like maxFrameSize
        // The server will use Node.js http2 defaults which allow larger frames
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    let output = "";

    serverProcess.stdout?.on("data", (data: Buffer) => {
      output += data.toString();
      try {
        const addr = JSON.parse(output) as ServerAddress;
        resolve(addr);
      } catch {
        // Wait for more data
      }
    });

    serverProcess.stderr?.on("data", (data: Buffer) => {
      console.error("Server stderr:", data.toString());
    });

    serverProcess.on("error", reject);

    serverProcess.on("exit", code => {
      if (code !== 0 && !serverAddress) {
        reject(new Error(`Server exited with code ${code}`));
      }
    });
  });
}

function stopServer(): Promise<void> {
  return new Promise(resolve => {
    if (serverProcess) {
      serverProcess.stdin?.write("shutdown");
      serverProcess.on("exit", () => resolve());
      setTimeout(() => {
        serverProcess?.kill();
        resolve();
      }, 2000);
    } else {
      resolve();
    }
  });
}

function createClient(address: ServerAddress): InstanceType<typeof echoService> {
  const credentials = grpc.credentials.createSsl(ca);
  const target = `${address.address}:${address.port}`;
  return new echoService(target, credentials);
}

describe("HTTP/2 FRAME_SIZE_ERROR with @grpc/grpc-js", () => {
  beforeAll(async () => {
    serverAddress = await startServer();
  });

  afterAll(async () => {
    await stopServer();
  });

  test("receives large response (32KB) without FRAME_SIZE_ERROR", async () => {
    assert.ok(serverAddress, "Server should be running");

    const client = createClient(serverAddress);
    const metadata = new grpc.Metadata();
    metadata.add("x-large-response", "32768"); // 32KB response

    try {
      const response = await new Promise<{ value: string; value2: number }>((resolve, reject) => {
        client.echo(
          { value: "test", value2: 1 },
          metadata,
          (err: Error | null, response: { value: string; value2: number }) => {
            if (err) reject(err);
            else resolve(response);
          },
        );
      });

      assert.ok(response.value.length >= 32768, `Response should be at least 32KB, got ${response.value.length}`);
    } finally {
      client.close();
    }
  });

  test("receives large response (100KB) without FRAME_SIZE_ERROR", async () => {
    assert.ok(serverAddress, "Server should be running");

    const client = createClient(serverAddress);
    const metadata = new grpc.Metadata();
    metadata.add("x-large-response", "102400"); // 100KB response

    try {
      const response = await new Promise<{ value: string; value2: number }>((resolve, reject) => {
        client.echo(
          { value: "test", value2: 1 },
          metadata,
          (err: Error | null, response: { value: string; value2: number }) => {
            if (err) reject(err);
            else resolve(response);
          },
        );
      });

      assert.ok(response.value.length >= 102400, `Response should be at least 100KB, got ${response.value.length}`);
    } finally {
      client.close();
    }
  });

  test("receives large response headers without FRAME_SIZE_ERROR", async () => {
    assert.ok(serverAddress, "Server should be running");

    const client = createClient(serverAddress);
    const metadata = new grpc.Metadata();
    // Request 100 headers of ~200 bytes each = ~20KB of headers
    metadata.add("x-large-headers", "100");

    try {
      const response = await new Promise<{ value: string; value2: number }>((resolve, reject) => {
        client.echo(
          { value: "test", value2: 1 },
          metadata,
          (err: Error | null, response: { value: string; value2: number }) => {
            if (err) reject(err);
            else resolve(response);
          },
        );
      });

      assert.strictEqual(response.value, "test");
    } finally {
      client.close();
    }
  });

  test("sends large request metadata without FRAME_SIZE_ERROR", async () => {
    assert.ok(serverAddress, "Server should be running");

    const client = createClient(serverAddress);
    const metadata = new grpc.Metadata();
    // Add many custom headers to test large header handling.
    // Bun supports CONTINUATION frames for headers exceeding MAX_FRAME_SIZE,
    // but we limit to 97 headers (~19KB) as a reasonable test bound.
    for (let i = 0; i < 97; i++) {
      metadata.add(`x-custom-header-${i}`, "A".repeat(200));
    }

    try {
      const response = await new Promise<{ value: string; value2: number }>((resolve, reject) => {
        client.echo(
          { value: "test", value2: 1 },
          metadata,
          (err: Error | null, response: { value: string; value2: number }) => {
            if (err) reject(err);
            else resolve(response);
          },
        );
      });

      assert.strictEqual(response.value, "test");
    } finally {
      client.close();
    }
  });

  test("receives large trailers without FRAME_SIZE_ERROR", async () => {
    assert.ok(serverAddress, "Server should be running");

    const client = createClient(serverAddress);
    const metadata = new grpc.Metadata();
    // Request large trailers (20KB)
    metadata.add("x-large-trailers", "20000");

    try {
      const response = await new Promise<{ value: string; value2: number }>((resolve, reject) => {
        client.echo(
          { value: "test", value2: 1 },
          metadata,
          (err: Error | null, response: { value: string; value2: number }) => {
            if (err) reject(err);
            else resolve(response);
          },
        );
      });

      assert.strictEqual(response.value, "test");
    } finally {
      client.close();
    }
  });
});
