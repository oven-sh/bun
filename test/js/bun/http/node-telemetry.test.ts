/**
 * Core telemetry insertion point tests for Node.js http.createServer
 *
 * These tests verify that _node_binding hooks in src/js/node/_http_server.ts are called.
 * They do NOT test OpenTelemetry integration - see packages/bun-otel/ for that.
 *
 * Note: Node.js uses _node_binding hooks; Bun.serve uses high-level callbacks.
 */
import { afterEach, expect, test } from "bun:test";
import * as http from "node:http";

// Reset telemetry after each test
afterEach(() => {
  try {
    Bun.telemetry.configure(null);
  } catch (e) {
    // Ignore if already reset
  }
});

test("_node_binding.handleIncomingRequest and handleWriteHead are invoked with correct arguments", async () => {
  const calls: Array<{ method: string; args: any[] }> = [];

  // Create a stub _node_binding that records all calls
  const mockBinding = {
    handleIncomingRequest(req: any, res: any) {
      calls.push({ method: "handleIncomingRequest", args: [req, res] });
      return 123; // Return a fake request ID
    },
    handleWriteHead(res: any, statusCode: number) {
      calls.push({ method: "handleWriteHead", args: [res, statusCode] });
    },
  };

  // Configure telemetry with our mock
  Bun.telemetry.configure({
    _node_binding: mockBinding,
  });

  const server = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("Hello!");
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(0, () => resolve());
    server.on("error", reject);
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Server address not available");
  }

  const port = address.port;

  // Make a request
  const response = await fetch(`http://localhost:${port}/test`);
  expect(response.status).toBe(200);
  await response.text();

  // Wait for callbacks (short spin to avoid flakiness)
  let attempts = 0;
  while (calls.length < 2 && attempts < 50) {
    await Bun.sleep(10);
    attempts++;
  }

  // Verify the hooks were called
  expect(calls.length).toBeGreaterThanOrEqual(2);

  // Verify handleIncomingRequest was called
  const incomingCall = calls.find(c => c.method === "handleIncomingRequest");
  expect(incomingCall).toBeDefined();
  expect(incomingCall?.args[0].method).toBe("GET");
  expect(incomingCall?.args[0].url).toBe("/test");
  expect(incomingCall?.args[1]).toBeDefined(); // ServerResponse object

  // Verify handleWriteHead was called
  const writeHeadCall = calls.find(c => c.method === "handleWriteHead");
  expect(writeHeadCall).toBeDefined();
  expect(writeHeadCall?.args[0]).toBe(incomingCall?.args[1]); // Same response object
  expect(writeHeadCall?.args[1]).toBe(200); // Status code

  server.close();
});

test("handleWriteHead deduplication - called only once even with multiple writes", async () => {
  const calls: string[] = [];

  const mockBinding = {
    handleIncomingRequest() {
      calls.push("handleIncomingRequest");
      return 1;
    },
    handleWriteHead() {
      calls.push("handleWriteHead");
    },
  };

  Bun.telemetry.configure({ _node_binding: mockBinding });

  const server = http.createServer((req, res) => {
    // Call writeHead explicitly
    res.writeHead(200);
    res.write("chunk1");
    res.write("chunk2");
    res.end("final");
  });

  await new Promise<void>(resolve => {
    server.listen(0, () => resolve());
  });

  const port = (server.address() as any).port;
  await fetch(`http://localhost:${port}/`);

  // Wait for all calls
  let attempts = 0;
  while (calls.length < 2 && attempts < 50) {
    await Bun.sleep(10);
    attempts++;
  }

  // handleWriteHead should be called exactly once (deduplication works)
  const writeHeadCalls = calls.filter(c => c === "handleWriteHead");
  expect(writeHeadCalls.length).toBe(1);

  server.close();
});

test("handleWriteHead receives ServerResponse with accessible headers via getHeader()", async () => {
  let capturedStatusCode: number | undefined;
  let capturedResponse: any;

  const mockBinding = {
    handleIncomingRequest() {
      return 1;
    },
    handleWriteHead(res: any, statusCode: number) {
      capturedStatusCode = statusCode;
      capturedResponse = res;
    },
  };

  Bun.telemetry.configure({ _node_binding: mockBinding });

  const server = http.createServer((req, res) => {
    res.writeHead(201, { "Content-Length": "42" });
    res.end();
  });

  await new Promise<void>(resolve => {
    server.listen(0, () => resolve());
  });

  const port = (server.address() as any).port;
  await fetch(`http://localhost:${port}/`);

  // Wait for callback
  let attempts = 0;
  while (!capturedStatusCode && attempts < 50) {
    await Bun.sleep(10);
    attempts++;
  }

  expect(capturedStatusCode).toBe(201);
  expect(capturedResponse).toBeDefined();

  // The mock can inspect the response object to verify content-length is accessible
  const contentLength = capturedResponse.getHeader("content-length");
  expect(contentLength).toBe("42");

  server.close();
});

test("telemetry failures are isolated and don't crash request path", async () => {
  // Create a binding that throws errors
  const mockBinding = {
    handleIncomingRequest() {
      throw new Error("Telemetry system failure in handleIncomingRequest");
    },
    handleWriteHead() {
      throw new Error("Telemetry system failure in handleWriteHead");
    },
  };

  Bun.telemetry.configure({ _node_binding: mockBinding });

  const server = http.createServer((req, res) => {
    // This should succeed despite telemetry failures
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("Request handled successfully");
  });

  await new Promise<void>(resolve => {
    server.listen(0, () => resolve());
  });

  const port = (server.address() as any).port;

  // Make request - should succeed despite telemetry errors
  const response = await fetch(`http://localhost:${port}/test`);
  expect(response.status).toBe(200);
  const body = await response.text();
  expect(body).toBe("Request handled successfully");

  server.close();
});
