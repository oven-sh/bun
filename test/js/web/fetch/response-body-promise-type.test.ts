import { expect, test } from "bun:test";

// Regression: Response body from an async-iterable source used to return an
// InternalPromise from .bytes()/.text()/.json()/.arrayBuffer(), leaking JSC's
// internal promise to user space.
test.concurrent.each(["bytes", "text", "json", "arrayBuffer"] as const)(
  "Response.%s() returns a regular Promise for async-iterable body",
  async method => {
    function* gen() {
      return 1;
    }
    (gen as any)[Symbol.asyncIterator] = gen;

    const res = new Response(gen as any);
    const p = res[method]();
    expect(p.constructor).toBe(Promise);
    try {
      await p;
    } catch {}
  },
);

test.concurrent.each(["bytes", "text", "json"] as const)(
  "ReadableStream.%s() returns a regular Promise for async-iterable body",
  async method => {
    function* gen() {
      return 1;
    }
    (gen as any)[Symbol.asyncIterator] = gen;

    const res = new Response(gen as any);
    const p = (res.body as any)[method]();
    expect(p.constructor).toBe(Promise);
    try {
      await p;
    } catch {}
  },
);
