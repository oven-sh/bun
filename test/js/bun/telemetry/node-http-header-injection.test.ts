import { expect, test } from "bun:test";
import { createServer } from "node:http";
import { InstrumentKind } from "./types";

test("Node.js http.Server injects headers from instruments", async () => {
  let injectCalled = false;

  using ref = Bun.telemetry.attach({
    type: InstrumentKind.HTTP,
    name: "test-node-http-inject",
    version: "1.0.0",
    injectHeaders: {
      response: ["traceparent", "x-custom-trace"],
    },
    onOperationStart() {},
    onOperationInject(opId: number, data: any) {
      injectCalled = true;
      // Return array of values matching injectHeaders.response order: ["traceparent", "x-custom-trace"]
      return [
        "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01", // traceparent
        "test-value-123", // x-custom-trace
      ];
    },
  });

  const server = createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("Hello World");
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(0, () => resolve());
    server.on("error", reject);
  });

  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Invalid address");

  try {
    const response = await fetch(`http://localhost:${address.port}/`);
    expect(response.status).toBe(200);

    // Verify inject hook was called
    expect(injectCalled).toBe(true);

    // Verify injected headers are present in response
    expect(response.headers.get("traceparent")).toBe("00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01");
    expect(response.headers.get("x-custom-trace")).toBe("test-value-123");

    await response.text();
  } finally {
    server.close();
  }
});

test("Node.js http.Server handles multiple instruments with same headers", async () => {
  using ref1 = Bun.telemetry.attach({
    type: InstrumentKind.HTTP,
    name: "test-inject-1",
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
    name: "test-inject-2",
    version: "1.0.0",
    injectHeaders: {
      response: ["traceparent"],
    },
    onOperationStart() {},
    onOperationInject() {
      // Return array of values matching injectHeaders.response order: ["traceparent"]
      return ["00-trace2-span2-01"]; // traceparent
    },
  });

  const server = createServer((req, res) => {
    res.writeHead(200);
    res.end("OK");
  });

  await new Promise<void>(resolve => {
    server.listen(0, () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Invalid address");

  try {
    const response = await fetch(`http://localhost:${address.port}/`);

    // Last instrument's value wins (linear concatenation, last setHeader wins)
    const traceparent = response.headers.get("traceparent");
    expect(traceparent).toMatch(/00-trace[12]-span[12]-01/);

    await response.text();
  } finally {
    server.close();
  }
});

test("Node.js http.Server skips injection when no headers configured", async () => {
  let injectCalled = false;

  using ref = Bun.telemetry.attach({
    type: InstrumentKind.HTTP,
    name: "test-no-inject-headers",
    version: "1.0.0",
    // No injectHeaders specified
    onOperationStart() {},
    onOperationInject() {
      injectCalled = true;
      // Return array (but this shouldn't be called)
      return ["should-not-appear"];
    },
  });

  const server = createServer((req, res) => {
    res.writeHead(200);
    res.end("OK");
  });

  await new Promise<void>(resolve => {
    server.listen(0, () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Invalid address");

  try {
    const response = await fetch(`http://localhost:${address.port}/`);

    // Inject should not be called when no headers configured
    expect(injectCalled).toBe(false);
    expect(response.headers.get("traceparent")).toBeNull();

    await response.text();
  } finally {
    server.close();
  }
});

test("Node.js http.Server handles inject returning undefined gracefully", async () => {
  using ref = Bun.telemetry.attach({
    type: InstrumentKind.HTTP,
    name: "test-inject-undefined",
    version: "1.0.0",
    injectHeaders: {
      response: ["traceparent"],
    },
    onOperationStart() {},
    onOperationInject() {
      // Return undefined - no headers to inject
      return undefined;
    },
  });

  const server = createServer((req, res) => {
    res.writeHead(200);
    res.end("OK");
  });

  await new Promise<void>(resolve => {
    server.listen(0, () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Invalid address");

  try {
    const response = await fetch(`http://localhost:${address.port}/`);
    expect(response.status).toBe(200);

    // No headers should be injected
    expect(response.headers.get("traceparent")).toBeNull();

    await response.text();
  } finally {
    server.close();
  }
});

test("Node.js http.Server only injects configured headers", async () => {
  using ref = Bun.telemetry.attach({
    type: InstrumentKind.HTTP,
    name: "test-selective-inject",
    version: "1.0.0",
    injectHeaders: {
      response: ["traceparent"],
    },
    onOperationStart() {},
    onOperationInject() {
      // Return array of values matching injectHeaders.response order: ["traceparent"]
      // Note: Extra values beyond configured headers should be ignored
      return [
        "00-configured-header-01", // traceparent (configured)
        "should-not-appear", // x-not-configured (not configured, should be ignored)
      ];
    },
  });

  const server = createServer((req, res) => {
    res.writeHead(200);
    res.end("OK");
  });

  await new Promise<void>(resolve => {
    server.listen(0, () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Invalid address");

  try {
    const response = await fetch(`http://localhost:${address.port}/`);

    // Only configured header should be injected
    expect(response.headers.get("traceparent")).toBe("00-configured-header-01");
    expect(response.headers.get("x-not-configured")).toBeNull();

    await response.text();
  } finally {
    server.close();
  }
});
