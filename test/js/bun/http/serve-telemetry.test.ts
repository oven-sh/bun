/**
 * Core telemetry callback tests for Bun.serve
 *
 * These tests verify that high-level callbacks (onRequestStart, onResponseHeaders, onRequestEnd)
 * are invoked correctly. They do NOT test OpenTelemetry integration - see packages/bun-otel/ for that.
 *
 * Note: Bun.serve uses high-level callbacks; Node.js uses _node_binding hooks.
 */
import { expect, test } from "bun:test";
import { waitForEvents } from "../telemetry-test-utils";

test("onResponseHeaders receives statusCode and contentLength for non-empty response body", async () => {
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

  await using server = Bun.serve({
    port: 0,
    fetch(req) {
      return new Response("Hello", { status: 200 });
    },
  });

  const response = await fetch(`http://localhost:${server.port}/test`);
  expect(response.status).toBe(200);

  await waitForEvents(events, ["start", "headers", "end"]);

  // Should keep 200 status since body is not empty
  const headersEvent = events.find(e => e.type === "headers");
  expect(headersEvent).toBeDefined();
  expect(headersEvent?.data?.statusCode).toBe(200);
  expect(headersEvent?.data?.contentLength).toBeGreaterThan(0);

  Bun.telemetry.disable();
});

test("onResponseHeaders receives explicit 204 status code for no-content responses", async () => {
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

  await using server = Bun.serve({
    port: 0,
    fetch(req) {
      // Explicitly set 204
      return new Response(null, { status: 204 });
    },
  });

  const response = await fetch(`http://localhost:${server.port}/test`);
  expect(response.status).toBe(204);

  await waitForEvents(events, ["start", "headers", "end"]);

  const headersEvent = events.find(e => e.type === "headers");
  expect(headersEvent).toBeDefined();
  expect(headersEvent?.data?.statusCode).toBe(204);
  expect(headersEvent?.data?.contentLength).toBe(0);

  Bun.telemetry.disable();
});
