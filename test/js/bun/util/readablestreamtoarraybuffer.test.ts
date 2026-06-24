import { expect, test } from "bun:test";

test("readableStreamToArrayBuffer works", async () => {
  // Bun.readableStreamToArray returns an InternalPromise, whose own .then is
  // not Promise.prototype.then; this test pins that the helper's chaining is
  // unaffected by a user-patched .then. Sync start() so the spec's start-
  // result wrap (which per Web IDL does call public .then for thenables) is
  // not in play.
  let _then = Promise.prototype.then;
  let counter = 0;
  // @ts-ignore
  Promise.prototype.then = (...args) => {
    counter++;
    return _then.apply(this, args);
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
    expect(counter).toBe(0);
    expect(new TextDecoder().decode(result)).toBe("bun is awesome!");
  } catch (error) {
    throw error;
  } finally {
    Promise.prototype.then = _then;
  }
});
