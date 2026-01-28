import { test } from "bun:test";

test.only("file1.0 (only)", () => {
  console.log("file1.0 (only)");
});

test("file1.1", () => {
  console.log("file1.1");
  throw new Error("this test should never run because it is in a file which has `.only()`");
});
