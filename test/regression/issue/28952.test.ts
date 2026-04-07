// https://github.com/oven-sh/bun/issues/28952
//
// When fetch()'s native body stream delivered the full payload as a single
// buffer, the JS wrapper installed a plain `{ start, pull }` underlying source
// that was missing a `$resume` method. After the async-iterator finished and
// called `reader.releaseLock()`, `readableStreamReaderGenericRelease` tried to
// invoke `underlyingSource.$resume(false)` and threw
// `TypeError: ... $resume is not a function`.
//
// The crash only reproduced when the caller inserted any delay between
// receiving `res.body` and iterating it, because the gap let the native
// buffered fast-path finish before the iterator started.
import { expect, test } from "bun:test";

test("fetch() body iterates with a buffered fast-path across an await (#28952)", async () => {
  using server = Bun.serve({
    port: 0,
    async fetch() {
      const data = new Uint8Array(280 * 1024);
      for (let i = 0; i < data.length; i++) data[i] = i & 0xff;
      return new Response(data, {
        headers: {
          "Content-Type": "application/octet-stream",
          "Content-Length": String(data.length),
        },
      });
    },
  });

  async function fetchStream() {
    const res = await fetch(`http://localhost:${server.port}/file-280kb.bin`);
    return res.body!;
  }

  const body = await fetchStream();
  // A setTimeout gap lets the native fetch task drain the response into
  // the single-buffer fast path before iteration begins — which is what
  // used to crash releaseLock() in the async-iterator's finally block.
  await new Promise(resolve => setTimeout(resolve, 50));

  let total = 0;
  for await (const chunk of body) {
    total += chunk.length;
  }
  expect(total).toBe(280 * 1024);
});

test("fetch() body iterates with a buffered fast-path for a large payload (#28952)", async () => {
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
  await new Promise(resolve => setTimeout(resolve, 50));

  const chunks: number[] = [];
  for await (const chunk of body) {
    chunks.push(chunk.length);
  }
  expect(chunks.reduce((a, b) => a + b, 0)).toBe(512 * 1024);
});
