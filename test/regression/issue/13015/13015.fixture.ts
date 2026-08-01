import { test, expect } from "bun:test";

test("Set diff shows only membership differences", () => {
  expect(new Set(["asdf", "xx"])).toEqual(new Set(["xx", "asdf", "sdf"]));
});

test("Set diff with numbers", () => {
  expect(new Set([3, 1, 2])).toEqual(new Set([2, 4, 1]));
});

test("Map diff shows only entry differences", () => {
  expect(
    new Map([
      ["b", 2],
      ["a", 1],
    ]),
  ).toEqual(
    new Map([
      ["a", 1],
      ["c", 3],
      ["b", 2],
    ]),
  );
});

test("Set nested in object", () => {
  expect({ s: new Set(["y", "x"]) }).toEqual({ s: new Set(["x", "y", "z"]) });
});
