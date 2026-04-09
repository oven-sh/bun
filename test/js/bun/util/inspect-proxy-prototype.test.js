import { test, expect } from "bun:test";

// Regression: Bun.inspect crashed with a null deref when walking a prototype
// chain through a Proxy whose getPrototypeOf trap throws, because
// JSObject::getPrototype returns an empty JSValue on exception and the
// result was unconditionally dereferenced via .getObject().
test("Bun.inspect doesn't crash when a Proxy getPrototypeOf trap throws", () => {
  const obj = {};
  Object.setPrototypeOf(
    obj,
    new Proxy(
      { foo: 1 },
      {
        getPrototypeOf() {
          throw new Error("trap threw");
        },
      },
    ),
  );
  expect(() => Bun.inspect(obj)).not.toThrow();
});

test("Bun.inspect doesn't crash on a Proxy prototype wrapping a native prototype", () => {
  const v = Bun.jest(import.meta.path).expect(1);
  const originalPrototype = Object.getPrototypeOf(v);
  Object.setPrototypeOf(v, new Proxy(originalPrototype, {}));
  expect(() => Bun.inspect(v)).not.toThrow();
});
