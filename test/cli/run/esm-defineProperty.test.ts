import { expect, test } from "bun:test";
import * as CJSArrayLike from "./cjs-defineProperty-arraylike.cjs";
import * as CJS from "./cjs-defineProperty-fixture.cjs";
// https://github.com/oven-sh/bun/issues/4432
test("defineProperty", () => {
  expect(CJS.a).toBe(1);
  expect(CJS.b).toBe(2);
  // non-enumerable getter/setter are not copied, matching node.js
  expect(CJS.c).toBe(undefined);

  expect(Bun.inspect(CJS.default)).toBe(`{\n  a: 1,\n  b: 2,\n  c: [Getter],\n}`);
});

test("arraylike", () => {
  console.log(globalThis);
  expect(CJSArrayLike[0]).toBe(0);
  expect(CJSArrayLike[1]).toBe(1);
  expect(CJSArrayLike[2]).toBe(3);
  expect(CJSArrayLike[3]).toBe(4);
  expect(CJSArrayLike[4]).toBe(undefined);
  expect(CJSArrayLike).toHaveProperty("4");
  expect(Bun.inspect(CJSArrayLike)).toBe(`Module {
  "0": 0,
  "1": 1,
  "2": 3,
  "3": 4,
  "4": undefined,
  default: {
    "0": 0,
    "1": 1,
    "2": [Getter],
    "3": 4,
    "4": [Getter],
  },
}`);
});
