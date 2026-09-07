import { test } from "bun:test";

// Under --todo, a todo test whose callback fails stays todo. An unhandled error
// that merely lands while it runs is not the callback's outcome: it fails the test.

test.todo("todo whose body throws", () => {
  throw new Error("expected failure");
});

test.todo("todo whose body passes while a stray timer throws", async () => {
  const { promise, resolve } = Promise.withResolvers();
  setTimeout(() => {
    setTimeout(resolve, 0);
    throw new Error("stray timer error");
  }, 0);
  await promise;
});
