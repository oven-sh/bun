import { expect, test } from "bun:test";

// Regression test for #23092 - panic in sendInitialRequestPayload:
// "index out of bounds: index 4162794746, len 671"
//
// Root cause: WebCore__FetchHeaders__count used createIterator()
// (lowerCaseKeys=true) while WebCore__FetchHeaders__copyTo used
// createIterator(false). The mismatch means count computed byte
// lengths on lowercased keys while copyTo wrote original-case keys.
// For non-ASCII header names where Unicode lowercasing changes UTF-8
// byte length, this caused the buffer to be undersized, and copyTo
// would write out of bounds, corrupting adjacent StringPointer data.

test("fetch with many headers does not corrupt header data", async () => {
  using server = Bun.serve({
    port: 0,
    async fetch(req) {
      const body = await req.text();
      return new Response(`${req.headers.get("x-check") ?? "missing"}:${body.length}`, {
        status: 200,
      });
    },
  });

  // Exercise the header copy path with varying header sizes
  for (let i = 0; i < 10; i++) {
    const headers = new Headers();
    headers.set("X-Check", `value-${i}`);
    // Add progressively more headers to stress the buffer
    for (let j = 0; j < i * 5; j++) {
      headers.set(`X-Header-${j}`, Buffer.alloc(j + 1, "x").toString());
    }

    const response = await fetch(server.url, {
      method: "POST",
      headers,
      body: Buffer.alloc(671, "a").toString(),
    });

    const text = await response.text();
    expect(text).toBe(`value-${i}:671`);
    expect(response.status).toBe(200);
  }
});
