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
  // CJS named-export detection is now static (matching Node's cjs-module-lexer),
  // so only bindings the lexer can prove are declared on the namespace; the
  // full exports object is still reachable via `default`.
  expect(Object.getOwnPropertyNames(CJSArrayLike)).not.toContain("__esModule");
  expect(Object.getOwnPropertyNames(CJSArrayLike.default)).not.toContain("__esModule");
  expect(CJSArrayLike.default[0]).toBe(0);
  expect(CJSArrayLike.default[1]).toBe(1);
  expect(CJSArrayLike.default[2]).toBe(3);
  expect(CJSArrayLike.default[3]).toBe(4);
  expect(() => CJSArrayLike.default[4]).toThrow();
});
