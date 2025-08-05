import { expect, test, describe, beforeAll, afterAll } from "bun:test";
import { spawn } from "bun";
import * as http2 from "node:http2";
import * as fs from "node:fs";
import * as path from "node:path";

describe("HTTP/2 Client with Node.js HTTP/2 Server", () => {
  let server: http2.Http2SecureServer | null = null;
  let serverUrl: string;
  const port = 8443 + Math.floor(Math.random() * 1000); // Random port to avoid conflicts

  beforeAll(async () => {
    // Create self-signed certificates for testing
    const { generateKeyPairSync } = await import("node:crypto");
    const { publicKey, privateKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });

    // Create a temporary certificate (self-signed)
    const cert = `-----BEGIN CERTIFICATE-----
MIICpDCCAYwCCQC8w6gKOsrYRDANBgkqhkiG9w0BAQsFADATMREwDwYDVQQDDAhs
b2NhbGhvc3QwHhcNMjQwMTAxMDAwMDAwWhcNMjUwMTAxMDAwMDAwWjATMREwDwYD
VQQDDAhsb2NhbGhvc3QwggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQC0
test-certificate-content-here-this-is-a-dummy-cert-for-testing-purposes
-----END CERTIFICATE-----`;

    // Start HTTP/2 server
    server = http2.createSecureServer({
      key: privateKey,
      cert: cert,
      allowHTTP1: false, // Force HTTP/2 only
      rejectUnauthorized: false,
    });

    // Handle streams
    server.on("stream", (stream, headers) => {
      const method = headers[":method"];
      const path = headers[":path"];

      // Log the request for debugging
      console.log(`HTTP/2 Server received: ${method} ${path}`);

      // Handle different endpoints
      if (path === "/json") {
        stream.respond({
          "content-type": "application/json",
          ":status": 200,
        });
        stream.end(JSON.stringify({
          message: "Hello from HTTP/2 server",
          method,
          path,
          protocol: "h2",
          headers: Object.fromEntries(
            Object.entries(headers).filter(([key]) => !key.startsWith(":"))
          ),
        }));
      } else if (path === "/echo") {
        stream.respond({
          "content-type": "application/json",
          ":status": 200,
        });

        let body = "";
        stream.on("data", (chunk) => {
          body += chunk.toString();
        });

        stream.on("end", () => {
          stream.end(JSON.stringify({
            method,
            path,
            body,
            headers: Object.fromEntries(
              Object.entries(headers).filter(([key]) => !key.startsWith(":"))
            ),
          }));
        });
      } else if (path === "/delay") {
        // Simulate network delay
        setTimeout(() => {
          stream.respond({
            "content-type": "text/plain",
            ":status": 200,
          });
          stream.end("Delayed response");
        }, 1000);
      } else if (path === "/large") {
        // Send a large response to test flow control
        const largeData = "A".repeat(1024 * 1024); // 1MB of 'A's
        stream.respond({
          "content-type": "text/plain",
          "content-length": largeData.length.toString(),
          ":status": 200,
        });
        stream.end(largeData);
      } else if (path === "/stream") {
        // Send a streaming response
        stream.respond({
          "content-type": "text/plain",
          ":status": 200,
        });

        let count = 0;
        const interval = setInterval(() => {
          if (count >= 5) {
            clearInterval(interval);
            stream.end("\\nEnd of stream\\n");
          } else {
            stream.write(`Chunk ${count}\\n`);
            count++;
          }
        }, 100);
      } else if (path === "/error") {
        stream.respond({ ":status": 500 });
        stream.end("Internal Server Error");
      } else {
        stream.respond({
          "content-type": "text/plain",
          ":status": 200,
        });
        stream.end("Hello HTTP/2 World!");
      }
    });

    // Start server
    await new Promise<void>((resolve, reject) => {
      server!.listen(port, "localhost", (err?: Error) => {
        if (err) reject(err);
        else {
          serverUrl = `https://localhost:${port}`;
          console.log(`HTTP/2 test server started on ${serverUrl}`);
          resolve();
        }
      });
    });
  }, 30000);

  afterAll(async () => {
    if (server) {
      await new Promise<void>((resolve) => {
        server!.close(() => {
          console.log("HTTP/2 test server closed");
          resolve();
        });
      });
    }
  }, 10000);

  test("should connect to Node.js HTTP/2 server", async () => {
    const response = await fetch(`${serverUrl}/`, {
      verbose: true, // Force HTTP/2
      // Disable certificate validation for self-signed cert
      tls: { rejectUnauthorized: false },
    });

    expect(response.ok).toBe(true);
    expect(response.status).toBe(200);

    const text = await response.text();
    expect(text).toBe("Hello HTTP/2 World!");
  }, 10000);

  test("should handle JSON responses", async () => {
    const response = await fetch(`${serverUrl}/json`, {
      verbose: true,
      tls: { rejectUnauthorized: false },
    });

    expect(response.ok).toBe(true);
    const data = await response.json();

    expect(data.message).toBe("Hello from HTTP/2 server");
    expect(data.protocol).toBe("h2");
    expect(data.method).toBe("GET");
    expect(data.path).toBe("/json");
  }, 10000);

  test("should handle POST requests with body", async () => {
    const testData = { test: "data", timestamp: Date.now() };

    const response = await fetch(`${serverUrl}/echo`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Custom-Header": "test-value",
      },
      body: JSON.stringify(testData),
      verbose: true,
      tls: { rejectUnauthorized: false },
    });

    expect(response.ok).toBe(true);
    const data = await response.json();

    expect(data.method).toBe("POST");
    expect(data.path).toBe("/echo");
    expect(JSON.parse(data.body)).toEqual(testData);
    expect(data.headers["content-type"]).toBe("application/json");
    expect(data.headers["x-custom-header"]).toBe("test-value");
  }, 10000);

  test("should handle multiple concurrent requests", async () => {
    const requests = [
      fetch(`${serverUrl}/json`, { verbose: true, tls: { rejectUnauthorized: false } }),
      fetch(`${serverUrl}/`, { verbose: true, tls: { rejectUnauthorized: false } }),
      fetch(`${serverUrl}/json`, { verbose: true, tls: { rejectUnauthorized: false } }),
    ];

    const responses = await Promise.all(requests);

    responses.forEach(response => {
      expect(response.ok).toBe(true);
    });

    const [jsonResponse1, rootResponse, jsonResponse2] = responses;

    const json1 = await jsonResponse1.json();
    expect(json1.protocol).toBe("h2");

    const rootText = await rootResponse.text();
    expect(rootText).toBe("Hello HTTP/2 World!");

    const json2 = await jsonResponse2.json();
    expect(json2.protocol).toBe("h2");
  }, 15000);

  test("should handle large responses", async () => {
    const response = await fetch(`${serverUrl}/large`, {
      verbose: true,
      tls: { rejectUnauthorized: false },
    });

    expect(response.ok).toBe(true);

    const text = await response.text();
    expect(text.length).toBe(1024 * 1024); // 1MB
    expect(text[0]).toBe("A");
    expect(text[text.length - 1]).toBe("A");
  }, 15000);

  test("should handle streaming responses", async () => {
    const response = await fetch(`${serverUrl}/stream`, {
      verbose: true,
      tls: { rejectUnauthorized: false },
    });

    expect(response.ok).toBe(true);

    const text = await response.text();
    expect(text).toContain("Chunk 0");
    expect(text).toContain("Chunk 4");
    expect(text).toContain("End of stream");
  }, 10000);

  test("should handle delayed responses", async () => {
    const startTime = Date.now();

    const response = await fetch(`${serverUrl}/delay`, {
      verbose: true,
      tls: { rejectUnauthorized: false },
    });

    const endTime = Date.now();
    const duration = endTime - startTime;

    expect(response.ok).toBe(true);
    expect(duration).toBeGreaterThan(900); // Should take at least ~1 second

    const text = await response.text();
    expect(text).toBe("Delayed response");
  }, 10000);

  test("should handle HTTP/2 errors", async () => {
    const response = await fetch(`${serverUrl}/error`, {
      verbose: true,
      tls: { rejectUnauthorized: false },
    });

    expect(response.ok).toBe(false);
    expect(response.status).toBe(500);

    const text = await response.text();
    expect(text).toBe("Internal Server Error");
  }, 10000);

  test("should handle custom headers", async () => {
    const customHeaders = {
      "X-Test-Header": "test-value",
      "X-Number-Header": "12345",
      "X-Unicode-Header": "测试 🚀",
      "Authorization": "Bearer fake-token",
    };

    const response = await fetch(`${serverUrl}/json`, {
      headers: customHeaders,
      verbose: true,
      tls: { rejectUnauthorized: false },
    });

    expect(response.ok).toBe(true);
    const data = await response.json();

    // Verify headers were received (lowercase due to HTTP/2 spec)
    expect(data.headers["x-test-header"]).toBe("test-value");
    expect(data.headers["x-number-header"]).toBe("12345");
    expect(data.headers["x-unicode-header"]).toBe("测试 🚀");
    expect(data.headers.authorization).toBe("Bearer fake-token");
  }, 10000);
});