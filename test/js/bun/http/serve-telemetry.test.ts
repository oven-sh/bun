import { expect, test } from "bun:test";

test("Bun.serve telemetry captures 200 status for non-empty body", async () => {
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

  await Bun.sleep(50);

  // Should keep 200 status since body is not empty
  const headersEvent = events.find(e => e.type === "headers");
  expect(headersEvent).toBeDefined();
  expect(headersEvent?.data?.statusCode).toBe(200);
  expect(headersEvent?.data?.contentLength).toBeGreaterThan(0);

  Bun.telemetry.disable();
});

test("Bun.serve telemetry captures explicit 204 status", async () => {
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

  await Bun.sleep(50);

  const headersEvent = events.find(e => e.type === "headers");
  expect(headersEvent).toBeDefined();
  expect(headersEvent?.data?.statusCode).toBe(204);
  expect(headersEvent?.data?.contentLength).toBe(0);

  Bun.telemetry.disable();
});
