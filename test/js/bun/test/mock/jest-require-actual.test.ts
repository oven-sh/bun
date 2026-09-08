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

  test("works inside mock.module factory for the same cold CommonJS module", () => {
    mock.module("./require-actual-cjs-partial-fixture.js", () => ({
      ...jest.requireActual("./require-actual-cjs-partial-fixture.js"),
      value: "mocked",
    }));

    const mocked = require("./require-actual-cjs-partial-fixture.js");
    expect(mocked).toEqual({ untouched: "untouched", value: "mocked" });
    expect(require("./require-actual-cjs-partial-fixture.js")).toBe(mocked);
    expect(jest.requireActual("./require-actual-cjs-partial-fixture.js")).toEqual({
      untouched: "untouched",
      value: "real",
    });
  });

  test("partially mocks an ESM module with more exports than the maximum inline capacity", async () => {
    const before = await import("./require-actual-many-exports-fixture.js");
    expect(Object.keys(before)).toHaveLength(128);

    mock.module("./require-actual-many-exports-fixture.js", () => ({
      ...jest.requireActual("./require-actual-many-exports-fixture.js"),
      export000: "mocked",
    }));

    const mocked = await import("./require-actual-many-exports-fixture.js");
    expect(mocked).toBe(before);
    expect(mocked.export000).toBe("mocked");
    expect(mocked.export127).toBe(127);

    const actual = jest.requireActual("./require-actual-many-exports-fixture.js");
    expect(Object.keys(actual)).toHaveLength(128);
    expect(actual.export000).toBe(0);
    expect(actual.export127).toBe(127);
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

  test("requireActual before ESM mocking keeps a detached actual result", async () => {
    const before = jest.requireActual("./require-actual-before-mock-esm-fixture.js");
    expect(before).toEqual({ untouched: "untouched", value: "real" });

    mock.module("./require-actual-before-mock-esm-fixture.js", () => ({ value: "first mock" }));
    expect((await import("./require-actual-before-mock-esm-fixture.js")).value).toBe("first mock");
    expect(before).toEqual({ untouched: "untouched", value: "real" });
    expect(jest.requireActual("./require-actual-before-mock-esm-fixture.js")).toBe(before);

    mock.module("./require-actual-before-mock-esm-fixture.js", () => ({ value: "second mock" }));
    expect((await import("./require-actual-before-mock-esm-fixture.js")).value).toBe("second mock");
    expect(before).toEqual({ untouched: "untouched", value: "real" });
  });

  test("re-mocking a loaded CommonJS mock does not cache mocked exports as actual", () => {
    mock.module("./require-actual-cjs-remock-fixture.js", () => ({ value: "first mock" }));
    expect(require("./require-actual-cjs-remock-fixture.js")).toEqual({ value: "first mock" });

    mock.module("./require-actual-cjs-remock-fixture.js", () => ({ value: "second mock" }));

    expect(jest.requireActual("./require-actual-cjs-remock-fixture.js")).toEqual({
      untouched: "untouched",
      value: "real",
    });
    expect(require("./require-actual-cjs-remock-fixture.js")).toEqual({ value: "second mock" });
  });

  test("re-mocking a loaded ESM mock does not cache mocked exports as actual", async () => {
    mock.module("./require-actual-esm-remock-fixture.js", () => ({
      untouched: "first mock untouched",
      value: "first mock",
    }));
    const first = await import("./require-actual-esm-remock-fixture.js");
    expect(first.untouched).toBe("first mock untouched");
    expect(first.value).toBe("first mock");

    mock.module("./require-actual-esm-remock-fixture.js", () => ({
      ...jest.requireActual("./require-actual-esm-remock-fixture.js"),
      value: "second mock",
    }));

    expect(jest.requireActual("./require-actual-esm-remock-fixture.js")).toEqual({
      untouched: "untouched",
      value: "real",
    });
    const second = await import("./require-actual-esm-remock-fixture.js");
    expect(second).toBe(first);
    expect(second.untouched).toBe("untouched");
    expect(second.value).toBe("second mock");
  });

  test("requireActual preserves an already-loaded mocked ESM namespace", async () => {
    mock.module("./require-actual-esm-identity-after-mock-fixture.js", () => ({
      untouched: "mocked untouched",
      value: "mocked",
    }));
    const before = await import("./require-actual-esm-identity-after-mock-fixture.js");
    expect(before.value).toBe("mocked");

    expect(jest.requireActual("./require-actual-esm-identity-after-mock-fixture.js")).toEqual({
      untouched: "untouched",
      value: "real",
    });

    const after = await import("./require-actual-esm-identity-after-mock-fixture.js");
    expect(after).toBe(before);
    expect(after.value).toBe("mocked");
  });

  test("requireActual preserves every loaded mocked ESM module-type variant", async () => {
    mock.module("./require-actual-multi-type-fixture.js", () => ({
      default: "mocked default",
      value: "mocked",
    }));

    const javascriptBefore = await import("./require-actual-multi-type-fixture.js");
    const textBefore = await import("./require-actual-multi-type-fixture.js", {
      with: { type: "text" },
    });
    expect(javascriptBefore.value).toBe("mocked");
    expect(textBefore.value).toBe("mocked");
    expect(
      await import("./require-actual-multi-type-fixture.js", {
        with: { type: "text" },
      }),
    ).toBe(textBefore);

    expect(jest.requireActual("./require-actual-multi-type-fixture.js")).toEqual({
      default: "real default",
      value: "real",
    });

    const textAfter = await import("./require-actual-multi-type-fixture.js", {
      with: { type: "text" },
    });
    expect(textAfter).toBe(textBefore);
    expect(textAfter.value).toBe("mocked");
  });

  test("mock.module does not read bindings from an ESM module that failed evaluation", async () => {
    const specifier = `data:text/javascript,${encodeURIComponent(
      'throw new Error("evaluation failed"); export const value = "real";',
    )}`;

    await expect(import(specifier)).rejects.toThrow("evaluation failed");
    expect(() => mock.module(specifier, () => ({ value: "mocked" }))).not.toThrow();
    expect((await import(specifier)).value).toBe("mocked");
  });

  test("mock.module does not read linked but unevaluated ESM bindings", async () => {
    const result = await import("./require-actual-linked-entry-fixture.js");
    expect(result.registered).toBe(true);
    expect(result.value).toBe("real");

    const direct = await import("./require-actual-linked-target-fixture.js");
    expect(direct.value).toBe("mocked");
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
    // The public API must only expose module exports, never loader bookkeeping values.
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

  test("builder.module registration invalidates and detaches a cached actual result", async () => {
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
      const actual = jest.requireActual(moduleId);
      expect(actual).toEqual({ source: "plugin" });

      mock.module(moduleId, () => ({ source: "jest" }));
      expect(await import(moduleId)).toMatchObject({ source: "jest" });
      expect(actual).toEqual({ source: "plugin" });
      expect(jest.requireActual(moduleId)).toBe(actual);
    } finally {
      Bun.plugin.clearAll();
    }
  });
});
