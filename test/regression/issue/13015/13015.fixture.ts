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

test("Set diff with Promise after long sibling", () => {
  const p = Promise.resolve();
  const long = Buffer.alloc(100, "a").toString();
  expect(new Set([p, long])).toEqual(new Set([long, p, "extra"]));
});

test("sibling after a Set is order-independent", () => {
  const p = Promise.resolve();
  const long = Buffer.alloc(100, "a").toString();
  expect([new Set(["a", long]), p]).toEqual([new Set([long, "a"]), p, "extra"]);
});
