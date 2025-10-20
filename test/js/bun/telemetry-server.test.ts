import { spawnSync } from "bun";
import { beforeEach, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";
import { waitForEvents } from "./telemetry-test-utils";

describe("Bun.telemetry with servers", () => {
  // Ensure clean state before each test
  beforeEach(() => {
    Bun.telemetry.disable();
  });

  test("telemetry API exists", () => {
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

  test("telemetry tracks Bun.serve requests with Request objects", async () => {
    const events: Array<{
      type: string;
      id?: number;
      request?: any;
      error?: any;
      statusCode?: number;
      contentLength?: number;
    }> = [];

    Bun.telemetry.configure({
      onRequestStart(id, request) {
        events.push({ type: "start", id, request });
      },
      onRequestEnd(id) {
        events.push({ type: "end", id });
      },
      onRequestError(id, error) {
        events.push({ type: "error", id, error });
      },
      onResponseHeaders(id, statusCode, contentLength) {
        events.push({ type: "headers", id, statusCode, contentLength });
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
    await waitForEvents(events, ["start", "headers", "end"]);

    // We should have a start event with an ID and Request object
    const startEvent = events.find(e => e.type === "start");
    expect(startEvent).toBeDefined();
    expect(typeof startEvent?.id).toBe("number");
    expect(startEvent?.id).toBeGreaterThan(0);
    expect(startEvent?.request).toBeDefined();

    // For Bun.serve, we should get a real Request object
    expect(startEvent?.request.url).toContain("/test-path");
    expect(startEvent?.request.method).toBe("GET");

    // We should have a headers event
    const headersEvent = events.find(e => e.type === "headers");
    expect(headersEvent).toBeDefined();
    expect(headersEvent?.id).toBe(startEvent?.id);
    expect(headersEvent?.statusCode).toBe(200);
    expect(typeof headersEvent?.contentLength).toBe("number");

    // We should have an end event with just the ID
    const endEvent = events.find(e => e.type === "end");
    expect(endEvent).toBeDefined();
    expect(endEvent?.id).toBe(startEvent?.id);
    expect(endEvent?.request).toBeUndefined();

    // Clean up
    Bun.telemetry.disable();
  });

  test("telemetry tracks request errors", () => {
    // Use subprocess to test error handling (errors propagate to test runner otherwise)
    const code = `
      const events = [];

      Bun.telemetry.configure({
        onRequestStart(id) {
          events.push({ type: "start", id });
        },
        onRequestError(id, error) {
          events.push({ type: "error", id, message: error.message });
        },
        onRequestEnd(id) {
          events.push({ type: "end", id });
        },
      });

      using server = Bun.serve({
        development: false,
        port: 0,
        fetch() {
          throw new Error("Test error");
        },
        onError(error) {
          return new Response("Internal Server Error", { status: 500 });
        },
      });

      const response = await fetch(server.url);
      if (response.status !== 500) {
        console.error("FAIL: Expected status 500, got " + response.status);
        server.stop(true);
        process.exit(1);
      }

      // Poll for all events instead of fixed sleep
      const deadline = Date.now() + 500;
      while (Date.now() < deadline) {
        const hasStart = events.find(e => e.type === "start");
        const hasError = events.find(e => e.type === "error");
        const hasEnd = events.find(e => e.type === "end");
        if (hasStart && hasError && hasEnd) break;
        await Bun.sleep(5);
      }

      const startEvent = events.find(e => e.type === "start");
      const errorEvent = events.find(e => e.type === "error");
      const endEvent = events.find(e => e.type === "end");

      if (!startEvent) {
        console.error("FAIL: No start event");
        server.stop(true);
        process.exit(1);
      }
      if (!errorEvent) {
        console.error("FAIL: No error event");
        server.stop(true);
        process.exit(1);
      }
      if (errorEvent.message !== "Test error") {
        console.error("FAIL: Wrong error message: " + errorEvent.message);
        server.stop(true);
        process.exit(1);
      }
      if (!endEvent) {
        console.error("FAIL: No end event");
        server.stop(true);
        process.exit(1);
      }
      if (errorEvent.id !== startEvent.id || endEvent.id !== startEvent.id) {
        console.error("FAIL: Event ID mismatch");
        server.stop(true);
        process.exit(1);
      }

      console.log("PASS");
      server.stop(true);
      process.exit(0);
    `;

    const dir = tempDirWithFiles("telemetry-errors", {
      "test.js": code,
    });

    const { stdout, stderr, exitCode } = spawnSync({
      cmd: [bunExe(), "test.js"],
      cwd: dir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const output = stdout.toString() + stderr.toString();
    if (exitCode !== 0) {
      console.log("Subprocess failed with exit code", exitCode);
      console.log("Output:", output);
    }
    expect(output).toContain("PASS");
    expect(exitCode).toBe(0);
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
          // Duration available if needed for assertions
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
    await fetch(`http://localhost:${server.port}/api/posts`, { method: "POST", body: "{}" });

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
      onRequestStart(id) {
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

    // Wait for all start callbacks to complete
    const deadline = Date.now() + 500;
    while (ids.size < 3 && Date.now() < deadline) {
      await Bun.sleep(5);
    }

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

  // Note: Node.js http.createServer telemetry is thoroughly tested in node-telemetry.test.ts

  test("telemetry captures response status and content length", async () => {
    const responseData: Array<{ id: number; statusCode: number; contentLength: number }> = [];

    Bun.telemetry.configure({
      onResponseHeaders(id, statusCode, contentLength) {
        responseData.push({ id, statusCode, contentLength });
      },
    });

    using server = Bun.serve({
      port: 0,
      fetch() {
        return new Response("test body", {
          status: 201,
          headers: {
            "X-Custom-Header": "test-value",
            "Content-Type": "text/plain",
          },
        });
      },
    });

    await fetch(`http://localhost:${server.port}/`);

    // Wait for response headers callback
    const startTime = Date.now();
    while (responseData.length < 1 && Date.now() - startTime < 500) {
      await Bun.sleep(5);
    }
    if (responseData.length < 1) {
      throw new Error("Expected onResponseHeaders callback to fire");
    }

    expect(responseData.length).toBe(1);
    expect(responseData[0].statusCode).toBe(201);
    expect(responseData[0].contentLength).toBe(9); // "test body" is 9 bytes
    expect(typeof responseData[0].id).toBe("number");

    // Clean up
    Bun.telemetry.disable();
  });
});
