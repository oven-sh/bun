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
