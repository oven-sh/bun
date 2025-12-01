import { expect, test } from "bun:test";

const eachWithDifferingTypes = test.each([
  ["hello", "world"],
  ["hello", 2],
]);

eachWithDifferingTypes("each with differing types", (a, b) => {
  expect(typeof a).toBe("string");
  expect(["world", 2]).toContain(b);
});

const eachWithConst = test.each([
  ["hello", "world"],
  ["hello", "alistair"],
] as const);

eachWithConst("each with `as const`", (a, b) => {
  expect(a).toBe("hello");
  expect(["world", "alistair"]).toContain(b);
});

const eachWithConstAndDifferingTypes = test.each([
  ["hello", "world"],
  ["hello", 2],
] as const);

eachWithConstAndDifferingTypes("each with `as const` and differing types", (a, b) => {
  expect(a).toBe("hello");
  expect(["world", 2]).toContain(b);
});
