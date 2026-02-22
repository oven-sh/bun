import { expect, test } from "bun:test";
import http from "node:http";

// Regression test for https://github.com/oven-sh/bun/issues/27010
// HTTP requests hanging on Windows when making multiple concurrent large
// streaming GET requests using the Node.js http module.

test("multiple concurrent streaming HTTP requests complete without hanging", async () => {
  const TWO_MIB = 2 * 1024 * 1024;
  const CHUNK_SIZE = 64 * 1024;
  const ZERO_CHUNK = new Uint8Array(CHUNK_SIZE);

  // Start a streaming HTTP server
  using server = Bun.serve({
    port: 0,
    fetch(req) {
      const url = new URL(req.url);
      if (url.pathname !== "/stream") {
        return new Response("OK");
      }
      let sent = 0;
      const stream = new ReadableStream({
        pull: async controller => {
          const remaining = TWO_MIB - sent;
          if (remaining <= 0) {
            controller.close();
            return;
          }
          // Small delay to simulate realistic streaming
          await new Promise(resolve => setTimeout(resolve, 1));
          const n = Math.min(remaining, ZERO_CHUNK.byteLength);
          controller.enqueue(n === ZERO_CHUNK.byteLength ? ZERO_CHUNK : ZERO_CHUNK.subarray(0, n));
          sent += n;
        },
      });
      return new Response(stream, {
        headers: {
          "content-type": "application/octet-stream",
          "cache-control": "no-store",
        },
      });
    },
  });

  const url = `http://localhost:${server.port}/stream`;
  const NUM_WORKERS = 3;
  const NUM_ITERATIONS = 2;

  function downloadOnce(): Promise<number> {
    return new Promise((resolve, reject) => {
      const req = http.get(url, res => {
        let total = 0;
        res.on("data", (chunk: Buffer) => {
          total += chunk.length;
        });
        res.on("end", () => {
          resolve(total);
        });
        res.on("error", (err: Error) => {
          reject(err);
        });
      });
      req.on("error", (err: Error) => {
        reject(err);
      });
    });
  }

  async function workerLoop(): Promise<void> {
    for (let iter = 0; iter < NUM_ITERATIONS; iter++) {
      const bytes = await downloadOnce();
      expect(bytes).toBe(TWO_MIB);
    }
  }

  const promises: Promise<void>[] = [];
  for (let w = 0; w < NUM_WORKERS; w++) {
    promises.push(workerLoop());
  }
  await Promise.all(promises);
}, 30_000);

test("streaming HTTP response delivers all chunks via node:http", async () => {
  const TOTAL_SIZE = 512 * 1024; // 512KB
  const CHUNK_SIZE = 16 * 1024; // 16KB chunks

  using server = Bun.serve({
    port: 0,
    fetch(req) {
      let sent = 0;
      const stream = new ReadableStream({
        pull: async controller => {
          if (sent >= TOTAL_SIZE) {
            controller.close();
            return;
          }
          // Create a chunk with incrementing byte pattern for verification
          const n = Math.min(TOTAL_SIZE - sent, CHUNK_SIZE);
          const chunk = new Uint8Array(n);
          chunk.fill((sent / CHUNK_SIZE) & 0xff);
          controller.enqueue(chunk);
          sent += n;
        },
      });
      return new Response(stream);
    },
  });

  const url = `http://localhost:${server.port}/`;

  const result = await new Promise<Buffer>((resolve, reject) => {
    const req = http.get(url, res => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => {
        chunks.push(chunk);
      });
      res.on("end", () => {
        resolve(Buffer.concat(chunks));
      });
      res.on("error", reject);
    });
    req.on("error", reject);
  });

  expect(result.length).toBe(TOTAL_SIZE);

  // Verify chunk pattern integrity
  for (let i = 0; i < TOTAL_SIZE / CHUNK_SIZE; i++) {
    const offset = i * CHUNK_SIZE;
    const expectedByte = i & 0xff;
    expect(result[offset]).toBe(expectedByte);
    expect(result[offset + CHUNK_SIZE - 1]).toBe(expectedByte);
  }
});
