import { expect, test } from "bun:test";
import * as http from "node:http";
import { waitForEvents } from "../telemetry-test-utils";

test("Node.js http.createServer works with Bun.telemetry", async () => {
  const events: Array<{ type: string; id: number; data?: any }> = [];

  // Configure telemetry
  Bun.telemetry.configure({
    onRequestStart(id, request) {
      events.push({
        type: "start",
        id,
        data: {
          method: request.method,
          url: request.url,
        },
      });
    },
    onResponseHeaders(id, statusCode, contentLength) {
      events.push({
        type: "headers",
        id,
        data: {
          statusCode,
          contentLength,
        },
      });
    },
    onRequestEnd(id) {
      events.push({ type: "end", id });
    },
    onRequestError(id, error) {
      events.push({ type: "error", id, data: error });
    },
  });

  const server = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("Hello from Node.js HTTP server!");
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(0, () => {
      resolve();
    });
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
  const text = await response.text();
  expect(text).toBe("Hello from Node.js HTTP server!");

  // Wait for telemetry callbacks to fire
  await waitForEvents(events, ["start", "headers", "end"]);

  // Verify telemetry events were captured
  expect(events.length).toBeGreaterThanOrEqual(3);

  const startEvent = events.find(e => e.type === "start");
  expect(startEvent).toBeDefined();
  expect(startEvent?.data?.method).toBe("GET");
  expect(startEvent?.data?.url).toBe("/test");

  const headersEvent = events.find(e => e.type === "headers");
  expect(headersEvent).toBeDefined();
  expect(headersEvent?.id).toBe(startEvent?.id);
  expect(headersEvent?.data?.statusCode).toBe(200);
  // Content-length may be 0 if not set explicitly in writeHead
  expect(headersEvent?.data?.contentLength).toBeGreaterThanOrEqual(0);

  const endEvent = events.find(e => e.type === "end");
  expect(endEvent).toBeDefined();
  expect(endEvent?.id).toBe(startEvent?.id);

  // Clean up
  await new Promise<void>(resolve => {
    server.close(() => resolve());
  });

  Bun.telemetry.disable();
});

test("Node.js http server without telemetry configured", async () => {
  // Ensure telemetry is disabled
  Bun.telemetry.disable();

  const server = http.createServer((req, res) => {
    res.writeHead(200);
    res.end("OK");
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

  // Should work fine without telemetry
  const response = await fetch(`http://localhost:${port}/`);
  expect(response.status).toBe(200);

  await new Promise<void>(resolve => {
    server.close(() => resolve());
  });
});

test("Node.js http server with multiple requests tracks each", async () => {
  const events: Array<{ type: string; id: number }> = [];

  Bun.telemetry.configure({
    onRequestStart(id) {
      events.push({ type: "start", id });
    },
    onRequestEnd(id) {
      events.push({ type: "end", id });
    },
  });

  const server = http.createServer((req, res) => {
    res.writeHead(200);
    res.end("OK");
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

  // Make multiple requests
  await Promise.all([
    fetch(`http://localhost:${port}/1`),
    fetch(`http://localhost:${port}/2`),
    fetch(`http://localhost:${port}/3`),
  ]);

  // Wait for all 6 events (3 starts + 3 ends)
  const startTime = Date.now();
  while (events.length < 6 && Date.now() - startTime < 200) {
    await Bun.sleep(5);
  }
  if (events.length < 6) {
    throw new Error(`Expected at least 6 events, got ${events.length}`);
  }

  // Should have 6 events: 3 starts + 3 ends
  expect(events.length).toBeGreaterThanOrEqual(6);

  // All IDs should be unique
  const startIds = events.filter(e => e.type === "start").map(e => e.id);
  const uniqueIds = new Set(startIds);
  expect(uniqueIds.size).toBe(startIds.length);

  // Every start should have a corresponding end
  for (const startEvent of events.filter(e => e.type === "start")) {
    const endEvent = events.find(e => e.type === "end" && e.id === startEvent.id);
    expect(endEvent).toBeDefined();
  }

  await new Promise<void>(resolve => {
    server.close(() => resolve());
  });

  Bun.telemetry.disable();
});

test("Node.js http server captures explicit content-length", async () => {
  const events: Array<{ type: string; id: number; data?: any }> = [];

  Bun.telemetry.configure({
    onRequestStart(id) {
      events.push({ type: "start", id });
    },
    onResponseHeaders(id, statusCode, contentLength) {
      events.push({
        type: "headers",
        id,
        data: { statusCode, contentLength },
      });
    },
    onRequestEnd(id) {
      events.push({ type: "end", id });
    },
  });

  const server = http.createServer((req, res) => {
    const body = "Hello, World!";
    res.writeHead(200, {
      "Content-Type": "text/plain",
      "Content-Length": body.length.toString(),
    });
    res.end(body);
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
  const response = await fetch(`http://localhost:${port}/`);
  expect(response.status).toBe(200);
  const text = await response.text();
  expect(text).toBe("Hello, World!");

  // Wait for telemetry callbacks
  await waitForEvents(events, ["start", "headers", "end"]);

  // Verify the headers event captured the explicit content-length
  const headersEvent = events.find(e => e.type === "headers");
  expect(headersEvent).toBeDefined();
  expect(headersEvent?.data?.statusCode).toBe(200);
  expect(headersEvent?.data?.contentLength).toBe(13); // "Hello, World!" is 13 bytes

  await new Promise<void>(resolve => {
    server.close(() => resolve());
  });

  Bun.telemetry.disable();
});
