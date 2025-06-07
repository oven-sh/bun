import { describe, expect, test } from "bun:test";

describe("AbortSignal reason", () => {
  // https://bugs.webkit.org/show_bug.cgi?id=293319
  test("reason is preserved after GC", () => {
    const controller = new AbortController();
    controller.signal;
    controller.abort(new Error("one two three")); // error must be defined inline so it doesn't get kept alive
    Bun.gc(true);

    let error;
    try {
      controller.signal.throwIfAborted();
    } catch (e) {
      error = e;
    }

    expect(error).toBe(controller.signal.reason);
    expect(error.message).toBe("one two three");
  });
});
