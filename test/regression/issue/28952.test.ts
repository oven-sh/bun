// https://github.com/oven-sh/bun/issues/28952
// Iterating `res.body` after an `await` used to crash with
// `TypeError: ... $resume is not a function` when the native fetch task
// had already drained the body into the single-buffer fast path in
// `lazyLoadStream` (src/js/builtins/ReadableStreamInternals.ts). The
// first fetch in a process is too slow to reliably hit the fast path, so
// this test warms the connection and then loops — any single iteration
// that hits the fast path will crash without the fix, so 8 attempts give
// a consistent regression signal across debug and release builds.
import { expect, test } from "bun:test";

test("fetch() body iterates across an await without crashing releaseLock (#28952)", async () => {
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

  // Warm up TCP + HTTP keep-alive so subsequent fetches complete their
  // native drain inside the Bun.sleep(0) gap below.
  await (await fetch(`http://localhost:${server.port}/warmup`)).arrayBuffer();

  for (let attempt = 0; attempt < 8; attempt++) {
    const res = await fetch(`http://localhost:${server.port}/`);
    const body = res.body!;
    // Yield once to let the native fetch task finish draining the body
    // into the buffered fast path before iteration starts.
    await Bun.sleep(0);

    let total = 0;
    for await (const chunk of body) {
      total += chunk.length;
    }
    expect(total).toBe(280 * 1024);
  }
});
