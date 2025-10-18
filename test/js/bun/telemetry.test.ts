/**
 * Bun.telemetry API functionality tests
 *
 * Tests API methods with servers and request tracking.
 * Does NOT test OpenTelemetry integration - see packages/bun-otel/ for that.
 */
import { expect, test } from "bun:test";
import { waitForEvents } from "./telemetry-test-utils";

test("Bun.telemetry API exists", () => {
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

test("telemetry tracks requests with lightweight IDs", async () => {
  const events: Array<{ type: string; id?: number; request?: any }> = [];

  Bun.telemetry.configure({
    onRequestStart(id, request) {
      events.push({ type: "start", id, request });
    },
    onRequestEnd(id) {
      events.push({ type: "end", id });
    },
  });

  using server = Bun.serve({
    port: 0,
    fetch() {
      return new Response("telemetry test");
    },
  });

  await fetch(`http://localhost:${server.port}/test-path`);

  // Wait for telemetry callbacks to fire
  await waitForEvents(events, ["start", "end"]);

  // We should have a start event with an ID and request
  const startEvent = events.find(e => e.type === "start");
  expect(startEvent).toBeDefined();
  expect(typeof startEvent?.id).toBe("number");
  expect(startEvent?.id).toBeGreaterThan(0);
  expect(startEvent?.request).toBeDefined();

  // We should have an end event with just the ID
  const endEvent = events.find(e => e.type === "end");
  expect(endEvent).toBeDefined();
  expect(endEvent?.id).toBe(startEvent?.id);
  expect(endEvent?.request).toBeUndefined();

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
  await fetch(`http://localhost:${server.port}/api/posts`, { method: "POST" });

  // Wait for telemetry callbacks to complete and clean up metadata
  const startTime = Date.now();
  while (requestMetadata.size > 0 && Date.now() - startTime < 200) {
    await Bun.sleep(5);
  }
  if (requestMetadata.size > 0) {
    throw new Error(`Expected metadata to be cleaned up, but ${requestMetadata.size} entries remain`);
  }

  // All metadata should be cleaned up after requests complete
  expect(requestMetadata.size).toBe(0);

  // Clean up
  Bun.telemetry.disable();
});

test("telemetry IDs are unique per request", async () => {
  const ids = new Set<number>();

  Bun.telemetry.configure({
    onRequestStart(id, request) {
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

test.todo("telemetry onRequestError is called on errors", async () => {
  // TODO: Implement error tracking
  const errors: Array<{ id: number; error: any }> = [];

  Bun.telemetry.configure({
    onRequestStart(id, request) {
      // Track request start
    },
    onRequestError(id, error) {
      errors.push({ id, error });
    },
  });

  using server = Bun.serve({
    port: 0,
    fetch() {
      throw new Error("Test error");
    },
  });

  try {
    await fetch(`http://localhost:${server.port}/`);
  } catch (e) {
    // Expected
  }

  // Wait for error callback to fire
  const startTime = Date.now();
  while (errors.length === 0 && Date.now() - startTime < 200) {
    await Bun.sleep(5);
  }
  if (errors.length === 0) {
    throw new Error("Expected onRequestError callback to fire");
  }

  expect(errors.length).toBeGreaterThan(0);

  // Clean up
  Bun.telemetry.disable();
});
