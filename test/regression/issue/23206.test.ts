// https://github.com/oven-sh/bun/issues/23206
import { test, expect } from "bun:test";

test.each([
  "apple",
  "banana"
])("fruit #%# is %s", fruit => {
  // Test name should be "fruit #0 is apple" and "fruit #1 is banana"
  expect(["apple", "banana"]).toContain(fruit);
});

test.each([
  { name: "apple" },
  { name: "banana" }
])("fruit #%# is $name", fruit => {
  // Test name should be "fruit #0 is apple" and "fruit #1 is banana"
  // NOT "fruit #0 is "apple"" and "fruit #1 is "banana""
  expect(["apple", "banana"]).toContain(fruit.name);
});
