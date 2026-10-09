// TODO:
// - Write tests for errors
// - Write tests for Promise
// - Write test for export * from
// - Write test for export {foo} from "./foo"
// - Write test for import {foo} from "./foo"; export {foo}

import { describe, expect, mock, spyOn, test, vi } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
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

test("a factory export getter that throws throws when the export is read, not from the import", async () => {
  mock.module("mock-module-getter-throws", () => ({
    get a() {
      throw new Error("export getter");
    },
    b: 2,
  }));
  const ns = await import("mock-module-getter-throws");
  expect(ns.b).toBe(2);
  expect(() => ns.a).toThrow("export getter");
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

test("a factory promise still pending on return patches an already-imported ES module once it settles", async () => {
  using dir = tempDir("mock-module-pending-esm", {
    "a.ts": `export function a() { return "real-a"; }\nexport let b = "real-b";`,
  });
  const path = join(String(dir), "a.ts");
  const ns = await import(path);

  const factory = Promise.withResolvers<object>();
  const patched = mock.module(path, () => factory.promise);
  expect(patched).toBeInstanceOf(Promise);
  // Nothing is patched while the factory is pending, and nothing blocks waiting for it.
  expect(ns.a()).toBe("real-a");

  factory.resolve({ a: () => "mocked-a" });
  expect(await patched).toBeUndefined();
  expect(ns.a()).toBe("mocked-a");
  expect(ns.b).toBe("real-b");
  expect((await import(path)).a()).toBe("mocked-a");
});

test("a factory promise still pending on return patches an already-required CommonJS module once it settles", async () => {
  using dir = tempDir("mock-module-pending-cjs", {
    "a.cjs": `exports.a = () => "real-a";`,
  });
  const path = join(String(dir), "a.cjs");
  expect(require(path).a()).toBe("real-a");

  const factory = Promise.withResolvers<object>();
  const patched = mock.module(path, () => factory.promise);
  expect(require(path).a()).toBe("real-a");

  factory.resolve({ a: () => "mocked-a" });
  await patched;
  expect(require(path).a()).toBe("mocked-a");
});

test("a factory that returns import() of another module patches an already-imported module with its exports", async () => {
  using dir = tempDir("mock-module-pending-import", {
    "a.ts": `export function a() { return "real-a"; }\nexport const b = "real-b";`,
    "a.mock.ts": `export function a() { return "mocked-a"; }\nexport const b = "mocked-b";`,
  });
  const path = join(String(dir), "a.ts");
  const ns = await import(path);

  await mock.module(path, () => import(join(String(dir), "a.mock.ts")));
  expect(ns.a()).toBe("mocked-a");
  expect(ns.b).toBe("mocked-b");
});

test("a factory that returns a module namespace object patches an already-imported module with its exports", async () => {
  using dir = tempDir("mock-module-namespace", {
    "a.ts": `export function a() { return "real-a"; }`,
    "a.mock.ts": `export function a() { return "mocked-a"; }`,
  });
  const path = join(String(dir), "a.ts");
  const ns = await import(path);
  const replacement = await import(join(String(dir), "a.mock.ts"));

  expect(mock.module(path, () => replacement)).toBeUndefined();
  expect(ns.a()).toBe("mocked-a");
});

test("a pending factory promise that rejects rejects the promise mock.module returned and leaves the module untouched", async () => {
  using dir = tempDir("mock-module-pending-reject", {
    "a.ts": `export function a() { return "real-a"; }`,
  });
  const path = join(String(dir), "a.ts");
  const ns = await import(path);

  const factory = Promise.withResolvers<object>();
  const patched = mock.module(path, () => factory.promise);
  const error = new Error("factory failed");
  factory.reject(error);
  await expect(patched).rejects.toBe(error);
  expect(ns.a()).toBe("real-a");
  // A fresh load is not served by the failed mock.
  delete require.cache[path];
  expect((await import(path)).a()).toBe("real-a");

  // Already rejected when the factory returns: thrown, and not also reported as an unhandled rejection.
  expect(() =>
    mock.module(path, async () => {
      throw error;
    }),
  ).toThrow(error);
});

test("a pending factory whose exports throw while being read rejects the returned promise and unregisters the mock", async () => {
  using dir = tempDir("mock-module-pending-getter-throws", {
    "a.ts": `export function a() { return "real-a"; }`,
  });
  const path = join(String(dir), "a.ts");
  const ns = await import(path);

  const patched = mock.module(path, async () => {
    await Promise.resolve();
    return {
      get a() {
        throw new Error("export getter");
      },
    };
  });
  await expect(patched).rejects.toThrow("export getter");
  expect(ns.a()).toBe("real-a");
  // A fresh load is not served by the failed mock.
  delete require.cache[path];
  expect((await import(path)).a()).toBe("real-a");
});

test("a factory promise that resolves to a non-object is rejected like the synchronous case", async () => {
  using dir = tempDir("mock-module-non-object", {
    "a.ts": `export function a() { return "real-a"; }\nexport default "real-default";`,
  });
  const path = join(String(dir), "a.ts");
  const ns = await import(path);
  const message = "mock(module, fn) requires a function that returns an object";

  expect(() => mock.module(path, () => 42)).toThrow(message);
  // Already fulfilled when the factory returns.
  expect(() => mock.module(path, async () => 42)).toThrow(message);
  // Still pending when the factory returns.
  const patched = mock.module(path, async () => {
    await Promise.resolve();
    return 42;
  });
  await expect(patched).rejects.toThrow(message);

  expect(ns.a()).toBe("real-a");
  expect(ns.default).toBe("real-default");
});

test("a later mock.module for the same module is not overwritten when an earlier pending factory settles", async () => {
  using dir = tempDir("mock-module-superseded", {
    "a.ts": `export function a() { return "real-a"; }`,
  });
  const path = join(String(dir), "a.ts");
  const ns = await import(path);

  const factory = Promise.withResolvers<object>();
  const first = mock.module(path, () => factory.promise);
  mock.module(path, () => ({ a: () => "second" }));
  expect(ns.a()).toBe("second");

  factory.resolve({ a: () => "first" });
  await first;
  expect(ns.a()).toBe("second");

  // Whether a replaced mock's factory fails does not matter either.
  const replaced = mock.module(path, async () => {
    await Promise.resolve();
    return 42;
  });
  mock.module(path, () => ({ a: () => "third" }));
  expect(await replaced).toBeUndefined();
  expect(ns.a()).toBe("third");

  const replacedAndRejects = mock.module(path, async () => {
    await Promise.resolve();
    throw new Error("replaced");
  });
  mock.module(path, () => ({ a: () => "fourth" }));
  expect(await replacedAndRejects).toBeUndefined();
  expect(ns.a()).toBe("fourth");
});

test("a factory that require()s the module it is mocking also patches the require.cache entry that creates", async () => {
  using dir = tempDir("mock-module-factory-requires", {
    "a.ts": `export function a() { return "real-a"; }`,
  });
  const path = join(String(dir), "a.ts");
  const ns = await import(path);

  mock.module(path, () => ({ ...require(path), extra: "extra" }));
  expect(ns.a()).toBe("real-a");
  expect(require(path).extra).toBe("extra");
});

test.concurrent(
  "tests in a file do not start until a top-level mock.module with a pending factory has patched its static imports",
  async () => {
    using dir = tempDir("mock-module-pending-toplevel", {
      "a.ts": `export function a() { return "real-a"; }\nexport function b() { return "real-b"; }`,
      "partial.test.ts": `
      import { expect, mock, test } from "bun:test";
      import { a, b } from "./a";

      // Not awaited: the vitest partial-mock idiom.
      mock.module("./a", async () => {
        const actual = await import("./a?actual");
        return { ...actual, a: () => "mocked-" + actual.a() };
      });

      test("sees the mock", () => {
        expect(a()).toBe("mocked-real-a");
        expect(b()).toBe("real-b");
      });
    `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "partial.test.ts"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toContain(" 1 pass");
    expect(exitCode).toBe(0);
  },
);

test.concurrent(
  "a top-level mock.module whose pending factory rejects fails the run when the returned promise is not awaited",
  async () => {
    using dir = tempDir("mock-module-pending-toplevel-reject", {
      "a.ts": `export function a() { return "real-a"; }`,
      "reject.test.ts": `
      import { expect, mock, test } from "bun:test";
      import { a } from "./a";

      mock.module("./a", async () => {
        await Promise.resolve();
        throw new Error("factory failed");
      });

      test("a", () => {
        expect(a()).toBe("real-a");
      });
    `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "reject.test.ts"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toContain("error: factory failed");
    expect(stderr).toContain(" 1 error");
    expect(exitCode).toBe(1);
  },
);

test.concurrent(
  "a mock.module patch that a test leaves pending or that was replaced does not hold up a file",
  async () => {
    using dir = tempDir("mock-module-pending-leftover", {
      "a.ts": `export function a() { return "real-a"; }`,
      "1.test.ts": `
      import { expect, mock, test } from "bun:test";
      import { a } from "./a";

      test("leaves a factory pending", () => {
        expect(mock.module("./a", () => new Promise(() => {}))).toBeInstanceOf(Promise);
        expect(a()).toBe("real-a");
      });
    `,
      "2.test.ts": `
      import { expect, mock, test } from "bun:test";
      import { a } from "./a";

      // Nor does one that was replaced before it settled.
      mock.module("./a", () => new Promise(() => {}));
      mock.module("./a", () => ({ a: () => "mocked-a" }));

      test("runs", () => {
        expect(a()).toBe("mocked-a");
      });
    `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "./1.test.ts", "./2.test.ts"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toContain(" 2 pass");
    expect(exitCode).toBe(0);
  },
);

test.concurrent("mock.module() of a module whose import() is still loading its dependencies", async () => {
  using dir = tempDir("mock-module-import-in-flight", {
    "a.ts": `import "./dependency"; export const a = "real-a";`,
    "dependency.ts": `export {};`,
    "in-flight.test.ts": `
      import { expect, mock, test } from "bun:test";

      test("the import in flight gets the module it was loading, the next one gets the mock", async () => {
        const dependencyRequested = Promise.withResolvers<void>();
        const dependencyMayLoad = Promise.withResolvers<void>();
        Bun.plugin({
          name: "hold the dependency's load open",
          setup(build) {
            build.onLoad({ filter: /dependency\\.ts$/ }, async () => {
              dependencyRequested.resolve();
              await dependencyMayLoad.promise;
              return { contents: "export {}", loader: "ts" };
            });
          },
        });

        const inFlight = import("./a");
        await dependencyRequested.promise;
        mock.module("./a", () => ({ a: "mocked-a" }));
        dependencyMayLoad.resolve();

        expect((await inFlight).a).toBe("real-a");
        expect((await import("./a")).a).toBe("mocked-a");
      });
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "./in-flight.test.ts"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toContain(" 1 pass");
  expect(exitCode).toBe(0);
});

// The fixtures assert. This checks that every test in them ran and passed.
async function expectFixturesToPass(files: Record<string, string>, pass: number, args: string[] = []) {
  using dir = tempDir("mock-module", files);
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", ...args],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toContain(` ${pass} pass\n 0 fail\n`);
  expect(exitCode).toBe(0);
}

const modules = {
  "mod.ts": `
    import { dep } from "./dep";
    globalThis.loads = (globalThis.loads ?? 0) + 1;
    export const value = "real";
    export function fn() { return "real-fn"; }
    export function usesDep() { return dep(); }
    export class Klass { method() { return "real-method"; } }
    export const obj = { nested: { f() { return "real-nested"; } }, arr: [1, 2, 3], n: 1 };
    export default function def() { return "real-default"; }
  `,
  "dep.ts": `export function dep() { return "real-dep"; }`,
  "side.ts": `
    import { value, fn } from "./mod";
    export const captured = value;
    export const callFn = () => fn();
  `,
  "sub/thing.ts": `
    export const thing = "real-thing";
    export function f() { return "real-f"; }
  `,
  "node_modules/esm-pkg/package.json": JSON.stringify({ name: "esm-pkg", type: "module", main: "./index.js" }),
  "node_modules/esm-pkg/index.js": `
    export const name = "esm-pkg";
    export function hello() { return "real-hello"; }
    export default function def() { return "real-default"; }
  `,
  "node_modules/cjs-pkg/package.json": JSON.stringify({ name: "cjs-pkg", main: "./index.js" }),
  "node_modules/cjs-pkg/index.js": `
    exports.name = "cjs-pkg";
    exports.hello = function hello() { return "real-hello"; };
  `,
  "node_modules/cjs-fn/package.json": JSON.stringify({ name: "cjs-fn", main: "./index.js" }),
  "node_modules/cjs-fn/index.js": `
    module.exports = function cjsFn() { return "real-cjs-fn"; };
    module.exports.extra = function extra() { return "real-extra"; };
  `,
  "node_modules/@scope/pkg/package.json": JSON.stringify({ name: "@scope/pkg", type: "module", main: "./index.js" }),
  "node_modules/@scope/pkg/index.js": `export const scoped = "real-scoped";`,
};

const manualMocks = {
  "sub/__mocks__/thing.ts": `
    export const thing = "manual-thing";
    export function f() { return "manual-f"; }
  `,
  "__mocks__/esm-pkg.ts": `
    export const name = "manual-esm-pkg";
    export default function def() { return "manual-default"; }
  `,
  "__mocks__/cjs-fn.js": `module.exports = function manual() { return "manual-cjs-fn"; };`,
  "__mocks__/@scope/pkg.ts": `export const scoped = "manual-scoped";`,
  "__mocks__/fs.ts": `
    export function readFileSync() { return "manual-fs"; }
    export default { readFileSync };
  `,
};

describe.concurrent("the original of a mocked module", () => {
  test("importOriginal and vi.importActual load a module that was never loaded, once", async () => {
    await expectFixturesToPass(
      {
        ...modules,
        // Imports the mock while the original loads, without being imported by the original.
        "other.ts": `import { value } from "./mod"; export const other = value;`,
        "both.ts": `export { captured } from "./side"; export { other } from "./other";`,
        "original.test.ts": `
          import { expect, test, vi } from "bun:test";
          import * as both from "./both";
          import * as mod from "./mod";
          import * as side from "./side";

          vi.mock("./mod", async importOriginal => {
            const original = await importOriginal();
            return { ...original, value: "mocked" };
          });

          test("partial mock", async () => {
            expect(mod.value).toBe("mocked");
            expect(mod.fn()).toBe("real-fn");
            expect(mod.default()).toBe("real-default");
            expect(both).toEqual({ captured: "mocked", other: "mocked" });
            expect(side.callFn()).toBe("real-fn");

            const actual = await vi.importActual("./mod");
            expect(actual.value).toBe("real");
            expect(actual.fn).toBe(mod.fn);
            expect(await vi.importActual("./mod")).toBe(actual);
            expect(globalThis.loads).toBe(1);
          });
        `,
      },
      1,
    );
  });

  test("importOriginal and vi.importActual give what an already loaded module exported before it was patched", async () => {
    await expectFixturesToPass(
      {
        ...modules,
        "original.test.ts": `
          import { expect, mock, test, vi } from "bun:test";

          test("partial mock", async () => {
            const mod = await import("./mod");
            const realFn = mod.fn;
            await vi.doMock("./mod", async importOriginal => {
              const original = await importOriginal();
              expect(original.value).toBe("real");
              return { ...original, value: "mocked", fn: () => "mocked-" + original.fn() };
            });
            expect(mod.value).toBe("mocked");
            expect(mod.fn()).toBe("mocked-real-fn");
            expect((await vi.importActual("./mod")).fn).toBe(realFn);

            // A later mock of the same module does not lose them.
            mock.module("./mod", () => ({ value: "again", usesDep: () => "again" }));
            expect([mod.value, mod.usesDep()]).toEqual(["again", "again"]);
            const actual = await vi.importActual("./mod");
            expect([actual.value, actual.fn, actual.usesDep()]).toEqual(["real", realFn, "real-dep"]);

            vi.doUnmock("./mod");
            expect([mod.value, mod.fn, mod.usesDep()]).toEqual(["real", realFn, "real-dep"]);
            expect(await import("./mod")).toBe(mod);
            expect(globalThis.loads).toBe(1);
          });

          test("a CommonJS module", async () => {
            const cjs = require("cjs-pkg");
            const realHello = cjs.hello;
            vi.doMock("cjs-pkg", () => ({ hello: () => "mocked-hello" }));
            expect(require("cjs-pkg")).not.toBe(cjs);
            expect((await vi.importActual("cjs-pkg")).hello).toBe(realHello);
            expect((await vi.importActual("cjs-pkg")).default).toBe(cjs);
            vi.doUnmock("cjs-pkg");
            expect(require("cjs-pkg")).toBe(cjs);
          });

          test("a builtin, with an export that is made on first use", async () => {
            const fs = await import("node:fs");
            const real = require("fs");
            vi.doMock("node:fs", () => ({ readFileSync: () => "mocked", ReadStream: "mocked" }));
            expect([fs.readFileSync(), fs.ReadStream]).toEqual(["mocked", "mocked"]);
            const actual = await vi.importActual("node:fs");
            expect([actual.readFileSync, actual.ReadStream]).toEqual([real.readFileSync, real.ReadStream]);
            vi.doUnmock("node:fs");
            expect([fs.readFileSync, fs.ReadStream]).toEqual([real.readFileSync, real.ReadStream]);
          });

          test("a module that is not mocked", async () => {
            expect(await vi.importActual("./dep")).toBe(await import("./dep"));
            await expect(vi.importActual("./does-not-exist")).rejects.toThrow("Cannot find module");
          });
        `,
      },
      4,
    );
  });

  test("of a builtin and of a package", async () => {
    await expectFixturesToPass(
      {
        ...modules,
        "original.test.ts": `
          import { expect, jest, test, vi } from "bun:test";
          import * as cjs from "cjs-pkg";
          import * as esm from "esm-pkg";
          import * as fs from "node:fs";

          vi.mock("node:fs", async importOriginal => ({ ...(await importOriginal()), readFileSync: vi.fn(() => "mocked") }));
          vi.mock("esm-pkg", async importOriginal => ({ ...(await importOriginal()), hello: () => "mocked-hello" }));
          vi.mock("cjs-pkg", async importOriginal => ({ ...(await importOriginal()), hello: () => "mocked-hello" }));

          test("builtin", async () => {
            expect(fs.readFileSync("x")).toBe("mocked");
            expect(fs.existsSync(import.meta.path)).toBe(true);
            expect((await import("fs")).readFileSync).toBe(fs.readFileSync);
            expect(require("fs").readFileSync).toBe(fs.readFileSync);
            expect(require("node:fs").readFileSync).toBe(fs.readFileSync);

            const actual = await vi.importActual("node:fs");
            expect(actual.readFileSync(import.meta.path, "utf8")).toContain("importOriginal");
            expect(actual.existsSync).toBe(fs.existsSync);
            expect(jest.requireActual("fs")).toBe(actual.default);
          });

          test("packages", async () => {
            expect([esm.name, esm.hello(), esm.default()]).toEqual(["esm-pkg", "mocked-hello", "real-default"]);
            expect([cjs.name, cjs.hello()]).toEqual(["cjs-pkg", "mocked-hello"]);
            expect((await vi.importActual("esm-pkg")).hello()).toBe("real-hello");
            expect((await vi.importActual("cjs-pkg")).hello()).toBe("real-hello");
          });
        `,
      },
      2,
    );
  });

  test("jest.requireActual", async () => {
    await expectFixturesToPass(
      {
        ...modules,
        "tla.ts": `await 1; export const tla = true;`,
        "original.test.ts": `
          import { expect, jest, test } from "bun:test";

          jest.mock("./mod", () => ({ ...jest.requireActual("./mod"), value: "mocked" }));
          jest.mock("cjs-fn", () => Object.assign(() => "mocked", jest.requireActual("cjs-fn")));
          jest.mock("./tla", () => ({}));

          test("in a factory, for require() and for import", async () => {
            const mod = require("./mod");
            expect([mod.value, mod.fn()]).toEqual(["mocked", "real-fn"]);
            expect((await import("./mod")).fn).toBe(mod.fn);
            expect(jest.requireActual("./mod").value).toBe("real");
            expect(globalThis.loads).toBe(1);

            expect(require("cjs-fn")()).toBe("mocked");
            expect(require("cjs-fn").extra()).toBe("real-extra");
            expect(jest.requireActual("cjs-fn")()).toBe("real-cjs-fn");
          });

          test("of a module that is not mocked", () => {
            expect(jest.requireActual("./dep")).toBe(require("./dep"));
            expect(() => jest.requireActual("./does-not-exist")).toThrow("Cannot find module");
          });

          test("does not wait for a module with top-level await", () => {
            expect(() => jest.requireActual("./tla")).toThrow("require() async module");
          });
        `,
      },
      3,
    );
  });
});

describe.concurrent("a module mocked without a factory", () => {
  test("has mocks of the original's exports", async () => {
    await expectFixturesToPass(
      {
        ...modules,
        "automock.test.ts": `
          import { expect, jest, mock, test, vi } from "bun:test";
          import * as mod from "./mod";
          import * as path from "node:path";

          vi.mock("./mod");
          jest.mock("cjs-pkg");
          jest.mock("cjs-fn");
          vi.mock("node:path");

          test("ES module", async () => {
            expect(mod.value).toBe("real");
            expect(vi.isMockFunction(mod.fn)).toBe(true);
            expect(mod.fn()).toBeUndefined();
            expect(mod.fn).toHaveBeenCalledTimes(1);
            expect(vi.isMockFunction(mod.default)).toBe(true);
            expect(vi.isMockFunction(mod.obj.nested.f)).toBe(true);
            expect(mod.obj.arr).toEqual([]);
            expect(mod.obj.n).toBe(1);
            expect(new mod.Klass().method()).toBeUndefined();
            expect(Object.keys(mod).sort()).toEqual(["Klass", "default", "fn", "obj", "usesDep", "value"]);
            expect(require("./mod").fn).toBe(mod.fn);
            expect((await vi.importActual("./mod")).fn()).toBe("real-fn");
            expect(globalThis.loads).toBe(1);
          });

          test("CommonJS module", async () => {
            // require() first: nothing waits for the original.
            const fn = require("cjs-fn");
            expect(jest.isMockFunction(fn)).toBe(true);
            expect(fn()).toBeUndefined();
            expect(jest.isMockFunction(fn.extra)).toBe(true);
            expect((await import("cjs-fn")).default).toBe(fn);

            const cjs = await import("cjs-pkg");
            expect(cjs.name).toBe("cjs-pkg");
            expect(cjs.hello()).toBeUndefined();
            expect(cjs.default.hello).toBe(cjs.hello);
            expect(require("cjs-pkg")).toBe(cjs.default);
          });

          test("builtin", async () => {
            expect(path.join("a", "b")).toBeUndefined();
            expect(path.default.join).toBe(path.join);
            expect(require("path")).toBe(path.default);
            expect(require("node:path")).toBe(path.default);
            expect(jest.requireActual("path").basename("a/b")).toBe("b");
            expect((await vi.importActual("path")).basename("a/b")).toBe("b");
          });

          test("a module that is already loaded", async () => {
            const dep = await import("./dep");
            vi.doMock("./dep");
            expect(dep.dep()).toBeUndefined();
            expect(vi.isMockFunction(dep.dep)).toBe(true);
            vi.doUnmock("./dep");
            expect(dep.dep()).toBe("real-dep");
          });

          test("mock.module() still requires a factory", () => {
            expect(() => mock.module("./dep")).toThrow("mock(module, fn) requires a function");
            expect(() => mock.module("./dep", { spy: true })).toThrow("mock(module, fn) requires a function");
            expect(() => vi.mock("./dep", 1)).toThrow("mock(module, fn) requires a function");
          });
        `,
      },
      5,
    );
  });

  test("is the file in __mocks__", async () => {
    await expectFixturesToPass(
      {
        ...modules,
        ...manualMocks,
        "manual.test.ts": `
          import { expect, test, vi } from "bun:test";
          import { scoped } from "@scope/pkg";
          import * as esm from "esm-pkg";
          import * as thing from "./sub/thing";

          vi.mock("./sub/thing");
          vi.mock("esm-pkg");
          vi.mock("cjs-fn");
          vi.mock("@scope/pkg");
          vi.mock("node:fs");

          test("next to a file", async () => {
            expect([thing.thing, thing.f(), vi.isMockFunction(thing.f)]).toEqual(["manual-thing", "manual-f", false]);
            expect(require("./sub/thing").f).toBe(thing.f);
            expect((await vi.importActual("./sub/thing")).thing).toBe("real-thing");
          });

          test("in the working directory for a package or a builtin", async () => {
            expect([esm.name, esm.default()]).toEqual(["manual-esm-pkg", "manual-default"]);
            expect(require("cjs-fn")()).toBe("manual-cjs-fn");
            expect((await import("cjs-fn")).default).toBe(require("cjs-fn"));
            expect(scoped).toBe("manual-scoped");
            expect((await import("node:fs")).readFileSync("x")).toBe("manual-fs");
            expect((await import("fs")).readFileSync("x")).toBe("manual-fs");
            expect(require("fs").readFileSync("x")).toBe("manual-fs");
          });
        `,
      },
      2,
    );
  });

  test("{ spy: true } keeps the implementations, and ignores __mocks__", async () => {
    await expectFixturesToPass(
      {
        ...modules,
        ...manualMocks,
        "shared.ts": `
          export function f() { return "real-f"; }
          export const nested = { f() { return "real-nested"; } };
        `,
        "spy.test.ts": `
          import { expect, test, vi } from "bun:test";
          import * as mod from "./mod";
          import * as thing from "./sub/thing";

          vi.mock("./mod", { spy: true });
          vi.mock("./sub/thing", { spy: true });

          test("spy", () => {
            expect(mod.fn()).toBe("real-fn");
            expect(mod.fn).toHaveBeenCalledTimes(1);
            expect(mod.obj.nested.f()).toBe("real-nested");
            expect(mod.obj.arr).toEqual([1, 2, 3]);
            expect(new mod.Klass().method()).toBe("real-method");
            expect(mod.usesDep()).toBe("real-dep");

            expect(thing.f()).toBe("real-f");
            expect(vi.isMockFunction(thing.f)).toBe(true);
          });

          test("nothing is written to a module that is already loaded, or to a builtin", async () => {
            const loaded = await import("./shared");
            const { nested } = loaded;
            const realPath = require("path");
            const originals = [nested.f, realPath.win32.join];
            vi.doMock("./shared", { spy: true });
            vi.doMock("node:path", { spy: true });
            const path = await import("node:path");
            expect([loaded.f, loaded.nested.f, path.join, path.win32.join].map(vi.isMockFunction)).toEqual([true, true, true, true]);
            expect(loaded.nested.f()).toBe("real-nested");
            expect([nested.f, realPath.win32.join]).toEqual(originals);
            expect((await vi.importActual("./shared")).nested).toBe(nested);

            vi.doUnmock("./shared");
            vi.doUnmock("node:path");
            expect(loaded.nested).toBe(nested);
            expect([loaded.f, (await import("node:path")).win32.join].map(vi.isMockFunction)).toEqual([false, false]);
          });
        `,
      },
      2,
    );
  });

  test("vi.importMock, jest.requireMock and jest.createMockFromModule do not mock the module", async () => {
    await expectFixturesToPass(
      {
        ...modules,
        ...manualMocks,
        "import-mock.test.ts": `
          import { expect, jest, test, vi } from "bun:test";

          test("vi.importMock", async () => {
            const mocked = await vi.importMock("./dep");
            expect(mocked.dep()).toBeUndefined();
            expect(vi.isMockFunction(mocked.dep)).toBe(true);
            expect((await import("./dep")).dep()).toBe("real-dep");
            expect((await vi.importMock("./sub/thing")).thing).toBe("manual-thing");
            const cjs = await vi.importMock("cjs-pkg");
            expect(cjs.hello()).toBeUndefined();
            expect(cjs.default.hello).toBe(cjs.hello);

            vi.doMock("./dep", () => ({ dep: () => "factory" }));
            expect((await vi.importMock("./dep")).dep()).toBe("factory");
            vi.doUnmock("./dep");
          });

          test("jest.requireMock, jest.createMockFromModule", () => {
            expect(jest.requireMock("./dep").dep()).toBeUndefined();
            expect(require("./dep").dep()).toBe("real-dep");
            expect(jest.requireMock("./sub/thing").thing).toBe("manual-thing");
            expect(jest.createMockFromModule("./sub/thing").thing).toBe("real-thing");
            expect(jest.isMockFunction(jest.createMockFromModule("./sub/thing").f)).toBe(true);
            expect(jest.isMockFunction(jest.createMockFromModule("cjs-pkg").hello)).toBe(true);

            jest.doMock("./dep", () => ({ dep: () => "factory" }));
            expect(jest.requireMock("./dep").dep()).toBe("factory");
            expect(jest.createMockFromModule("./dep").dep()).toBeUndefined();
            jest.dontMock("./dep");
            expect(require("./dep").dep()).toBe("real-dep");
          });
        `,
      },
      2,
    );
  });
});

describe.concurrent("unmock", () => {
  test("the next import or require() of a module that was loaded as the mock loads the original", async () => {
    await expectFixturesToPass(
      {
        ...modules,
        "unmock.test.ts": `
          import { expect, jest, test, vi } from "bun:test";

          test("vi.doMock, vi.doUnmock", async () => {
            vi.doMock("./mod", () => ({ value: "mocked", fn: () => "mocked-fn" }));
            const mocked = await import("./mod");
            expect(mocked.value).toBe("mocked");
            expect((await import("./side")).captured).toBe("mocked");
            expect(globalThis.loads).toBeUndefined();

            vi.doUnmock("./mod");
            expect(mocked.value).toBe("mocked");
            const real = await import("./mod");
            expect(real.value).toBe("real");
            expect(require("./mod")).toBe(real);
            expect(globalThis.loads).toBe(1);
          });

          test("jest.doMock, jest.dontMock, jest.unmock", () => {
            jest.doMock("./dep", () => ({ dep: () => "mocked-dep" }));
            expect(require("./dep").dep()).toBe("mocked-dep");
            jest.dontMock("./dep");
            expect(require("./dep").dep()).toBe("real-dep");
            jest.doMock("./dep", () => ({ dep: () => "mocked-again" }));
            expect(require("./dep").dep()).toBe("mocked-again");
            jest.unmock("./dep");
            expect(require("./dep").dep()).toBe("real-dep");
          });

          test("vi.unmock before the module is imported", async () => {
            vi.doMock("./sub/thing", () => ({ thing: "mocked" }));
            vi.unmock("./sub/thing");
            expect((await import("./sub/thing")).thing).toBe("real-thing");
          });

          test("arguments", () => {
            expect(vi.unmock("./dep")).toBeUndefined();
            expect(() => vi.unmock()).toThrow("unmock(module) requires a module name string");
            expect(() => vi.doUnmock(1)).toThrow("unmock(module) requires a module name string");
            expect(() => vi.importActual("")).toThrow("importActual(module) requires a module name string");
            expect(() => vi.importMock(null)).toThrow("importMock(module) requires a module name string");
            expect(() => jest.requireActual({})).toThrow("requireActual(module) requires a module name string");
            expect(() => jest.requireMock()).toThrow("requireMock(module) requires a module name string");
            expect(() => jest.createMockFromModule()).toThrow("createMockFromModule(module) requires a module name string");
          });
        `,
      },
      4,
    );
  });
});

describe.concurrent("resetModules", () => {
  test("the next import or require() evaluates a module again", async () => {
    await expectFixturesToPass(
      {
        ...modules,
        "reset.test.ts": `
          import { expect, jest, test, vi } from "bun:test";

          test("vi.resetModules", async () => {
            const first = await import("./mod");
            expect(globalThis.loads).toBe(1);
            expect(vi.resetModules()).toBe(vi);
            const second = await import("./mod");
            expect(globalThis.loads).toBe(2);
            expect(second).not.toBe(first);
            expect(second.fn).not.toBe(first.fn);
            expect(first.fn()).toBe("real-fn");
            expect(require("./mod")).toBe(second);

            vi.resetModules();
            expect(require("./mod")).not.toBe(second);
            expect(globalThis.loads).toBe(3);

            const cjs = require("cjs-pkg");
            vi.resetModules();
            expect(require("cjs-pkg")).not.toBe(cjs);

            expect((await import("node:fs")).default).toBe(require("fs"));
            expect((await import("bun:test")).vi).toBe(vi);
          });

          // Its \`this\` is then the scope that holds the name, which is not for script to see.
          test("resetModules() called by a bare name returns undefined", () => {
            const [ofVi, ofJest] = [vi.resetModules, jest.resetModules];
            expect((() => [ofVi(), ofJest()])()).toEqual([undefined, undefined]);
          });

          test("mocks stay. vi.resetModules keeps their exports, jest.resetModules calls the factories again", async () => {
            vi.resetModules();
            let calls = 0;
            vi.doMock("./dep", () => ({ dep: () => "mocked-dep", call: ++calls }));
            expect((await import("./dep")).call).toBe(1);

            vi.resetModules();
            const second = await import("./dep");
            expect([second.dep(), second.call]).toEqual(["mocked-dep", 1]);
            expect((await import("./mod")).usesDep()).toBe("mocked-dep");

            expect(jest.resetModules()).toBe(jest);
            const third = await import("./dep");
            expect([third.dep(), third.call]).toEqual(["mocked-dep", 2]);
            vi.doUnmock("./dep");
          });

          test("a module that was patched in place is loaded as the mock, and its original again", async () => {
            vi.resetModules();
            const loads = globalThis.loads;
            const mod = await import("./mod");
            vi.doMock("./mod", () => ({ value: "mocked" }));
            expect(mod.value).toBe("mocked");

            vi.resetModules();
            expect(Object.keys(await import("./mod"))).toEqual(["value"]);
            expect((await vi.importActual("./mod")).value).toBe("real");
            expect(globalThis.loads).toBe(loads + 2);
            vi.doUnmock("./mod");
          });
        `,
      },
      4,
    );
  });

  test("a module that is still evaluating, and the running test file", async () => {
    await expectFixturesToPass(
      {
        ...modules,
        "slow.ts": `
          import "./mod";
          globalThis.started?.();
          await globalThis.gate;
          export const slow = true;
        `,
        "reset.test.ts": `
          import { expect, test, vi } from "bun:test";

          const started = Promise.withResolvers();
          const gate = Promise.withResolvers();
          globalThis.started = started.resolve;
          globalThis.gate = gate.promise;
          const evaluating = import("./slow");
          await started.promise;
          vi.resetModules();
          gate.resolve();
          const first = await evaluating;

          test("both finish, and the next import evaluates it again", async () => {
            expect(first.slow).toBe(true);
            const second = await import("./slow");
            expect(second.slow).toBe(true);
            expect(second).not.toBe(first);
            expect(globalThis.loads).toBe(2);
          });
        `,
      },
      1,
    );
  });
});

describe.concurrent("factories", () => {
  test("vi.hoisted calls its function", () => {
    expect(vi.hoisted(() => 42)).toBe(42);
    // @ts-expect-error
    expect(() => vi.hoisted(42)).toThrow("vi.hoisted(factory) requires a function");
  });

  test("an accessor among the exports is not called before the export is read", async () => {
    await expectFixturesToPass(
      {
        "getter.test.ts": `
          import { expect, mock, test, vi } from "bun:test";
          import * as dep from "./dep";

          const counter = vi.hoisted(() => ({ calls: 0 }));
          vi.mock("./dep", () => ({
            get flag() {
              counter.calls++;
              return later;
            },
            plain: 1,
          }));
          const later = "later";

          test("ES module", () => {
            expect(dep.plain).toBe(1);
            expect(counter.calls).toBe(0);
            expect(dep.flag).toBe("later");
            expect(counter.calls).toBe(1);
          });

          // https://github.com/oven-sh/bun/issues/9874
          test("require() gives the object the factory returned", () => {
            let state = "first";
            const exports = { get flag() { return state; }, update() { state = "second"; } };
            mock.module("./cjs", () => exports);
            const cjs = require("./cjs");
            expect(cjs).toBe(exports);
            expect(cjs.flag).toBe("first");
            cjs.update();
            expect(cjs.flag).toBe("second");
          });
        `,
      },
      2,
    );
  });

  test("a ReferenceError for a variable of the test file says that vi.mock and jest.mock are hoisted", async () => {
    await expectFixturesToPass(
      {
        "tdz.test.ts": `
          import { expect, jest, mock, test, vi } from "bun:test";

          vi.mock("./throws", () => ({ value: later }));
          jest.mock("./rejected", async () => ({ value: later }));
          vi.mock("./rejects", async () => { await Promise.resolve(); return { value: later }; });
          mock.module("./not-hoisted", () => ({ value: later }));
          vi.mock("./other-error", () => { throw new ReferenceError("other"); });

          const errors = {};
          for (const name of ["throws", "rejected", "rejects", "not-hoisted", "other-error"])
            errors[name] = await import("./" + name).catch(error => error);
          const later = "later";

          test("note", () => {
            const message = "Cannot access 'later' before initialization.";
            const note = "\\nnote: vi.mock() and jest.mock() run before the imports and the top-level variables of the file, so a factory cannot use them. Declare what it needs with vi.hoisted().";
            for (const name of ["throws", "rejected", "rejects"]) {
              expect(errors[name]).toBeInstanceOf(ReferenceError);
              expect(errors[name].message).toBe(message + note);
              expect(errors[name].stack).toContain("tdz.test.ts");
            }
            expect(errors["not-hoisted"].message).toBe(message);
            expect(errors["other-error"].message).toBe("other");
          });
        `,
      },
      1,
    );
  });

  test("the file whose import runs such a factory fails to load with the note", async () => {
    using dir = tempDir("mock-module-tdz", {
      "dep.ts": `export const value = "real";`,
      "tdz.test.ts": `
        import { test, vi } from "bun:test";
        import { value } from "./dep";
        const later = "later";
        vi.mock("./dep", () => ({ value: later }));
        test("never runs", () => value);
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toContain(
      "ReferenceError: Cannot access 'later' before initialization.\nnote: vi.mock() and jest.mock() run before the imports and the top-level variables of the file, so a factory cannot use them. Declare what it needs with vi.hoisted().",
    );
    expect(stderr).toContain(" 0 pass\n 1 fail\n 1 error\n");
    expect(exitCode).toBe(1);
  });

  test("a pending factory that fails leaves an already imported module as it was before an earlier mock patched it", async () => {
    using dir = tempDir("mock-module-pending-after-mock", {
      "a.ts": `export function a() { return "real-a"; }`,
    });
    const path = join(String(dir), "a.ts");
    const ns = await import(path);
    const real = ns.a;

    for (const fail of [() => Promise.reject(new Error("factory failed")), () => 42]) {
      mock.module(path, () => ({ a: () => "mocked-a" }));
      expect(ns.a()).toBe("mocked-a");
      const patched = mock.module(path, async () => {
        await Promise.resolve();
        return fail();
      });
      await expect(patched).rejects.toThrow();
      expect(ns.a).toBe(real);
      expect((await vi.importActual(path)).a).toBe(real);
    }
  });

  test("a factory that fails is called again by the next import", async () => {
    let calls = 0;
    mock.module("mock-module-factory-fails-once", () => {
      if (++calls === 1) throw new Error("factory failed");
      return { calls };
    });
    await expect(import("mock-module-factory-fails-once")).rejects.toThrow("factory failed");
    expect((await import("mock-module-factory-fails-once")).calls).toBe(2);
  });

  test("a pending factory promise that resolves to a non-object fails the import", async () => {
    mock.module("mock-module-resolves-to-non-object", async () => {
      await Promise.resolve();
      return 42;
    });
    await expect(import("mock-module-resolves-to-non-object")).rejects.toThrow(
      "Expected module mock to return an object",
    );
  });

  test("import() does not call the factory before it returns, require() does", async () => {
    const order: string[] = [];
    mock.module("mock-module-factory-order-import", () => (order.push("import factory"), {}));
    mock.module("mock-module-factory-order-require", () => (order.push("require factory"), {}));
    const imported = import("mock-module-factory-order-import");
    order.push("import() returned");
    require("mock-module-factory-order-require");
    order.push("require() returned");
    await imported;
    expect(order).toEqual(["import() returned", "require factory", "require() returned", "import factory"]);
  });
});

describe.concurrent("import cycles through a mocked module", () => {
  const cycle = {
    "a.ts": `import { b } from "./b"; export const a = "real-a"; export const viaB = () => b();`,
    "b.ts": `import { c } from "./c"; export const b = () => c();`,
    "c.ts": `import { a } from "./a"; export const c = () => a;`,
    "message.ts": `
      import { join } from "node:path";
      export const message =
        "Circular import: " + ["a.ts", "b.ts", "c.ts", "a.ts"].map(file => join(import.meta.dir, file)).join(" -> ") +
        "\\nThe original of a mocked module cannot be loaded while a module that imports the mock is one of the original's own imports.";
    `,
  };

  test("the original fails to load instead of never settling", async () => {
    await expectFixturesToPass(
      {
        ...cycle,
        // The modules of the cycle are loaded only for the original.
        "mock-first.test.ts": `
          import { expect, test, vi } from "bun:test";
          import { message } from "./message";
          vi.mock("./a", async importOriginal => ({ ...(await importOriginal()), a: "mocked-a" }));
          test("cycle", async () => {
            await expect(import("./a")).rejects.toThrow(message);
          });
        `,
        // Its import of the mock is already waiting when the factory asks for the original.
        "importer-first.test.ts": `
          import { expect, test, vi } from "bun:test";
          import { message } from "./message";
          vi.mock("./a", async importOriginal => ({ ...(await importOriginal()), a: "mocked-a" }));
          test("cycle", async () => {
            await expect(import("./c")).rejects.toThrow(message);
          });
        `,
        "automock.test.ts": `
          import { expect, test, vi } from "bun:test";
          import { message } from "./message";
          vi.mock("./a");
          test("cycle", async () => {
            await expect(import("./b")).rejects.toThrow(message);
          });
        `,
        // The original is already loading, and has asked for the mock, when the factory asks for it.
        "import-actual-first.test.ts": `
          import { expect, test, vi } from "bun:test";
          import { message } from "./message";
          vi.mock("./a", async importOriginal => ({ ...(await importOriginal()), a: "mocked-a" }));
          test("cycle", async () => {
            await expect(vi.importActual("./a")).rejects.toThrow(message);
          });
        `,
        "no-cycle.test.ts": `
          import { expect, test, vi } from "bun:test";
          vi.mock("./a", () => ({ a: "mocked-a" }));
          test("the factory does not wait for the original", async () => {
            const actual = await vi.importActual("./a");
            expect(actual.a).toBe("real-a");
            expect(actual.viaB()).toBe("mocked-a");
          });
        `,
      },
      5,
      ["--isolate"],
    );
  });

  test("the test file that imports the mock fails to load", async () => {
    using dir = tempDir("mock-module-cycle", {
      ...cycle,
      "cycle.test.ts": `
        import { test, vi } from "bun:test";
        import { c } from "./c";
        vi.mock("./a", async importOriginal => ({ ...(await importOriginal()), a: "mocked-a" }));
        test("never runs", () => c());
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toContain(
      "error: Circular import: " + ["a.ts", "b.ts", "c.ts", "a.ts"].map(file => join(String(dir), file)).join(" -> "),
    );
    expect(stderr).toContain(" 0 pass\n 1 fail\n 1 error\n");
    expect(exitCode).toBe(1);
  });

  test("a factory that loads a module which imports the mocked module", async () => {
    await expectFixturesToPass(
      {
        ...cycle,
        "d.ts": `import { a } from "./a"; export const d = a;`,
        "factory.test.ts": `
          import { expect, mock, test } from "bun:test";
          import { join } from "node:path";
          mock.module("./a", () => ({ a: "mocked-a", viaB: require("./b").b }));
          test("cycle", async () => {
            await expect(import("./d")).rejects.toThrow(
              'Circular import: "' + join(import.meta.dir, "a.ts") + '" is imported by a module that its own mock factory loads while it runs',
            );
          });
        `,
      },
      1,
    );
  });
});

describe.concurrent("the module mocks of a test file are undone when it ends", () => {
  const shared = {
    "mod.ts": `
      globalThis.modLoads = (globalThis.modLoads ?? 0) + 1;
      export const value = "real";
      export function fn() { return "real-fn"; }
    `,
    "importer.ts": `
      import { value, fn } from "./mod";
      globalThis.importerLoads = (globalThis.importerLoads ?? 0) + 1;
      export const captured = value;
      export const callFn = () => fn();
    `,
    "transitive.ts": `
      import { captured } from "./importer";
      export const seen = captured;
    `,
    "untouched.ts": `
      globalThis.untouchedLoads = (globalThis.untouchedLoads ?? 0) + 1;
      export const untouched = true;
    `,
    "cjs-mod.cjs": `exports.value = "real";`,
    "cjs-importer.cjs": `
      const { value } = require("./cjs-mod.cjs");
      exports.captured = value;
      exports.esm = require("./mod.ts").value;
    `,
    "cjs-transitive.cjs": `exports.seen = require("./cjs-importer.cjs").captured;`,
  };
  const mocks = `
    import { expect, test, vi } from "bun:test";
    import { callFn } from "./importer";
    import { seen } from "./transitive";
    import { untouched } from "./untouched";

    vi.mock("./mod", () => ({ value: "mocked", fn: () => "mocked-fn" }));
    vi.mock("./cjs-mod.cjs", () => ({ value: "mocked" }));

    test("mocked", () => {
      expect([seen, callFn()]).toEqual(["mocked", "mocked-fn"]);
      expect(require("./cjs-transitive.cjs").seen).toBe("mocked");
      expect(require("./cjs-importer.cjs").esm).toBe("mocked");
      expect(untouched).toBe(true);
      expect(globalThis.untouchedLoads).toBe(1);
    });
  `;
  const plain = `
    import { expect, test } from "bun:test";
    import { callFn } from "./importer";
    import { fn, value } from "./mod";
    import { seen } from "./transitive";
    import { untouched } from "./untouched";

    test("not mocked", () => {
      expect([value, fn(), seen, callFn()]).toEqual(["real", "real-fn", "real", "real-fn"]);
      expect(require("./cjs-transitive.cjs").seen).toBe("real");
      expect(require("./cjs-importer.cjs").esm).toBe("real");
      expect(untouched).toBe(true);
      expect(globalThis.untouchedLoads).toBe(1);
      expect(globalThis.modLoads).toBe(1);
    });
  `;

  test.each([
    ["mocks, plain", [mocks, plain]],
    ["plain, mocks", [plain, mocks]],
    ["mocks, plain, mocks", [mocks, plain, mocks]],
    ["plain, mocks, plain", [plain, mocks, plain]],
    ["mocks, mocks, plain", [mocks, mocks, plain]],
  ])("%s", async (_, files) => {
    await expectFixturesToPass(
      { ...shared, ...Object.fromEntries(files.map((file, i) => [`${i + 1}.test.ts`, file])) },
      files.length,
    );
  });

  test("only the modules that import a mocked module are evaluated again", async () => {
    const loads = (expected: number[]) => `
      import { expect, test } from "bun:test";
      import { seen } from "./transitive";
      import "./untouched";
      test("loads", () => {
        expect(seen).toBe("real");
        expect([globalThis.modLoads, globalThis.importerLoads, globalThis.untouchedLoads]).toEqual(${JSON.stringify(expected)});
      });
    `;
    await expectFixturesToPass(
      {
        ...shared,
        "1.test.ts": loads([1, 1, 1]),
        "2.test.ts": loads([1, 1, 1]),
        "3.test.ts": mocks,
        // Once more for the file with the mocks, and once more after it.
        "4.test.ts": loads([1, 3, 1]),
        "5.test.ts": loads([1, 3, 1]),
      },
      5,
    );
  });

  test("of a file that fails to load, and of a mock that the file removed itself", async () => {
    using dir = tempDir("mock-module-leak", {
      ...shared,
      "1.test.ts": `
        import { vi } from "bun:test";
        vi.mock("./mod", () => ({ value: "mocked", fn: () => "mocked-fn" }));
        await import("./transitive");
        throw new Error("fails to load");
      `,
      "2.test.ts": plain,
      "3.test.ts": `
        import { expect, test, vi } from "bun:test";
        test("mocked, then not", async () => {
          vi.doMock("./untouched", () => ({ untouched: "mocked" }));
          vi.doUnmock("./untouched");
          vi.resetModules();
          vi.doMock("./mod", () => ({ value: "mocked", fn: () => "mocked-fn" }));
          expect((await import("./transitive")).seen).toBe("mocked");
          vi.doUnmock("./mod");
          expect((await import("./transitive")).seen).toBe("real");
        });
      `,
      "4.test.ts": `
        import { expect, test } from "bun:test";
        import { seen } from "./transitive";
        test("not mocked", () => {
          expect(seen).toBe("real");
        });
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toContain("error: fails to load");
    expect(stderr).toContain(" 3 pass\n 1 fail\n 1 error\n");
    expect(exitCode).toBe(1);
  });

  test("the mocks of a preload stay", async () => {
    await expectFixturesToPass(
      {
        "preload.ts": `
          import { beforeAll, mock } from "bun:test";
          import { configure } from "./configured";
          configure("by the preload");
          mock.module("./mocked-by-preload", () => ({ which: "preload" }));
          mock.module("./patched-by-preload", () => ({ which: "preload" }));
          // Runs once, before the first test file.
          beforeAll(() => {
            mock.module("./mocked-by-hook", () => ({ which: "hook" }));
          });
        `,
        "mocked-by-hook.ts": `export const which = "real";`,
        "mocked-by-preload.ts": `export const which = "real";`,
        "patched-by-preload.ts": `export const which = "real";`,
        // Loaded by the preload, before it mocks what this imports.
        "configured.ts": `
          import { which } from "./patched-by-preload";
          import { dependency } from "./dependency";
          globalThis.configuredLoads = (globalThis.configuredLoads ?? 0) + 1;
          export let configuration;
          export const configure = value => { configuration = value; };
          export const patched = () => which;
          export const callDependency = () => dependency();
        `,
        "dependency.ts": `export const dependency = () => "real";`,
        "importer.ts": `
          import { which } from "./mocked-by-preload";
          export const seen = which;
        `,
        "1.test.ts": `
          import { expect, test, vi } from "bun:test";
          test("a file replaces them", async () => {
            expect((await import("./importer")).seen).toBe("preload");
            const configured = await import("./configured");
            expect(configured.patched()).toBe("preload");
            vi.doMock("./mocked-by-preload", () => ({ which: "file" }));
            vi.doMock("./patched-by-preload", () => ({ which: "file" }));
            expect((await import("./mocked-by-preload")).which).toBe("file");
            expect(configured.patched()).toBe("file");
          });
        `,
        "2.test.ts": `
          import { expect, test, vi } from "bun:test";
          test("they are back, and a file removes them", async () => {
            expect((await import("./importer")).seen).toBe("preload");
            const configured = await import("./configured");
            expect(configured.patched()).toBe("preload");
            vi.doUnmock("./mocked-by-preload");
            vi.doUnmock("./patched-by-preload");
            expect((await import("./importer")).seen).toBe("real");
            expect(configured.patched()).toBe("real");
          });
        `,
        "3.test.ts": `
          import { expect, test, vi } from "bun:test";
          vi.mock("./dependency", () => ({ dependency: () => "mocked" }));
          test("they are back, and a file mocks what a module of the preload imports", async () => {
            expect((await import("./importer")).seen).toBe("preload");
            const configured = await import("./configured");
            expect(configured.patched()).toBe("preload");
            expect(configured.callDependency()).toBe("mocked");
          });
        `,
        "4.test.ts": `
          import { expect, test } from "bun:test";
          import { callDependency, configuration, patched } from "./configured";
          test("what the preload loaded was never loaded again", async () => {
            expect((await import("./mocked-by-hook")).which).toBe("hook");
            expect([patched(), callDependency(), configuration]).toEqual(["preload", "real", "by the preload"]);
            expect(globalThis.configuredLoads).toBe(1);
          });
        `,
      },
      4,
      ["--preload", "./preload.ts"],
    );
  });
});
