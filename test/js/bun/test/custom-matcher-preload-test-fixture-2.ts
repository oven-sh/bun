import { test, expect } from "bun:test";

test("custom matcher", () => {
  // @ts-expect-error
  expect("goat").toBeGoat();
  console.log("custom matcher test passed");
});
