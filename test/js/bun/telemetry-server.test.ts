import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

describe("Bun.telemetry with servers", () => {
  test("telemetry API exists", () => {
    expect(Bun.telemetry).toBeDefined();
    expect(typeof Bun.telemetry.configure).toBe("function");
    expect(typeof Bun.telemetry.isEnabled).toBe("function");
    expect(typeof Bun.telemetry.disable).toBe("function");
  });

  test("telemetry starts disabled", () => {
    expect(Bun.telemetry.isEnabled()).toBe(false);
  });

  test("telemetry can be configured and enabled", () => {
    const requestMap = new Map<number, any>();

    Bun.telemetry.configure({
      onRequestStart(id, request) {
        requestMap.set(id, { url: request.url, startTime: Date.now() });
      },
      onRequestEnd(id) {
        const req = requestMap.get(id);
        if (req) {
          req.endTime = Date.now();
          req.duration = req.endTime - req.startTime;
        }
      },
    });

    expect(Bun.telemetry.isEnabled()).toBe(true);

    // Clean up
    Bun.telemetry.disable();
  });

  test("telemetry can be disabled", () => {
    Bun.telemetry.configure({
      onRequestStart() {},
    });

    expect(Bun.telemetry.isEnabled()).toBe(true);

    Bun.telemetry.disable();

    expect(Bun.telemetry.isEnabled()).toBe(false);
  });

  test("telemetry tracks Bun.serve requests with Request objects", async () => {
    const events: Array<{ type: string; id?: number; request?: any; error?: any; response?: any }> = [];

    Bun.telemetry.configure({
      onRequestStart(id, request) {
        events.push({ type: "start", id, request });
      },
      onRequestEnd(id) {
        events.push({ type: "end", id });
      },
      onRequestError(id, error) {
        events.push({ type: "error", id, error });
      },
      onResponseHeaders(id, response) {
        events.push({ type: "headers", id, response });
      },
    });

    using server = Bun.serve({
      port: 0,
      fetch() {
        return new Response("telemetry test");
      },
    });

    await fetch(`http://localhost:${server.port}/test-path`);

    // Give it a moment for the hooks to complete
    await Bun.sleep(10);

    // We should have a start event with an ID and Request object
    const startEvent = events.find(e => e.type === "start");
    expect(startEvent).toBeDefined();
    expect(typeof startEvent?.id).toBe("number");
    expect(startEvent?.id).toBeGreaterThan(0);
    expect(startEvent?.request).toBeDefined();

    // For Bun.serve, we should get a real Request object
    expect(startEvent?.request.url).toContain("/test-path");
    expect(startEvent?.request.method).toBe("GET");

    // We should have a headers event
    const headersEvent = events.find(e => e.type === "headers");
    expect(headersEvent).toBeDefined();
    expect(headersEvent?.id).toBe(startEvent?.id);
    expect(headersEvent?.response).toBeDefined();

    // We should have an end event with just the ID
    const endEvent = events.find(e => e.type === "end");
    expect(endEvent).toBeDefined();
    expect(endEvent?.id).toBe(startEvent?.id);
    expect(endEvent?.request).toBeUndefined();

    // Clean up
    Bun.telemetry.disable();
  });

  test("telemetry tracks request errors", async () => {
    const events: Array<{ type: string; id?: number; error?: any }> = [];

    Bun.telemetry.configure({
      onRequestStart(id) {
        events.push({ type: "start", id });
      },
      onRequestError(id, error) {
        events.push({ type: "error", id, error });
      },
      onRequestEnd(id) {
        events.push({ type: "end", id });
      },
    });

    using server = Bun.serve({
      port: 0,
      fetch() {
        throw new Error("Test error");
      },
    });

    // This should trigger an error
    const response = await fetch(`http://localhost:${server.port}/`);
    expect(response.status).toBe(500);

    await Bun.sleep(10);

    // We should have an error event
    const errorEvent = events.find(e => e.type === "error");
    expect(errorEvent).toBeDefined();
    expect(errorEvent?.error).toBeDefined();

    // Clean up
    Bun.telemetry.disable();
  });

  test("telemetry allows tracking request metadata without keeping request object", async () => {
    const requestMetadata = new Map<number, { method: string; path: string; timestamp: number }>();

    Bun.telemetry.configure({
      onRequestStart(id, request) {
        // Extract only what we need from the request
        const url = new URL(request.url);
        requestMetadata.set(id, {
          method: request.method,
          path: url.pathname,
          timestamp: Date.now(),
        });
      },
      onRequestEnd(id) {
        const metadata = requestMetadata.get(id);
        if (metadata) {
          // Calculate duration
          const duration = Date.now() - metadata.timestamp;
          console.log(`Request ${id} (${metadata.method} ${metadata.path}) took ${duration}ms`);
          // Clean up the metadata
          requestMetadata.delete(id);
        }
      },
    });

    using server = Bun.serve({
      port: 0,
      fetch() {
        return new Response("OK");
      },
    });

    await fetch(`http://localhost:${server.port}/api/users`, { method: "GET" });
    await fetch(`http://localhost:${server.port}/api/posts`, { method: "POST", body: "{}" });

    // Give it a moment for the hooks to complete
    await Bun.sleep(10);

    // All metadata should be cleaned up after requests complete
    expect(requestMetadata.size).toBe(0);

    // Clean up
    Bun.telemetry.disable();
  });

  test("telemetry IDs are unique per request", async () => {
    const ids = new Set<number>();

    Bun.telemetry.configure({
      onRequestStart(id) {
        ids.add(id);
      },
    });

    using server = Bun.serve({
      port: 0,
      fetch() {
        return new Response("ID test");
      },
    });

    // Make multiple requests
    await Promise.all([
      fetch(`http://localhost:${server.port}/1`),
      fetch(`http://localhost:${server.port}/2`),
      fetch(`http://localhost:${server.port}/3`),
    ]);

    // All IDs should be unique
    expect(ids.size).toBe(3);

    // Clean up
    Bun.telemetry.disable();
  });

  test("telemetry does not interfere with server when disabled", async () => {
    // Ensure telemetry is disabled
    Bun.telemetry.disable();
    expect(Bun.telemetry.isEnabled()).toBe(false);

    using server = Bun.serve({
      port: 0,
      fetch() {
        return new Response("no telemetry");
      },
    });

    const response = await fetch(`http://localhost:${server.port}/`);
    const text = await response.text();

    expect(text).toBe("no telemetry");
    expect(response.status).toBe(200);
  });

  test("telemetry with Node.js compatibility layer", async () => {
    // This test verifies telemetry works with the Node.js http.createServer API
    using dir = tempDir("telemetry-node");

    const serverFile = `
      const http = require("http");

      const events = [];

      Bun.telemetry.configure({
        onRequestStart(id, request) {
          // Node.js path should get a stub object with url, method, and headers
          events.push({
            type: "start",
            id,
            hasUrl: !!request.url,
            hasMethod: !!request.method,
            hasHeaders: !!request.headers
          });
        },
        onRequestEnd(id) {
          events.push({ type: "end", id });
        }
      });

      const server = http.createServer((req, res) => {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("Node.js server");
      });

      server.listen(0, () => {
        const { port } = server.address();
        console.log("PORT:" + port);
      });

      // Export events for testing
      global.telemetryEvents = events;
    `;

    await Bun.write(`${dir}/server.js`, serverFile);

    await using proc = Bun.spawn({
      cmd: [bunExe(), `${dir}/server.js`],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
    });

    // Wait for server to start and get port
    let port = 0;
    const reader = proc.stdout.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const text = decoder.decode(value);
      const match = text.match(/PORT:(\d+)/);
      if (match) {
        port = parseInt(match[1]);
        break;
      }
    }

    expect(port).toBeGreaterThan(0);

    // Make a request to the Node.js server
    const response = await fetch(`http://localhost:${port}/test`);
    const text = await response.text();
    expect(text).toBe("Node.js server");

    // Clean up
    proc.kill();
  });

  test("telemetry captures response headers", async () => {
    const responseHeaders: Array<{ id: number; status: number; headers: any }> = [];

    Bun.telemetry.configure({
      onResponseHeaders(id, response) {
        responseHeaders.push({
          id,
          status: response.status,
          headers: response.headers,
        });
      },
    });

    using server = Bun.serve({
      port: 0,
      fetch() {
        return new Response("test body", {
          status: 201,
          headers: {
            "X-Custom-Header": "test-value",
            "Content-Type": "text/plain",
          },
        });
      },
    });

    await fetch(`http://localhost:${server.port}/`);
    await Bun.sleep(10);

    expect(responseHeaders.length).toBe(1);
    expect(responseHeaders[0].status).toBe(201);
    expect(responseHeaders[0].headers).toBeDefined();

    // Clean up
    Bun.telemetry.disable();
  });
});
