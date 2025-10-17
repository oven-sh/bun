import { describe, expect, test } from "bun:test";

describe("Bun.telemetry basic tests", () => {
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
    Bun.telemetry.configure({
      onRequestStart(id, request) {
        console.log("Request started:", id);
      },
      onRequestEnd(id) {
        console.log("Request ended:", id);
      },
    });

    expect(Bun.telemetry.isEnabled()).toBe(true);

    // Clean up
    Bun.telemetry.disable();
    expect(Bun.telemetry.isEnabled()).toBe(false);
  });

  test("simple server test without checking request details", async () => {
    let startCalled = false;
    let endCalled = false;
    let requestId = 0;

    Bun.telemetry.configure({
      onRequestStart(id, request) {
        console.log("onRequestStart called with id:", id);
        console.log("Request type:", typeof request);
        console.log("Request url:", request?.url);
        console.log("Request method:", request?.method);
        console.log("Request constructor:", request?.constructor?.name);
        startCalled = true;
        requestId = id;
      },
      onRequestEnd(id) {
        console.log("onRequestEnd called with id:", id);
        endCalled = true;
        expect(id).toBe(requestId);
      },
    });

    using server = Bun.serve({
      port: 0,
      fetch() {
        return new Response("test");
      },
    });

    await fetch(`http://localhost:${server.port}/test`);

    // Wait a bit for callbacks
    await Bun.sleep(50);

    expect(startCalled).toBe(true);
    expect(endCalled).toBe(true);
    expect(requestId).toBeGreaterThan(0);

    Bun.telemetry.disable();
  });
});
