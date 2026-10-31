import { expect, test } from "bun:test";

test("a preload that does not resolve throws the message of the resolver", () => {
  let thrown: unknown;
  try {
    const worker = new Worker(new URL("worker-fixture-preload-entry.js", import.meta.url).href, {
      preload: ["./this-preload-does-not-exist.js"],
    });
    worker.terminate();
  } catch (e) {
    thrown = e;
  }
  expect(thrown).toBeInstanceOf(TypeError);
  expect((thrown as TypeError).message).toBe(
    'BuildMessage: ModuleNotFound resolving "./this-preload-does-not-exist.js" (entry point)',
  );
});
