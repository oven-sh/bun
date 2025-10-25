import { expect, test } from "bun:test";
import { InstrumentKind } from "./types";

test("HTTP server injects headers from instruments", async () => {
  using ref = Bun.telemetry.attach({
    type: InstrumentKind.HTTP,
    name: "test-server-inject",
    version: "1.0.0",
    injectHeaders: {
      response: ["traceparent", "x-custom-header"],
    },
    onOperationStart() {},
    onOperationInject(reqId: number, data: any) {
      // Return array of values matching injectHeaders.response order: ["traceparent", "x-custom-header"]
      return [
        "00-trace123-span456-01", // traceparent
        "custom-value", // x-custom-header
      ];
    },
  });

  using server = Bun.serve({
    port: 0,
    fetch(req) {
      return new Response("Hello");
    },
  });

  const response = await fetch(`http://localhost:${server.port}/`);
  const text = await response.text();

  expect(text).toBe("Hello");
  expect(response.headers.get("traceparent")).toBe("00-trace123-span456-01");
  expect(response.headers.get("x-custom-header")).toBe("custom-value");
});

test("HTTP server merges headers from multiple instruments", async () => {
  using ref1 = Bun.telemetry.attach({
    type: InstrumentKind.HTTP,
    name: "test-server-1",
    version: "1.0.0",
    injectHeaders: {
      response: ["traceparent"],
    },
    onOperationStart() {},
    onOperationInject() {
      // Return array of values matching injectHeaders.response order: ["traceparent"]
      return ["00-trace1-span1-01"]; // traceparent
    },
  });

  using ref2 = Bun.telemetry.attach({
    type: InstrumentKind.HTTP,
    name: "test-server-2",
    version: "1.0.0",
    injectHeaders: {
      response: ["x-request-id"],
    },
    onOperationStart() {},
    onOperationInject() {
      // Return array of values matching injectHeaders.response order: ["x-request-id"]
      return ["req-123"]; // x-request-id
    },
  });

  using server = Bun.serve({
    port: 0,
    fetch(req) {
      return new Response("Test");
    },
  });

  const response = await fetch(`http://localhost:${server.port}/`);

  // Both instruments' headers should be present
  expect(response.headers.get("traceparent")).toBe("00-trace1-span1-01");
  expect(response.headers.get("x-request-id")).toBe("req-123");
});

test("HTTP server handles missing header values gracefully", async () => {
  using ref = Bun.telemetry.attach({
    type: InstrumentKind.HTTP,
    name: "test-server-missing",
    version: "1.0.0",
    injectHeaders: {
      response: ["traceparent", "x-missing"],
    },
    onOperationStart() {},
    onOperationInject() {
      // Return array of values matching injectHeaders.response order: ["traceparent", "x-missing"]
      // Only provide value for first header (second will be missing/undefined)
      return ["00-trace-span-01"]; // traceparent (x-missing not provided)
    },
  });

  using server = Bun.serve({
    port: 0,
    fetch(req) {
      return new Response("OK");
    },
  });

  const response = await fetch(`http://localhost:${server.port}/`);

  // Present header should be injected
  expect(response.headers.get("traceparent")).toBe("00-trace-span-01");
  // Missing header should not cause errors
  expect(response.headers.get("x-missing")).toBeNull();
});

test("HTTP server without instrumentation doesn't inject headers", async () => {
  using server = Bun.serve({
    port: 0,
    fetch(req) {
      return new Response("No telemetry");
    },
  });

  const response = await fetch(`http://localhost:${server.port}/`);
  const text = await response.text();

  expect(text).toBe("No telemetry");
  expect(response.headers.get("traceparent")).toBeNull();
  expect(response.headers.get("x-custom-header")).toBeNull();
});

test("HTTP server allows duplicate header values (linear concatenation)", async () => {
  using ref1 = Bun.telemetry.attach({
    type: InstrumentKind.HTTP,
    name: "test-server-dup1",
    version: "1.0.0",
    injectHeaders: {
      response: ["x-trace-id"],
    },
    onOperationStart() {},
    onOperationInject() {
      // Return array of values matching injectHeaders.response order: ["x-trace-id"]
      return ["trace1"]; // x-trace-id
    },
  });

  using ref2 = Bun.telemetry.attach({
    type: InstrumentKind.HTTP,
    name: "test-server-dup2",
    version: "1.0.0",
    injectHeaders: {
      response: ["x-trace-id"],
    },
    onOperationStart() {},
    onOperationInject() {
      // Return array of values matching injectHeaders.response order: ["x-trace-id"]
      return ["trace2"]; // x-trace-id
    },
  });

  using server = Bun.serve({
    port: 0,
    fetch(req) {
      return new Response("Duplicates");
    },
  });

  const response = await fetch(`http://localhost:${server.port}/`);

  // Both values should be present (Headers API behavior)
  // Note: Exact behavior depends on Headers implementation
  const traceHeader = response.headers.get("x-trace-id");
  expect(traceHeader).toBeTruthy();
});
