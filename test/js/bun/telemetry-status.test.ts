/**
 * Response status code tracking tests
 *
 * Verifies status codes are captured correctly in onResponseHeaders.
 * Does NOT test OpenTelemetry span status mapping - see packages/bun-otel/ for that.
 */
import { beforeEach, expect, test } from "bun:test";
import { waitForEvents } from "./telemetry-test-utils";

beforeEach(() => {
  Bun.telemetry.disable();
});

test("onResponseHeaders captures custom status codes (201 Created)", async () => {
  const events: Array<{ type: string; id: number; data?: any }> = [];

  Bun.telemetry.configure({
    onRequestStart(id, request) {
      events.push({ type: "start", id, data: { url: request.url } });
    },
    onResponseHeaders(id, statusCode) {
      events.push({ type: "status", id, data: statusCode });
    },
    onRequestEnd(id) {
      events.push({ type: "end", id });
    },
  });

  using server = Bun.serve({
    port: 0,
    fetch() {
      return new Response("created", { status: 201 });
    },
  });

  const response = await fetch(`http://localhost:${server.port}/test`);
  expect(response.status).toBe(201);
  expect(await response.text()).toBe("created");

  // Wait for callbacks deterministically
  await waitForEvents(events, ["start", "status", "end"]);

  // Check required events (allow additional events in future)
  const startEvent = events.find(e => e.type === "start");
  expect(startEvent).toBeDefined();
  expect(startEvent?.data.url).toContain("/test");

  const statusEvent = events.find(e => e.type === "status");
  expect(statusEvent).toBeDefined();
  expect(statusEvent?.data).toBe(201);
  expect(statusEvent?.id).toBe(startEvent?.id);

  const endEvent = events.find(e => e.type === "end");
  expect(endEvent).toBeDefined();
  expect(endEvent?.id).toBe(startEvent?.id);
});
