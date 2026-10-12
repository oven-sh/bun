import { expect, test } from "bun:test";

// The consumer's own promise plumbing must never route through user-patched
// Promise.prototype.then. (A thenable returned by the user's own start() is
// adopted through it, matching the spec and Node.)
test("readableStreamToArrayBuffer does not call a patched Promise.prototype.then", async () => {
  const originalThen = Promise.prototype.then;
  let counter = 0;
  // @ts-ignore
  Promise.prototype.then = function (...args) {
    counter++;
    return originalThen.apply(this, args);
  };
  try {
    const result = await Bun.readableStreamToArrayBuffer(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("bun is"));
          controller.enqueue(new TextEncoder().encode(" awesome!"));
          controller.close();
        },
      }),
    );
    expect(new TextDecoder().decode(result)).toBe("bun is awesome!");
    expect(counter).toBe(0);
  } finally {
    Promise.prototype.then = originalThen;
  }
});

test("an async start() promise is adopted observably, like Node", async () => {
  const originalThen = Promise.prototype.then;
  let counter = 0;
  // @ts-ignore
  Promise.prototype.then = function (...args) {
    counter++;
    return originalThen.apply(this, args);
  };
  try {
    const result = await Bun.readableStreamToArrayBuffer(
      new ReadableStream({
        async start(controller) {
          controller.enqueue(new TextEncoder().encode("bun is"));
          controller.enqueue(new TextEncoder().encode(" awesome!"));
          controller.close();
        },
      }),
    );
    expect(new TextDecoder().decode(result)).toBe("bun is awesome!");
    // Web IDL "a promise resolved with startResult" adopts the user's promise:
    // one observable then() call, exactly as in Node.
    expect(counter).toBe(1);
  } finally {
    Promise.prototype.then = originalThen;
  }
});
