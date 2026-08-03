import { expect, test } from "bun:test";

test("Worker preload: unresolvable module surfaces the resolve error, not 'undefined'", () => {
  let caught: unknown;
  try {
    new Worker(new URL("worker-fixture-preload-entry.js", import.meta.url).href, {
      preload: ["./this-preload-does-not-exist.js"],
    });
  } catch (e) {
    caught = e;
  }
  expect(caught).toBeInstanceOf(Error);
  const message = String((caught as Error).message);
  expect(message).not.toBe("undefined");
  expect(message).toContain("this-preload-does-not-exist");
});
