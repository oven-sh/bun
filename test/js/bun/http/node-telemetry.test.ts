import { test, expect } from "bun:test";
import { bunEnv, bunExe } from "harness";
import * as http from "node:http";

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

  // Give telemetry callbacks time to fire
  await Bun.sleep(50);

  // Verify telemetry events were captured
  expect(events.length).toBeGreaterThanOrEqual(2);

  const startEvent = events.find(e => e.type === "start");
  expect(startEvent).toBeDefined();
  expect(startEvent?.data?.method).toBe("GET");
  expect(startEvent?.data?.url).toBe("/test");

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

  await Bun.sleep(100);

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
