import { describe, test } from "bun:test";

test.todo("todo 1");
test.todo("todo 2", () => {
  throw new Error("this error is shown");
});
test.todo("todo 3", () => {
  // passes
});

describe("async", () => {
  test.todo("todo with error", async () => {
    throw new Error("this async error is shown");
  });

  test.todo("todo with error and await", async () => {
    await 1;
    throw new Error("this async error with an await is shown");
  });

  test.todo("passing todo", async () => {});
  test.todo("passing todo with an await", async () => {
    await 1;
  });
});
