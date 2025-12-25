/**
 * Regression test for issue #25632
 * ServerResponse.end() should always result in writableEnded being set to/returning true
 *
 * @see https://github.com/oven-sh/bun/issues/25632
 */
import { test, expect, describe } from "bun:test";
import http, { createServer, ServerResponse, IncomingMessage } from "node:http";

describe("ServerResponse.writableEnded", () => {
  test("should be true after end() is called without a socket", async () => {
    // Create a ServerResponse without a valid socket/handle
    const req = new http.IncomingMessage(null as any);
    const res = new ServerResponse(req);

    expect(res.writableEnded).toBe(false);
    expect(res.finished).toBe(false);

    res.end();

    // Per Node.js spec, writableEnded should be true after end() is called
    expect(res.writableEnded).toBe(true);
    expect(res.finished).toBe(true);
  });

  test("should be true after end() is called with callback but without socket", async () => {
    const req = new http.IncomingMessage(null as any);
    const res = new ServerResponse(req);

    let callbackCalled = false;
    res.end(() => {
      callbackCalled = true;
    });

    expect(res.writableEnded).toBe(true);
    expect(res.finished).toBe(true);

    // Wait for callback to be called via nextTick
    await new Promise(resolve => process.nextTick(resolve));
    expect(callbackCalled).toBe(true);
  });

  test("should be true after end() with chunk but without socket", async () => {
    const req = new http.IncomingMessage(null as any);
    const res = new ServerResponse(req);

    res.end("test data");

    expect(res.writableEnded).toBe(true);
    expect(res.finished).toBe(true);
  });

  test("should be true in normal server context", async () => {
    const server = createServer((req, res) => {
      expect(res.writableEnded).toBe(false);
      res.end("Hello");
      expect(res.writableEnded).toBe(true);
    });

    server.listen({ port: 0 });
    const { port } = server.address() as { port: number };

    try {
      const response = await fetch(`http://localhost:${port}`);
      expect(await response.text()).toBe("Hello");
    } finally {
      server.close();
    }
  });
});
