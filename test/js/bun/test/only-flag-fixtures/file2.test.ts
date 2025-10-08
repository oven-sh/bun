import { test } from "bun:test";

test("file2: should not execute without --only flag", () => {
  console.log("file2: test1 executed");
});

test("file2: another test that should not execute", () => {
  console.log("file2: test2 executed");
});
