import { describe, expect, test } from "bun:test";

describe("Bun.inspect with Proxy in prototype chain", () => {
  test("does not crash when a getter reached through a Proxy prototype throws", () => {
    // The Expect prototype has getters (.rejects / .resolves) that mutate state and can
    // throw when invoked in sequence. Going through a Proxy forces the slow property
    // iteration path which invokes those getters.
    const e = expect(1);
    const proto = Object.getPrototypeOf(e);
    Object.setPrototypeOf(e, new Proxy(proto, {}));
    const out = Bun.inspect(e);
    expect(out).toContain("toBe");
  });

  test("does not crash when a Proxy getPrototypeOf trap throws during iteration", () => {
    class Foo {
      bar() {}
    }
    const obj = new Foo();
    const proto = Object.getPrototypeOf(obj);
    Object.setPrototypeOf(
      obj,
      new Proxy(proto, {
        getPrototypeOf() {
          throw new Error("nope");
        },
      }),
    );
    const out = Bun.inspect(obj);
    expect(out).toContain("bar");
  });

  test("does not crash when a Proxy get trap throws during iteration", () => {
    class Foo {
      bar() {}
      baz() {}
    }
    const obj = new Foo();
    const proto = Object.getPrototypeOf(obj);
    let count = 0;
    Object.setPrototypeOf(
      obj,
      new Proxy(proto, {
        get(t, k, r) {
          if (++count > 3) throw new Error("get fail");
          return Reflect.get(t, k, r);
        },
      }),
    );
    expect(() => Bun.inspect(obj)).not.toThrow();
  });
});
