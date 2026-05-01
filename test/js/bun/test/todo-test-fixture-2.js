import { test } from "bun:test";

test.todo("todo 1");
test.todo("todo 2", () => {
  throw new Error("this error is shown");
});
