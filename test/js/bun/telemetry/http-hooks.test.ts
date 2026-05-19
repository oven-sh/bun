/**
 * Test native HTTP server telemetry hooks
 * NO @opentelemetry/* imports - testing ONLY Bun.telemetry.attach() API
 */
import { describe, expect, test } from "bun:test";
import { InstrumentKinds } from "./types";

describe("Bun.serve() telemetry hooks", () => {
  test("calls onOperationStart with correct attributes for GET request", async () => {
    let startCalled = false;
    const startAttrs: any = {};

    const instrument = {
      kind: InstrumentKinds.HTTP,
      name: "test-http-start",
      version: "1.0.0",
      onOperationStart(id: number, attributes: any) {
        startCalled = true;
        Object.assign(startAttrs, attributes);
      },
      onOperationEnd() {},
      onOperationError() {},
    };

    using ref = Bun.telemetry.attach(instrument);

    using server = Bun.serve({
      port: 0,
      fetch(req) {
        return new Response("Hello World");
      },
    });

    const response = await fetch(`http://localhost:${server.port}/test`);
    await response.text();

    expect(startCalled).toBe(true);
    expect(startAttrs).toMatchObject({
      "http.request.method": "GET",
      "url.path": "/test",
    });
    expect(typeof startAttrs["operation.id"]).toBe("number");
    expect(typeof startAttrs["operation.timestamp"]).toBe("number");
    expect(typeof startAttrs["url.full"]).toBe("string");
  });

  test("calls onOperationEnd with correct attributes and status code", async () => {
    let endCalled = false;
    const endAttrs: any = {};

    const instrument = {
      kind: InstrumentKinds.HTTP,
      name: "test-http-end",
      version: "1.0.0",
      onOperationStart() {},
      onOperationEnd(id: number, attributes: any) {
        endCalled = true;
        Object.assign(endAttrs, attributes);
      },
      onOperationError() {},
    };

    using ref = Bun.telemetry.attach(instrument);

    const responseBody = "Hello from Bun!";
    using server = Bun.serve({
      port: 0,
      fetch(req) {
        return new Response(responseBody);
      },
    });

    const response = await fetch(`http://localhost:${server.port}/`);
    await response.text();

    expect(endCalled).toBe(true);
    expect(endAttrs).toMatchObject({
      "http.response.status_code": 200,
    });
    expect(typeof endAttrs["operation.duration"]).toBe("number");
    if (typeof endAttrs["operation.duration"] === "number") {
      expect(endAttrs["operation.duration"]).toBeGreaterThan(0);
    }
  });

  test("extracts query parameters correctly", async () => {
    let startCalled = false;
    const startAttrs: any = {};

    const instrument = {
      kind: InstrumentKinds.HTTP,
      name: "test-query-params",
      version: "1.0.0",
      onOperationStart(id: number, attributes: any) {
        startCalled = true;
        Object.assign(startAttrs, attributes);
      },
      onOperationEnd() {},
      onOperationError() {},
    };

    using ref = Bun.telemetry.attach(instrument);

    using server = Bun.serve({
      port: 0,
      fetch(req) {
        return new Response("OK");
      },
    });

    await fetch(`http://localhost:${server.port}/search?foo=bar&baz=qux`);

    expect(startCalled).toBe(true);
    expect(startAttrs).toMatchObject({
      "url.path": "/search",
      "url.query": "foo=bar&baz=qux",
    });
  });

  test("handles POST requests with correct method attribute", async () => {
    let startCalled = false;
    const startAttrs: any = {};

    const instrument = {
      kind: InstrumentKinds.HTTP,
      name: "test-post-method",
      version: "1.0.0",
      onOperationStart(id: number, attributes: any) {
        startCalled = true;
        Object.assign(startAttrs, attributes);
      },
      onOperationEnd() {},
      onOperationError() {},
    };

    using ref = Bun.telemetry.attach(instrument);

    using server = Bun.serve({
      port: 0,
      fetch(req) {
        return new Response("Created", { status: 201 });
      },
    });

    await fetch(`http://localhost:${server.port}/api/create`, {
      method: "POST",
      body: JSON.stringify({ data: "test" }),
      headers: { "Content-Type": "application/json" },
    });

    expect(startCalled).toBe(true);
    expect(startAttrs).toMatchObject({
      "http.request.method": "POST",
      "url.path": "/api/create",
    });
  });

  test.skip("calls onOperationError when handler throws", async () => {
    // TODO: Error hook integration may not be complete yet
    let errorCalled = false;
    const errorAttrs: any = {};

    const instrument = {
      kind: InstrumentKinds.HTTP,
      name: "test-error-handling",
      version: "1.0.0",
      onOperationStart() {},
      onOperationEnd() {},
      onOperationError(id: number, attributes: any) {
        errorCalled = true;
        Object.assign(errorAttrs, attributes);
      },
    };

    using ref = Bun.telemetry.attach(instrument);

    using server = Bun.serve({
      port: 0,
      fetch(req) {
        throw new Error("Test error message");
      },
    });

    // Fetch will fail, but we don't care about the response
    try {
      await fetch(`http://localhost:${server.port}/error`);
    } catch (e) {
      // Expected to fail
    }

    // Give it a moment for the error hook to be called
    await Bun.sleep(10);

    expect(errorCalled).toBe(true);
    expect(errorAttrs).toMatchObject({
      "error.type": expect.any(String),
      "error.message": expect.stringContaining("Test error"),
    });
    expect(typeof errorAttrs["operation.duration"]).toBe("number");
  });

  test("reports different status codes correctly", async () => {
    const statusCodes: number[] = [];

    const instrument = {
      kind: InstrumentKinds.HTTP,
      name: "test-status-codes",
      version: "1.0.0",
      onOperationStart() {},
      onOperationEnd(id: number, attributes: any) {
        statusCodes.push(attributes["http.response.status_code"]);
      },
      onOperationError() {},
    };

    using ref = Bun.telemetry.attach(instrument);

    using server = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url, `http://localhost:${server.port}`);
        if (url.pathname === "/not-found") {
          return new Response("Not Found", { status: 404 });
        }
        if (url.pathname === "/server-error") {
          return new Response("Internal Server Error", { status: 500 });
        }
        return new Response("OK", { status: 200 });
      },
    });

    await fetch(`http://localhost:${server.port}/`);
    await fetch(`http://localhost:${server.port}/not-found`);
    await fetch(`http://localhost:${server.port}/server-error`);

    expect(statusCodes.length).toBe(3);
    expect(statusCodes[0]).toBe(200);
    expect(statusCodes[1]).toBe(404);
    expect(statusCodes[2]).toBe(500);
  });

  test("assigns unique operation IDs to concurrent requests", async () => {
    const operationIds = new Set<number>();

    const instrument = {
      kind: InstrumentKinds.HTTP,
      name: "test-concurrent-ids",
      version: "1.0.0",
      onOperationStart(id: number, attributes: any) {
        // Use the id parameter, not attributes["operation.id"]
        operationIds.add(id);
      },
      onOperationEnd() {},
      onOperationError() {},
    };

    using ref = Bun.telemetry.attach(instrument);

    using server = Bun.serve({
      port: 0,
      async fetch(req) {
        // Add a small delay to ensure requests overlap
        await Bun.sleep(5);
        return new Response("OK");
      },
    });

    // Fire off 5 concurrent requests
    const requests = Array.from({ length: 5 }, (_, i) => fetch(`http://localhost:${server.port}/req-${i}`));

    await Promise.all(requests);

    // Each request should have a unique operation ID
    expect(operationIds.size).toBe(5);
  });

  test("provides matching operation IDs between start and end", async () => {
    const startIds: number[] = [];
    const endIds: number[] = [];

    const instrument = {
      kind: InstrumentKinds.HTTP,
      name: "test-matching-ids",
      version: "1.0.0",
      onOperationStart(id: number, attributes: any) {
        // Use the id parameter from the hook
        startIds.push(id);
      },
      onOperationEnd(id: number, attributes: any) {
        // Use the id parameter from the hook
        endIds.push(id);
      },
      onOperationError() {},
    };

    using ref = Bun.telemetry.attach(instrument);

    using server = Bun.serve({
      port: 0,
      fetch(req) {
        return new Response("OK");
      },
    });

    await fetch(`http://localhost:${server.port}/test1`);
    await fetch(`http://localhost:${server.port}/test2`);
    await fetch(`http://localhost:${server.port}/test3`);

    expect(startIds.length).toBe(3);
    expect(endIds.length).toBe(3);
    expect(startIds).toEqual(endIds);
  });

  test("includes url.full attribute", async () => {
    let startCalled = false;
    const startAttrs: any = {};

    const instrument = {
      kind: InstrumentKinds.HTTP,
      name: "test-full-url",
      version: "1.0.0",
      onOperationStart(id: number, attributes: any) {
        startCalled = true;
        Object.assign(startAttrs, attributes);
      },
      onOperationEnd() {},
      onOperationError() {},
    };

    using ref = Bun.telemetry.attach(instrument);

    using server = Bun.serve({
      port: 0,
      fetch(req) {
        return new Response("OK");
      },
    });

    await fetch(`http://localhost:${server.port}/path/to/resource`);

    expect(startCalled).toBe(true);
    // url.full currently contains just the path from req.url()
    expect(startAttrs["url.full"]).toBe("/path/to/resource");
  });

  test("handles requests without query parameters", async () => {
    let startCalled = false;
    const startAttrs: any = {};

    const instrument = {
      kind: InstrumentKinds.HTTP,
      name: "test-no-query",
      version: "1.0.0",
      onOperationStart(id: number, attributes: any) {
        startCalled = true;
        Object.assign(startAttrs, attributes);
      },
      onOperationEnd() {},
      onOperationError() {},
    };

    using ref = Bun.telemetry.attach(instrument);

    using server = Bun.serve({
      port: 0,
      fetch(req) {
        return new Response("OK");
      },
    });

    await fetch(`http://localhost:${server.port}/no-query`);

    expect(startCalled).toBe(true);
    expect(startAttrs).toMatchObject({
      "url.path": "/no-query",
    });
    // url.query should not be present or should be empty
    expect(startAttrs["url.query"] === undefined || startAttrs["url.query"] === "").toBe(true);
  });

  test("calls hooks for user-defined routes", async () => {
    let startCalled = false;
    let endCalled = false;
    const startAttrs: any = {};
    const endAttrs: any = {};

    const instrument = {
      kind: InstrumentKinds.HTTP,
      name: "test-user-routes",
      version: "1.0.0",
      onOperationStart(id: number, attributes: any) {
        startCalled = true;
        Object.assign(startAttrs, attributes);
      },
      onOperationEnd(id: number, attributes: any) {
        endCalled = true;
        Object.assign(endAttrs, attributes);
      },
      onOperationError() {},
    };

    using ref = Bun.telemetry.attach(instrument);

    using server = Bun.serve({
      port: 0,
      routes: {
        "/api/users/:id": req => {
          return new Response(JSON.stringify({ id: req.params.id }));
        },
        "/api/posts": {
          GET: () => new Response("GET posts"),
          POST: () => new Response("POST post", { status: 201 }),
        },
      },
      fetch() {
        return new Response("fallback");
      },
    });

    // Test parameterized route
    const response1 = await fetch(`http://localhost:${server.port}/api/users/123`);
    await response1.text();

    expect(startCalled).toBe(true);
    expect(startAttrs).toMatchObject({
      "http.request.method": "GET",
      "url.path": "/api/users/123",
    });
    expect(endCalled).toBe(true);
    expect(endAttrs).toMatchObject({
      "http.response.status_code": 200,
    });

    // Reset for next test
    startCalled = false;
    endCalled = false;
    Object.keys(startAttrs).forEach(key => delete startAttrs[key]);
    Object.keys(endAttrs).forEach(key => delete endAttrs[key]);

    // Test method-specific route
    const response2 = await fetch(`http://localhost:${server.port}/api/posts`, {
      method: "POST",
    });
    await response2.text();

    expect(startCalled).toBe(true);
    expect(startAttrs).toMatchObject({
      "http.request.method": "POST",
      "url.path": "/api/posts",
    });
    expect(endCalled).toBe(true);
    expect(endAttrs).toMatchObject({
      "http.response.status_code": 201,
    });
  });

  test("includes http.route for parameterized routes", async () => {
    let startCalled = false;
    const startAttrs: any = {};

    const instrument = {
      kind: InstrumentKinds.HTTP,
      name: "test-http-route",
      version: "1.0.0",
      onOperationStart(id: number, attributes: any) {
        startCalled = true;
        Object.assign(startAttrs, attributes);
      },
      onOperationEnd() {},
      onOperationError() {},
    };

    using ref = Bun.telemetry.attach(instrument);

    using server = Bun.serve({
      port: 0,
      routes: {
        "/api/users/:id": req => new Response(`User ${req.params.id}`),
        "/api/posts/:postId/comments/:commentId": () => new Response("comment"),
      },
      fetch() {
        return new Response("fallback");
      },
    });

    // Test parameterized route with single parameter
    await fetch(`http://localhost:${server.port}/api/users/123`);

    expect(startCalled).toBe(true);
    expect(startAttrs["url.path"]).toBe("/api/users/123"); // actual path
    expect(startAttrs["http.route"]).toBe("/api/users/:id"); // route pattern

    // Reset for next test
    startCalled = false;
    Object.keys(startAttrs).forEach(key => delete startAttrs[key]);

    // Test parameterized route with multiple parameters
    await fetch(`http://localhost:${server.port}/api/posts/456/comments/789`);

    expect(startCalled).toBe(true);
    expect(startAttrs["url.path"]).toBe("/api/posts/456/comments/789"); // actual path
    expect(startAttrs["http.route"]).toBe("/api/posts/:postId/comments/:commentId"); // route pattern
  });

  test("fetch-based requests do not have http.route", async () => {
    let startCalled = false;
    const startAttrs: any = {};

    const instrument = {
      kind: InstrumentKinds.HTTP,
      name: "test-no-route",
      version: "1.0.0",
      onOperationStart(id: number, attributes: any) {
        startCalled = true;
        Object.assign(startAttrs, attributes);
      },
      onOperationEnd() {},
      onOperationError() {},
    };

    using ref = Bun.telemetry.attach(instrument);

    using server = Bun.serve({
      port: 0,
      fetch(req) {
        return new Response("OK");
      },
    });

    await fetch(`http://localhost:${server.port}/some/path`);

    expect(startCalled).toBe(true);
    expect(startAttrs["url.path"]).toBe("/some/path");
    // http.route should not be present for fetch-based handlers
    expect(startAttrs["http.route"]).toBeUndefined();
  });
});

describe("hook edge cases - circular references and malformed data", () => {
  test("handles circular object references in hook return values gracefully", async () => {
    let hookError = false;
    const capturedAttrs: any = {};

    const circularObj: any = { name: "root" };
    circularObj.self = circularObj; // Create circular reference
    circularObj.nested = { parent: circularObj }; // Nested circular reference

    const instrument = {
      kind: InstrumentKinds.HTTP,
      name: "circular-ref-test",
      version: "1.0.0",
      onOperationStart(id: number, attributes: any) {
        Object.assign(capturedAttrs, attributes);
        // Return circular object to test graceful handling
        return circularObj;
      },
      onOperationEnd() {},
      onOperationError(id: number, error: any) {
        hookError = true;
      },
    };

    using ref = Bun.telemetry.attach(instrument);

    using server = Bun.serve({
      port: 0,
      fetch(req) {
        return new Response("OK");
      },
    });

    // Request should succeed even if hook returns circular data
    const response = await fetch(`http://localhost:${server.port}/test`);
    expect(response.status).toBe(200);

    // Hook should have been called
    expect(capturedAttrs["http.request.method"]).toBe("GET");

    // System should not have crashed or called onOperationError
    // (circular refs should be handled gracefully, not treated as errors)
    expect(hookError).toBe(false);
  });

  test("handles hook returning deeply nested objects", async () => {
    let deeplyNested: any = { level: 0 };
    let current = deeplyNested;

    // Create 100-level deep nesting
    for (let i = 1; i <= 100; i++) {
      current.next = { level: i };
      current = current.next;
    }

    const instrument = {
      kind: InstrumentKinds.HTTP,
      name: "deep-nested-test",
      version: "1.0.0",
      onOperationStart() {
        return deeplyNested;
      },
      onOperationEnd() {},
    };

    using ref = Bun.telemetry.attach(instrument);

    using server = Bun.serve({
      port: 0,
      fetch(req) {
        return new Response("OK");
      },
    });

    // Should not crash with deep nesting
    const response = await fetch(`http://localhost:${server.port}/`);
    expect(response.status).toBe(200);
  });

  test("handles hook returning non-serializable values", async () => {
    let requestSucceeded = false;

    const instrument = {
      kind: InstrumentKinds.HTTP,
      name: "non-serializable-test",
      version: "1.0.0",
      onOperationStart() {
        // Return values that can't be JSON.stringify'd
        return {
          func: () => {},
          symbol: Symbol("test"),
          undef: undefined,
          bigint: BigInt(9007199254740991),
        };
      },
      onOperationEnd() {},
    };

    using ref = Bun.telemetry.attach(instrument);

    using server = Bun.serve({
      port: 0,
      fetch(req) {
        requestSucceeded = true;
        return new Response("OK");
      },
    });

    // Request should complete successfully despite non-serializable hook data
    const response = await fetch(`http://localhost:${server.port}/`);
    expect(response.status).toBe(200);
    expect(requestSucceeded).toBe(true);
  });
});
