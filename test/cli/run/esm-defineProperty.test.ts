import { expect, test } from "bun:test";
import * as CJSArrayLike from "./cjs-defineProperty-arraylike.cjs";
import * as CJS from "./cjs-defineProperty-fixture.cjs";
import * as Self from "./esm-defineProperty.test.ts";
// https://github.com/oven-sh/bun/issues/4432
// ESM-imported CommonJS named exports are determined statically (as in Node's
// cjs-module-lexer) for evaluation-order correctness. `Object.defineProperty(exports, "<name>", ...)`
// is detected, so `a` and `c` are named-importable; the getter's value is snapshotted
// after the body runs.
test("defineProperty", () => {
  expect(CJS.a).toBe(1);
  expect(CJS.b).toBe(2);
  expect(CJS.c).toBe(3);

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
  // Named exports are determined statically: `Object.defineProperty(exports, "1"/"2"/"4", ...)`
  // is detected, bracket/computed assignments (`exports[0]`, `exports[3]`) are not. This is
  // Node's cjs-module-lexer behavior. Every value remains reachable on `default`.
  expect(Object.getOwnPropertyNames(CJSArrayLike)).toEqual(["1", "2", "4", "default"]);
  expect(Object.getOwnPropertyNames(CJSArrayLike)).not.toContain("__esModule");
  expect(Object.getOwnPropertyNames(CJSArrayLike.default)).not.toContain("__esModule");

  expect(CJSArrayLike[0]).toBe(undefined);
  expect(CJSArrayLike[1]).toBe(1);
  expect(CJSArrayLike[2]).toBe(3);
  expect(CJSArrayLike[3]).toBe(undefined);
  expect(CJSArrayLike[4]).toBe(undefined);

  expect(CJSArrayLike.default[0]).toBe(0);
  expect(CJSArrayLike.default[1]).toBe(1);
  expect(CJSArrayLike.default[2]).toBe(3);
  expect(CJSArrayLike.default[3]).toBe(4);
  expect(() => CJSArrayLike.default[4]).toThrow("4");

  expect(Bun.inspect(CJSArrayLike)).toBe(`Module {
  "1": 1,
  "2": 3,
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
