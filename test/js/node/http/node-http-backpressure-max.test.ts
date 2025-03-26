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
  it("should handle backpressure with the maximum allowed bytes", async () => {
    Bun.gc(true);
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
    const bytes = await fetch(`http://localhost:${PORT}/`).then(res => res.arrayBuffer());
    expect(bytes.byteLength).toBe(payloadSize);
  }, 60_000);
});
