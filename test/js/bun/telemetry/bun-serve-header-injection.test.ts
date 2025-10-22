import { expect, test } from "bun:test";
import { InstrumentKind } from "./types";

test("Bun.serve injects headers from instruments", async () => {
  let injectCalled = false;

  using ref = Bun.telemetry.attach({
    type: InstrumentKind.HTTP,
    name: "test-bun-serve-inject",
    version: "1.0.0",
    injectHeaders: {
      response: ["traceparent", "x-custom-trace"],
    },
    onOperationStart() {},
    onOperationInject(opId: number, data: any) {
      injectCalled = true;
      return {
        traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
        "x-custom-trace": "bun-serve-test",
      };
    },
  });

  const server = Bun.serve({
    port: 0,
    fetch(req) {
      return new Response("Hello from Bun.serve");
    },
  });

  try {
    const response = await fetch(`http://localhost:${server.port}/`);
    expect(response.status).toBe(200);

    // Verify inject hook was called
    expect(injectCalled).toBe(true);

    // Verify injected headers are present in response
    expect(response.headers.get("traceparent")).toBe("00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01");
    expect(response.headers.get("x-custom-trace")).toBe("bun-serve-test");

    await response.text();
  } finally {
    server.stop();
  }
});

test("Bun.serve handles multiple instruments", async () => {
  using ref1 = Bun.telemetry.attach({
    type: InstrumentKind.HTTP,
    name: "test-inject-1",
    version: "1.0.0",
    injectHeaders: {
      response: ["traceparent", "x-trace-1"],
    },
    onOperationStart() {},
    onOperationInject() {
      return {
        traceparent: "00-trace1-span1-01",
        "x-trace-1": "value1",
      };
    },
  });

  using ref2 = Bun.telemetry.attach({
    type: InstrumentKind.HTTP,
    name: "test-inject-2",
    version: "1.0.0",
    injectHeaders: {
      response: ["traceparent", "x-trace-2"],
    },
    onOperationStart() {},
    onOperationInject() {
      return {
        traceparent: "00-trace2-span2-01",
        "x-trace-2": "value2",
      };
    },
  });

  const server = Bun.serve({
    port: 0,
    fetch() {
      return new Response("OK");
    },
  });

  try {
    const response = await fetch(`http://localhost:${server.port}/`);

    // Both instruments should inject their custom headers
    expect(response.headers.get("x-trace-1")).toBe("value1");
    expect(response.headers.get("x-trace-2")).toBe("value2");

    // Last instrument's traceparent wins (linear concatenation, last append wins)
    const traceparent = response.headers.get("traceparent");
    expect(traceparent).toMatch(/00-trace[12]-span[12]-01/);

    await response.text();
  } finally {
    server.stop();
  }
});

test("Bun.serve skips injection when no headers configured", async () => {
  let injectCalled = false;

  using ref = Bun.telemetry.attach({
    type: InstrumentKind.HTTP,
    name: "test-no-inject",
    version: "1.0.0",
    // No injectHeaders specified
    onOperationStart() {},
    onOperationInject() {
      injectCalled = true;
      return { traceparent: "should-not-appear" };
    },
  });

  const server = Bun.serve({
    port: 0,
    fetch() {
      return new Response("OK");
    },
  });

  try {
    const response = await fetch(`http://localhost:${server.port}/`);

    // Inject should not be called when no headers configured
    expect(injectCalled).toBe(false);
    expect(response.headers.get("traceparent")).toBeNull();

    await response.text();
  } finally {
    server.stop();
  }
});

test("Bun.serve only injects configured headers", async () => {
  using ref = Bun.telemetry.attach({
    type: InstrumentKind.HTTP,
    name: "test-selective",
    version: "1.0.0",
    injectHeaders: {
      response: ["traceparent"],
    },
    onOperationStart() {},
    onOperationInject() {
      return {
        traceparent: "00-configured-01",
        "x-not-configured": "should-not-appear",
      };
    },
  });

  const server = Bun.serve({
    port: 0,
    fetch() {
      return new Response("OK");
    },
  });

  try {
    const response = await fetch(`http://localhost:${server.port}/`);

    // Only configured header should be injected
    expect(response.headers.get("traceparent")).toBe("00-configured-01");
    expect(response.headers.get("x-not-configured")).toBeNull();

    await response.text();
  } finally {
    server.stop();
  }
});

test("Bun.serve works with Response objects that have existing headers", async () => {
  using ref = Bun.telemetry.attach({
    type: InstrumentKind.HTTP,
    name: "test-existing-headers",
    version: "1.0.0",
    injectHeaders: {
      response: ["traceparent"],
    },
    onOperationStart() {},
    onOperationInject() {
      return { traceparent: "00-injected-trace-01" };
    },
  });

  const server = Bun.serve({
    port: 0,
    fetch() {
      return new Response("OK", {
        headers: {
          "content-type": "text/plain",
          "x-custom": "user-header",
        },
      });
    },
  });

  try {
    const response = await fetch(`http://localhost:${server.port}/`);

    // User headers should be preserved
    expect(response.headers.get("content-type")).toBe("text/plain");
    expect(response.headers.get("x-custom")).toBe("user-header");

    // Injected header should also be present
    expect(response.headers.get("traceparent")).toBe("00-injected-trace-01");

    await response.text();
  } finally {
    server.stop();
  }
});
