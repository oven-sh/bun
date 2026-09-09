import { expect, it } from "bun:test";

it("shadow realm works", () => {
  const red = new ShadowRealm();
  globalThis.someValue = 1;
  // Affects only the ShadowRealm's global
  const result = red.evaluate("globalThis.someValue = 2;");
  expect(globalThis.someValue).toBe(1);
  expect(result).toBe(2);
});

// A callable that a wrapped function returns is wrapped for the caller's realm,
// so its prototype is the caller's Function.prototype. The engine uses a
// separate call path for a target that is not a plain function, so check one
// target of each kind.
it.each([
  ["a plain function", `() => () => 1`],
  ["a bound function", `(() => () => 1).bind(undefined)`],
  ["the realm's Function constructor", `Function`],
  ["a callable Proxy", `new Proxy(() => () => 1, {})`],
  ["a Proxy with an apply trap", `new Proxy(() => {}, { apply: () => () => 1 })`],
])("a callable returned through %s belongs to the caller's realm", (name, source) => {
  const wrapped = new ShadowRealm().evaluate(source);
  const returned = wrapped();
  expect(typeof returned).toBe("function");
  expect(Object.getPrototypeOf(returned)).toBe(Function.prototype);
});

it("a returned wrapper does not expose the shadow realm's global object", () => {
  const realm = new ShadowRealm();
  const made = realm.evaluate(`Function`)("return 1");

  // The wrapper's prototype is the caller's Function.prototype, so the
  // constructor found on it compiles code in the caller's realm.
  const constructor = Object.getPrototypeOf(made).constructor;
  expect(constructor).toBe(Function);
  expect(constructor("return globalThis")()).toBe(globalThis);

  // The realm's global stays out of reach, so the two globals share no state.
  globalThis.injectedByShadowTest = { list: [] };
  try {
    expect(realm.evaluate(`typeof globalThis.injectedByShadowTest`)).toBe("undefined");
  } finally {
    delete globalThis.injectedByShadowTest;
  }
});

it("a callable returned to the shadow realm belongs to the shadow realm", () => {
  const realm = new ShadowRealm();
  const fromRealm = realm.evaluate(`(f) => {
    const proto = Object.getPrototypeOf(f());
    if (proto !== Function.prototype) return typeof proto.constructor("return globalThis")().Bun;
    return "ok";
  }`);

  expect(fromRealm(new Proxy(() => () => 1, {}))).toBe("ok");
  expect(fromRealm(() => () => 1)).toBe("ok");
  expect(fromRealm(Function)).toBe("ok");
});
