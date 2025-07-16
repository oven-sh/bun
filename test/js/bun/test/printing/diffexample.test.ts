import { test, expect } from "bun:test";

test("example 1", () => {
  expect("a\nb\nc\n d\ne").toEqual("a\nd\nc\nd\ne");
});
test("example 2", () => {
  expect({
    object1: "a",
    object2: "b",
    object3: "c\nd\ne",
  }).toEqual({
    object1: "a",
    object2: " b",
    object3: "c\nd",
  });
});
