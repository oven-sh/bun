/**
 * All new tests in this file should also run in Node.js.
 *
 * Do not add any tests that only run in Bun.
 *
 * A handful of older tests do not run in Node in this file. These tests should be updated to run in Node, or deleted.
 */
import { once } from "node:events";
import http from "node:http";
import type { AddressInfo } from "node:net";

describe("backpressure", () => {
  // INT_MAX is the maximum we can sent to the socket in one call
  const TwoGBPayload = Buffer.allocUnsafe(1024 * 1024 * 1024 * 2);
  it("should handle backpressure", async () => {
    await using server = http.createServer((req, res) => {
      res.writeHead(200, {
        "Content-Type": "application/octet-stream",
        "Transfer-Encoding": "chunked",
      });
      // send 3 chunks of 1MB each which is more than the socket buffer and will trigger a backpressure event
      const payload = Buffer.alloc(1024 * 1024, "a");
      res.write(payload, () => {
        res.write(payload, () => {
          res.write(payload, () => {
            res.end();
          });
        });
      });
    });
    await once(server.listen(0), "listening");

    const PORT = (server.address() as AddressInfo).port;
    const bytes = await fetch(`http://localhost:${PORT}/`).then(res => res.arrayBuffer());
    expect(bytes.byteLength).toBe(1024 * 1024 * 3);
  });
  it("should handle backpressure with INT_MAX bytes", async () => {
    await using server = http.createServer((req, res) => {
      res.writeHead(200, {
        "Content-Type": "application/octet-stream",
        "Transfer-Encoding": "chunked",
      });

      res.write(TwoGBPayload, () => {
        res.end();
      });
    });

    await once(server.listen(0), "listening");

    const PORT = (server.address() as AddressInfo).port;
    const response = await fetch(`http://localhost:${PORT}/`);
    const reader = (response.body as ReadableStream<Uint8Array>).getReader();
    let totalBytes = 0;
    while (true) {
      const { done, value } = await reader.read();

      if (value) {
        totalBytes += value.byteLength;
      }
      if (done) break;
    }

    expect(totalBytes).toBe(TwoGBPayload.byteLength);
  }, 30_000);

  // https://github.com/oven-sh/bun/issues/26332
  // When the IncomingMessage (req) buffer fills up, socket reading must pause
  // so TCP backpressure propagates to the client. Previously push()'s return
  // value was ignored and the Readable's internal buffer grew unbounded.
  it("applies backpressure on request body when IncomingMessage buffer is full", async () => {
    const { promise: reqReceived, resolve: onReq } = Promise.withResolvers<http.IncomingMessage>();

    const server = http.createServer((req, _res) => {
      // Enter flowing mode (so _read() wires up the native ondata handler),
      // then pause. The Readable buffer will fill up; once push() returns
      // false the socket must stop reading.
      req.on("data", () => {});
      req.pause();
      onReq(req);
    });
    await once(server.listen(0, "127.0.0.1"), "listening");
    const port = (server.address() as AddressInfo).port;

    let pullCount = 0;
    const CHUNK = 256 * 1024;
    const body = new ReadableStream(
      {
        pull(controller) {
          pullCount++;
          controller.enqueue(new Uint8Array(CHUNK));
        },
      },
      { highWaterMark: 1 },
    );

    const controller = new AbortController();
    fetch(`http://127.0.0.1:${port}/`, {
      method: "POST",
      body,
      // @ts-ignore
      duplex: "half",
      signal: controller.signal,
    }).catch(() => {});

    const req = await reqReceived;
    let finalPullCount = 0;
    let finalReadableLength = 0;
    try {
      // Wait for the pull count to stabilize (backpressure kicked in) instead
      // of waiting a fixed amount of time. Without the fix this never
      // stabilizes — pullCount and req.readableLength grow unbounded — so
      // the hard cap trips and the assertions below fail.
      let last = -1;
      let stable = 0;
      for (let i = 0; i < 200 && stable < 5; i++) {
        await new Promise(r => setTimeout(r, 20));
        if (pullCount === last) stable++;
        else stable = 0;
        last = pullCount;
        // Hard cap: with 256KB chunks, 512 pulls = 128MB pulled by the client.
        // With working backpressure this stays well under 64 (Node.js ~16-40).
        if (pullCount > 512) break;
      }
      finalPullCount = pullCount;
      finalReadableLength = req.readableLength;
    } finally {
      // Tear down before asserting so a failing expect doesn't leave the
      // server waiting on an open connection.
      controller.abort();
      req.destroy();
      server.closeAllConnections();
      server.close();
    }

    expect(finalPullCount).toBeGreaterThan(0);
    expect(finalPullCount).toBeLessThan(512);
    // The Readable buffer should be bounded near its highWaterMark (16KB by
    // default) plus whatever was in flight while pausing, not hundreds of MB.
    expect(finalReadableLength).toBeLessThan(8 * 1024 * 1024);
  }, 30_000);

  it("should handle backpressure with more than INT_MAX bytes", async () => {
    // enough to fill the socket buffer
    const smallPayloadSize = 1024 * 1024;
    await using server = http.createServer((req, res) => {
      res.writeHead(200, {
        "Content-Type": "application/octet-stream",
        "Transfer-Encoding": "chunked",
      });
      res.write(Buffer.alloc(smallPayloadSize, "a"));
      res.write(TwoGBPayload, () => {
        res.end();
      });
    });

    await once(server.listen(0), "listening");

    const PORT = (server.address() as AddressInfo).port;
    const response = await fetch(`http://localhost:${PORT}/`);
    const reader = (response.body as ReadableStream<Uint8Array>).getReader();
    let totalBytes = 0;
    while (true) {
      const { done, value } = await reader.read();

      if (value) {
        totalBytes += value.byteLength;
      }
      if (done) break;
    }

    expect(totalBytes).toBe(TwoGBPayload.byteLength + smallPayloadSize);
  }, 30_000);
});
