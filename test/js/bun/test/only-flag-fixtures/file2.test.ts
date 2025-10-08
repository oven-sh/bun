import { test } from "bun:test";

test.only("file2: should only execute", () => {
  console.log("file2: only test executed");
});

test("file2: should not execute", () => {
  console.log("file2: regular test executed");
  throw new Error("This test should not run");
});
