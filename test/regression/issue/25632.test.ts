/**
 * Regression test for issue #25632
 * ServerResponse.end() should always result in writableEnded being set to/returning true
 *
 * @see https://github.com/oven-sh/bun/issues/25632
 */
import { test, expect, describe } from "bun:test";
import { createServer, ServerResponse, IncomingMessage } from "node:http";

describe("ServerResponse.writableEnded", () => {
  test("should be true after end() is called without a socket", async () => {
    // Create a ServerResponse without a valid socket/handle
    const req = new IncomingMessage(null as any);
    const res = new ServerResponse(req);

    expect(res.writableEnded).toBe(false);
    expect(res.finished).toBe(false);

    res.end();

    // Per Node.js spec, writableEnded should be true after end() is called
    expect(res.writableEnded).toBe(true);
    expect(res.finished).toBe(true);
  });

  test("should be true after end() is called with callback but without socket", async () => {
    const req = new IncomingMessage(null as any);
    const res = new ServerResponse(req);

    let called = false;
    res.end(() => {
      // Note: In Node.js, callback is NOT invoked when there's no socket
      // This matches Node.js behavior where the 'finish' event never fires without a socket
      called = true;
    });

    // Per Node.js spec, writableEnded should be true after end() is called
    expect(res.writableEnded).toBe(true);
    expect(res.finished).toBe(true);

    await new Promise(resolve => process.nextTick(resolve));
    expect(called).toBe(false);
  });

  test("should be true after end() with chunk but without socket", async () => {
    const req = new IncomingMessage(null as any);
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

    await new Promise(resolve => server.listen({ port: 0 }, resolve));
    const { port } = server.address() as { port: number };

    try {
      const response = await fetch(`http://localhost:${port}`);
      expect(await response.text()).toBe("Hello");
    } finally {
      await new Promise(resolve => server.close(resolve));
    }
  });
});
