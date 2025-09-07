import { expect, test } from "bun:test";
import vm from "node:vm";

// Regression test for https://github.com/oven-sh/bun/pull/22454
// VM contexts were incorrectly intercepting globalThis and returning
// the sandbox instead of the actual global object with builtins

test("vm.createContext allows access to globalThis.eval", () => {
  const context = {};
  vm.createContext(context);

  // This was failing with: TypeError: globalThis.eval is not a function
  vm.runInContext("this.eval = globalThis.eval", context);
  expect(typeof context.eval).toBe("function");

  // Verify eval actually works
  const result = vm.runInContext("globalThis.eval('2 + 2')", context);
  expect(result).toBe(4);
});

test("happy-dom pattern: copying builtins via globalThis works", () => {
  const context = {};
  vm.createContext(context);

  // This is the exact pattern used by happy-dom that was failing
  const code = `
    this.eval = globalThis.eval;
    this.Array = globalThis.Array;
    this.Object = globalThis.Object;
    this.Function = globalThis.Function;
    this.Boolean = globalThis.Boolean;
    this.ArrayBuffer = globalThis.ArrayBuffer;
  `;

  vm.runInContext(code, context);

  expect(typeof context.eval).toBe("function");
  expect(typeof context.Array).toBe("function");
  expect(typeof context.Object).toBe("function");
  expect(typeof context.Function).toBe("function");
  expect(typeof context.Boolean).toBe("function");
  expect(typeof context.ArrayBuffer).toBe("function");

  // Verify they actually work
  const arr = vm.runInContext("globalThis.Array.from([1,2,3])", context);
  expect(arr).toEqual([1, 2, 3]);
});

test("DONT_CONTEXTIFY mode: globalThis returns sandbox", () => {
  // When using DONT_CONTEXTIFY, globalThis should return the sandbox itself
  const context = vm.createContext(vm.constants.DONT_CONTEXTIFY);

  // In DONT_CONTEXTIFY mode, globalThis === the context object
  const result = vm.runInContext("globalThis", context);
  expect(result).toBe(context);

  // But builtins should still be accessible directly
  expect(typeof context.Array).toBe("function");
  expect(typeof context.Object).toBe("function");
});
