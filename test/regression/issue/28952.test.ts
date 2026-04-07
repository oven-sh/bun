// https://github.com/oven-sh/bun/issues/28952
// The `await Bun.sleep(0)` between `res.body` and iteration is load-bearing:
// it lets the native fetch task drain the response into the single-buffer
// fast path before the async-iterator starts, which is the regression signal.
import { expect, test } from "bun:test";

test.concurrent("fetch() body iterates with a buffered fast-path across an await (#28952)", async () => {
  using server = Bun.serve({
    port: 0,
    async fetch() {
      return new Response(Buffer.alloc(280 * 1024, 0x41), {
        headers: {
          "Content-Type": "application/octet-stream",
          "Content-Length": String(280 * 1024),
        },
      });
    },
  });

  async function fetchStream() {
    const res = await fetch(`http://localhost:${server.port}/file-280kb.bin`);
    return res.body!;
  }

  const body = await fetchStream();
  await Bun.sleep(0);

  let total = 0;
  for await (const chunk of body) {
    total += chunk.length;
  }
  expect(total).toBe(280 * 1024);
});

test.concurrent("fetch() body iterates with a buffered fast-path for a large payload (#28952)", async () => {
  using server = Bun.serve({
    port: 0,
    async fetch() {
      return new Response(Buffer.alloc(512 * 1024, 0x42), {
        headers: { "Content-Type": "application/octet-stream" },
      });
    },
  });

  async function fetchStream() {
    const res = await fetch(`http://localhost:${server.port}/`);
    return res.body!;
  }

  const body = await fetchStream();
  await Bun.sleep(0);

  const chunks: number[] = [];
  for await (const chunk of body) {
    chunks.push(chunk.length);
  }
  expect(chunks.reduce((a, b) => a + b, 0)).toBe(512 * 1024);
});
