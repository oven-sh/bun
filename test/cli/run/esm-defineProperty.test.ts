import { expect, test } from "bun:test";
import * as CJSArrayLike from "./cjs-defineProperty-arraylike.cjs";
import * as CJS from "./cjs-defineProperty-fixture.cjs";
import * as Self from "./esm-defineProperty.test.ts";
// https://github.com/oven-sh/bun/issues/4432
test("defineProperty", () => {
  expect(CJS.a).toBe(1);
  expect(CJS.b).toBe(2);
  // non-enumerable getter/setter are not copied, matching node.js
  expect(CJS.c).toBe(undefined);

  expect(Bun.inspect(CJS.default)).toBe(`{\n  a: 1,\n  b: 2,\n  c: [Getter],\n}`);
});
export const __esModule = true;
test("shows __esModule if it was exported", () => {
  expect(Bun.inspect(Self)).toBe(`Module {
  __esModule: true,
}`);
  expect(Object.getOwnPropertyNames(Self)).toContain("__esModule");
});

test("arraylike", () => {
  expect(CJSArrayLike[0]).toBe(0);
  expect(CJSArrayLike[1]).toBe(1);
  // Accessor-defined own properties (indices 2 and 4) on a plain CJS module
  // are not exposed as named exports; see issue #6747.
  expect(CJSArrayLike[2]).toBe(undefined);
  expect(CJSArrayLike).not.toHaveProperty("2");
  expect(CJSArrayLike[3]).toBe(4);
  expect(CJSArrayLike[4]).toBe(undefined);
  expect(CJSArrayLike).not.toHaveProperty("4");
  expect(Object.getOwnPropertyNames(CJSArrayLike)).not.toContain("__esModule");
  expect(Object.getOwnPropertyNames(CJSArrayLike.default)).not.toContain("__esModule");
  expect(Bun.inspect(CJSArrayLike)).toBe(`Module {
  "0": 0,
  "1": 1,
  "3": 4,
  default: {
    "0": 0,
    "1": 1,
    "2": [Getter],
    "3": 4,
    "4": [Getter],
  },
}`);
});
