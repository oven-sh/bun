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

  test("throws for a non-existent relative module even when it is mocked", () => {
    mock.module("./does-not-exist-require-actual-mocked.js", () => ({ mocked: true }));
    expect(require("./does-not-exist-require-actual-mocked.js")).toEqual({ mocked: true });
    expect(() => jest.requireActual("./does-not-exist-require-actual-mocked.js")).toThrow();
    expect(require("./does-not-exist-require-actual-mocked.js")).toEqual({ mocked: true });
  });

  test("throws with no arguments", () => {
    expect(() => Reflect.apply(jest.requireActual, jest, [])).toThrow();
  });

  test("works inside mock.module factory for the same module", () => {
    mock.module("./require-actual-esm-fixture.js", () => ({
      ...jest.requireActual("./require-actual-esm-fixture.js"),
      name: "mocked",
    }));
    const mod = require("./require-actual-esm-fixture.js");
    expect(mod.name).toBe("mocked");
    expect(mod.greet()).toBe("hello");
    expect(mod.default.name).toBe("real");
  });

  test("results are cached (same object reference on repeated calls)", () => {
    const first = jest.requireActual("./require-actual-fixture.js");
    const second = jest.requireActual("./require-actual-fixture.js");
    const third = jest.requireActual("./require-actual-fixture.js");
    expect(first).toBe(second);
    expect(second).toBe(third);
  });

  test("re-mocking preserves the cached actual module", () => {
    const before = jest.requireActual("./require-actual-fixture.js");
    Object.defineProperty(before, "__sentinel", { value: true });
    mock.module("./require-actual-fixture.js", () => ({
      hello: "re-mocked",
      foo: "re-mocked",
    }));
    const after = jest.requireActual("./require-actual-fixture.js");
    expect(after).toBe(before);
    expect(Reflect.get(after, "__sentinel")).toBe(true);
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
    expect(pathMod.sep).toBe(process.platform === "win32" ? "\\" : "/");
    expect(pathMod.join).toBeFunction();
  });

  test("caches primitive exports while a mock is active", () => {
    const counter = Symbol.for("bun.test.jest.requireActual.primitiveLoads");
    Reflect.deleteProperty(globalThis, counter);
    mock.module("./require-actual-primitive-fixture.js", () => ({ mocked: true }));

    const first = jest.requireActual("./require-actual-primitive-fixture.js");
    const second = jest.requireActual("./require-actual-primitive-fixture.js");

    expect(first).toBe(1);
    expect(second).toBe(1);
    expect(Reflect.get(globalThis, counter)).toBe(1);
  });

  test("caches undefined exports while a mock is active", () => {
    const counter = Symbol.for("bun.test.jest.requireActual.undefinedLoads");
    Reflect.deleteProperty(globalThis, counter);
    mock.module("./require-actual-undefined-fixture.js", () => ({ mocked: true }));

    expect(jest.requireActual("./require-actual-undefined-fixture.js")).toBeUndefined();
    expect(jest.requireActual("./require-actual-undefined-fixture.js")).toBeUndefined();
    expect(Reflect.get(globalThis, counter)).toBe(1);
  });

  test("restores the mock when the actual module throws", () => {
    mock.module("./require-actual-throwing-fixture.js", () => ({ value: "mocked" }));

    expect(() => jest.requireActual("./require-actual-throwing-fixture.js")).toThrow("actual module failed to load");
    expect(require("./require-actual-throwing-fixture.js")).toEqual({ value: "mocked" });
  });

  test("preserves an existing ESM namespace while partially mocking it", async () => {
    const before = await import("./require-actual-identity-fixture.js");
    mock.module("./require-actual-identity-fixture.js", () => ({
      ...jest.requireActual("./require-actual-identity-fixture.js"),
      value: "mocked",
    }));

    const mocked = await import("./require-actual-identity-fixture.js");
    expect(mocked).toBe(before);
    expect(mocked.value).toBe("mocked");
    expect(jest.requireActual("./require-actual-identity-fixture.js")).toEqual({
      untouched: "untouched",
      value: "real",
    });

    const after = await import("./require-actual-identity-fixture.js");
    expect(after).toBe(mocked);
    expect(after.value).toBe("mocked");
  });

  test("builder.module registration invalidates a cached actual result", () => {
    const moduleId = require.resolve("./require-actual-unmocked-fixture.js");
    expect(jest.requireActual(moduleId)).toEqual({ value: "unmocked" });

    Bun.plugin({
      name: "jest-require-actual-virtual-module",
      setup(builder) {
        builder.module(moduleId, () => ({
          exports: { source: "plugin" },
          loader: "object",
        }));
      },
    });

    try {
      expect(jest.requireActual(moduleId)).toEqual({ source: "plugin" });
    } finally {
      Bun.plugin.clearAll();
    }
  });
});
