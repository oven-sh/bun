/**
 * All new tests in this file should also run in Node.js.
 *
 * Do not add any tests that only run in Bun.
 *
 * A handful of older tests do not run in Node in this file. These tests should be updated to run in Node, or deleted.
 */
import { once } from "node:events";
import http from "node:http";
import net from "node:net";
import type { AddressInfo } from "node:net";

describe("backpressure", () => {
  // Writes `total` bytes to `res` in `chunk`-sized pieces, waiting for "drain"
  // whenever a write reports backpressure, then ends the response. Reusing one
  // chunk buffer keeps the test's peak memory small (the previous version held
  // a single 2 GB payload plus the server's queued copy, which pushed peak RSS
  // past 4.5 GB and intermittently got OOM-killed on 8 GB CI runners).
  async function writeBytes(res: http.ServerResponse, total: number, chunk: Buffer) {
    let remaining = total;
    while (remaining > 0) {
      const slice = remaining >= chunk.byteLength ? chunk : chunk.subarray(0, remaining);
      remaining -= slice.byteLength;
      if (!res.write(slice)) {
        await once(res, "drain");
      }
    }
    res.end();
  }

  async function countResponseBytes(port: number): Promise<number> {
    const response = await fetch(`http://localhost:${port}/`);
    const reader = (response.body as ReadableStream<Uint8Array>).getReader();
    let totalBytes = 0;
    while (true) {
      const { done, value } = await reader.read();

      if (value) {
        totalBytes += value.byteLength;
      }
      if (done) break;
    }
    return totalBytes;
  }

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
    const totalSize = 1024 * 1024 * 1024 * 2; // 2^31, one past INT_MAX
    const chunk = Buffer.alloc(64 * 1024 * 1024, "a");
    await using server = http.createServer((req, res) => {
      res.writeHead(200, {
        "Content-Type": "application/octet-stream",
        "Transfer-Encoding": "chunked",
      });

      writeBytes(res, totalSize, chunk);
    });

    await once(server.listen(0), "listening");

    const PORT = (server.address() as AddressInfo).port;
    const totalBytes = await countResponseBytes(PORT);

    expect(totalBytes).toBe(totalSize);
  }, 30_000);

  it("should handle backpressure with more than INT_MAX bytes", async () => {
    // enough to fill the socket buffer
    const smallPayloadSize = 1024 * 1024;
    const totalSize = 1024 * 1024 * 1024 * 2; // 2^31, one past INT_MAX
    const chunk = Buffer.alloc(64 * 1024 * 1024, "a");
    await using server = http.createServer((req, res) => {
      res.writeHead(200, {
        "Content-Type": "application/octet-stream",
        "Transfer-Encoding": "chunked",
      });
      res.write(Buffer.alloc(smallPayloadSize, "a"));
      writeBytes(res, totalSize, chunk);
    });

    await once(server.listen(0), "listening");

    const PORT = (server.address() as AddressInfo).port;
    const totalBytes = await countResponseBytes(PORT);

    expect(totalBytes).toBe(totalSize + smallPayloadSize);
  }, 30_000);

  // In Node.js, res.write and res.socket.write share one net.Socket buffer,
  // so raw socket bytes written while the response body is backpressured
  // are ordered after the body bytes and delivered once the buffer drains.
  // Previously Bun routed res.socket.write() straight to the fd via a
  // separate buffer that was only drained for CONNECT tunnels, so under
  // response backpressure the raw bytes were silently dropped and
  // socket.write() claimed success.
  it("res.socket.write() under response backpressure is buffered, ordered and delivered", async () => {
    const BIG = Buffer.alloc(8 * 1024 * 1024, "A");
    const MARKER = "INJECTED-RAW-BYTES";
    const TAIL = "ZZZ";
    const TOTAL = BIG.length + MARKER.length + TAIL.length;

    const { promise: observed, resolve, reject } = Promise.withResolvers<{
      bigWriteOk: boolean;
      socketWriteOk: boolean;
    }>();

    await using server = http.createServer((req, res) => {
      res.writeHead(200, { "content-length": String(TOTAL) });
      const bigWriteOk = res.write(BIG);
      const socketWriteOk = res.socket!.write(MARKER);
      res.end(TAIL);
      resolve({ bigWriteOk, socketWriteOk });
    });
    server.on("error", reject);
    await once(server.listen(0), "listening");
    const port = (server.address() as AddressInfo).port;

    // Raw TCP client so the raw socket bytes are observable as-is (an HTTP
    // client would error on a body that does not match Content-Length).
    const body = await new Promise<Buffer>((resolveBody, rejectBody) => {
      const chunks: Buffer[] = [];
      const sock = net.connect(port, "127.0.0.1", () => {
        sock.write("GET / HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n");
      });
      sock.on("data", c => chunks.push(c));
      sock.on("error", rejectBody);
      sock.on("close", () => {
        const all = Buffer.concat(chunks);
        const headEnd = all.indexOf("\r\n\r\n");
        resolveBody(all.subarray(headEnd + 4));
      });
    });

    const { bigWriteOk, socketWriteOk } = await observed;

    const markerAt = body.indexOf(MARKER);
    const tailAt = body.indexOf(TAIL);
    expect({
      bodyLength: body.length,
      bigWriteOk,
      socketWriteOk,
      markerAt,
      tailAt,
    }).toEqual({
      bodyLength: TOTAL,
      // res.write(8MB) must report backpressure.
      bigWriteOk: false,
      // The raw socket write sees the same backpressured connection.
      socketWriteOk: false,
      // Ordered: BIG, then MARKER, then TAIL.
      markerAt: BIG.length,
      tailAt: BIG.length + MARKER.length,
    });
  });
});
