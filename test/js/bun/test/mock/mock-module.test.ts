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

// =============================================================================
// Auto-mock: `mock.module(specifier)` / `jest.mock(specifier)` /
// `vi.mock(specifier)` with no factory, plus `jest.requireMock(specifier)` /
// `vi.requireMock(specifier)`. Issue: https://github.com/oven-sh/bun/issues/29834
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

  // Top-level class is replaced with a mock constructor that records calls.
  expect(typeof mocked.MyClass).toBe("function");
  expect(mocked.MyClass.mock).toBeDefined();
  new mocked.MyClass("arg");
  expect(mocked.MyClass).toHaveBeenCalledTimes(1);
  expect(mocked.MyClass).toHaveBeenCalledWith("arg");

  // Instance methods on the class's prototype are mocked too (via the
  // prototype itself — Bun's JSMockFunction doesn't currently install the
  // prototype on `new` instances, but MyClass.prototype.method is a mock).
  expect(typeof mocked.MyClass.prototype.greet).toBe("function");
  expect(mocked.MyClass.prototype.greet.mock).toBeDefined();
  expect(mocked.MyClass.prototype.greet()).toBeUndefined();

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

test("vi.requireMock mirrors jest.requireMock", () => {
  jest.mock("./auto-mock-fixture-virequiremock");

  const viMocked = vi.requireMock("./auto-mock-fixture-virequiremock") as any;
  const jestMocked = jest.requireMock("./auto-mock-fixture-virequiremock") as any;

  // Both call into the same cached JSModuleMock, so the handles are identical.
  expect(viMocked).toBe(jestMocked);
  expect(viMocked.plainFunction.mock).toBeDefined();
  expect(viMocked.MyClass.mock).toBeDefined();
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
  // accessors instead. We load the real module first so we can observe its
  // real counter.
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

  // jest.mock without a factory fails because there's nothing on disk to
  // load for this specifier. We don't care what message it throws — only
  // that the prior factory mock is still intact afterwards.
  expect(() => jest.mock("auto-mock-virtual-no-disk")).toThrow();

  // The factory mock must still resolve the specifier.
  expect(require("auto-mock-virtual-no-disk").greet()).toBe("hi");
});

test("jest.restoreAllMocks clears the on-demand requireMock cache", () => {
  // A subsequent jest.requireMock() for the same specifier, with no
  // intervening jest.mock(), must not return the previously configured
  // mock — bun test runs all files in one process, and the cache must
  // scope per `mock.restore()` boundary the same way `activeSpies` does.
  const first = jest.requireMock("./auto-mock-fixture-ondemand") as any;
  first.plainFunction.mockReturnValue("from-before-restore");
  expect(first.plainFunction()).toBe("from-before-restore");

  jest.restoreAllMocks();

  const second = jest.requireMock("./auto-mock-fixture-ondemand") as any;
  // Fresh mock — configured return value is gone.
  expect(second.plainFunction()).toBeUndefined();
  // And the handles are distinct — cache was cleared, not replaced in place.
  expect(second).not.toBe(first);
});

test("jest.requireMock with a relative specifier doesn't break later ESM imports", async () => {
  // requireMock resolves its specifier against the caller's source origin but
  // caches in a side-map, never allocating virtualModules. If it set
  // `mustDoExpensiveRelativeLookup` (which jest.mock does), a later ESM import
  // from a file that never called jest.mock would trip the module loader's
  // `!mustDoExpensiveRelativeLookup` assert under the debug/ASAN build.
  // Run in a fresh process so the global starts with virtualModules == null.
  // Use a `file:` specifier — that branch sets the flag unconditionally once
  // the URL is valid (the relative branch only sets it when resolution
  // fails), so it reliably reproduces the flag-set-but-map-null state.
  using dir = tempDir("requiremock-esm", {
    "real.ts": `export const value = 42;`,
    "fixture.test.ts": `
      import { test, expect, jest } from "bun:test";
      test("requireMock then import", async () => {
        // file: specifier → resolver sets the flag pre-fix.
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

test("a failing jest.mock() with a relative specifier doesn't break later ESM imports", async () => {
  // The auto-mock path sets `mustDoExpensiveRelativeLookup` for `./` and
  // `file:` specifiers on the assumption the mock install (which allocates
  // virtualModules) will follow. When the internal require() throws (typo'd
  // path), the install never happens — the flag must be reset or the module
  // loader's `!mustDoExpensiveRelativeLookup` assert fires on the next ESM
  // import under the debug/ASAN build. Fresh process so virtualModules
  // starts null.
  using dir = tempDir("failing-mock-esm", {
    "real.ts": `export const value = 42;`,
    "fixture.test.ts": `
      import { test, expect, jest } from "bun:test";
      test("failing mock then import", async () => {
        // Typo'd relative specifier → resolution fails → require() throws.
        expect(() => jest.mock("./my-fixtrue")).toThrow();
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

test("auto-mocking an already-required module doesn't re-run its side effects", async () => {
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
