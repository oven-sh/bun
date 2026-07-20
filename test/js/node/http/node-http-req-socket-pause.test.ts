/**
 * All tests in this file should also run in Node.js.
 */
import { expect, it } from "bun:test";
import { once } from "node:events";
import { createServer, request } from "node:http";
import type { AddressInfo } from "node:net";

it("req.socket emits 'pause' once an unread request body fills the IncomingMessage buffer", async () => {
  // Node's test-http-no-read-no-dump: a handler that never reads the body sees
  // 'pause' on req.connection once the IncomingMessage push() backpressures.
  const { promise: paused, resolve: onPause, reject } = Promise.withResolvers<number>();
  const server = createServer((req, res) => {
    req.connection!.on("pause", () => {
      onPause((req as any).readableLength);
      res.end("ok");
    });
    res.writeHead(200);
    res.flushHeaders();
  });
  try {
    await once(server.listen(0), "listening");
    const port = (server.address() as AddressInfo).port;
    const post = request({ method: "POST", port });
    post.on("error", reject);
    post.flushHeaders();
    // One body chunk at the default highWaterMark: the first parserOnBody push
    // returns false and Node's readStop pauses the socket.
    post.write(Buffer.alloc(64 * 1024, "X"));
    const buffered = await paused;
    expect(buffered).toBeGreaterThan(0);
    post.destroy();
  } finally {
    server.closeAllConnections();
    server.close();
  }
});

it("body reading from 'pause' still delivers every byte and 'end'", async () => {
  // A handler that keys its slow-reader flow off the socket's 'pause' event
  // (the pattern from Node's test-http-no-read-no-dump) must still be able to
  // drain the full body once it attaches a 'data' listener.
  const { promise: done, resolve, reject } = Promise.withResolvers<{ pauses: number; received: number }>();
  const server = createServer((req, res) => {
    let pauses = 0;
    let received = 0;
    req.connection!.on("pause", () => {
      pauses++;
      if (pauses > 1) return;
      req.on("data", chunk => (received += chunk.length));
      req.on("end", () => {
        res.end("ok");
        resolve({ pauses, received });
      });
    });
    res.writeHead(200);
    res.flushHeaders();
  });
  try {
    await once(server.listen(0), "listening");
    const port = (server.address() as AddressInfo).port;
    const payload = 256 * 1024;
    const post = request({ method: "POST", port });
    post.on("error", reject);
    post.flushHeaders();
    await once(post, "response");
    post.end(Buffer.alloc(payload, "X"));
    const { pauses, received } = await done;
    expect(received).toBe(payload);
    expect(pauses).toBeGreaterThanOrEqual(1);
  } finally {
    server.closeAllConnections();
    server.close();
  }
});
