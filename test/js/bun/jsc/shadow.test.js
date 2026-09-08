import { describe, expect, it } from "bun:test";
import { tempDir } from "harness";
import { join } from "node:path";

it("shadow realm works", () => {
  const red = new ShadowRealm();
  globalThis.someValue = 1;
  // Affects only the ShadowRealm's global
  const result = red.evaluate("globalThis.someValue = 2;");
  expect(globalThis.someValue).toBe(1);
  expect(result).toBe(2);
});

// Anything thrown across a ShadowRealm boundary is replaced by a TypeError of the catching realm.
// Building that TypeError's message must not itself throw (a Symbol has no ToString), must not run
// the thrown value's code, and must never let the original value through.
describe("exception crossing the boundary", () => {
  function catchSync(fn) {
    try {
      fn();
    } catch (e) {
      return e;
    }
    throw new Error("did not throw");
  }

  it("evaluate() of a script that throws a Symbol", () => {
    const realm = new ShadowRealm();
    const error = catchSync(() => realm.evaluate(`throw Symbol("from evaluate")`));
    expect(error.constructor).toBe(TypeError);
    expect(error.message).toBe("Symbol(from evaluate)");
  });

  it("wrapped function that throws a Symbol, both directions", () => {
    const realm = new ShadowRealm();
    const thrower = realm.evaluate(`() => { throw Symbol("from wrapped function") }`);
    const error = catchSync(thrower);
    expect(error.constructor).toBe(TypeError);
    expect(error.message).toBe("Symbol(from wrapped function)");

    const callAndDescribe = realm.evaluate(`(f) => { try { f(); } catch (e) { return e.constructor.name + ": " + e.message; } }`);
    expect(
      callAndDescribe(() => {
        throw Symbol("from incubating realm");
      }),
    ).toBe("TypeError: Symbol(from incubating realm)");
  });

  it("importValue() of a module that throws a Symbol", async () => {
    using dir = tempDir("shadow-realm-import-symbol", {
      "throws-symbol.mjs": `throw Symbol("from module");`,
    });
    const realm = new ShadowRealm();
    let error;
    await realm.importValue(join(String(dir), "throws-symbol.mjs"), "x").catch(e => (error = e));
    expect(error).toBeDefined();
    expect(error.constructor).toBe(TypeError);
    expect(error.message).toBe("Symbol(from module)");
  });

  it("importValue() of a module that throws an object runs none of its code and lets nothing through", async () => {
    using dir = tempDir("shadow-realm-import-object", {
      "throws-object.mjs": `
        globalThis.ran = 0;
        throw {
          toString() {
            globalThis.ran++;
            throw Object.assign(new Error("toString ran"), { leaked: globalThis });
          },
          get message() {
            globalThis.ran++;
            return "getter ran";
          },
        };
      `,
    });
    const realm = new ShadowRealm();
    let error;
    await realm.importValue(join(String(dir), "throws-object.mjs"), "x").catch(e => (error = e));
    // A TypeError of this realm, not the Error thrown from toString() inside the shadow realm.
    expect(error).toBeInstanceOf(TypeError);
    expect(error.leaked).toBeUndefined();
    expect(error.message).toBe("Error encountered during evaluation");
    expect(realm.evaluate(`globalThis.ran`)).toBe(0);
  });
});
