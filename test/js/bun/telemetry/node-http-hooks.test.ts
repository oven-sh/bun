/**
 * Test Node.js http.createServer() telemetry hooks
 * NO @opentelemetry/* imports - testing ONLY Bun.telemetry.attach() API
 *
 * This tests the Node.js compatibility layer telemetry integration,
 * which bridges http.createServer() to Bun's native telemetry system.
 */
import { describe, expect, test } from "bun:test";
import http from "node:http";
import { InstrumentKind } from "./types";

describe("http.createServer() telemetry hooks", () => {
  test("calls onOperationStart with correct attributes for GET request", async () => {
    let startCalled = false;
    const startAttrs: any = {};

    const instrument = {
      type: InstrumentKind.HTTP,
      name: "test-node-http-start",
      version: "1.0.0",
      onOperationStart(id: number, attributes: any) {
        startCalled = true;
        Object.assign(startAttrs, attributes);
      },
      onOperationEnd() {},
      onOperationError() {},
    };

    using ref = Bun.telemetry.attach(instrument);

    const server = http.createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("Hello World");
    });

    await new Promise<void>((resolve, reject) => {
      server.listen(0, async () => {
        try {
          const addr = server.address() as any;
          const response = await fetch(`http://localhost:${addr.port}/test`);
          await response.text();
          server.close(() => resolve());
        } catch (err) {
          server.close(() => reject(err));
        }
      });
    });

    expect(startCalled).toBe(true);
    expect(startAttrs).toMatchObject({
      "http.request.method": "GET",
      "url.path": "/test",
    });
    expect(typeof startAttrs["operation.id"]).toBe("number");
    expect(typeof startAttrs["operation.timestamp"]).toBe("number");
  });

  test("calls onOperationEnd with correct attributes and status code", async () => {
    let endCalled = false;
    const endAttrs: any = {};

    const instrument = {
      type: InstrumentKind.HTTP,
      name: "test-node-http-end",
      version: "1.0.0",
      onOperationStart() {},
      onOperationEnd(id: number, attributes: any) {
        endCalled = true;
        Object.assign(endAttrs, attributes);
      },
      onOperationError() {},
    };

    using ref = Bun.telemetry.attach(instrument);

    const server = http.createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("Hello from Node.js!");
    });

    await new Promise<void>((resolve, reject) => {
      server.listen(0, async () => {
        try {
          const addr = server.address() as any;
          const response = await fetch(`http://localhost:${addr.port}/`);
          await response.text();
          server.close(() => resolve());
        } catch (err) {
          server.close(() => reject(err));
        }
      });
    });

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
      type: InstrumentKind.HTTP,
      name: "test-node-query-params",
      version: "1.0.0",
      onOperationStart(id: number, attributes: any) {
        startCalled = true;
        Object.assign(startAttrs, attributes);
      },
      onOperationEnd() {},
      onOperationError() {},
    };

    using ref = Bun.telemetry.attach(instrument);

    const server = http.createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("OK");
    });

    await new Promise<void>((resolve, reject) => {
      server.listen(0, async () => {
        try {
          const addr = server.address() as any;
          await fetch(`http://localhost:${addr.port}/search?key=value&foo=bar`);
          server.close(() => resolve());
        } catch (err) {
          server.close(() => reject(err));
        }
      });
    });

    expect(startCalled).toBe(true);
    expect(startAttrs).toMatchObject({
      "url.path": "/search",
      "url.query": "key=value&foo=bar",
    });
  });

  test("captures response status code from res.writeHead()", async () => {
    let endCalled = false;
    const endAttrs: any = {};

    const instrument = {
      type: InstrumentKind.HTTP,
      name: "test-node-status-code",
      version: "1.0.0",
      onOperationStart() {},
      onOperationEnd(id: number, attributes: any) {
        endCalled = true;
        Object.assign(endAttrs, attributes);
      },
      onOperationError() {},
    };

    using ref = Bun.telemetry.attach(instrument);

    const server = http.createServer((req, res) => {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not Found");
    });

    await new Promise<void>((resolve, reject) => {
      server.listen(0, async () => {
        try {
          const addr = server.address() as any;
          await fetch(`http://localhost:${addr.port}/missing`);
          server.close(() => resolve());
        } catch (err) {
          server.close(() => reject(err));
        }
      });
    });

    expect(endCalled).toBe(true);
    expect(endAttrs).toMatchObject({
      "http.response.status_code": 404,
    });
  });

  test("handles POST requests with correct method attribute", async () => {
    let startCalled = false;
    const startAttrs: any = {};

    const instrument = {
      type: InstrumentKind.HTTP,
      name: "test-node-post-method",
      version: "1.0.0",
      onOperationStart(id: number, attributes: any) {
        startCalled = true;
        Object.assign(startAttrs, attributes);
      },
      onOperationEnd() {},
      onOperationError() {},
    };

    using ref = Bun.telemetry.attach(instrument);

    const server = http.createServer((req, res) => {
      res.writeHead(201, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: true }));
    });

    await new Promise<void>((resolve, reject) => {
      server.listen(0, async () => {
        try {
          const addr = server.address() as any;
          await fetch(`http://localhost:${addr.port}/api/create`, {
            method: "POST",
            body: JSON.stringify({ data: "test" }),
            headers: { "Content-Type": "application/json" },
          });
          server.close(() => resolve());
        } catch (err) {
          server.close(() => reject(err));
        }
      });
    });

    expect(startCalled).toBe(true);
    expect(startAttrs).toMatchObject({
      "http.request.method": "POST",
      "url.path": "/api/create",
    });
  });

  test("calls onOperationError when handler throws", async () => {
    let errorCalled = false;
    const errorAttrs: any = {};

    const instrument = {
      type: InstrumentKind.HTTP,
      name: "test-node-error-handling",
      version: "1.0.0",
      onOperationStart() {},
      onOperationEnd() {},
      onOperationError(id: number, attributes: any) {
        errorCalled = true;
        Object.assign(errorAttrs, attributes);
      },
    };

    using ref = Bun.telemetry.attach(instrument);

    const server = http.createServer((req, res) => {
      // Instead of throwing, send an error response
      // (Node.js doesn't auto-catch handler errors like Bun.serve does)
      res.writeHead(500);
      res.end("Internal Server Error");
      // Manually trigger error event to test telemetry
      res.emit("error", new Error("Test error from handler"));
    });

    await new Promise<void>((resolve, reject) => {
      server.listen(0, async () => {
        try {
          const addr = server.address() as any;
          await fetch(`http://localhost:${addr.port}/error`);
          // Give it a moment for the error hook to be called
          await Bun.sleep(50);
          server.close(() => resolve());
        } catch (err) {
          server.close(() => reject(err));
        }
      });
    });

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
      type: InstrumentKind.HTTP,
      name: "test-node-status-codes",
      version: "1.0.0",
      onOperationStart() {},
      onOperationEnd(id: number, attributes: any) {
        statusCodes.push(attributes["http.response.status_code"]);
      },
      onOperationError() {},
    };

    using ref = Bun.telemetry.attach(instrument);

    const server = http.createServer((req, res) => {
      const url = new URL(req.url!, `http://${req.headers.host}`);
      if (url.pathname === "/not-found") {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Not Found");
      } else if (url.pathname === "/server-error") {
        res.writeHead(500, { "Content-Type": "text/plain" });
        res.end("Internal Server Error");
      } else {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("OK");
      }
    });

    await new Promise<void>((resolve, reject) => {
      server.listen(0, async () => {
        try {
          const addr = server.address() as any;
          await fetch(`http://localhost:${addr.port}/`);
          await fetch(`http://localhost:${addr.port}/not-found`);
          await fetch(`http://localhost:${addr.port}/server-error`);
          server.close(() => resolve());
        } catch (err) {
          server.close(() => reject(err));
        }
      });
    });

    expect(statusCodes).toEqual([200, 404, 500]);
  });

  test("assigns unique operation IDs to concurrent requests", async () => {
    const operationIds = new Set<number>();

    const instrument = {
      type: InstrumentKind.HTTP,
      name: "test-node-concurrent-ids",
      version: "1.0.0",
      onOperationStart(id: number, attributes: any) {
        operationIds.add(attributes["operation.id"]);
      },
      onOperationEnd() {},
      onOperationError() {},
    };

    using ref = Bun.telemetry.attach(instrument);

    const server = http.createServer(async (req, res) => {
      // Add a small delay to ensure requests overlap
      await Bun.sleep(5);
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("OK");
    });

    await new Promise<void>((resolve, reject) => {
      server.listen(0, async () => {
        try {
          const addr = server.address() as any;
          // Fire off 5 concurrent requests
          const requests = Array.from({ length: 5 }, (_, i) => fetch(`http://localhost:${addr.port}/req-${i}`));

          await Promise.all(requests);
          server.close(() => resolve());
        } catch (err) {
          server.close(() => reject(err));
        }
      });
    });

    // Each request should have a unique operation ID
    expect(operationIds.size).toBe(5);
  });

  test("provides matching operation IDs between start and end", async () => {
    const startIds: number[] = [];
    const endIds: number[] = [];

    const instrument = {
      type: InstrumentKind.HTTP,
      name: "test-node-matching-ids",
      version: "1.0.0",
      onOperationStart(id: number, attributes: any) {
        startIds.push(attributes["operation.id"]);
      },
      onOperationEnd(id: number, attributes: any) {
        endIds.push(attributes["operation.id"]);
      },
      onOperationError() {},
    };

    using ref = Bun.telemetry.attach(instrument);

    const server = http.createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("OK");
    });

    await new Promise<void>((resolve, reject) => {
      server.listen(0, async () => {
        try {
          const addr = server.address() as any;
          await fetch(`http://localhost:${addr.port}/test1`);
          await fetch(`http://localhost:${addr.port}/test2`);
          await fetch(`http://localhost:${addr.port}/test3`);
          server.close(() => resolve());
        } catch (err) {
          server.close(() => reject(err));
        }
      });
    });

    expect(startIds.length).toBe(3);
    expect(endIds.length).toBe(3);
    expect(startIds).toEqual(endIds);
  });

  test("includes full URL in attributes", async () => {
    let startCalled = false;
    const startAttrs: any = {};

    const instrument = {
      type: InstrumentKind.HTTP,
      name: "test-node-full-url",
      version: "1.0.0",
      onOperationStart(id: number, attributes: any) {
        startCalled = true;
        Object.assign(startAttrs, attributes);
      },
      onOperationEnd() {},
      onOperationError() {},
    };

    using ref = Bun.telemetry.attach(instrument);

    const server = http.createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("OK");
    });

    await new Promise<void>((resolve, reject) => {
      server.listen(0, async () => {
        try {
          const addr = server.address() as any;
          await fetch(`http://localhost:${addr.port}/path/to/resource`);
          server.close(() => resolve());
        } catch (err) {
          server.close(() => reject(err));
        }
      });
    });

    expect(startCalled).toBe(true);
    expect(startAttrs["url.full"]).toContain("/path/to/resource");
  });

  test("handles requests without query parameters", async () => {
    let startCalled = false;
    const startAttrs: any = {};

    const instrument = {
      type: InstrumentKind.HTTP,
      name: "test-node-no-query",
      version: "1.0.0",
      onOperationStart(id: number, attributes: any) {
        startCalled = true;
        Object.assign(startAttrs, attributes);
      },
      onOperationEnd() {},
      onOperationError() {},
    };

    using ref = Bun.telemetry.attach(instrument);

    const server = http.createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("OK");
    });

    await new Promise<void>((resolve, reject) => {
      server.listen(0, async () => {
        try {
          const addr = server.address() as any;
          await fetch(`http://localhost:${addr.port}/no-query`);
          server.close(() => resolve());
        } catch (err) {
          server.close(() => reject(err));
        }
      });
    });

    expect(startCalled).toBe(true);
    expect(startAttrs).toMatchObject({
      "url.path": "/no-query",
    });
    // url.query should not be present or should be empty
    expect(startAttrs["url.query"] === undefined || startAttrs["url.query"] === "").toBe(true);
  });

  test("works with implicit status code (defaults to 200)", async () => {
    let endCalled = false;
    const endAttrs: any = {};

    const instrument = {
      type: InstrumentKind.HTTP,
      name: "test-node-implicit-status",
      version: "1.0.0",
      onOperationStart() {},
      onOperationEnd(id: number, attributes: any) {
        endCalled = true;
        Object.assign(endAttrs, attributes);
      },
      onOperationError() {},
    };

    using ref = Bun.telemetry.attach(instrument);

    const server = http.createServer((req, res) => {
      // Don't call writeHead, just end with data
      res.end("OK");
    });

    await new Promise<void>((resolve, reject) => {
      server.listen(0, async () => {
        try {
          const addr = server.address() as any;
          await fetch(`http://localhost:${addr.port}/`);
          server.close(() => resolve());
        } catch (err) {
          server.close(() => reject(err));
        }
      });
    });

    expect(endCalled).toBe(true);
    expect(endAttrs).toMatchObject({
      "http.response.status_code": 200,
    });
  });
});
