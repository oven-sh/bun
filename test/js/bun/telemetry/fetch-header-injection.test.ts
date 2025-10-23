import { expect, test } from "bun:test";
import { InstrumentKind } from "./types";

test("fetch injects headers into outgoing requests", async () => {
  let injectCalled = false;
  let receivedHeaders: Record<string, string> = {};

  // Setup test server to capture injected headers
  const testServer = Bun.serve({
    port: 0,
    fetch(req) {
      receivedHeaders = Object.fromEntries(req.headers.entries());
      return new Response("OK");
    },
  });

  using ref = Bun.telemetry.attach({
    type: InstrumentKind.Fetch,
    name: "test-fetch-inject",
    version: "1.0.0",
    injectHeaders: {
      request: ["traceparent", "x-custom-trace"],
    },
    onOperationStart() {},
    onOperationInject(opId: number, data: any) {
      injectCalled = true;
      // Return array of values matching injectHeaders.request order: ["traceparent", "x-custom-trace"]
      return [
        "00-fetch-trace-id-span-01", // traceparent
        "fetch-client-test", // x-custom-trace
      ];
    },
  });

  try {
    const response = await fetch(`http://localhost:${testServer.port}/`);
    await response.text();

    // Verify inject hook was called
    expect(injectCalled).toBe(true);

    // Verify headers were injected into the request
    expect(receivedHeaders["traceparent"]).toBe("00-fetch-trace-id-span-01");
    expect(receivedHeaders["x-custom-trace"]).toBe("fetch-client-test");
  } finally {
    testServer.stop();
  }
});

test("fetch handles multiple instruments injecting headers", async () => {
  let receivedHeaders: Record<string, string> = {};

  const testServer = Bun.serve({
    port: 0,
    fetch(req) {
      receivedHeaders = Object.fromEntries(req.headers.entries());
      return new Response("OK");
    },
  });

  using ref1 = Bun.telemetry.attach({
    type: InstrumentKind.Fetch,
    name: "test-inject-1",
    version: "1.0.0",
    injectHeaders: {
      request: ["traceparent", "x-trace-1"],
    },
    onOperationStart() {},
    onOperationInject() {
      // Return array of values matching injectHeaders.request order: ["traceparent", "x-trace-1"]
      return [
        "00-trace1-span1-01", // traceparent
        "value1", // x-trace-1
      ];
    },
  });

  using ref2 = Bun.telemetry.attach({
    type: InstrumentKind.Fetch,
    name: "test-inject-2",
    version: "1.0.0",
    injectHeaders: {
      request: ["traceparent", "x-trace-2"],
    },
    onOperationStart() {},
    onOperationInject() {
      // Return array of values matching injectHeaders.request order: ["traceparent", "x-trace-2"]
      return [
        "00-trace2-span2-01", // traceparent
        "value2", // x-trace-2
      ];
    },
  });

  try {
    const response = await fetch(`http://localhost:${testServer.port}/`);
    await response.text();

    // Both instruments should inject their custom headers
    expect(receivedHeaders["x-trace-1"]).toBe("value1");
    expect(receivedHeaders["x-trace-2"]).toBe("value2");

    // Last instrument's traceparent wins (linear concatenation)
    expect(receivedHeaders["traceparent"]).toMatch(/00-trace[12]-span[12]-01/);
  } finally {
    testServer.stop();
  }
});

test("fetch skips injection when no headers configured", async () => {
  let injectCalled = false;
  let receivedHeaders: Record<string, string> = {};

  const testServer = Bun.serve({
    port: 0,
    fetch(req) {
      receivedHeaders = Object.fromEntries(req.headers.entries());
      return new Response("OK");
    },
  });

  using ref = Bun.telemetry.attach({
    type: InstrumentKind.Fetch,
    name: "test-no-inject",
    version: "1.0.0",
    // No injectHeaders specified
    onOperationStart() {},
    onOperationInject() {
      injectCalled = true;
      // Return array (but this shouldn't be called)
      return ["should-not-appear"];
    },
  });

  try {
    const response = await fetch(`http://localhost:${testServer.port}/`);
    await response.text();

    // Inject should not be called when no headers configured
    expect(injectCalled).toBe(false);
    expect(receivedHeaders["traceparent"]).toBeUndefined();
  } finally {
    testServer.stop();
  }
});

test("fetch only injects configured headers", async () => {
  let receivedHeaders: Record<string, string> = {};

  const testServer = Bun.serve({
    port: 0,
    fetch(req) {
      receivedHeaders = Object.fromEntries(req.headers.entries());
      return new Response("OK");
    },
  });

  using ref = Bun.telemetry.attach({
    type: InstrumentKind.Fetch,
    name: "test-selective",
    version: "1.0.0",
    injectHeaders: {
      request: ["traceparent"],
    },
    onOperationStart() {},
    onOperationInject() {
      // Return array of values matching injectHeaders.request order: ["traceparent"]
      // Note: Extra values beyond configured headers should be ignored
      return [
        "00-configured-01", // traceparent (configured)
        "should-not-appear", // x-not-configured (not configured, should be ignored)
      ];
    },
  });

  try {
    const response = await fetch(`http://localhost:${testServer.port}/`);
    await response.text();

    // Only configured header should be injected
    expect(receivedHeaders["traceparent"]).toBe("00-configured-01");
    expect(receivedHeaders["x-not-configured"]).toBeUndefined();
  } finally {
    testServer.stop();
  }
});

test("fetch preserves user-provided headers", async () => {
  let receivedHeaders: Record<string, string> = {};

  const testServer = Bun.serve({
    port: 0,
    fetch(req) {
      receivedHeaders = Object.fromEntries(req.headers.entries());
      return new Response("OK");
    },
  });

  using ref = Bun.telemetry.attach({
    type: InstrumentKind.Fetch,
    name: "test-preserve",
    version: "1.0.0",
    injectHeaders: {
      request: ["traceparent"],
    },
    onOperationStart() {},
    onOperationInject() {
      // Return array of values matching injectHeaders.request order: ["traceparent"]
      return ["00-injected-01"]; // traceparent
    },
  });

  try {
    const response = await fetch(`http://localhost:${testServer.port}/`, {
      headers: {
        "content-type": "application/json",
        "x-user-header": "user-value",
      },
    });
    await response.text();

    // User headers should be preserved
    expect(receivedHeaders["content-type"]).toBe("application/json");
    expect(receivedHeaders["x-user-header"]).toBe("user-value");

    // Injected header should also be present
    expect(receivedHeaders["traceparent"]).toBe("00-injected-01");
  } finally {
    testServer.stop();
  }
});

test("fetch handles inject returning undefined gracefully", async () => {
  let receivedHeaders: Record<string, string> = {};

  const testServer = Bun.serve({
    port: 0,
    fetch(req) {
      receivedHeaders = Object.fromEntries(req.headers.entries());
      return new Response("OK");
    },
  });

  using ref = Bun.telemetry.attach({
    type: InstrumentKind.Fetch,
    name: "test-undefined",
    version: "1.0.0",
    injectHeaders: {
      request: ["traceparent"],
    },
    onOperationStart() {},
    onOperationInject() {
      return undefined;
    },
  });

  try {
    const response = await fetch(`http://localhost:${testServer.port}/`);
    await response.text();

    // No headers should be injected
    expect(receivedHeaders["traceparent"]).toBeUndefined();
  } finally {
    testServer.stop();
  }
});
