// v8.test.ts runs this file with `bun test`. The addon calls the first function from a libuv callback, and the
// expectation in it fails. Then the addon calls the second function, which has not run before.
import { expect, test } from "bun:test";
import { createRequire } from "node:module";

const addon = createRequire(import.meta.url)("./build/Release/v8tests");

test("an expectation fails in a function that the addon calls from the event loop", async () => {
  const { promise, resolve } = Promise.withResolvers();
  addon.run_entry_from_event_loop(
    "Function::Call",
    1,
    () => expect(1).toBe(2),
    undefined,
    () => setImmediate(resolve),
  );
  await promise;
});

test("the next test runs", () => {
  expect(1).toBe(1);
});
