/**
 * Test for GitHub Issue #19152: Bun HTTP/2 server ignores SETTINGS_HEADER_TABLE_SIZE=0
 *
 * When an HTTP/2 client sends SETTINGS_HEADER_TABLE_SIZE=0 to disable the dynamic
 * header table, Bun's HPACK encoder must not use dynamic table indices (62+).
 * Per RFC 7540 Section 6.5.2, the encoder must respect the peer's header table size.
 *
 * This test verifies that when Bun acts as a server and receives SETTINGS_HEADER_TABLE_SIZE=0,
 * it correctly updates its HPACK encoder to not use the dynamic table.
 */

import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir, tls } from "harness";
import http2 from "node:http2";
import path from "node:path";

describe("HTTP/2 SETTINGS_HEADER_TABLE_SIZE=0", () => {
  test("server respects client's SETTINGS_HEADER_TABLE_SIZE=0", async () => {
    // Create a fixture server script that will be run with Bun
    using dir = tempDir("http2-settings", {
      "server.ts": `
        import http2 from "node:http2";

        const tlsCert = JSON.parse(process.argv[2]);

        const server = http2.createSecureServer({
          ...tlsCert,
          rejectUnauthorized: false,
        });

        server.on("stream", (stream, headers) => {
          // Return a response with multiple custom headers
          // Without the fix, these will be encoded with dynamic table indices
          stream.respond({
            "content-type": "text/plain",
            ":status": 200,
            "x-custom-header-1": "value1",
            "x-custom-header-2": "value2",
            "x-custom-header-3": "value3",
            "x-another-header": "another-value",
            "x-test-header": "test-value",
          });
          stream.end("Hello");
        });

        server.on("error", (err) => {
          console.error("Server error:", err);
          process.exit(1);
        });

        server.listen(0, "127.0.0.1", () => {
          const addr = server.address();
          console.log(JSON.stringify({ port: addr.port }));
        });
      `,
    });

    // Start the server using Bun (or the current runtime under test)
    const serverProcess = Bun.spawn([bunExe(), path.join(String(dir), "server.ts"), JSON.stringify(tls)], {
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
      env: bunEnv,
    });

    // Read the port from stdout
    const reader = serverProcess.stdout.getReader();
    const { value } = await reader.read();
    const text = new TextDecoder().decode(value);
    const { port } = JSON.parse(text);

    try {
      // Connect to the server with headerTableSize: 0
      // This tells the server to NOT use dynamic table indices in responses
      const { promise, resolve, reject } = Promise.withResolvers<{
        headers: http2.IncomingHttpHeaders;
        data: string;
      }>();

      const client = http2.connect(`https://127.0.0.1:${port}`, {
        rejectUnauthorized: false,
        settings: {
          headerTableSize: 0, // Disable dynamic table - server must respect this
          enablePush: false,
        },
      });

      client.on("error", reject);

      const req = client.request({ ":path": "/" });

      let responseHeaders: http2.IncomingHttpHeaders = {};
      req.on("response", headers => {
        responseHeaders = headers;
      });

      let data = "";
      req.setEncoding("utf8");
      req.on("data", (chunk: string) => {
        data += chunk;
      });

      req.on("end", () => {
        client.close();
        resolve({ headers: responseHeaders, data });
      });

      req.on("error", reject);
      req.end();

      // If the bug exists, this will fail because the client can't decode
      // headers that use dynamic table indices (since headerTableSize: 0)
      const result = await promise;

      // Verify we got the response correctly
      expect(result.headers[":status"]).toBe(200);
      expect(result.headers["content-type"]).toBe("text/plain");
      expect(result.headers["x-custom-header-1"]).toBe("value1");
      expect(result.headers["x-custom-header-2"]).toBe("value2");
      expect(result.headers["x-custom-header-3"]).toBe("value3");
      expect(result.headers["x-another-header"]).toBe("another-value");
      expect(result.headers["x-test-header"]).toBe("test-value");
      expect(result.data).toBe("Hello");
    } finally {
      serverProcess.kill();
    }
  });

  // Additional test: Make multiple requests to verify dynamic table isn't used
  test("server respects SETTINGS_HEADER_TABLE_SIZE=0 across multiple requests", async () => {
    // Create a fixture server script that will be run with Bun
    using dir = tempDir("http2-settings-multi", {
      "server.ts": `
        import http2 from "node:http2";

        const tlsCert = JSON.parse(process.argv[2]);
        let requestCount = 0;

        const server = http2.createSecureServer({
          ...tlsCert,
          rejectUnauthorized: false,
        });

        server.on("stream", (stream, headers) => {
          requestCount++;
          // Return headers that would normally be added to dynamic table
          stream.respond({
            "content-type": "application/json",
            ":status": 200,
            "x-request-id": \`request-\${requestCount}\`,
            "x-custom-value": "same-value-each-time",
          });
          stream.end(JSON.stringify({ count: requestCount }));
        });

        server.on("error", (err) => {
          console.error("Server error:", err);
          process.exit(1);
        });

        server.listen(0, "127.0.0.1", () => {
          const addr = server.address();
          console.log(JSON.stringify({ port: addr.port }));
        });
      `,
    });

    // Start the server using Bun
    const serverProcess = Bun.spawn([bunExe(), path.join(String(dir), "server.ts"), JSON.stringify(tls)], {
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
      env: bunEnv,
    });

    // Read the port from stdout
    const reader = serverProcess.stdout.getReader();
    const { value } = await reader.read();
    const text = new TextDecoder().decode(value);
    const { port } = JSON.parse(text);

    try {
      const client = http2.connect(`https://127.0.0.1:${port}`, {
        rejectUnauthorized: false,
        settings: {
          headerTableSize: 0, // Disable dynamic table
          enablePush: false,
        },
      });

      // Make multiple requests - if dynamic table was being used incorrectly,
      // later requests would fail because they'd reference indices that don't exist
      for (let i = 1; i <= 3; i++) {
        const { promise, resolve, reject } = Promise.withResolvers<{
          headers: http2.IncomingHttpHeaders;
          data: string;
        }>();

        const req = client.request({ ":path": "/" });

        let responseHeaders: http2.IncomingHttpHeaders = {};
        req.on("response", headers => {
          responseHeaders = headers;
        });

        let data = "";
        req.setEncoding("utf8");
        req.on("data", (chunk: string) => {
          data += chunk;
        });

        req.on("end", () => {
          resolve({ headers: responseHeaders, data });
        });

        req.on("error", reject);
        req.end();

        const result = await promise;

        expect(result.headers[":status"]).toBe(200);
        expect(result.headers["x-request-id"]).toBe(`request-${i}`);
        expect(result.headers["x-custom-value"]).toBe("same-value-each-time");

        const parsed = JSON.parse(result.data);
        expect(parsed.count).toBe(i);
      }

      client.close();
    } finally {
      serverProcess.kill();
    }
  });
});
