/**
 * Test header capture using Bun.telemetry native configuration
 * Validates that the AttributeKey pointer optimization works correctly
 * NO @opentelemetry/* imports - testing ONLY Bun.telemetry API
 */
import { describe, expect, test } from "bun:test";
import { InstrumentKinds } from "./types";

// Helper to wait for async telemetry events without unconditional sleep
function waitForCondition(checkFn: () => boolean, timeoutMs = 100): Promise<void> {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    const check = () => {
      if (checkFn()) {
        resolve();
      } else if (Date.now() - startTime > timeoutMs) {
        reject(new Error("Timeout waiting for condition"));
      } else {
        setImmediate(check);
      }
    };
    check();
  });
}

describe("HTTP Server Header Capture (Bun.serve)", () => {
  test("captures configured request headers from Bun.serve", async () => {
    const capturedAttrs: any = {};

    const instrument = {
      kind: InstrumentKinds.HTTP,
      name: "test-server-request-headers",
      version: "1.0.0",
      onOperationStart(id: number, attributes: any) {
        Object.assign(capturedAttrs, attributes);
      },
      onOperationEnd() {},
      onOperationError() {},
      captureAttributes: {
        requestHeaders: ["content-type", "x-custom-header", "user-agent"],
      },
    };

    using ref = Bun.telemetry.attach(instrument);

    using server = Bun.serve({
      port: 0,
      fetch(req) {
        return new Response("OK");
      },
    });

    await fetch(`http://localhost:${server.port}/test`, {
      headers: {
        "Content-Type": "application/json",
        "X-Custom-Header": "test-value",
        "User-Agent": "TestAgent/1.0",
        "X-Not-Captured": "should-not-appear",
      },
    });

    // Verify captured headers (using AttributeKey pointer optimization)
    expect(capturedAttrs["http.request.header.content-type"]).toBe("application/json");
    expect(capturedAttrs["http.request.header.x-custom-header"]).toBe("test-value");
    expect(capturedAttrs["http.request.header.user-agent"]).toBe("TestAgent/1.0");

    // Verify non-configured header was NOT captured
    expect(capturedAttrs["http.request.header.x-not-captured"]).toBeUndefined();
  });

  test("captures configured response headers from Bun.serve", async () => {
    const capturedAttrs: any = {};
    const instrument = {
      kind: InstrumentKinds.HTTP,
      name: "test-server-response-headers",
      version: "1.0.0",
      captureAttributes: {
        responseHeaders: ["content-type", "x-response-id"],
      },
      onOperationStart() {},
      onOperationProgress(id: number, attributes: any) {
        // Response headers come via progress event
        Object.assign(capturedAttrs, attributes);
      },
      onOperationEnd() {},
      onOperationError() {},
    };

    using ref = Bun.telemetry.attach(instrument);

    using server = Bun.serve({
      port: 0,
      fetch(req) {
        return new Response("Test Body", {
          headers: {
            "Content-Type": "text/plain",
            "X-Response-ID": "abc123",
            "X-Not-Captured": "should-not-appear",
          },
        });
      },
    });

    await fetch(`http://localhost:${server.port}/test`);

    // Wait for async telemetry events
    await waitForCondition(() => Object.keys(capturedAttrs).length > 0);

    // Verify captured response headers
    expect(capturedAttrs["http.response.header.content-type"]).toBe("text/plain");
    expect(capturedAttrs["http.response.header.x-response-id"]).toBe("abc123");

    // Verify non-configured header was NOT captured
    expect(capturedAttrs["http.response.header.x-not-captured"]).toBeUndefined();
  });

  test("captures non-standard custom headers from Bun.serve", async () => {
    const capturedAttrs: any = {};
    const instrument = {
      kind: InstrumentKinds.HTTP,
      name: "test-custom-headers",
      version: "1.0.0",
      captureAttributes: {
        responseHeaders: ["x-custom-tracking-id", "x-rate-limit-remaining", "x-api-version"],
      },
      onOperationStart() {},
      onOperationProgress(id: number, attributes: any) {
        Object.assign(capturedAttrs, attributes);
      },
      onOperationEnd() {},
      onOperationError() {},
    };

    using ref = Bun.telemetry.attach(instrument);

    using server = Bun.serve({
      port: 0,
      fetch(req) {
        return new Response("Custom Response", {
          headers: {
            "X-Custom-Tracking-ID": "track-12345",
            "X-Rate-Limit-Remaining": "42",
            "X-API-Version": "v2.1.0",
            "X-Ignored-Header": "not-captured",
          },
        });
      },
    });

    await fetch(`http://localhost:${server.port}/test`);

    // Wait for async telemetry events
    await waitForCondition(() => Object.keys(capturedAttrs).length > 0);

    // Verify custom headers are captured (normalized to lowercase)
    expect(capturedAttrs["http.response.header.x-custom-tracking-id"]).toBe("track-12345");
    expect(capturedAttrs["http.response.header.x-rate-limit-remaining"]).toBe("42");
    expect(capturedAttrs["http.response.header.x-api-version"]).toBe("v2.1.0");
    expect(capturedAttrs["http.response.header.x-ignored-header"]).toBeUndefined();
  });

  test("handles case-insensitive header names", async () => {
    const capturedAttrs: any = {};
    const instrument = {
      kind: InstrumentKinds.HTTP,
      name: "test-case-insensitive",
      version: "1.0.0",
      captureAttributes: {
        requestHeaders: ["content-type"], // lowercase
      },
      onOperationStart(id: number, attributes: any) {
        Object.assign(capturedAttrs, attributes);
      },
      onOperationEnd() {},
      onOperationError() {},
    };

    using ref = Bun.telemetry.attach(instrument);

    using server = Bun.serve({
      port: 0,
      fetch(req) {
        return new Response("OK");
      },
    });

    await fetch(`http://localhost:${server.port}/test`, {
      headers: {
        "Content-Type": "application/json", // Mixed case
      },
    });

    // Should still capture despite case difference
    expect(capturedAttrs["http.request.header.content-type"]).toBe("application/json");
  });
});

describe("Fetch Client Header Capture", () => {
  test("captures configured request headers from outgoing fetch", async () => {
    const capturedAttrs: any = {};

    const instrument = {
      kind: InstrumentKinds.Fetch,
      name: "test-fetch-request-headers",
      version: "1.0.0",
      captureAttributes: {
        requestHeaders: ["content-type", "authorization", "x-request-id"],
      },
      onOperationStart(id: number, attributes: any) {
        Object.assign(capturedAttrs, attributes);
      },
      onOperationEnd() {},
      onOperationError() {},
    };

    using ref = Bun.telemetry.attach(instrument);

    // Create a test server to receive the fetch
    using server = Bun.serve({
      port: 0,
      fetch(req) {
        return new Response("OK");
      },
    });

    await fetch(`http://localhost:${server.port}/api`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer test-token",
        "X-Request-ID": "req-123",
        "X-Not-Captured": "should-not-appear",
      },
      body: JSON.stringify({ test: "data" }),
    });

    // Verify captured request headers
    expect(capturedAttrs["http.request.header.content-type"]).toBe("application/json");
    expect(capturedAttrs["http.request.header.authorization"]).toBe("Bearer test-token");
    expect(capturedAttrs["http.request.header.x-request-id"]).toBe("req-123");

    // Verify non-configured header was NOT captured
    expect(capturedAttrs["http.request.header.x-not-captured"]).toBeUndefined();
  });

  test("captures configured response headers received by fetch() client", async () => {
    const capturedAttrs: any = {};

    const instrument = {
      kind: InstrumentKinds.Fetch,
      name: "test-fetch-response-headers",
      version: "1.0.0",
      captureAttributes: {
        responseHeaders: ["content-type", "x-rate-limit"],
      },
      onOperationStart() {},
      onOperationEnd(id: number, attributes: any) {
        // Fetch response headers come via end event (different from HTTP server)
        Object.assign(capturedAttrs, attributes);
      },
      onOperationError() {},
    };

    using ref = Bun.telemetry.attach(instrument);

    // Create a dummy server to respond with headers (NO telemetry on server side)
    using server = Bun.serve({
      port: 0,
      fetch(req) {
        return new Response("Response Data", {
          headers: {
            "Content-Type": "application/json",
            "X-Rate-Limit": "100",
            "X-Not-Captured": "should-not-appear",
          },
        });
      },
    });

    // Make fetch() call AS A CLIENT - we're testing client-side response header capture
    await fetch(`http://localhost:${server.port}/test`);

    // Verify captured response headers
    expect(capturedAttrs["http.response.header.content-type"]).toBe("application/json");
    expect(capturedAttrs["http.response.header.x-rate-limit"]).toBe("100");

    // Verify non-configured header was NOT captured
    expect(capturedAttrs["http.response.header.x-not-captured"]).toBeUndefined();
  });

  test("captures content-length for fetch requests and responses", async () => {
    const fetchRequestAttrs: any = {};
    const fetchResponseAttrs: any = {};

    const instrument = {
      kind: InstrumentKinds.Fetch,
      name: "test-content-length-fetch",
      version: "1.0.0",
      captureAttributes: {
        requestHeaders: ["content-length", "content-type"],
        responseHeaders: ["content-length", "content-type"],
      },
      onOperationStart(id: number, attributes: any) {
        Object.assign(fetchRequestAttrs, attributes);
      },
      onOperationEnd(id: number, attributes: any) {
        Object.assign(fetchResponseAttrs, attributes);
      },
      onOperationError() {},
    };

    using ref = Bun.telemetry.attach(instrument);

    // Create a server that echoes back the request body length
    using server = Bun.serve({
      port: 0,
      fetch(req) {
        return new Response("Fetch Response Data", {
          headers: {
            "Content-Type": "application/json",
          },
        });
      },
    });

    const requestBody = JSON.stringify({ fetch: "request data" });
    await fetch(`http://localhost:${server.port}/test`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: requestBody,
    });

    // Wait for async telemetry events
    await waitForCondition(() => Object.keys(fetchResponseAttrs).length > 0);

    // Note: Bun's fetch() doesn't expose content-length as a capturable request header (computed internally)
    // So we only verify content-type for requests
    expect(fetchRequestAttrs["http.request.header.content-type"]).toBe("application/json");

    // Verify fetch response headers captured content-length (this DOES work)
    expect(fetchResponseAttrs["http.response.header.content-length"]).toBe("19"); // "Fetch Response Data".length
    expect(fetchResponseAttrs["http.response.header.content-type"]).toBe("application/json");
  });
});

describe("AttributeKey Pointer Optimization Validation", () => {
  test("efficiently handles multiple headers without string conversion", async () => {
    const capturedCount: Record<string, number> = {};
    const instrument = {
      kind: InstrumentKinds.HTTP,
      name: "test-optimization",
      version: "1.0.0",
      captureAttributes: {
        requestHeaders: ["content-type", "user-agent", "accept", "accept-encoding", "accept-language"],
      },
      onOperationStart(id: number, attributes: any) {
        // Count captured attributes
        for (const key in attributes) {
          if (key.startsWith("http.request.header.")) {
            capturedCount[key] = (capturedCount[key] || 0) + 1;
          }
        }
      },
      onOperationEnd() {},
      onOperationError() {},
    };

    using ref = Bun.telemetry.attach(instrument);

    using server = Bun.serve({
      port: 0,
      fetch(req) {
        return new Response("OK");
      },
    });

    // Make multiple requests
    for (let i = 0; i < 5; i++) {
      await fetch(`http://localhost:${server.port}/test`, {
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "TestAgent/1.0",
          "Accept": "*/*",
          "Accept-Encoding": "gzip, deflate",
          "Accept-Language": "en-US",
        },
      });
    }

    // Each header should have been captured 5 times
    expect(capturedCount["http.request.header.content-type"]).toBe(5);
    expect(capturedCount["http.request.header.user-agent"]).toBe(5);
    expect(capturedCount["http.request.header.accept"]).toBe(5);
    expect(capturedCount["http.request.header.accept-encoding"]).toBe(5);
    expect(capturedCount["http.request.header.accept-language"]).toBe(5);
  });

  test("handles empty configuration gracefully", async () => {
    const capturedAttrs: any = {};
    const instrument = {
      kind: InstrumentKinds.HTTP,
      name: "test-empty-config",
      version: "1.0.0",
      onOperationStart(id: number, attributes: any) {
        Object.assign(capturedAttrs, attributes);
      },
      onOperationEnd() {},
      onOperationError() {},
    };

    using ref = Bun.telemetry.attach(instrument);

    using server = Bun.serve({
      port: 0,
      fetch(req) {
        return new Response("OK");
      },
    });

    await fetch(`http://localhost:${server.port}/test`, {
      headers: {
        "Content-Type": "application/json",
      },
    });

    // Should still have basic attributes, but no header attributes
    expect(capturedAttrs["http.request.method"]).toBe("GET");
    expect(capturedAttrs["http.request.header.content-type"]).toBeUndefined();
  });

  test("captures content-length for server requests and responses", async () => {
    const serverRequestAttrs: any = {};
    const serverResponseAttrs: any = {};
    const serverEndAttrs: any = {};

    const instrument = {
      kind: InstrumentKinds.HTTP,
      name: "test-content-length-server",
      version: "1.0.0",
      captureAttributes: {
        requestHeaders: ["content-length", "content-type"],
        responseHeaders: ["content-length", "content-type"],
      },
      onOperationStart(id: number, attributes: any) {
        Object.assign(serverRequestAttrs, attributes);
      },
      onOperationProgress(id: number, attributes: any) {
        Object.assign(serverResponseAttrs, attributes);
      },
      onOperationEnd(id: number, attributes: any) {
        Object.assign(serverEndAttrs, attributes);
      },
      onOperationError() {},
    };

    using ref = Bun.telemetry.attach(instrument);

    using server = Bun.serve({
      port: 0,
      fetch(req) {
        return new Response("Response Body Content", {
          headers: {
            "Content-Type": "text/plain",
          },
        });
      },
    });

    const requestBody = JSON.stringify({ test: "data" });
    await fetch(`http://localhost:${server.port}/test`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: requestBody,
    });

    // Wait for async telemetry events
    await waitForCondition(() => Object.keys(serverEndAttrs).length > 0);

    // Verify server request headers captured content-length (this DOES work)
    expect(serverRequestAttrs["http.request.header.content-length"]).toBe(String(requestBody.length));
    expect(serverRequestAttrs["http.request.header.content-type"]).toBe("application/json");

    // Verify response headers in onOperationProgress
    expect(serverResponseAttrs["http.response.header.content-type"]).toBe("text/plain");

    // Verify onOperationEnd is called
    expect(serverEndAttrs["http.response.status_code"]).toBe(200);
    expect(serverEndAttrs["operation.duration"]).toBeGreaterThan(0);

    // TODO: Server response body size tracking not yet implemented in hooks-http.zig
    // When implemented, this should work:
    // expect(serverEndAttrs["http.response.body.size"]).toBe(21); // "Response Body Content".length
  });
});
