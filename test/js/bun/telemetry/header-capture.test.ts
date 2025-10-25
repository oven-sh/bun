/**
 * Test header capture using Bun.telemetry native configuration
 * Validates that the AttributeKey pointer optimization works correctly
 * NO @opentelemetry/* imports - testing ONLY Bun.telemetry API
 */
import { describe, expect, test } from "bun:test";
import { ConfigurationProperty, InstrumentKind } from "./types";

describe("HTTP Server Header Capture (Bun.serve)", () => {
  test("captures configured request headers from Bun.serve", async () => {
    const capturedAttrs: any = {};

    const instrument = {
      type: InstrumentKind.HTTP,
      name: "test-server-request-headers",
      version: "1.0.0",
      onOperationStart(id: number, attributes: any) {
        Object.assign(capturedAttrs, attributes);
      },
      onOperationEnd() {},
      onOperationError() {},
    };

    using ref = Bun.telemetry.attach(instrument);

    // Configure header capture via native API
    const hooks = Bun.telemetry.nativeHooks();
    hooks?.setConfigurationProperty(ConfigurationProperty.http_capture_headers_server_request, [
      "content-type",
      "x-custom-header",
      "user-agent",
    ]);

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
      type: InstrumentKind.HTTP,
      name: "test-server-response-headers",
      version: "1.0.0",
      onOperationStart() {},
      onOperationEnd(id: number, attributes: any) {
        Object.assign(capturedAttrs, attributes);
      },
      onOperationError() {},
    };

    using ref = Bun.telemetry.attach(instrument);

    // Configure header capture via native API
    const hooks = Bun.telemetry.nativeHooks();
    hooks?.setConfigurationProperty(ConfigurationProperty.http_capture_headers_server_response, [
      "content-type",
      "x-response-id",
    ]);

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

    // Wait a bit for onOperationEnd to be called
    await Bun.sleep(10);

    // Verify captured response headers
    expect(capturedAttrs["http.response.header.content-type"]).toBe("text/plain");
    expect(capturedAttrs["http.response.header.x-response-id"]).toBe("abc123");

    // Verify non-configured header was NOT captured
    expect(capturedAttrs["http.response.header.x-not-captured"]).toBeUndefined();
  });

  test("handles case-insensitive header names", async () => {
    const capturedAttrs: any = {};

    const instrument = {
      type: InstrumentKind.HTTP,
      name: "test-case-insensitive",
      version: "1.0.0",
      onOperationStart(id: number, attributes: any) {
        Object.assign(capturedAttrs, attributes);
      },
      onOperationEnd() {},
      onOperationError() {},
    };

    using ref = Bun.telemetry.attach(instrument);

    const hooks = Bun.telemetry.nativeHooks();
    hooks?.setConfigurationProperty(
      ConfigurationProperty.http_capture_headers_server_request,
      ["content-type"], // lowercase
    );

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
      type: InstrumentKind.Fetch,
      name: "test-fetch-request-headers",
      version: "1.0.0",
      onOperationStart(id: number, attributes: any) {
        Object.assign(capturedAttrs, attributes);
      },
      onOperationEnd() {},
      onOperationError() {},
    };

    using ref = Bun.telemetry.attach(instrument);

    const hooks = Bun.telemetry.nativeHooks();
    hooks?.setConfigurationProperty(ConfigurationProperty.http_capture_headers_fetch_request, [
      "content-type",
      "authorization",
      "x-request-id",
    ]);

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

  test("captures configured response headers from incoming fetch", async () => {
    const capturedAttrs: any = {};

    const instrument = {
      type: InstrumentKind.Fetch,
      name: "test-fetch-response-headers",
      version: "1.0.0",
      onOperationStart() {},
      onOperationEnd(id: number, attributes: any) {
        Object.assign(capturedAttrs, attributes);
      },
      onOperationError() {},
    };

    using ref = Bun.telemetry.attach(instrument);

    const hooks = Bun.telemetry.nativeHooks();
    hooks?.setConfigurationProperty(ConfigurationProperty.http_capture_headers_fetch_response, [
      "content-type",
      "x-rate-limit",
    ]);

    // Create a test server that returns headers
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

    await fetch(`http://localhost:${server.port}/test`);

    // Verify captured response headers
    expect(capturedAttrs["http.response.header.content-type"]).toBe("application/json");
    expect(capturedAttrs["http.response.header.x-rate-limit"]).toBe("100");

    // Verify non-configured header was NOT captured
    expect(capturedAttrs["http.response.header.x-not-captured"]).toBeUndefined();
  });
});

describe("AttributeKey Pointer Optimization Validation", () => {
  test("efficiently handles multiple headers without string conversion", async () => {
    const capturedCount: Record<string, number> = {};

    const instrument = {
      type: InstrumentKind.HTTP,
      name: "test-optimization",
      version: "1.0.0",
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

    const hooks = Bun.telemetry.nativeHooks();
    hooks?.setConfigurationProperty(ConfigurationProperty.http_capture_headers_server_request, [
      "content-type",
      "user-agent",
      "accept",
      "accept-encoding",
      "accept-language",
    ]);

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
      type: InstrumentKind.HTTP,
      name: "test-empty-config",
      version: "1.0.0",
      onOperationStart(id: number, attributes: any) {
        Object.assign(capturedAttrs, attributes);
      },
      onOperationEnd() {},
      onOperationError() {},
    };

    using ref = Bun.telemetry.attach(instrument);

    const hooks = Bun.telemetry.nativeHooks();
    hooks?.setConfigurationProperty(
      ConfigurationProperty.http_capture_headers_server_request,
      [], // Empty array - no headers to capture
    );

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
});
