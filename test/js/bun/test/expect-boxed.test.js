import * as util from "util";

test("boxed number", () => {
  expect(new Number(2)).not.toEqual(new Number(1));
  expect(2).not.toEqual(new Number(2));
});
test("boxed symbol", () => {
  expect(Object(Symbol())).not.toEqual(Object(Symbol()));
});
test("set props on boxed string", () => {
  const str1 = new String("abc");
  const str2 = new String("abc");
  str1.x = 1;
  expect(str1).toEqual(str2); // jest doesn't care
  expect(util.isDeepStrictEqual(str1, str2)).toBe(false);
  expect(Bun.deepEquals(str1, str2)).toBe(true);
});
for (const key of [Symbol(), "abc"]) {
  describe(key === "abc" ? "string key" : "symbol key", () => {
    const util = require("util");
    const sym = Symbol();
    const obj1 = {};
    const obj4 = {};
    Object.defineProperty(obj1, sym, { value: 1, enumerable: true });
    Object.defineProperty(obj4, sym, { value: 1, enumerable: false });
    test("enumerable 1", () => {
      expect(obj1).not.toEqual(obj4);
      expect(util.isDeepStrictEqual(obj1, obj4)).toBe(false);
      expect(Bun.deepEquals(obj1, obj4)).toBe(false);
      expect(Bun.deepEquals(obj1, obj4, false)).toBe(false);
      expect(Bun.deepEquals(obj1, obj4, true)).toBe(false);
      expect(obj4).not.toEqual(obj1);
      expect(util.isDeepStrictEqual(obj4, obj1)).toBe(false);
      expect(Bun.deepEquals(obj4, obj1)).toBe(false);
      expect(Bun.deepEquals(obj4, obj1, false)).toBe(false);
      expect(Bun.deepEquals(obj4, obj1, true)).toBe(false);
    });
    test("enumerable 2", () => {
      const obj1 = {};
      const obj2 = {};
      Object.defineProperty(obj2, sym, { value: 1 });
      expect(util.isDeepStrictEqual(obj1, obj2)).toBe(true);
      expect(util.isDeepStrictEqual(obj2, obj1)).toBe(true);
      obj1[sym] = 1;
      expect(util.isDeepStrictEqual(obj1, obj2)).toBe(false);
      expect(util.isDeepStrictEqual(obj2, obj1)).toBe(false);
    });
  });
}
