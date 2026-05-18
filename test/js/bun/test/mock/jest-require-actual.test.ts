import { mock, jest, test, expect, describe } from "bun:test";

mock.module("./require-actual-fixture.js", () => ({
  hello: "mocked",
  foo: "mocked",
}));

describe("jest.requireActual", () => {
  test("returns the real module when a mock is active", () => {
    const mocked = require("./require-actual-fixture.js");
    expect(mocked.hello).toBe("mocked");

    const real = jest.requireActual("./require-actual-fixture.js");
    expect(real.hello).toBe("world");
    expect(real.foo).toBe("bar");
  });

  test("partial mock pattern: spread actual + override", () => {
    const actual = jest.requireActual("./require-actual-fixture.js");
    const partial = { ...actual, hello: "overridden" };
    expect(partial.hello).toBe("overridden");
    expect(partial.foo).toBe("bar");
  });

  test("works with builtin modules", () => {
    const real = jest.requireActual("path");
    expect(real.join).toBeFunction();
    expect(real.resolve).toBeFunction();
  });

  test("works when no mock is active (passthrough)", () => {
    const real = jest.requireActual("fs");
    expect(real.readFileSync).toBeFunction();
  });

  test("calling multiple times returns same result", () => {
    const real1 = jest.requireActual("./require-actual-fixture.js");
    const real2 = jest.requireActual("./require-actual-fixture.js");
    expect(real1.hello).toBe("world");
    expect(real2.hello).toBe("world");
  });

  test("mock still works after requireActual is called", () => {
    jest.requireActual("./require-actual-fixture.js");
    const mocked = require("./require-actual-fixture.js");
    expect(mocked.hello).toBe("mocked");
  });

  test("throws for non-existent module", () => {
    expect(() => jest.requireActual("./does-not-exist-xyz.js")).toThrow();
  });

  test("throws with no arguments", () => {
    expect(() => (jest.requireActual as any)()).toThrow();
  });

  test("works inside mock.module factory (canonical Jest pattern)", () => {
    mock.module("./require-actual-esm-fixture.js", () => {
      const actual = jest.requireActual("./require-actual-fixture.js");
      return { ...actual, name: "mocked" };
    });
    const mod = require("./require-actual-esm-fixture.js");
    expect(mod.name).toBe("mocked");
    expect(mod.hello).toBe("world");
  });

  test("results are cached (same object reference on repeated calls)", () => {
    const first = jest.requireActual("./require-actual-fixture.js");
    const second = jest.requireActual("./require-actual-fixture.js");
    const third = jest.requireActual("./require-actual-fixture.js");
    expect(first).toBe(second);
    expect(second).toBe(third);
  });

  test("cache is invalidated when mock.module is called again", () => {
    const before = jest.requireActual("./require-actual-fixture.js");
    (before as any).__sentinel = true;
    mock.module("./require-actual-fixture.js", () => ({
      hello: "re-mocked",
      foo: "re-mocked",
    }));
    const after = jest.requireActual("./require-actual-fixture.js");
    expect(after.hello).toBe("world");
    expect((after as any).__sentinel).toBeUndefined();
  });

  test("requireActual on unmocked module does not corrupt require cache", () => {
    const r1 = require("./require-actual-unmocked-fixture.js");
    expect(r1.value).toBe("unmocked");

    const actual = jest.requireActual("./require-actual-unmocked-fixture.js");
    expect(actual.value).toBe("unmocked");

    const r2 = require("./require-actual-unmocked-fixture.js");
    expect(r2).toBe(r1);
  });

  test("requireActual never returns internal sentinel values", () => {
    // Regression: if fetchCommonJSModule returns -1 (ESM sentinel) but the
    // registry lookup fails, requireActual should throw instead of returning -1.
    const real = jest.requireActual("./require-actual-fixture.js");
    expect(real).not.toBe(-1);
    expect(typeof real).toBe("object");
    expect(real.hello).toBe("world");
  });

  test("requireActual on builtin ESM module returns module not -1", () => {
    // Builtins go through the ESM path internally — verify we get the real module
    const pathMod = jest.requireActual("path");
    expect(pathMod).not.toBe(-1);
    expect(pathMod.sep).toBeDefined();
    expect(pathMod.join).toBeFunction();
  });
});
