import { expect, test } from "bun:test";

// Regression: Response body from an async-iterable source used to return an
// InternalPromise from .bytes()/.text()/.json()/.arrayBuffer(), leaking JSC's
// internal promise to user space.
function makeAsyncIterableBody() {
  async function* gen() {
    yield new Uint8Array([104, 105]); // "hi"
  }
  return gen();
}

for (const method of ["bytes", "text", "json", "arrayBuffer"] as const) {
  test(`Response.${method}() returns a regular Promise for async-iterable body`, async () => {
    const res = new Response(makeAsyncIterableBody() as any);
    const p = res[method]();
    expect(p.constructor).toBe(Promise);
    try {
      await p;
    } catch {}
  });
}

for (const method of ["bytes", "text", "json"] as const) {
  test(`ReadableStream.${method}() returns a regular Promise for async-iterable body`, async () => {
    const res = new Response(makeAsyncIterableBody() as any);
    const p = (res.body as any)[method]();
    expect(p.constructor).toBe(Promise);
    try {
      await p;
    } catch {}
  });
}
