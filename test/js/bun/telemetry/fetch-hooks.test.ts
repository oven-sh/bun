/**
 * Test native fetch telemetry hooks
 * NO @opentelemetry/* imports allowed - testing ONLY native hooks
 */
import { describe, expect, test } from "bun:test";
import { InstrumentKinds } from "./types";

describe("fetch telemetry hooks", () => {
  test("calls onOperationStart with correct attributes on successful fetch", async () => {
    using server = Bun.serve({
      port: 0,
      fetch: () => new Response("ok"),
    });

    let startCalled = false;
    const startAttrs: any = {};
    let startId: number | undefined;

    const instrument = {
      kind: InstrumentKinds.Fetch,
      name: "test-fetch-start",
      version: "1.0.0",
      onOperationStart(id: number, attributes: any) {
        startCalled = true;
        startId = id;
        Object.assign(startAttrs, attributes);
      },
      onOperationEnd() {},
      onOperationError() {},
    };

    using ref = Bun.telemetry.attach(instrument);

    await fetch(`http://localhost:${server.port}/test`);

    expect(startCalled).toBe(true);
    expect(startId).toBeGreaterThan(0);
    expect(startAttrs).toMatchObject({
      "http.request.method": "GET",
      "url.path": "/test",
      "server.address": "localhost",
      "server.port": server.port,
    });

    // url.full should contain the complete URL
    expect(startAttrs["url.full"]).toContain(`http://localhost:${server.port}/test`);
  });

  test("calls onOperationEnd with correct attributes on successful fetch", async () => {
    using server = Bun.serve({
      port: 0,
      fetch: () => new Response("test response"),
    });

    let endCalled = false;
    const endAttrs: any = {};
    let capturedStartId: number | undefined;
    let capturedEndId: number | undefined;

    const instrument = {
      kind: InstrumentKinds.Fetch,
      name: "test-fetch-end",
      version: "1.0.0",
      onOperationStart(id: number, attributes: any) {
        capturedStartId = id;
      },
      onOperationEnd(id: number, attributes: any) {
        endCalled = true;
        capturedEndId = id;
        Object.assign(endAttrs, attributes);
      },
      onOperationError() {},
    };

    using ref = Bun.telemetry.attach(instrument);

    const response = await fetch(`http://localhost:${server.port}/test`);
    const body = await response.text();

    expect(endCalled).toBe(true);
    expect(capturedEndId).toBe(capturedStartId);
    expect(endAttrs).toMatchObject({
      "http.response.status_code": 200,
    });

    // Duration should be present and positive if available
    if (endAttrs["operation.duration"] !== undefined) {
      expect(typeof endAttrs["operation.duration"]).toBe("number");
      expect(endAttrs["operation.duration"]).toBeGreaterThan(0);
    }
  });

  test("calls onOperationError on failed fetch", async () => {
    // Create and immediately stop server to get a port that will refuse connections
    using server = Bun.serve({
      port: 0,
      fetch: () => new Response("test"),
    });
    const port = server.port;
    server.stop();

    let errorCalled = false;
    const errorAttrs: any = {};
    let errorId: number | undefined;

    const instrument = {
      kind: InstrumentKinds.Fetch,
      name: "test-fetch-error",
      version: "1.0.0",
      onOperationStart() {},
      onOperationEnd() {},
      onOperationError(id: number, attributes: any) {
        errorCalled = true;
        errorId = id;
        Object.assign(errorAttrs, attributes);
      },
    };

    using ref = Bun.telemetry.attach(instrument);

    // This should fail with connection refused
    await fetch(`http://localhost:${port}`).catch(() => {
      // Expected to fail
    });

    expect(errorCalled).toBe(true);
    expect(errorId).toBeGreaterThan(0);
    expect(errorAttrs).toMatchObject({
      "operation.duration": expect.any(Number),
    });

    // Should have some error information
    expect(errorAttrs["error.type"] !== undefined || errorAttrs["error.message"] !== undefined).toBe(true);
  });

  test("assigns unique operation IDs to concurrent fetches", async () => {
    using server = Bun.serve({
      port: 0,
      async fetch(req) {
        // Add small delay to ensure overlap
        await Bun.sleep(10);
        return new Response("ok");
      },
    });

    const operationIds = new Set<number>();

    const instrument = {
      kind: InstrumentKinds.Fetch,
      name: "test-concurrent-fetch",
      version: "1.0.0",
      onOperationStart(id: number, attributes: any) {
        operationIds.add(id);
      },
      onOperationEnd() {},
      onOperationError() {},
    };

    using ref = Bun.telemetry.attach(instrument);

    // Launch 5 concurrent fetches
    await Promise.all([
      fetch(`http://localhost:${server.port}/1`),
      fetch(`http://localhost:${server.port}/2`),
      fetch(`http://localhost:${server.port}/3`),
      fetch(`http://localhost:${server.port}/4`),
      fetch(`http://localhost:${server.port}/5`),
    ]);

    // Each fetch should have a unique operation ID
    expect(operationIds.size).toBe(5);
  });

  test("handles POST requests with body correctly", async () => {
    using server = Bun.serve({
      port: 0,
      async fetch(req) {
        const body = await req.json();
        return new Response(JSON.stringify({ received: body }), {
          headers: { "Content-Type": "application/json" },
        });
      },
    });

    let startCalled = false;
    const startAttrs: any = {};

    const instrument = {
      kind: InstrumentKinds.Fetch,
      name: "test-post-fetch",
      version: "1.0.0",
      onOperationStart(id: number, attributes: any) {
        startCalled = true;
        Object.assign(startAttrs, attributes);
      },
      onOperationEnd() {},
      onOperationError() {},
    };

    using ref = Bun.telemetry.attach(instrument);

    const payload = { test: "data", value: 123 };
    await fetch(`http://localhost:${server.port}/api`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    expect(startCalled).toBe(true);
    expect(startAttrs["http.request.method"]).toBe("POST");
    expect(startAttrs["url.path"]).toBe("/api");
  });

  test("complete fetch lifecycle calls start->end in sequence", async () => {
    using server = Bun.serve({
      port: 0,
      fetch: () => new Response("lifecycle test"),
    });

    const callSequence: string[] = [];
    let startId: number | undefined;
    let endId: number | undefined;

    const instrument = {
      kind: InstrumentKinds.Fetch,
      name: "test-lifecycle",
      version: "1.0.0",
      onOperationStart(id: number, attributes: any) {
        callSequence.push("start");
        startId = id;
      },
      onOperationEnd(id: number, attributes: any) {
        callSequence.push("end");
        endId = id;
      },
      onOperationError() {
        callSequence.push("error");
      },
    };

    using ref = Bun.telemetry.attach(instrument);

    await fetch(`http://localhost:${server.port}`);

    expect(callSequence).toEqual(["start", "end"]);
    expect(startId).toBe(endId);
  });

  test("handles different HTTP methods correctly", async () => {
    using server = Bun.serve({
      port: 0,
      fetch: req => new Response(req.method),
    });

    const methods: Array<{ method: string; expected: string }> = [
      { method: "GET", expected: "GET" },
      { method: "POST", expected: "POST" },
      { method: "PUT", expected: "PUT" },
      { method: "DELETE", expected: "DELETE" },
      { method: "PATCH", expected: "PATCH" },
    ];

    for (const { method, expected } of methods) {
      const capturedAttrs: any = {};

      const instrument = {
        kind: InstrumentKinds.Fetch,
        name: `test-${method}`,
        version: "1.0.0",
        onOperationStart(id: number, attributes: any) {
          Object.assign(capturedAttrs, attributes);
        },
        onOperationEnd() {},
        onOperationError() {},
      };

      using ref = Bun.telemetry.attach(instrument);

      await fetch(`http://localhost:${server.port}`, { method });

      expect(capturedAttrs["http.request.method"]).toBe(expected);
    }
  });

  test("captures URL path with query parameters", async () => {
    using server = Bun.serve({
      port: 0,
      fetch: () => new Response("ok"),
    });

    const startAttrs: any = {};

    const instrument = {
      kind: InstrumentKinds.Fetch,
      name: "test-query-params",
      version: "1.0.0",
      onOperationStart(id: number, attributes: any) {
        Object.assign(startAttrs, attributes);
      },
      onOperationEnd() {},
      onOperationError() {},
    };

    using ref = Bun.telemetry.attach(instrument);

    await fetch(`http://localhost:${server.port}/api/users?id=123&filter=active`);

    // Path should include query string
    expect(startAttrs["url.path"]).toMatch(/\/api\/users/);
    expect(startAttrs["url.full"]).toContain("id=123");
    expect(startAttrs["url.full"]).toContain("filter=active");
  });
});
