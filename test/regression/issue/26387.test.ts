import { expect, test } from "bun:test";

// https://github.com/oven-sh/bun/issues/26387
// Request.text() failed with "TypeError: undefined is not a function" after
// ~4500 requests on macOS 1.3.6 (fixed in #26390).
//
// The original repro needed thousands of requests so that natural GC would
// fire. Here GC is forced explicitly every few iterations, so a weak-ref /
// wrapper-tracking regression surfaces within the first GC cycle it becomes
// observable rather than after an allocation threshold. That keeps the test
// in the ~1s range on debug+ASAN instead of ~20s for 6000 sequential
// round-trips.
test("Request.text() should work after many requests", async () => {
  let handlerError = "";
  using server = Bun.serve({
    port: 0,
    async fetch(req) {
      try {
        return new Response(await req.text());
      } catch (e) {
        handlerError ||= String(e);
        return new Response(String(e), { status: 500 });
      }
    },
  });

  const url = `http://localhost:${server.port}`;
  const requestCount = 200;
  const pad = Buffer.alloc(100, "x").toString();

  for (let i = 0; i < requestCount; i++) {
    const body = `${pad}-request-${i}`;
    const response = await fetch(url, { method: "POST", body });
    const responseText = await response.text();
    // Echo the full body back (not just its length) so a wrong/garbled body
    // shows the actual diff rather than a matching integer by coincidence.
    expect(responseText).toBe(body);
    expect(response.status).toBe(200);

    if (i % 20 === 0) Bun.gc(true);
  }

  expect(handlerError).toBe("");
});
