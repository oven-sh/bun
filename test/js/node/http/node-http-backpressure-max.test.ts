/**
 * All new tests in this file should also run in Node.js.
 *
 * Do not add any tests that only run in Bun.
 *
 * A handful of older tests do not run in Node in this file. These tests should be updated to run in Node, or deleted.
 */
import { isCI, isLinux } from "harness";
import { once } from "node:events";
import http from "node:http";
import type { AddressInfo } from "node:net";

describe("backpressure", () => {
  // Linux CI only have 8GB with is not enought because we will clone all or most of this 4GB into memory
  it.skipIf(isCI && isLinux)(
    "should handle backpressure with the maximum allowed bytes",
    async () => {
      // max allowed by node:http to be sent in one go, more will throw an error
      const payloadSize = 4 * 1024 * 1024 * 1024;
      await using server = http.createServer((req, res) => {
        res.writeHead(200, {
          "Content-Type": "application/octet-stream",
          "Transfer-Encoding": "chunked",
        });
        const payload = Buffer.allocUnsafe(payloadSize);
        res.write(payload, () => {
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

      expect(totalBytes).toBe(payloadSize);
    },
    60_000,
  );
});
