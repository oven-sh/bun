import { test } from "bun:test";

test.only("file1: should only execute", () => {
  console.log("file1: only test executed");
});

test("file1: should not execute", () => {
  console.log("file1: regular test executed");
  throw new Error("This test should not run");
});
