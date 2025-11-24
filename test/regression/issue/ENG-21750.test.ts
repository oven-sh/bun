import { expect, test } from "bun:test";

// https://linear.app/oven/issue/ENG-21750
// CookieMap constructor should not crash when passed an object with symbol properties
test("CookieMap should handle objects with symbol properties without crashing", () => {
  // This should not crash - Bun object has symbol properties
  const cookieMap = new Bun.CookieMap(Bun);
  expect(cookieMap).toBeInstanceOf(Bun.CookieMap);

  // Also test with a custom object that has symbol properties
  const obj = {
    foo: "bar",
    [Symbol.for("test")]: "value",
    [Symbol("local")]: "another",
  };
  const cookieMap2 = new Bun.CookieMap(obj);
  expect(cookieMap2).toBeInstanceOf(Bun.CookieMap);
  // Symbol properties should be skipped, but string properties should work
  expect(cookieMap2.get("foo")).toBe("bar");
});

test("CookieMap should handle objects with numeric property names", () => {
  const obj = {
    "1": "one",
    "2": "two",
    "123": "onetwothree",
  };
  const cookieMap = new Bun.CookieMap(obj);
  expect(cookieMap).toBeInstanceOf(Bun.CookieMap);
  expect(cookieMap.get("1")).toBe("one");
  expect(cookieMap.get("2")).toBe("two");
  expect(cookieMap.get("123")).toBe("onetwothree");
});
