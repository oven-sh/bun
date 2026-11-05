// Symbol and BigInt are constructors: a class may extend them and they may stand as new.target; only constructing them throws. The engine knows a function that cannot be
// constructed by the address of one function of its own, so a linker that folds functions of the same code into one could make it take these two for such.
// Plain Bun, nothing is compiled: the table of built-ins asks a realm the same question (BuiltinTable::mismatches).
import { expect, test } from "bun:test";

test.each([
  ["Symbol", Symbol],
  ["BigInt", BigInt],
] as const)("%s is a constructor, and constructing it throws", (_, builtin) => {
  const constructor = builtin as unknown as new () => object;
  const Below = class extends constructor {};
  expect(Object.getPrototypeOf(Below)).toBe(builtin);
  expect(Object.getPrototypeOf(Reflect.construct(Object, [], builtin))).toBe(builtin.prototype);
  expect(() => new Below()).toThrow(TypeError);
  expect(() => new constructor()).toThrow(TypeError);
});
