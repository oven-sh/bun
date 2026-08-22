// TODO:
// - Write tests for errors
// - Write tests for Promise
// - Write tests for Promise rejection
// - Write tests for pending promise when a module already exists
// - Write test for export * from
// - Write test for export {foo} from "./foo"
// - Write test for import {foo} from "./foo"; export {foo}

import { expect, jest, mock, spyOn, test, vi } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { default as defaultValue, fn, iCallFn, rexported, rexportedAs, variable } from "./mock-module-fixture";
import * as spyFixture from "./spymodule-fixture";
// Imported (not just required) so its ESM registry entry exists — the
// repeat-jest.mock test below needs the second walk to run over the patched
// namespace.
import * as doubleFixture from "./auto-mock-fixture-double";

test("mock.module async", async () => {
  mock.module("i-am-async-and-mocked", async () => {
    await 42;
    await Bun.sleep(0);
    return { a: 123 };
  });

  expect((await import("i-am-async-and-mocked")).a).toBe(123);
});

test("mock.restore", () => {
  const original = spyFixture.iSpy;
  spyOn(spyFixture, "iSpy");
  const mocked = spyFixture.iSpy;
  expect(spyFixture.iSpy).not.toBe(original);
  expect(spyFixture.iSpy).not.toHaveBeenCalled();
  // @ts-expect-error
  spyFixture.iSpy();
  mock.restore();
  expect(spyFixture.iSpy).toBe(original);
});

test("spyOn", () => {
  spyOn(spyFixture, "iSpy");
  expect(spyFixture.iSpy).not.toHaveBeenCalled();
  spyFixture.iSpy(123);
  expect(spyFixture.iSpy).toHaveBeenCalled();
});

test("mocking a module that points to a file which does not resolve successfully still works", async () => {
  mock.module("i-never-existed-and-i-never-will", () => {
    return {
      bar: 42,
    };
  });

  // @ts-expect-error
  const { bar } = await import("i-never-existed-and-i-never-will");

  expect(bar).toBe(42);
});

test("mocking a non-existant relative file with a file URL", async () => {
  expect(() => require.resolve("./hey-hey-you-you2.ts")).toThrow();
  mock.module("file:./hey-hey-you-you2.ts", () => {
    return {
      bar: 42,
    };
  });

  // @ts-expect-error
  const { bar } = await import("./hey-hey-you-you2.ts");
  expect(bar).toBe(42);

  expect(require("./hey-hey-you-you2.ts").bar).toBe(42);
  expect(require.resolve("./hey-hey-you-you2.ts")).toBe(import.meta.resolveSync("./hey-hey-you-you2.ts"));
  expect(require.resolve("./hey-hey-you-you2.ts")).toBe(require.resolve("./hey-hey-you-you2.ts"));
});

test("mocking a non-existant relative file", async () => {
  expect(() => require.resolve("./hey-hey-you-you.ts")).toThrow();
  mock.module("./hey-hey-you-you.ts", () => {
    return {
      bar: 42,
    };
  });

  // @ts-expect-error
  const { bar } = await import("./hey-hey-you-you.ts");
  expect(bar).toBe(42);

  expect(require("./hey-hey-you-you.ts").bar).toBe(42);
  expect(require.resolve("./hey-hey-you-you.ts")).toBe(import.meta.resolveSync("./hey-hey-you-you.ts"));
  expect(require.resolve("./hey-hey-you-you.ts")).toBe(require.resolve("./hey-hey-you-you.ts"));
});

test("mocking a local file", async () => {
  expect(fn()).toEqual(42);
  expect(variable).toEqual(7);
  expect(defaultValue).toEqual("original");
  expect(rexported).toEqual(42);

  mock.module("./mock-module-fixture", () => {
    return {
      fn: () => 1,
      variable: 8,
      default: 42,
      rexported: 43,
    };
  });
  expect(fn()).toEqual(1);
  expect(variable).toEqual(8);
  // expect(defaultValue).toEqual(42);
  expect(rexported).toEqual(43);
  expect(rexportedAs).toEqual(43);
  expect((await import("./re-export-fixture")).rexported).toEqual(43);
  mock.module("./mock-module-fixture", () => {
    return {
      fn: () => 2,
      variable: 9,
    };
  });
  expect(fn()).toEqual(2);
  expect(variable).toEqual(9);
  mock.module("./mock-module-fixture", () => {
    return {
      fn: () => 3,
      variable: 10,
    };
  });
  expect(fn()).toEqual(3);
  expect(variable).toEqual(10);
  expect(require("./mock-module-fixture").fn()).toBe(3);
  expect(require("./mock-module-fixture").variable).toBe(10);
  expect(iCallFn()).toBe(3);
});

test.todo("adding a default on a module with no default", async () => {
  mock.module("./re-export-fixture.ts", () => {
    return {
      default: 42,
    };
  });
  expect((await import("./re-export-fixture")).default).toBe(42);
});

test("mocking a package", async () => {
  mock.module("ha-ha-ha", () => {
    return {
      wow: () => 42,
    };
  });
  const hahaha = await import("ha-ha-ha");
  expect(hahaha.wow()).toBe(42);
  expect(require("ha-ha-ha").wow()).toBe(42);
  mock.module("ha-ha-ha", () => {
    return {
      wow: () => 43,
    };
  });

  expect(hahaha.wow()).toBe(43);
  expect(require("ha-ha-ha").wow()).toBe(43);
});

test("mocking a builtin", async () => {
  mock.module("fs/promises", () => {
    return {
      readFile: () => Promise.resolve("hello world"),
    };
  });

  const { readFile } = await import("node:fs/promises");
  expect(await readFile("hello.txt", "utf8")).toBe("hello world");
});

test("a factory export getter that throws fails the import", async () => {
  mock.module("mock-module-getter-throws", () => ({
    get a() {
      throw new Error("export getter");
    },
    b: 2,
  }));
  await expect(import("mock-module-getter-throws")).rejects.toThrow("export getter");
});

test("a factory export getter that throws while patching an already-imported module throws from mock.module and leaves the namespace untouched", async () => {
  const before = { fn, variable };
  expect(() =>
    mock.module("./mock-module-fixture", () => ({
      fn: () => "patched",
      get variable() {
        throw new Error("export getter");
      },
    })),
  ).toThrow("export getter");
  // `fn` was read successfully before `variable` threw; neither may have been applied.
  expect(fn).toBe(before.fn);
  expect(variable).toBe(before.variable);
});

test("onResolve plugin errors surface from mock.module; an unresolvable specifier is still mockable", () => {
  Bun.plugin({
    name: "mock-module-onresolve-errors",
    setup(build) {
      build.onResolve({ filter: /\.mock-onresolve-throws$/ }, () => {
        throw new Error("onResolve threw");
      });
      build.onResolve({ filter: /\.mock-onresolve-invalid$/ }, () => ({ path: 42 }) as any);
    },
  });
  try {
    expect(() => mock.module("./thing.mock-onresolve-throws", () => ({ default: 1 }))).toThrow("onResolve threw");
    expect(() => mock.module("./thing.mock-onresolve-invalid", () => ({ default: 1 }))).toThrow(
      'Expected "path" to be a string in onResolve plugin',
    );
    mock.module("./does-not-exist-mock-probe", () => ({ default: 7 }));
    expect(require("./does-not-exist-mock-probe").default).toBe(7);
  } finally {
    Bun.plugin.clearAll();
  }
});

// =============================================================================
// Auto-mock: `mock.module(specifier)` / `jest.mock(specifier)` /
// `vi.mock(specifier)` with no factory, plus `jest.requireMock(specifier)`.
// Issue: https://github.com/oven-sh/bun/issues/29834
//
// NOTE: `mock.module(...)` in Bun is not hoisted (unlike Jest's Babel plugin),
// so when it runs the ESM namespace bindings resolve first. Our implementation
// re-patches the namespace after the mock registers, so code that imports the
// module still sees the mocked exports — but the tests below use `require()`
// for clarity so the ordering isn't ambiguous.
// =============================================================================

test("mock.module without a factory auto-mocks exported functions", () => {
  mock.module("./auto-mock-fixture");

  const mocked = require("./auto-mock-fixture");

  // Top-level function is replaced with a mock.
  expect(typeof mocked.plainFunction).toBe("function");
  expect(mocked.plainFunction.mock).toBeDefined();
  // Mock returns undefined by default.
  expect(mocked.plainFunction(1, 2, 3)).toBeUndefined();
  expect(mocked.plainFunction).toHaveBeenCalledWith(1, 2, 3);

  // Top-level class is replaced with a mock constructor that records calls
  // and produces instances inheriting the mocked prototype.
  expect(typeof mocked.MyClass).toBe("function");
  expect(mocked.MyClass.mock).toBeDefined();
  const instance = new mocked.MyClass("arg");
  expect(mocked.MyClass).toHaveBeenCalledTimes(1);
  expect(mocked.MyClass).toHaveBeenCalledWith("arg");
  expect(instance).toBeInstanceOf(mocked.MyClass);
  expect(mocked.MyClass.mock.instances[0]).toBe(instance);

  // Instance methods resolve through the mocked prototype.
  expect(typeof instance.greet).toBe("function");
  expect(instance.greet.mock).toBeDefined();
  expect(instance.greet()).toBeUndefined();
  expect(instance.greet).toBe(mocked.MyClass.prototype.greet);

  // `Class.prototype.constructor === Class` — Jest preserves this invariant on
  // auto-mocks so `instance.constructor === MockedClass` holds in consumer code.
  expect(mocked.MyClass.prototype.constructor).toBe(mocked.MyClass);

  // Primitives are preserved.
  expect(mocked.CONSTANT).toBe(42);
  expect(mocked.STRING_CONSTANT).toBe("hello");

  // Nested objects are recursively mocked.
  expect(typeof mocked.nested.fn).toBe("function");
  expect(mocked.nested.fn.mock).toBeDefined();
  expect(mocked.nested.fn()).toBeUndefined();
  expect(mocked.nested.value).toBe("nested-value");
});

test("jest.mock matches mock.module (no factory, auto-mocks)", () => {
  // Use a dedicated fixture so this specifier is touched only by this test —
  // if jest.mock's auto-mock path ever regresses into a no-op, the assertions
  // below won't pass by accident on a mock left over from an earlier test.
  jest.mock("./auto-mock-fixture-jest");
  const mocked = require("./auto-mock-fixture-jest");
  expect(mocked.plainFunction.mock).toBeDefined();
  expect(mocked.plainFunction()).toBeUndefined();
});

test("vi.mock matches mock.module (no factory, auto-mocks)", () => {
  vi.mock("./auto-mock-fixture-vi");
  const mocked = require("./auto-mock-fixture-vi");
  expect(mocked.plainFunction.mock).toBeDefined();
  expect(mocked.plainFunction()).toBeUndefined();
});

test("jest.requireMock returns the auto-mocked version of a module", () => {
  jest.mock("./auto-mock-fixture-requiremock");

  const mocked = jest.requireMock("./auto-mock-fixture-requiremock") as any;
  expect(mocked.plainFunction.mock).toBeDefined();
  expect(mocked.MyClass.mock).toBeDefined();

  // Configuring the mock via the requireMock handle works as expected.
  mocked.plainFunction.mockReturnValue(7);
  expect(mocked.plainFunction("x")).toBe(7);
});

test("jest.requireMock generates an auto-mock for a module that was never jest.mock()-ed", () => {
  // A distinct fixture so this specifier hasn't been touched by the other
  // tests — we exercise the synthesise-on-demand branch of requireMock.
  const mocked = jest.requireMock("./auto-mock-fixture-ondemand") as any;
  expect(mocked.plainFunction.mock).toBeDefined();
  expect(mocked.plainFunction()).toBeUndefined();

  // A second call must return the *same* mock object, otherwise any
  // `.mockReturnValue(...)` / `.mockImplementation(...)` configured through
  // the first handle would be invisible through later calls (matching
  // Jest's `Runtime.requireMock` caching in `_mockRegistry`).
  const mocked2 = jest.requireMock("./auto-mock-fixture-ondemand") as any;
  expect(mocked2).toBe(mocked);
  expect(mocked2.plainFunction).toBe(mocked.plainFunction);
});

test("mock.module still validates a non-callable second argument", () => {
  // @ts-expect-error non-callable second argument on purpose
  expect(() => mock.module("./auto-mock-fixture", 123)).toThrow("mock(module, fn) requires a function");
});

test("auto-mock preserves arrays and mocks static methods on classes", () => {
  mock.module("./auto-mock-fixture");
  const mocked = require("./auto-mock-fixture");

  // Arrays pass through (consumer code often branches on Array.isArray).
  expect(Array.isArray(mocked.arr)).toBe(true);
  expect(mocked.arr).toEqual([1, "two", { three: 3 }]);

  // Static methods on classes become mocks too so existing assertions keep working.
  expect(typeof mocked.MyClass.staticMethod).toBe("function");
  expect(mocked.MyClass.staticMethod.mock).toBeDefined();
  expect(mocked.MyClass.staticMethod()).toBeUndefined();
});

test("auto-mock does not invoke getters on the real module", () => {
  // If the walker read an accessor property via `object.get(...)` it would
  // trigger the getter, which can have side effects. The walker skips
  // accessors unless the owning object is an `__esModule` interop object
  // (see the esbuild-shaped test below). We load the real module first so we
  // can observe its real counter.
  const real = require("./auto-mock-fixture-accessor");
  const hitsBefore = real.getterHits();

  const mocked = jest.requireMock("./auto-mock-fixture-accessor") as any;

  // Walking the fixture to build the mock must not have invoked either
  // getter on the real module's `obj`.
  expect(real.getterHits()).toBe(hitsBefore);

  // Top-level mocks still get installed as expected.
  expect(mocked.getterHits.mock).toBeDefined();
  expect(mocked.plain.mock).toBeDefined();

  // The accessor properties themselves were skipped (not copied onto the
  // mock) — only plain data properties come through.
  expect(mocked.obj.sneaky).toBeUndefined();
  expect(mocked.obj.alsoSneaky).toBeUndefined();
  expect(mocked.obj.data).toBe(123);

  // And we still haven't invoked the real getters.
  expect(real.getterHits()).toBe(hitsBefore);
});

test("auto-mock handles plain objects with integer-indexed own keys", () => {
  // Under `bun bd test` / CI's x64-asan lane, `JSObject::putDirect(..., name)`
  // asserts `!parseIndex(name)` — so an export like `{ 0: fn, 1: fn }` must
  // route numeric keys through putDirectIndex to avoid tripping the assert
  // and/or landing them in the wrong storage slot.
  jest.mock("./auto-mock-fixture-indexed");
  const mocked = require("./auto-mock-fixture-indexed") as any;

  expect(typeof mocked.handlers[0]).toBe("function");
  expect(mocked.handlers[0]).toHaveProperty("mock");
  expect(mocked.handlers[0]()).toBeUndefined();

  expect(typeof mocked.handlers[1]).toBe("function");
  expect(mocked.handlers[1]()).toBeUndefined();

  expect(typeof mocked.handlers[42]).toBe("function");
  expect(mocked.handlers[42]()).toBeUndefined();

  // Non-index named keys still work alongside index keys.
  expect(mocked.handlers.name).toBe("handlers");
});

test("auto-mock walks the prototype chain: subclass statics, inherited methods, exported instances", () => {
  jest.mock("./auto-mock-fixture-subclass");
  const mocked = require("./auto-mock-fixture-subclass");

  // The subclass keeps the parent's statics and prototype methods (jest-mock
  // collects slots up the prototype chain, not just own properties).
  expect(mocked.Child.childStatic.mock).toBeDefined();
  expect(mocked.Child.baseStatic.mock).toBeDefined();
  expect(mocked.Child.prototype.childMethod.mock).toBeDefined();
  expect(mocked.Child.prototype.baseMethod.mock).toBeDefined();

  // `new` returns an instance that inherits the mocked prototype.
  const instance = new mocked.Child();
  expect(instance).toBeInstanceOf(mocked.Child);
  expect(instance.constructor).toBe(mocked.Child);
  expect(instance.childMethod()).toBeUndefined();
  expect(instance.baseMethod()).toBeUndefined();
  expect(mocked.Child.mock.instances[0]).toBe(instance);

  // A plain `export function Foo() {}` whose `prototype` was never read
  // before the mock (still lazily unreified) mocks with a prototype too,
  // so `new` and `instanceof` work on it.
  const legacy = new mocked.LegacyCtor();
  expect(legacy).toBeInstanceOf(mocked.LegacyCtor);
  expect(mocked.LegacyCtor.prototype.constructor).toBe(mocked.LegacyCtor);

  // An exported instance keeps its API — the methods live on the class
  // prototype, which only a chain walk can see.
  expect(typeof mocked.client.connect).toBe("function");
  expect(mocked.client.connect.mock).toBeDefined();
  expect(mocked.client.connect()).toBeUndefined();
  mocked.client.connect.mockReturnValue("ok");
  expect(mocked.client.connect()).toBe("ok");
  expect(mocked.client.disconnect.mock).toBeDefined();
});

test("auto-mock reads getters on __esModule interop objects (esbuild/tsc-built CJS)", () => {
  // esbuild and tsc emit CJS exports as getters next to an `__esModule` data
  // property; jest-mock reads accessors when the owner has `__esModule`, so
  // the mock keeps the exports instead of collapsing to `{ __esModule: true }`.
  const mocked = jest.requireMock("./auto-mock-fixture-esbuild.cjs") as any;

  expect(mocked.__esModule).toBe(true);
  expect(typeof mocked.helper).toBe("function");
  expect(mocked.helper.mock).toBeDefined();
  expect(mocked.helper()).toBeUndefined();
  expect(mocked.VERSION).toBe("1.2.3");
  // The `default` getter returns the same function as `helper`, so the mock
  // preserves the aliasing.
  expect(mocked.default).toBe(mocked.helper);

  // jest.mock + require must keep the full exports object: the real
  // require() of an esbuild module returns the exports object (with
  // __esModule and default on it), never just the default, so the mocked
  // require() must match and not unwrap `{ __esModule, default }`.
  jest.mock("./auto-mock-fixture-esbuild.cjs");
  const required = require("./auto-mock-fixture-esbuild.cjs");
  expect(required.__esModule).toBe(true);
  expect(required.helper.mock).toBeDefined();
  expect(required.VERSION).toBe("1.2.3");
  expect(required.default).toBe(required.helper);

  // requireMock returns the registered mock with the same shape, so the
  // result doesn't depend on which consumer ran first.
  const viaRequireMock = jest.requireMock("./auto-mock-fixture-esbuild.cjs") as any;
  expect(viaRequireMock).toBe(required);
});

test("a repeat jest.mock() of the same ESM module still produces working mocks", () => {
  // The second walk runs over the round-one mocks (the registry namespace was
  // patched), so the walker must not copy the mock prototype's methods onto
  // the new mocks as stubs that shadow the real mock API.
  jest.mock("./auto-mock-fixture-double");
  jest.mock("./auto-mock-fixture-double");

  const mocked = require("./auto-mock-fixture-double");
  expect(Object.prototype.hasOwnProperty.call(mocked.plainFunction, "mockReturnValue")).toBe(false);
  expect(Object.prototype.hasOwnProperty.call(mocked.plainFunction, "mockClear")).toBe(false);

  // Configuring the round-two mock must take effect.
  mocked.plainFunction.mockReturnValue(9);
  expect(mocked.plainFunction()).toBe(9);

  // Live bindings follow the round-two mock as well.
  expect((doubleFixture as any).plainFunction()).toBe(9);
});

test("auto-mock of a CJS module synthesizes a default export for import consumers", async () => {
  jest.mock("./auto-mock-fixture-cjs.cjs");

  // require() sees the mocked exports object.
  const mocked = require("./auto-mock-fixture-cjs.cjs");
  expect(mocked.doWork.mock).toBeDefined();
  expect(mocked.doWork()).toBeUndefined();
  expect(mocked.Engine.mock).toBeDefined();
  expect(mocked.LIMIT).toBe(99);

  // `import pkg from` links: `default` mirrors require-to-import interop
  // (the whole exports object). Without the synthesized `default`, this
  // import fails to link with "Missing 'default' export".
  const ns = await import("./auto-mock-fixture-cjs.cjs");
  expect(ns.doWork).toBe(mocked.doWork);
  expect(ns.default.doWork).toBe(mocked.doWork);
});

test("auto-mock of a primitive CJS module keeps the raw value", async () => {
  jest.mock("./auto-mock-fixture-primitive.cjs");

  // require() returns the primitive itself, not a `{ default: 42 }` carrier.
  expect(require("./auto-mock-fixture-primitive.cjs")).toBe(42);
  // jest.requireMock matches.
  expect(jest.requireMock("./auto-mock-fixture-primitive.cjs")).toBe(42);
  // And the default import sees the value.
  const ns = await import("./auto-mock-fixture-primitive.cjs");
  expect(ns.default).toBe(42);
});

test("auto-mock of exotic exports doesn't mutate the real object", async () => {
  jest.mock("./auto-mock-fixture-array.cjs");

  // The array passes through the walker unchanged, and the mock install
  // must not write a self-referencing `default` onto the real object.
  const arr = require("./auto-mock-fixture-array.cjs");
  expect(Array.isArray(arr)).toBe(true);
  expect(arr).toEqual([1, 2, 3]);
  expect(Object.prototype.hasOwnProperty.call(arr, "default")).toBe(false);
  expect(Object.keys(arr)).toEqual(["0", "1", "2"]);

  // Default import and requireMock resolve to the same untouched array.
  const ns = await import("./auto-mock-fixture-array.cjs");
  expect(ns.default).toBe(arr);
  expect(jest.requireMock("./auto-mock-fixture-array.cjs")).toBe(arr);
});

test("factory mocks shaped { __esModule, default } unwrap to the default for require()", () => {
  // Fresh require of the mock already unwrapped this shape (the
  // commonJSModule branch of handleVirtualModuleResult).
  mock.module("automock-esm-interop-fresh", () => ({ __esModule: true, default: { fresh: 1 }, named: "x" }));
  expect(require("automock-esm-interop-fresh")).toEqual({ fresh: 1 });

  // Re-mocking an already-required specifier patches the cached CJS entry
  // with the same unwrap, so the shape doesn't depend on load order.
  mock.module("automock-esm-interop-fresh", () => ({ __esModule: true, default: { fresh: 2 }, named: "y" }));
  expect(require("automock-esm-interop-fresh")).toEqual({ fresh: 2 });
});

test.concurrent("re-mocking an already-required module with an async factory doesn't hang", async () => {
  // The factory's promise is still pending while mock.module() patches the
  // cached CJS entry; the unwrap loop must break out instead of spinning on
  // the pending promise forever. Spawned so a regression fails by timeout
  // instead of hanging the suite.
  using dir = tempDir("async-remock", {
    "real.ts": `export const value = 1;`,
    "fixture.test.ts": `
      import { test, expect, mock } from "bun:test";
      test("async re-mock completes", async () => {
        require("./real.ts");
        mock.module("./real.ts", async () => {
          await Bun.sleep(0);
          return { value: 2 };
        });
        // mock.module() returned without hanging and the module is still
        // requireable.
        expect(require("./real.ts")).toBeDefined();
      });
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "fixture.test.ts"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toContain("1 pass");
  expect(stderr).not.toContain("0 pass");
  expect(exitCode).toBe(0);
});

test("jest.mock auto-mocks a plugin-provided module", () => {
  Bun.plugin({
    name: "auto-mock-plugin-test",
    setup(build) {
      build.module("auto-mock-plugin-pkg", () => ({
        exports: {
          greet() {
            return "real-greet";
          },
        },
        loader: "object",
      }));
    },
  });

  try {
    expect(require("auto-mock-plugin-pkg").greet()).toBe("real-greet");

    // jest.mock must be able to load the plugin-provided module to build the
    // auto-mock (the plugin's entry lives only in the virtual module map, so
    // removing it during the internal require() would break resolution).
    jest.mock("auto-mock-plugin-pkg");

    const mocked = require("auto-mock-plugin-pkg");
    expect(mocked.greet.mock).toBeDefined();
    expect(mocked.greet()).toBeUndefined();
  } finally {
    Bun.plugin.clearAll();
  }
});

test.concurrent(
  "auto-mock of the fs builtin: import and requireMock see the mock, require sees the real module",
  async () => {
    // Fresh process so mocking a builtin can't leak into other test files.
    using dir = tempDir("automock-builtin", {
      "fixture.test.ts": `
      import { test, expect, jest } from "bun:test";

      test("jest.mock('fs') consumers", async () => {
        jest.mock("fs");

        // Both import specifiers see the mock, including the default export.
        const ns: any = await import("fs");
        expect(ns.readFileSync.mock).toBeDefined();
        expect(ns.readFileSync("/nonexistent")).toBeUndefined();
        expect(ns.default.readFileSync).toBe(ns.readFileSync);
        const nodeNs: any = await import("node:fs");
        expect(nodeNs.readFileSync.mock).toBeDefined();

        // jest.requireMock returns the registered mock.
        const mocked: any = jest.requireMock("fs");
        expect(mocked.readFileSync.mock).toBeDefined();

        // Known limitation: require() of a builtin bypasses the mock
        // registry and keeps returning the real module.
        const real: any = require("fs");
        expect(real.readFileSync.mock).toBeUndefined();
        expect(typeof real.readFileSync).toBe("function");
      });
    `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "fixture.test.ts"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toContain("1 pass");
    expect(stderr).not.toContain("0 pass");
    expect(exitCode).toBe(0);
  },
);

test("auto-mock restores the prior factory mock when the require() throws", () => {
  // Install a factory mock for a virtual specifier that has no real module
  // on disk. A subsequent `jest.mock(specifier)` (no factory → auto-mock)
  // would try to `require(specifier)` for real exports — which throws
  // because the specifier has nothing to resolve to. Without the stash-
  // and-restore in JSMock__jsModuleMock, that exception would leak out
  // after silently destroying the original factory mock. With the fix,
  // the factory mock survives and keeps working.
  mock.module("auto-mock-virtual-no-disk", () => ({ greet: () => "hi" }));
  expect(require("auto-mock-virtual-no-disk").greet()).toBe("hi");

  // jest.mock without a factory fails inside the internal require() (there
  // is nothing on disk for this specifier), so the resolution error proves
  // the stash was already taken when the throw happened.
  expect(() => jest.mock("auto-mock-virtual-no-disk")).toThrow(/Cannot find package|Module not found|find module/);

  // The factory mock must still resolve the specifier.
  expect(require("auto-mock-virtual-no-disk").greet()).toBe("hi");
});

test("jest.requireMock handles survive jest.restoreAllMocks", () => {
  // Jest's restoreAllMocks doesn't touch the module registry (jest-runtime
  // clears _mockRegistry only in resetModules/teardown), so a requireMock
  // handle taken earlier must still be the one returned afterwards.
  const first = jest.requireMock("./auto-mock-fixture-ondemand") as any;

  jest.restoreAllMocks();

  const second = jest.requireMock("./auto-mock-fixture-ondemand") as any;
  expect(second).toBe(first);
});

test.concurrent("jest.requireMock with a relative specifier doesn't break later ESM imports", async () => {
  // Regression guard for the module loader's `!mustDoExpensiveRelativeLookup`
  // invariant: requireMock never installs into virtualModules, so it must not
  // leave the flag set. Fresh process so virtualModules starts null.
  using dir = tempDir("requiremock-esm", {
    "real.ts": `export const value = 42;`,
    "fixture.test.ts": `
      import { test, expect, jest } from "bun:test";
      test("requireMock then import", async () => {
        jest.requireMock("file:./real.ts");
        // A real ESM import afterwards must not hit the assert.
        const mod = await import("./real.ts");
        expect(mod.value).toBe(42);
      });
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "fixture.test.ts"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toContain("1 pass");
  expect(stderr).not.toContain("0 pass");
  expect(exitCode).toBe(0);
});

test.concurrent("Bun.plugin.clearAll() after jest.mock doesn't break later ESM imports", async () => {
  // Regression guard: clearAll() deletes virtualModules, so it must also
  // clear `mustDoExpensiveRelativeLookup` or the module loader's assert on
  // the flag-without-map state fires on the next ESM import. Fresh process
  // so virtualModules starts null.
  using dir = tempDir("clearall-esm", {
    "real.ts": `export const value = 42;`,
    "fixture.test.ts": `
      import { test, expect, jest } from "bun:test";
      test("jest.mock then clearAll then import", async () => {
        jest.mock("file:./real.ts");
        Bun.plugin.clearAll();
        const mod = await import("./real.ts");
        expect(mod.value).toBe(42);
      });
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "fixture.test.ts"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toContain("1 pass");
  expect(stderr).not.toContain("0 pass");
  expect(exitCode).toBe(0);
});

test.concurrent("a failing jest.mock() with a relative specifier doesn't break later ESM imports", async () => {
  // Regression guard: a jest.mock() whose internal require() throws (typo'd
  // path) must not leave the module loader's `!mustDoExpensiveRelativeLookup`
  // assert primed. Fresh process so virtualModules starts null.
  using dir = tempDir("failing-mock-esm", {
    "real.ts": `export const value = 42;`,
    "fixture.test.ts": `
      import { test, expect, jest } from "bun:test";
      test("failing mock then import", async () => {
        // Typo'd relative specifier → resolution fails → require() throws.
        expect(() => jest.mock("./my-fixtrue")).toThrow(/Cannot find package|Module not found|find module/);
        // A real ESM import afterwards must not hit the assert.
        const mod = await import("./real.ts");
        expect(mod.value).toBe(42);
      });
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "fixture.test.ts"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toContain("1 pass");
  expect(stderr).not.toContain("0 pass");
  expect(exitCode).toBe(0);
});

test.concurrent("auto-mocking an already-required module doesn't re-run its side effects", async () => {
  // When the module was merely require()'d (never mocked), its requireMap
  // entry holds the real exports — the auto-mock's internal require() must
  // reuse it instead of dropping the cache and re-evaluating the source.
  // Fresh process so the counter and module cache start clean.
  using dir = tempDir("automock-no-reeval", {
    "side-effect.cjs": `
      globalThis.__sideEffectRuns = (globalThis.__sideEffectRuns ?? 0) + 1;
      module.exports = {
        fn() {
          return "real";
        },
      };
    `,
    "fixture.test.ts": `
      import { test, expect, jest } from "bun:test";
      test("no double evaluation", () => {
        require("./side-effect.cjs");
        expect(globalThis.__sideEffectRuns).toBe(1);

        jest.mock("./side-effect.cjs");
        // The auto-mock must have been built from the cached real exports,
        // not a second evaluation.
        expect(globalThis.__sideEffectRuns).toBe(1);

        const mocked = require("./side-effect.cjs");
        expect(mocked.fn.mock).toBeDefined();
      });
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "fixture.test.ts"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toContain("1 pass");
  expect(stderr).not.toContain("0 pass");
  expect(exitCode).toBe(0);
});
