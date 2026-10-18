// TODO:
// - Write tests for errors
// - Write tests for Promise
// - Write test for export * from
// - Write test for export {foo} from "./foo"
// - Write test for import {foo} from "./foo"; export {foo}

import { describe, expect, jest, mock, spyOn, test, vi } from "bun:test";
import { bunEnv, bunExe, Heap, isASAN, isDebug, tempDir } from "harness";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { default as defaultValue, fn, iCallFn, rexported, rexportedAs, variable } from "./mock-module-fixture";
import * as spyFixture from "./spymodule-fixture";

test("mock.module async", async () => {
  mock.module("i-am-async-and-mocked", async () => {
    await 42;
    await Bun.sleep(0);
    return { a: 123 };
  });

  expect((await import("i-am-async-and-mocked" as string)).a).toBe(123);
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
  expect(((await import("./re-export-fixture")) as any).default).toBe(42);
});

test("mocking a package", async () => {
  mock.module("ha-ha-ha", () => {
    return {
      wow: () => 42,
    };
  });
  const hahaha = await import("ha-ha-ha" as string);
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
  const ns = await import("mock-module-getter-throws" as string);
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

test.concurrent(
  "a vi.doMock() factory that waits for a test doesn't keep the file that imported the module from loading",
  async () => {
    await expectFixturesToPass(
      {
        "a.ts": `export const a = "real-a";`,
        "held.test.ts": `
        import { expect, test, vi } from "bun:test";
        import * as ns from "./a";

        const gate = Promise.withResolvers();
        const patched = vi.doMock("./a", async () => (await gate.promise, { a: "mocked-a" }));

        test("which lets it go", async () => {
          expect(ns.a).toBe("real-a");
          gate.resolve();
          await patched;
          expect((await import("./a")).a).toBe("mocked-a");
        });
      `,
      },
      1,
    );
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

// The assertions are inside the fixtures. `pass` makes sure every test in them actually ran.
async function expectFixturesToPass(files: Record<string, string>, pass: number, args: string[] = []) {
  using dir = tempDir("mock-module", files);
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", ...args],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
    timeout: 60_000,
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
        // Imports the mocked module while its original is still loading, but isn't a dependency of the original.
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

  test("importOriginal and vi.importActual return an already loaded module's real exports", async () => {
    await expectFixturesToPass(
      {
        ...modules,
        "original.test.ts": `
          import { expect, mock, test, vi } from "bun:test";

          test("partial mock", async () => {
            const mod = await import("./mod");
            const realFn = mod.fn;
            await mock.module("./mod", async importOriginal => {
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

  const report = {
    "report.ts": `export const title = "real report";`,
    "report.cjs": `exports.title = "real report";`,
    "opens-report.ts": `export const open = () => import("./report");`,
  };
  // Long enough for an import() that waits for nothing to settle.
  const turns = `for (let i = 0; i < 3; i++) await new Promise(done => setImmediate(done));`;

  test.each([[[]], [["--isolate"]]])("vi.importActual() neither calls the factory nor waits for it %j", async args => {
    await expectFixturesToPass(
      {
        ...report,
        "while-loading.test.ts": `
          import { expect, test, vi } from "bun:test";

          const { order, gate } = vi.hoisted(() => ({ order: [], gate: Promise.withResolvers() }));
          vi.mock("./report", async importOriginal => {
            order.push("factory called");
            const original = await importOriginal();
            await gate.promise;
            return original;
          });
          const actual = await vi.importActual("./report");
          order.push("vi.importActual() gave " + actual.title);

          test("only an import of the mocked module does", async () => {
            const imported = import("./report").then(report => void order.push("import() gave " + report.title));
            ${turns}
            order.push("gate opened");
            gate.resolve();
            await imported;
            expect(order).toEqual(["vi.importActual() gave real report", "factory called", "gate opened", "import() gave real report"]);
          });
        `,
        "in-a-test.test.ts": `
          import { expect, test, vi } from "bun:test";

          test("before and after the factory is called", async () => {
            let calls = 0;
            vi.doMock("./report", async importOriginal => (calls++, { ...(await importOriginal()), title: "mock" }));
            const actual = await vi.importActual("./report");
            expect([actual.title, calls]).toEqual(["real report", 0]);
            expect(await vi.importActual("./report")).toBe(actual);
            expect([(await import("./report")).title, calls]).toEqual(["mock", 1]);
            expect(await vi.importActual("./report")).toBe(actual);
          });
        `,
      },
      2,
      args,
    );
  });

  test.each([[[]], [["--isolate"]]])("what vi.importActual() loaded before the module was mocked %j", async args => {
    await expectFixturesToPass(
      {
        ...report,
        "stays.test.ts": `
          import { expect, mock, test, vi } from "bun:test";

          test.each([
            ["an ES module", "./report"],
            ["a CommonJS module", "./report.cjs"],
            ["a module that was mocked before", "./report"],
          ])("stays the original, and the next import calls the factory: %s", async (_, path) => {
            const actual = await vi.importActual(path);
            const factory = vi.fn(() => ({ title: "mock" }));
            vi.mock(path, factory);
            expect(factory).not.toHaveBeenCalled();
            expect([(await import(path)).title, actual.title, factory.mock.calls.length]).toEqual(["mock", "real report", 1]);
            expect(await vi.importActual(path)).toBe(actual);
            vi.doUnmock(path);
          });

          test("is patched by mock.module()", async () => {
            vi.resetModules();
            const actual = await vi.importActual("./report");
            mock.module("./report", () => ({ title: "mock" }));
            expect(actual.title).toBe("mock");
            vi.doUnmock("./report");
          });

          test("is forgotten by vi.resetModules()", async () => {
            vi.resetModules();
            await vi.importActual("./report");
            vi.resetModules();
            const imported = await import("./report");
            vi.mock("./report", () => ({ title: "mock" }));
            expect(imported.title).toBe("mock");
          });
        `,
        "shared.ts": `export const title = "real";`,
        "shared-1.test.ts": `
          import { expect, test, vi } from "bun:test";
          test("a file loads it", async () => expect((await vi.importActual("./shared")).title).toBe("real"));
        `,
        "shared-2.test.ts": `
          import { expect, test, vi } from "bun:test";
          import * as shared from "./shared";
          test("and the next file, which imports it, patches it", () => {
            vi.mock("./shared", () => ({ title: "mock" }));
            expect(shared.title).toBe("mock");
          });
        `,
        "preloaded.ts": `export const title = "real";`,
        "preload.ts": `
          import { vi } from "bun:test";
          globalThis.preloaded = await vi.importActual("./preloaded");
        `,
        "preloaded-1.test.ts": `
          import { expect, test, vi } from "bun:test";
          test("a file mocks what a preload loaded", async () => {
            vi.doMock("./preloaded", () => ({ title: "mock" }));
            expect([(await import("./preloaded")).title, preloaded.title]).toEqual(["mock", "real"]);
          });
        `,
        "preloaded-2.test.ts": `
          import { expect, test } from "bun:test";
          test("and the next file gets it back", async () => expect(await import("./preloaded")).toBe(preloaded));
        `,
        "held.test.ts": `
          import { expect, test, vi } from "bun:test";

          async function mockReport() {
            vi.resetModules();
            const actual = await vi.importActual("./report");
            const gate = Promise.withResolvers();
            const factory = vi.fn(async () => (await gate.promise, actual));
            vi.doMock("./report", factory);
            return { factory, gate, ...(await import("./opens-report")) };
          }
          await mockReport();

          test("a factory that nothing lets go doesn't keep the file from loading", async () => {
            const { factory, gate, open } = await mockReport();
            expect(factory).not.toHaveBeenCalled();
            const order = [];
            const opened = open().then(report => void order.push("import() gave " + report.title));
            ${turns}
            expect(factory).toHaveBeenCalledTimes(1);
            order.push("gate opened");
            gate.resolve();
            await opened;
            expect(order).toEqual(["gate opened", "import() gave real report"]);
          });
        `,
      },
      10,
      ["--preload", "./preload.ts", ...args],
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
            vi.mock("./dep");
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
            vi.mock("./shared", { spy: true });
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

  const written = {
    "dep.js": `export const useDep = () => "real";`,
    "importer.js": `import { useDep } from "./dep.js"; export const call = () => useDep();`,
  };

  test("writing to a mocked module changes what its importers read", async () => {
    await expectFixturesToPass(
      {
        ...written,
        "write.test.js": `
          import { expect, test, vi } from "vitest";
          const made = vi.hoisted(() => ({}));
          vi.mock("./dep.js", () => (made.exports = { useDep: () => "mocked" }));
          import { call } from "./importer.js";
          import * as namespace from "./dep.js";

          test.each([
            ["vi.importMock()", () => vi.importMock("./dep.js")],
            ["import()", () => import("./dep.js")],
            ["import * as", () => namespace],
          ])("through %s", async (_, load) => {
            const mocked = await load();
            expect(call()).toBe("mocked");
            mocked.useDep = () => "assigned";
            expect(call()).toBe("assigned");
            expect(made.exports.useDep()).toBe("assigned");
            Object.assign(mocked, { useDep: () => "Object.assign" });
            expect(call()).toBe("Object.assign");
            Object.defineProperty(mocked, "useDep", { value: () => "defined", writable: true, enumerable: true, configurable: true });
            expect(call()).toBe("defined");
            mocked.added = 1;
            expect("added" in namespace).toBe(true);
            expect(namespace.added).toBe(1);
            expect(Object.keys(namespace)).toEqual(["useDep", "added"]);
            expect(delete mocked.added).toBe(true);
            expect("added" in namespace).toBe(false);
            expect(delete mocked.useDep).toBe(true);
            expect(call).toThrow('No "useDep" export is defined on the');
            mocked.useDep = () => "mocked";
          });
        `,
      },
      3,
    );
  });

  test("a write with another receiver leaves the mock alone", async () => {
    await expectFixturesToPass(
      {
        ...written,
        "receiver.test.js": `
          import { expect, test, vi } from "vitest";
          vi.mock("./dep.js", () => ({ useDep: () => "mocked" }));
          import { call } from "./importer.js";
          import * as namespace from "./dep.js";

          test("an object that inherits from the namespace object", () => {
            const derived = Object.create(namespace);
            derived.useDep = () => "derived";
            derived.added = 1;
            expect(Object.keys(derived)).toEqual(["useDep", "added"]);
            expect(call()).toBe("mocked");
            expect("added" in namespace).toBe(false);
          });

          test("Reflect.set()", () => {
            const other = {};
            expect(Reflect.set(namespace, "useDep", () => "other", other)).toBe(true);
            expect(other.useDep()).toBe("other");
            expect(Reflect.set(namespace, "useDep", () => "primitive", 1)).toBe(false);
            expect(call()).toBe("mocked");
            expect(Reflect.set(namespace, "useDep", () => "itself", namespace)).toBe(true);
            expect(call()).toBe("itself");
          });
        `,
      },
      2,
    );
  });

  test("writes and deletes aren't cached by the JIT", async () => {
    await expectFixturesToPass(
      {
        ...written,
        "hot.test.js": `
          import { expect, test, vi } from "vitest";
          vi.mock("./dep.js", () => ({ useDep: () => "mocked" }));
          import * as namespace from "./dep.js";
          const remove = object => delete object.added;
          const write = (object, value) => { object.added = value; };

          test("in a hot loop", () => {
            for (let i = 0; i < 10_000; i++) remove(namespace);
            let wrong = 0;
            for (let i = 0; i < 10_000; i++) {
              write(namespace, i);
              if (namespace.added !== i) wrong++;
              remove(namespace);
              if ("added" in namespace) wrong++;
            }
            expect(wrong).toBe(0);
          });
        `,
      },
      1,
    );
  });

  test.each([[[]], [["--isolate"]]])("writing to a module that a preload mocked %j", async args => {
    await expectFixturesToPass(
      {
        ...written,
        "setup.js": `
          import { vi } from "vitest";
          vi.mock("./dep.js", () => ({ useDep: vi.fn(() => "from the preload") }));
        `,
        "write.test.js": `
          import { expect, test, vi } from "vitest";
          import { call } from "./importer.js";
          test("importers read the new function", async () => {
            expect(call()).toBe("from the preload");
            (await vi.importMock("./dep.js")).useDep = () => "new";
            expect(call()).toBe("new");
          });
        `,
      },
      1,
      ["--preload", "./setup.js", ...args],
    );
  });

  test("the namespace object of a module that isn't mocked stays read-only", async () => {
    await expectFixturesToPass(
      {
        ...written,
        "barrel.js": `export * from "./dep.js";`,
        "read-only.test.js": `
          import { expect, test, vi } from "vitest";
          vi.mock("./dep.js", () => ({ useDep: () => "mocked" }));
          import * as importer from "./importer.js";
          import * as barrel from "./barrel.js";
          test.each([["importer", importer, "call"], ["barrel", barrel, "useDep"]])("%s", (_, namespace, name) => {
            expect(() => { namespace[name] = 1; }).toThrow(TypeError);
            expect(() => { namespace.added = 1; }).toThrow(TypeError);
            expect(() => delete namespace[name]).toThrow(TypeError);
            expect(() => Object.defineProperty(namespace, name, { value: 1 })).toThrow(TypeError);
            expect(namespace[name]()).toBe("mocked");
          });
        `,
      },
      2,
    );
  });

  describe("a mocked package that another package imports", () => {
    const packages = {
      "node_modules/dep/package.json": `{ "name": "dep", "main": "index.js" }`,
      "node_modules/dep/index.js": `module.exports = { who: () => "real", extra: 1 };`,
      "node_modules/cjs-lib/package.json": `{ "name": "cjs-lib", "main": "index.js" }`,
      "node_modules/cjs-lib/index.js": `const dep = require("dep"); module.exports = { who: () => dep.who(), extra: dep.extra };`,
      "node_modules/esm-lib/package.json": `{ "name": "esm-lib", "type": "module", "main": "index.js" }`,
      "node_modules/esm-lib/index.js": `import dep from "dep"; export const who = () => dep.who(); export const extra = dep.extra;`,
      "own.js": `import dep from "dep"; export const who = () => dep.who();`,
    };
    const file = (api: string, mock: string, factory: string, inPackages: string) => `
      import { expect, test, ${api} } from "${api === "vi" ? "vitest" : "bun:test"}";
      ${mock}("dep", ${factory});
      import dep from "dep";
      import * as own from "./own.js";
      import cjsLib from "cjs-lib";
      import * as esmLib from "esm-lib";
      test("packages get ${inPackages}", () => {
        expect([dep.who(), own.who()]).toEqual(["mock", "mock"]);
        expect([cjsLib.who(), esmLib.who()]).toEqual(["${inPackages}", "${inPackages}"]);
        expect([cjsLib.extra, esmLib.extra]).toEqual(${inPackages === "real" ? "[1, 1]" : "[undefined, undefined]"});
      });
    `;

    test.each([[[]], [["--isolate"]]])("vi.mock() leaves it real for them, as in Vitest %j", async args => {
      await expectFixturesToPass(
        {
          ...packages,
          "sync.test.js": file("vi", "vi.mock", `() => ({ default: { who: () => "mock" } })`, "real"),
          "async.test.js": file("vi", "vi.mock", `async () => ({ default: { who: () => "mock" } })`, "real"),
        },
        2,
        args,
      );
    });

    test("jest.mock() and mock.module() mock it for them too, as in Jest", async () => {
      await expectFixturesToPass(
        {
          ...packages,
          "jest.test.js": file(
            "jest",
            "jest.mock",
            `() => ({ default: { who: () => "mock" }, who: () => "mock" })`,
            "mock",
          ),
          "mock.test.js": `
            import { expect, mock, test } from "bun:test";
            test("packages get mock", async () => {
              mock.module("dep", () => ({ default: { who: () => "mock" }, who: () => "mock" }));
              const [{ default: cjsLib }, esmLib] = await Promise.all([import("cjs-lib"), import("esm-lib")]);
              expect([cjsLib.who(), esmLib.who()]).toEqual(["mock", "mock"]);
            });
          `,
        },
        2,
        ["--isolate"],
      );
    });
  });

  test("only vi.importActual() of the mocked module itself loads the original", async () => {
    const original = `globalThis.loads = (globalThis.loads ?? 0) + 1; export const useOriginal = () => "real";`;
    const run = (factory: string, loads: number) => `
      import { expect, test, vi } from "vitest";
      vi.mock("./original.js", ${factory});
      import { useOriginal } from "./original.js";
      test("loads the original ${loads} times", () => {
        expect(useOriginal()).toBe("made");
        expect(globalThis.loads ?? 0).toBe(${loads});
      });
    `;
    await expectFixturesToPass(
      {
        "original.js": original,
        "helper.js": `export const make = () => ({ useOriginal: () => "made" });`,
        "importer.js": `import "./original.js"; export const make = () => ({ useOriginal: () => "made" });`,
        "another.test.js": run(`async () => (await vi.importActual("./helper.js")).make()`, 0),
        "builtin.test.js": run(`async () => ((await vi.importActual("node:path")), { useOriginal: () => "made" })`, 0),
        "importer.test.js": run(`async () => (await vi.importActual("./importer.js")).make()`, 1),
        "itself.test.js": run(
          `async () => ({ ...(await vi.importActual("./original.js")), useOriginal: () => "made" })`,
          1,
        ),
        "spelled.test.js": run(
          `async () => ({ ...(await vi.importActual("./sub/../original.js")), useOriginal: () => "made" })`,
          1,
        ),
        "sub/keep.js": "",
      },
      5,
      ["--isolate"],
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

  test("what vi.importMock() gives inherits from Object.prototype, the exports of a mocked module from nothing", async () => {
    await expectFixturesToPass(
      {
        ...modules,
        "prototype.test.ts": `
          import { expect, test, vi } from "bun:test";
          import * as dep from "./dep";

          vi.mock("./dep");

          test.each(["./sub/thing", "cjs-pkg"])("vi.importMock(%j)", async path => {
            const mocked = await vi.importMock(path);
            expect(Object.getPrototypeOf(mocked)).toBe(Object.prototype);
            expect(mocked.hasOwnProperty("toString")).toBe(false);
          });

          test("an ES module is still tagged as one", async () => {
            expect(Object.prototype.toString.call(await vi.importMock("./sub/thing"))).toBe("[object Module]");
          });

          test("import * as", () => {
            expect([vi.isMockFunction(dep.dep), dep.toString, "toString" in dep]).toEqual([true, undefined, false]);
          });
        `,
      },
      4,
    );
  });
});

describe.concurrent("unmock", () => {
  test.each([{}, { BUN_JSC_useDFGJIT: "0" }])(
    "an export still uninitialized when it was mocked keeps the value its module assigned later %j",
    async env => {
      using dir = tempDir("mock-module-uninitialized", {
        "late.js": `
          globalThis.reachedTheAwait();
          await globalThis.gate;
          export let late = "real";
          export const read = () => late;
        `,
        "late.test.js": `
          import { numberOfDFGCompiles } from "bun:jsc";
          import { mock, test, vi } from "bun:test";

          test("in code that no longer checks whether it has one", async () => {
            const reached = Promise.withResolvers();
            const gate = Promise.withResolvers();
            globalThis.reachedTheAwait = reached.resolve;
            globalThis.gate = gate.promise;
            const loading = import("./late.js");
            await reached.promise;
            mock.module("./late.js", () => ({ late: "mocked" }));
            gate.resolve();
            const ns = await loading;

            const readMember = () => ns.late;
            const typeofMember = () => typeof ns.late;
            for (let i = 0; i < 1_000_000 && !(numberOfDFGCompiles(readMember) && numberOfDFGCompiles(typeofMember)); i++) {
              readMember();
              typeofMember();
            }
            const all = () => [readMember(), typeofMember(), ns.read(), 0 in [ns.read()]];
            console.log(JSON.stringify(all()));
            vi.doUnmock("./late.js");
            console.log(JSON.stringify(all()));
          });
        `,
      });
      await using proc = Bun.spawn({
        cmd: [bunExe(), "test", "./late.test.js"],
        cwd: String(dir),
        env: { ...bunEnv, BUN_JSC_useConcurrentJIT: "0", ...env },
        stdout: "pipe",
        stderr: "pipe",
        timeout: 60_000,
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stdout.split("\n").slice(1, 3)).toEqual(Array(2).fill('["real","string","real",true]'));
      expect(stderr).toContain(" 1 pass\n 0 fail\n");
      expect(exitCode).toBe(0);
    },
  );

  test.each([[[]], [["--isolate"]]])("the modules that imported the mock are loaded again %j", async args => {
    await expectFixturesToPass(
      {
        ...modules,
        "importers.test.ts": `
          import { expect, test, vi } from "bun:test";
          test("vi.doUnmock", async () => {
            vi.doMock("./mod", () => ({ value: "mocked", fn: () => "mocked-fn" }));
            expect((await import("./side")).captured).toBe("mocked");
            vi.doUnmock("./mod");
            expect((await import("./side")).captured).toBe("real");
          });
        `,
      },
      1,
      args,
    );
  });

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

test("jest.mock() and friends return jest, and vi.doMock() returns a disposable", async () => {
  using dir = tempDir("mock-module-returns", {
    "a.ts": `export const a = "real-a";`,
    "b.ts": `export const b = "real-b";`,
  });
  const [a, b] = [join(String(dir), "a.ts"), join(String(dir), "b.ts")];

  expect(
    jest
      .mock(a, () => ({ a: "mocked-a" }))
      .doMock(b, () => ({ b: "mocked-b" }))
      .unmock(a)
      .dontMock(b),
  ).toBe(jest);
  expect(vi.mock(a, () => ({ a: "mocked-a" }))).toBeUndefined();
  expect(vi.unmock(a)).toBeUndefined();

  {
    using mocked = vi.doMock(a, () => ({ a: "mocked-a" }));
    expect(Object.keys(mocked)).toEqual([]);
    expect((await import(a)).a).toBe("mocked-a");
  }
  const ns = await import(a);
  expect(ns.a).toBe("real-a");

  {
    using earlier = vi.doMock(a, async () => ({ a: "mocked-a" }));
    expect((await import(a)).a).toBe("mocked-a");
    // Disposing `earlier` must not remove the later mock of the same module.
    using later = vi.doMock(a, () => ({ a: "mocked-later" }));
    earlier[Symbol.dispose]();
    expect([(await import(a)).a, ns.a]).toEqual(["mocked-later", "real-a"]);
  }
  expect(await import(a)).toBe(ns);
});

describe.concurrent("factories that import each other's modules", () => {
  const second = `vi.mock("./second", async () => ({ name: "second with " + (await import("./first")).name }));`;
  test.each([
    [
      "the second gets the mock of the first, which their importer waits for anyway",
      `vi.mock("./first", async () => (await import("./slow"), { name: "first" }));
       ${second}`,
      `(await import("./both")).names`,
      ["first", "second with first"],
    ],
    [
      "also after it has awaited something else",
      `vi.mock("./first", async () => (await import("./slow"), { name: "first" }));
       vi.mock("./second", async () => (await new Promise(setImmediate), { name: "second with " + (await import("./first")).name }));`,
      `(await import("./both")).names`,
      ["first", "second with first"],
    ],
    [
      "also through a module that it loads",
      `vi.mock("./first", async () => (await import("./slow"), { name: "first" }));
       vi.mock("./second", async () => ({ name: "second with " + (await import("./through")).name }));`,
      `(await import("./both")).names`,
      ["first", "second with first"],
    ],
    [
      "if each asks for the other's module, the one that asks last gets the original",
      `vi.mock("./first", async () => (await import("./slow"), { name: "first with " + (await import("./second")).name }));
       ${second}`,
      `(await import("./both")).names`,
      ["first with second with real first", "second with real first"],
    ],
    [
      "a factory that the other one started gets the original",
      `vi.mock("./first", async () => ({ name: "first with " + (await import("./second")).name }));
       ${second}`,
      `[(await import("./first")).name]`,
      ["first with second with real first"],
    ],
    [
      "also if each loads a module that imports the other's module",
      `vi.mock("./first", async () => ({ name: "first with " + (await import("./through-second")).name }));
       vi.mock("./second", async () => ({ name: "second with " + (await import("./through")).name }));`,
      `(await import("./both")).names`,
      ["first with second with real first", "second with real first"],
    ],
    [
      "also if they load it with vi.importActual()",
      `vi.mock("./first", async () => ({ name: "first with " + (await vi.importActual("./through-second")).name }));
       vi.mock("./second", async () => ({ name: "second with " + (await vi.importActual("./through")).name }));`,
      `(await import("./both")).names`,
      ["first with second with real first", "second with real first"],
    ],
    [
      "also in a ring of three, where one loads the original of a module whose factory is running",
      `vi.mock("./first", async () => ({ name: "first with " + (await import("./third")).name }));
       vi.mock("./second", async () => ({ name: "second with " + (await vi.importActual("./first")).third }));
       vi.mock("./third", async () => ({ name: "third with " + (await import("./through-second")).name }));`,
      `(await import("./all")).names`,
      ["first with third with second with real third", "second with real third", "third with second with real third"],
    ],
    [
      "if import() asks for each of them, the second doesn't wait for the first, and gets the original",
      `const gate = vi.hoisted(() => Promise.withResolvers());
       vi.mock("./first", async () => (await gate.promise, { name: "first" }));
       ${second}`,
      `await (async () => {
         const first = import("./first");
         const second = await import("./second");
         gate.resolve();
         return [(await first).name, second.name];
       })()`,
      ["first", "second with real first"],
    ],
  ])("%s", async (_, mocks, names, expected) => {
    await expectFixturesToPass(
      {
        "first.ts": `export const name = "real first"; export { name as third } from "./third";`,
        "second.ts": `export const name = "real second";`,
        "third.ts": `export const name = "real third";`,
        "through.ts": `export { name } from "./first";`,
        "through-second.ts": `export { name } from "./second";`,
        "all.ts": `import { name as first } from "./first"; import { name as second } from "./second"; import { name as third } from "./third"; export const names = [first, second, third];`,
        "both.ts": `import { name as first } from "./first"; import { name as second } from "./second"; export const names = [first, second];`,
        // Takes more than one turn of the event loop to load.
        "slow.ts": `import "./slower";`,
        "slower.ts": `export {};`,
        "at-once.test.ts": `
          import { expect, test, vi } from "vitest";
          ${mocks}
          test("names", async () => {
            expect(${names}).toEqual(${JSON.stringify(expected)});
          });
        `,
      },
      1,
    );
  });
});

test.concurrent("the factories that one import calls run one at a time, in the order of the imports", async () => {
  const file = `
    import { expect, test, vi } from "vitest";
    const log = vi.hoisted(() => []);
    vi.mock("./a", async () => (log.push("a starts"), await import("./slow"), log.push("a ends"), {}));
    vi.mock("./b", async () => (log.push("b starts"), await import("./plain"), log.push("b ends"), {}));
    vi.mock("./c", async () => (log.push("c starts"), await new Promise(setImmediate), log.push("c ends"), {}));
    import "./page";
    test("order", () => expect(log).toEqual(["c starts", "c ends", "b starts", "b ends", "a starts", "a ends"]));
  `;
  await expectFixturesToPass(
    {
      "a.ts": ``,
      "b.ts": ``,
      "c.ts": ``,
      "plain.ts": ``,
      "slow.ts": `import "./slower";`,
      "slower.ts": ``,
      "inner.ts": `import "./b"; import "./a";`,
      // Leads back to the module that the test file imports.
      "last.ts": `import "./page";`,
      "page.ts": `import "./c"; import "./inner"; import "./last";`,
      // With the sources in memory, the modules of the second file load in fewer turns of the event loop.
      "first.test.ts": file,
      "second.test.ts": file,
    },
    2,
    ["--isolate"],
  );
});

test.concurrent(
  "a factory isn't called before that of a module that is imported earlier but fetched later",
  async () => {
    await expectFixturesToPass(
      {
        "deep.ts": ``,
        "shallow.ts": ``,
        "inner.ts": `import "./deep";`,
        "outer.ts": `import "./inner";`,
        "page.ts": `import "./outer"; import "./shallow";`,
        "depth.test.ts": `
        import { expect, test, vi } from "vitest";
        const log = vi.hoisted(() => []);
        vi.mock("./shallow", async () => (log.push("shallow"), {}));
        vi.mock("./deep", async () => (log.push("deep"), {}));
        import "./page";
        test("order", () => expect(log).toEqual(["deep", "shallow"]));
      `,
      },
      1,
    );
  },
);

test.concurrent("the factories that a factory's import calls run in the order of that import", async () => {
  await expectFixturesToPass(
    {
      "a.ts": ``,
      "b.ts": ``,
      "first.ts": ``,
      "inner.ts": `import "./a"; import "./b";`,
      "page.ts": `import "./first"; import "./b"; import "./a";`,
      "nested-order.test.ts": `
        import { expect, test, vi } from "vitest";
        const log = vi.hoisted(() => []);
        vi.mock("./a", async () => (log.push("a"), {}));
        vi.mock("./b", async () => (log.push("b"), {}));
        vi.mock("./first", async () => (log.push("first starts"), await import("./inner"), log.push("first ends"), {}));
        import "./page";
        test("order", () => expect(log).toEqual(["first starts", "a", "b", "first ends"]));
      `,
    },
    1,
  );
});

test.concurrent("a module runs once when a factory imports it while another import() is loading it", async () => {
  // It's a race, so repeat it. Without the fix, more than a third of the 40 shared modules run twice.
  const files: Record<string, string> = {
    "count.ts": `
      export const runs = {};
      export const count = name => void (runs[name] = (runs[name] ?? 0) + 1);
    `,
  };
  let mocks = "";
  for (let i = 0; i < 40; i++) {
    files[`shared${i}.ts`] = `import { count } from "./count"; count("shared${i}");`;
    files[`inner${i}.ts`] = `import "./shared${i}";`;
    files[`page${i}.ts`] = `import "./inner${i}";`;
    files[`helper${i}.ts`] = `import "./shared${i}";`;
    files[`mocked${i}.ts`] = ``;
    files[`other${i}.ts`] = `import "./mocked${i}";`;
    mocks += `vi.mock("./mocked${i}", async () => (await import("./helper${i}"), {}));\n`;
  }
  files["once.test.ts"] = `
    import { expect, test, vi } from "vitest";
    import { runs } from "./count";
    ${mocks}
    test("every shared module ran once", async () => {
      for (let i = 0; i < 40; i++) await Promise.all([import(\`./page\${i}\`), import(\`./other\${i}\`)]);
      expect(Object.entries(runs).filter(([, times]) => times !== 1)).toEqual([]);
      expect(Object.keys(runs)).toHaveLength(40);
    });
  `;
  await expectFixturesToPass(files, 1);
});

test.concurrent("import() of a mock doesn't wait for another load's running factory", async () => {
  await expectFixturesToPass(
    {
      "waits.ts": ``,
      "opens.ts": ``,
      "page.ts": `import "./waits"; import "./opens";`,
      "direct.test.ts": `
        import { expect, test, vi } from "vitest";
        const gate = vi.hoisted(() => Promise.withResolvers());
        vi.mock("./waits", async () => (await gate.promise, { name: "waits" }));
        vi.mock("./opens", async () => (gate.resolve(), { name: "opens" }));
        test("both load", async () => {
          const [, opens] = await Promise.all([import("./page"), import("./opens")]);
          expect(opens.name).toBe("opens");
        });
      `,
    },
    1,
  );
});

test.concurrent("two import() calls that share a module don't wait for each other's factories", async () => {
  await expectFixturesToPass(
    {
      "shared.ts": `export const shared = 1;`,
      "a.ts": ``,
      "b.ts": ``,
      "uses-a.ts": `import "./shared"; export { name } from "./a";`,
      "uses-b.ts": `import "./shared"; export { name } from "./b";`,
      "together.test.ts": `
        import { expect, test, vi } from "vitest";
        const second = vi.hoisted(() => Promise.withResolvers());
        vi.mock("./a", async () => (await second.promise, { name: "mock a" }));
        vi.mock("./b", async () => (second.resolve(), { name: "mock b" }));
        test("names", async () => {
          const [a, b] = await Promise.all([import("./uses-a"), import("./uses-b")]);
          expect([a.name, b.name]).toEqual(["mock a", "mock b"]);
        });
      `,
    },
    1,
  );
});

test.concurrent("a factory that import() called doesn't hold up another load that imports its module", async () => {
  await expectFixturesToPass(
    {
      "a.ts": ``,
      "b.ts": ``,
      "uses-both.ts": `import { name as b } from "./b"; import { name as a } from "./a"; export const names = [a, b];`,
      "held.test.ts": `
        import { expect, test, vi } from "vitest";
        const second = vi.hoisted(() => Promise.withResolvers());
        vi.mock("./a", async () => (await second.promise, { name: "mock a" }));
        vi.mock("./b", async () => (second.resolve(), { name: "mock b" }));
        test("names", async () => {
          const [a, both] = await Promise.all([import("./a"), import("./uses-both")]);
          expect([a.name, both.names]).toEqual(["mock a", ["mock a", "mock b"]]);
        });
      `,
    },
    1,
  );
});

test.concurrent("a factory that another factory's import calls also waits for what that import fetches", async () => {
  await expectFixturesToPass(
    {
      "one.ts": `import { name as two } from "./two"; export const name = "real one with " + two;`,
      "two.ts": `export const name = "real two";`,
      "three.ts": `export const name = "real three";`,
      "page.ts": `import { name as one } from "./one"; import { name as three } from "./three"; export const names = [one, three];`,
      "nested.test.ts": `
        import { expect, test, vi } from "vitest";
        vi.mock("./three", async importOriginal => ({ ...(await importOriginal()), name: "three" }));
        vi.mock("./one", async () => ({ name: "one with " + (await vi.importActual("./page")).names }));
        vi.mock("./two", async () => ({ name: "two with " + (await import("./three")).name }));
        import { name } from "./one";
        test("name", () => expect(name).toBe("one with real one with two with three,three"));
      `,
    },
    1,
  );
});

test.concurrent("a factory can load a partly mocked module while another one is being loaded", async () => {
  await expectFixturesToPass(
    {
      "one.ts": `export const name = "real one"; export const kept = "kept one";`,
      "two.ts": `export const name = "real two"; export const kept = "kept two";`,
      "three.ts": `export const name = "real three";`,
      "plain.ts": `export const plain = 1;`,
      "inner.ts": `import * as one from "./one"; import * as two from "./two"; export const inner = [one.name, one.kept, two.name, two.kept];`,
      "outer.ts": `import "./plain"; import { name } from "./three"; import { inner } from "./inner"; export const names = [name, ...inner];`,
      "page.ts": `export { names } from "./outer";`,
      // With the sources in memory, the modules of the next file load in another order.
      "a-first.test.ts": `
        import { expect, test } from "vitest";
        import { names } from "./page";
        test("real", () => expect(names).toEqual(["real three", "real one", "kept one", "real two", "kept two"]));
      `,
      "b-second.test.ts": `
        import { expect, test, vi } from "vitest";
        vi.mock("./one", async importOriginal => ({ ...(await importOriginal()), name: "one" }));
        vi.mock("./two", async importOriginal => ({ ...(await importOriginal()), name: "two" }));
        vi.mock("./three", async () => ({ name: "three with " + (await import("./two")).name }));
        import { names } from "./page";
        test("mocked", () => expect(names).toEqual(["three with two", "one", "kept one", "two", "kept two"]));
      `,
    },
    2,
    ["--isolate"],
  );
});

test.concurrent(
  "a relative path is resolved beside the file of the call, also in an arrow that ends in the call",
  async () => {
    await expectFixturesToPass(
      {
        // "await" keeps this call out of tail position, so the helper's frame is the one below the arrow's.
        "helpers/run.ts": `export const run = async callback => await callback();`,
        "helpers/where.ts": `export default "beside the helper";`,
        "tests/where.ts": `export default "beside the test file";`,
        "tests/path.test.ts": `
        import { expect, test, vi } from "vitest";
        import { run } from "../helpers/run";

        test("vi.importActual()", async () => {
          expect((await run(() => vi.importActual("./where"))).default).toBe("beside the test file");
        });

        test("vi.doMock()", async () => {
          await run(() => vi.doMock("./where", () => ({ default: "mock" })));
          expect([(await import("./where")).default, (await import("../helpers/where")).default]).toEqual(["mock", "beside the helper"]);
        });
      `,
      },
      2,
    );
  },
);

test.concurrent.each(["bun:test", "vitest"])(
  "vi.doMock() from %s leaves a module that is already loaded as it is",
  async from => {
    await expectFixturesToPass(
      {
        "dep.ts": `
          globalThis.loads = (globalThis.loads ?? 0) + 1;
          export const value = "real";
          export function fn() { return "real-fn"; }
        `,
        "reader.ts": `import { value, fn } from "./dep"; export const read = () => [value, fn()];`,
        "loaded.test.ts": `
          import { afterEach, expect, test, vi } from ${JSON.stringify(from)};
          import * as dep from "./dep";
          import { read } from "./reader";

          afterEach(() => {
            vi.doUnmock("./dep");
            expect(globalThis.loads).toBe(1);
          });

          test("the next import() calls the factory", async () => {
            const factory = vi.fn(() => ({ value: "mocked", fn: () => "mocked-fn" }));
            vi.doMock("./dep", factory);
            expect(factory).not.toHaveBeenCalled();
            const mocked = await import("./dep");
            expect(await import("./dep")).toBe(mocked);
            expect(factory).toHaveBeenCalledTimes(1);
            expect([mocked.value, dep.value, read()]).toEqual(["mocked", "real", ["real", "real-fn"]]);
            expect((await import("./reader")).read).toBe(read);
          });

          test("a factory that throws fails that import()", async () => {
            vi.doMock("./dep", () => {
              throw new Error("from the factory");
            });
            await expect(import("./dep")).rejects.toThrow("from the factory");
            expect(dep.value).toBe("real");
          });

          test("mocked again", async () => {
            const first = vi.fn();
            vi.doMock("./dep", first);
            vi.doMock("./dep", () => ({ value: "second" }));
            const second = await import("./dep");
            vi.doMock("./dep", () => ({ value: "third" }));
            const third = await import("./dep");
            expect([third.value, second.value, dep.value, first.mock.calls.length]).toEqual(["third", "second", "real", 0]);
          });

          test("importOriginal, vi.importActual() and vi.doUnmock() give the loaded module", async () => {
            let original;
            vi.doMock("./dep", async importOriginal => ({ ...(original = await importOriginal()), value: "mocked" }));
            expect((await import("./dep")).value).toBe("mocked");
            expect([original.fn, (await vi.importActual("./dep")).fn]).toEqual([dep.fn, dep.fn]);
            vi.doUnmock("./dep");
            expect(await import("./dep")).toBe(dep);
          });

          test("without a factory", async () => {
            vi.doMock("./dep");
            const automock = await import("./dep");
            expect([vi.isMockFunction(automock.fn), automock.fn(), vi.isMockFunction(dep.fn)]).toEqual([true, undefined, false]);
          });

          test("disposed", async () => {
            {
              using _ = vi.doMock("./dep", () => ({ value: "mocked" }));
              expect((await import("./dep")).value).toBe("mocked");
            }
            expect(await import("./dep")).toBe(dep);
          });

          test("with { spy: true }, which spies on an instance of its own", async () => {
            vi.doMock("./dep", { spy: true });
            const spied = await import("./dep");
            expect([vi.isMockFunction(spied.fn), spied.fn(), vi.isMockFunction(dep.fn)]).toEqual([true, "real-fn", false]);
            expect(globalThis.loads).toBe(2);
            globalThis.loads = 1;
          });
        `,
      },
      7,
    );
  },
);

describe.concurrent("resetModules", () => {
  test.each([[[]], [["--isolate"]]])("vi.resetModules() keeps packages, jest.resetModules() doesn't %j", async args => {
    const counted = (name: string) => `globalThis.${name} = (globalThis.${name} ?? 0) + 1;`;
    await expectFixturesToPass(
      {
        "node_modules/esm-pkg/package.json": `{ "name": "esm-pkg", "type": "module", "main": "index.js" }`,
        "node_modules/esm-pkg/index.js": `${counted("esm")} export default {};`,
        "node_modules/cjs-pkg/package.json": `{ "name": "cjs-pkg", "main": "index.js" }`,
        "node_modules/cjs-pkg/index.js": `${counted("cjs")} module.exports = {};`,
        "own.js": `${counted("own")} export { default as esm } from "esm-pkg"; export { default as cjs } from "cjs-pkg";`,
        "reset.test.js": `
          import { expect, jest, test, vi } from "bun:test";
          import * as first from "./own.js";

          test("resetModules", async () => {
            vi.resetModules();
            const second = await import("./own.js");
            expect(second).not.toBe(first);
            expect([second.esm === first.esm, second.cjs === first.cjs]).toEqual([true, true]);
            expect((await import("esm-pkg")).default).toBe(first.esm);
            expect(require("cjs-pkg")).toBe(first.cjs);
            expect([globalThis.own, globalThis.esm, globalThis.cjs]).toEqual([2, 1, 1]);

            jest.resetModules();
            const third = await import("./own.js");
            expect([third.esm === first.esm, third.cjs === first.cjs]).toEqual([false, false]);
            expect([globalThis.own, globalThis.esm, globalThis.cjs]).toEqual([3, 2, 2]);
          });
        `,
      },
      1,
      args,
    );
  });

  test.each([[[]], [["--isolate"]]])(
    "vi.doMock() of a package that is still loaded calls the factory lazily %j",
    async args => {
      await expectFixturesToPass(
        {
          "node_modules/esm-pkg/package.json": `{ "name": "esm-pkg", "type": "module", "main": "index.js" }`,
          "node_modules/esm-pkg/index.js": `export const who = "real";`,
          "node_modules/cjs-pkg/package.json": `{ "name": "cjs-pkg", "main": "index.js" }`,
          "node_modules/cjs-pkg/index.js": `module.exports = { who: "real" };`,
          "own.js": `export const load = name => import(name).then(exports => exports.who, error => "caught " + error.message);`,
          "lazy.test.js": `
          import { beforeEach, describe, expect, test, vi } from "vitest";
          import * as esm from "esm-pkg";
          import cjs from "cjs-pkg";
          beforeEach(() => void vi.resetModules());

          describe.each(["esm-pkg", "cjs-pkg"])("%s", name => {
            test("a factory that throws", async () => {
              const factory = vi.fn(() => { throw new TypeError("from the factory"); });
              vi.doMock(name, factory);
              expect(factory).not.toHaveBeenCalled();
              expect(await (await import("./own.js")).load(name)).toContain("caught");
              expect(factory).toHaveBeenCalledTimes(1);
              vi.doUnmock(name);
            });

            test("what was imported before keeps the real package", async () => {
              vi.doMock(name, () => ({ who: "mock" }));
              expect([esm.who, cjs.who]).toEqual(["real", "real"]);
              expect(await (await import("./own.js")).load(name)).toBe("mock");
              vi.doUnmock(name);
            });
          });
        `,
        },
        4,
        args,
      );
    },
  );

  test.each([[[]], [["--isolate"]]])("a real package stays one instance while vi.doMock() mocks it %j", async args => {
    await expectFixturesToPass(
      {
        "node_modules/esm-pkg/package.json": `{ "name": "esm-pkg", "type": "module", "main": "index.js" }`,
        "node_modules/esm-pkg/index.js": `globalThis.loads.push("esm-pkg"); export const who = () => "real"; export const token = {};`,
        "node_modules/cjs-pkg/package.json": `{ "name": "cjs-pkg", "main": "index.js" }`,
        "node_modules/cjs-pkg/index.js": `globalThis.loads.push("cjs-pkg"); module.exports = { who: () => "real", token: {} };`,
        "node_modules/lib/package.json": `{ "name": "lib", "type": "module", "main": "index.js" }`,
        "node_modules/lib/index.js": `
          globalThis.loads.push("lib");
          import cjs from "cjs-pkg";
          import * as esm from "esm-pkg";
          export const read = () => [cjs.who(), esm.who(), cjs.token, esm.token];
        `,
        "own.js": `
          import cjs from "cjs-pkg";
          import * as esm from "esm-pkg";
          export const read = () => [cjs.who(), esm.who(), cjs.token, esm.token];
        `,
        "preload.js": `globalThis.loads = [];`,
        "one.test.js": `
          import { expect, test, vi } from "vitest";
          import cjs from "cjs-pkg";
          import * as esm from "esm-pkg";
          import * as lib from "lib";

          test("mocked, reset and unmocked", async () => {
            vi.doMock("cjs-pkg", async () => {
              const actual = await vi.importActual("cjs-pkg");
              return { ...actual, default: { ...actual.default, who: () => "mock" } };
            });
            vi.doMock("esm-pkg", async importOriginal => ({ ...(await importOriginal()), who: () => "mock" }));
            expect((await vi.importActual("cjs-pkg")).default).toBe(cjs);
            expect((await vi.importActual("esm-pkg")).token).toBe(esm.token);

            vi.resetModules();
            expect((await import("./own.js")).read()).toEqual(["mock", "mock", cjs.token, esm.token]);
            expect(lib.read()).toEqual(["real", "real", cjs.token, esm.token]);
            expect(await import("lib")).toBe(lib);

            vi.doUnmock("cjs-pkg");
            vi.doUnmock("esm-pkg");
            vi.resetModules();
            expect((await import("./own.js")).read()).toEqual(["real", "real", cjs.token, esm.token]);
            expect((await import("cjs-pkg")).default).toBe(cjs);
            expect(await import("lib")).toBe(lib);
            expect(globalThis.loads.toSorted()).toEqual(["cjs-pkg", "esm-pkg", "lib"]);
          });

          test("mocked without a factory", async () => {
            vi.doMock("cjs-pkg");
            vi.doMock("esm-pkg");
            const mocks = [(await import("cjs-pkg")).default.who, (await import("esm-pkg")).who];
            expect(mocks.map(who => [vi.isMockFunction(who), who()])).toEqual([[true, undefined], [true, undefined]]);
            expect([cjs.who(), esm.who()]).toEqual(["real", "real"]);
            expect(globalThis.loads.toSorted()).toEqual(["cjs-pkg", "esm-pkg", "lib"]);
          });
        `,
      },
      2,
      ["--preload=./preload.js", ...args],
    );
  });

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
            expect(require("cjs-pkg")).toBe(cjs);
            jest.resetModules();
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
            vi.mock("./mod", () => ({ value: "mocked" }));
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

  test("a TDZ ReferenceError from a hoisted factory gets a note about vi.mock() hoisting", async () => {
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
          const later = String("later");

          test("note", () => {
            const message = "Cannot access 'later' before initialization.";
            const note = "\\nnote: vi.mock() and jest.mock() are hoisted above the file's imports and top-level variables, so a factory can't use them. Declare what it needs with vi.hoisted().";
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

  test("a file whose static import runs such a factory fails to load and prints the note", async () => {
    using dir = tempDir("mock-module-tdz", {
      "dep.ts": `export const value = "real";`,
      "tdz.test.ts": `
        import { test, vi } from "bun:test";
        import { value } from "./dep";
        const later = String("later");
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
      "ReferenceError: Cannot access 'later' before initialization.\nnote: vi.mock() and jest.mock() are hoisted above the file's imports and top-level variables, so a factory can't use them. Declare what it needs with vi.hoisted().",
    );
    expect(stderr).toContain(" 0 pass\n 1 fail\n 1 error\n");
    expect(exitCode).toBe(1);
  });

  test("a pending factory that fails restores the real exports, not an earlier mock's", async () => {
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
    await expect(import("mock-module-factory-fails-once" as string)).rejects.toThrow("factory failed");
    expect((await import("mock-module-factory-fails-once" as string)).calls).toBe(2);
  });

  test("a pending factory promise that resolves to a non-object fails the import", async () => {
    mock.module("mock-module-resolves-to-non-object", async () => {
      await Promise.resolve();
      return 42;
    });
    await expect(import("mock-module-resolves-to-non-object" as string)).rejects.toThrow(
      "mock(module, fn) requires a function that returns an object",
    );
  });

  test("import() does not call the factory before it returns, require() does", async () => {
    const order: string[] = [];
    mock.module("mock-module-factory-order-import", () => (order.push("import factory"), {}));
    mock.module("mock-module-factory-order-require", () => (order.push("require factory"), {}));
    const imported = import("mock-module-factory-order-import" as string);
    order.push("import() returned");
    require("mock-module-factory-order-require");
    order.push("require() returned");
    await imported;
    expect(order).toEqual(["import() returned", "require factory", "require() returned", "import factory"]);
  });
});

describe.concurrent("a mocked module's exports are read from the object the factory returned", () => {
  const dep = {
    "dep.ts": `
      export const flag = "real-flag";
      export const plain = "real-plain";
      export function fn() { return "real-fn"; }
      export default "real-default";
    `,
    "reader.ts": `
      import def, { flag, plain, fn } from "./dep";
      import * as ns from "./dep";
      export const read = () => [flag, ns.flag, def, plain, fn()];
      export const readFlag = () => flag;
      export const member = name => ns[name];
    `,
    "named.ts": `export { flag, flag as renamed, default as def, fn } from "./dep";`,
    "star.ts": `export * from "./dep";`,
  };

  test("every time, through every kind of import", async () => {
    await expectFixturesToPass(
      {
        ...dep,
        "getters.test.ts": `
          import { expect, test, vi } from "bun:test";
          import def, { flag } from "./dep";
          import * as ns from "./dep";
          import { read } from "./reader";
          import { flag as viaNamed, renamed, def as viaNamedDefault } from "./named";
          import * as named from "./named";
          import { flag as viaStar } from "./star";
          import * as star from "./star";

          const state = vi.hoisted(() => ({ value: "first", receivers: [] }));
          vi.mock("./dep", () => {
            const exports = {
              get flag() {
                state.receivers.push(this === exports);
                return state.value;
              },
              get default() {
                return "default-" + state.value;
              },
              get later() {
                return declaredBelow;
              },
              get thrower() {
                throw new Error("thrown for " + state.value);
              },
              plain: "mocked-plain",
              fn: () => "mocked-fn",
            };
            return exports;
          });
          const declaredBelow = "declared below";

          const all = () => ({
            flags: [flag, ns.flag, viaNamed, renamed, named.flag, viaStar, star.flag],
            defaults: [def, ns.default, viaNamedDefault, named.def],
            reader: read(),
          });

          test.each(["first", "second", "third"])("%s", value => {
            state.value = value;
            expect(all()).toEqual({
              flags: Array(7).fill(value),
              defaults: Array(4).fill("default-" + value),
              reader: [value, value, "default-" + value, "mocked-plain", "mocked-fn"],
            });
            expect(() => ns.thrower).toThrow("thrown for " + value);
          });

          test("a getter is called on the object it is a property of, and not before the export is read", () => {
            expect(state.receivers).not.toContain(false);
            expect(ns.later).toBe("declared below");
          });

          test("listing the exports calls no getter", () => {
            const calls = state.receivers.length;
            expect(Object.keys(ns)).toEqual(["flag", "default", "later", "thrower", "plain", "fn"]);
            expect("flag" in ns).toBe(true);
            expect(state.receivers.length).toBe(calls);
          });
        `,
      },
      5,
    );
  });

  test("in hot code, before and after the module is mocked", async () => {
    await expectFixturesToPass(
      {
        ...dep,
        "hot.test.ts": `
          import { expect, test, vi } from "bun:test";

          function readManyTimes(read, expected) {
            let different = 0;
            for (let i = 0; i < ${isDebug || isASAN ? 10_000 : 100_000}; i++) if (read() !== expected) different++;
            return different;
          }

          test("the same source, linked to a variable, to a getter, and to a variable again", async () => {
            const real = await import("./reader");
            expect(readManyTimes(real.readFlag, "real-flag")).toBe(0);

            let value = "mocked";
            vi.resetModules();
            vi.doMock("./dep", () => ({ get flag() { return value; } }));
            const mocked = await import("./reader");
            expect(mocked).not.toBe(real);
            expect(readManyTimes(mocked.readFlag, "mocked")).toBe(0);
            value = "changed";
            expect(readManyTimes(mocked.readFlag, "changed")).toBe(0);
            expect(readManyTimes(real.readFlag, "real-flag")).toBe(0);

            vi.doUnmock("./dep");
            vi.resetModules();
            expect(readManyTimes((await import("./reader")).readFlag, "real-flag")).toBe(0);
            expect(readManyTimes(mocked.readFlag, "changed")).toBe(0);
          });
        `,
      },
      1,
    );
  });

  for (const args of [[], ["--isolate"]]) {
    test(`in files that mock the same module differently ${JSON.stringify(args)}`, async () => {
      const file = (mock: string, expected: string) => `
        import { expect, test, vi } from "bun:test";
        import { readFlag } from "./reader";
        ${mock}
        test("reads", () => {
          const read = new Set();
          for (let i = 0; i < 2000; i++) read.add(readFlag());
          expect([...read]).toEqual([${expected}]);
        });
      `;
      await expectFixturesToPass(
        {
          ...dep,
          "1.test.ts": file(`vi.mock("./dep", () => ({ get flag() { return "getter"; } }));`, `"getter"`),
          "2.test.ts": file(``, `"real-flag"`),
          "3.test.ts": file(`vi.mock("./dep", () => ({ flag: "value" }));`, `"value"`),
          "4.test.ts": file(
            `vi.mock("./dep", async importOriginal => ({ ...(await importOriginal()) }));`,
            `"real-flag"`,
          ),
          "5.test.ts": file(
            `vi.mock("./dep", () => ({ get flag() { return "another getter"; } }));`,
            `"another getter"`,
          ),
          "6.test.ts": file(``, `"real-flag"`),
        },
        6,
        args,
      );
    });
  }

  test("mocking the module again updates every binding linked to it", async () => {
    await expectFixturesToPass(
      {
        ...dep,
        "again.test.ts": `
          import { expect, mock, test, vi } from "bun:test";
          import * as ns from "./dep";
          import { read, member } from "./reader";
          import { fn as viaStar } from "./star";

          vi.mock("./dep", () => ({ flag: "one", default: "one", plain: "one", fn: () => "one" }));

          test("at once, or when the promise of the factory settles", async () => {
            expect(read()).toEqual(["one", "one", "one", "one", "one"]);

            vi.mock("./dep", () => ({ flag: "two", default: "two", plain: "two", fn: () => "two", added: "added" }));
            expect(read()).toEqual(["two", "two", "two", "two", "two"]);
            expect([member("added"), viaStar(), Object.keys(ns)]).toEqual(["added", "two", ["flag", "default", "plain", "fn", "added"]]);

            const patched = vi.mock("./dep", async importOriginal => ({ ...(await importOriginal()), flag: "three" }));
            expect(read()[0]).toBe("two");
            await patched;
            expect(read()).toEqual(["three", "three", "real-default", "real-plain", "real-fn"]);
            expect(() => member("added")).toThrow('No "added" export');

            vi.mock("./dep");
            await vi.waitFor(() => expect(read()).toEqual(["real-flag", "real-flag", "real-default", "real-plain", undefined]));
            expect(vi.isMockFunction(ns.fn)).toBe(true);
          });

          test("a factory that fails leaves the module not mocked", async () => {
            vi.mock("./dep", () => ({ flag: "four", fn() {} }));
            await expect(mock.module("./dep", async () => { await 0; throw new Error("failed"); })).rejects.toThrow("failed");
            expect((await import("./reader")).read()[0]).toBe("real-flag");
          });
        `,
      },
      2,
    );
  });

  test("spyOn() on the namespace object spies on the object the factory returned", async () => {
    await expectFixturesToPass(
      {
        ...dep,
        "spy.test.ts": `
          import { expect, test, vi } from "bun:test";
          import * as ns from "./dep";
          import * as star from "./star";
          import * as named from "./named";
          import { read } from "./reader";

          const exports = vi.hoisted(() => ({ get flag() { return "getter"; }, default: 0, plain: "plain", fn: () => "fn" }));
          vi.mock("./dep", () => exports);
          const descriptors = JSON.stringify(Object.getOwnPropertyDescriptors(exports)) + Object.getOwnPropertyDescriptor(exports, "flag").get;

          test.each([["its own", ns], ["that of a module with export *", star], ["that of a module with export {}", named]])("%s", (_, namespace) => {
            const spy = vi.spyOn(namespace, "fn").mockReturnValue("spied");
            expect(exports.fn).toBe(spy);
            expect([read()[4], ns.fn(), star.fn(), named.fn()]).toEqual(["spied", "spied", "spied", "spied"]);
            expect(spy).toHaveBeenCalledTimes(4);
            spy.mockRestore();
            expect(read()[4]).toBe("fn");
          });

          test("an accessor", () => {
            const spy = vi.spyOn(ns, "flag", "get").mockReturnValue("spied");
            expect(read().slice(0, 2)).toEqual(["spied", "spied"]);
            vi.restoreAllMocks();
            expect(read().slice(0, 2)).toEqual(["getter", "getter"]);
          });

          test("every property is back as it was", () => {
            expect(JSON.stringify(Object.getOwnPropertyDescriptors(exports)) + Object.getOwnPropertyDescriptor(exports, "flag").get).toBe(descriptors);
          });
        `,
      },
      5,
    );
  });
});

describe.concurrent("a factory that returns a module namespace object", () => {
  const files = {
    "a.ts": `export const a = "real-a";`,
    "b.ts": `export const b = "real-b";`,
    "star.ts": `export * from "./a";`,
    "named.ts": `export { a } from "./a";`,
    "star-of-star.ts": `export * from "./star";`,
  };

  test("of a mocked module reuses that mock's current exports object", async () => {
    await expectFixturesToPass(
      {
        ...files,
        "itself.test.ts": `
          import { expect, mock, test } from "bun:test";
          test("of the module it mocks", async () => {
            mock.module("./a", () => ({ a: "first" }));
            const ns = await import("./a");
            mock.module("./a", () => ns);
            expect([ns.a, "a" in ns, Object.keys(ns), delete ns.missing]).toEqual(["first", true, ["a"], true]);
            await mock.module("./a", async () => ns);
            expect({ ...ns }).toEqual({ a: "first" });
            expect(require("./a")).toBe(ns);
          });
        `,
        "each-other.test.ts": `
          import { expect, mock, test } from "bun:test";
          test("of two modules, each the other's", async () => {
            mock.module("./a", () => ({ a: "first-a" }));
            mock.module("./b", () => ({ b: "first-b" }));
            const [a, b] = [await import("./a"), await import("./b")];
            mock.module("./a", () => b);
            mock.module("./b", () => a);
            expect([{ ...a }, { ...b }]).toEqual([{ b: "first-b" }, { b: "first-b" }]);
          });
        `,
      },
      2,
      ["--isolate"],
    );
  });

  test("of a module that re-exports the mocked module fails", async () => {
    await expectFixturesToPass(
      {
        ...files,
        "re-exports.test.ts": `
          import { expect, mock, test, vi } from "bun:test";
          const message = "mock(module, fn): the factory can't return the namespace object of a module that re-exports the mocked module";

          test.each(["./star", "./named", "./star-of-star"])("%s", async specifier => {
            mock.module("./a", () => ({ a: "first" }));
            const [ns, reexports] = [await import("./a"), await import(specifier)];
            expect(() => mock.module("./a", () => reexports)).toThrow(new TypeError(message));
            expect(ns.a).toBe("first");
            await expect(mock.module("./a", async () => (await 0, reexports))).rejects.toThrow(new TypeError(message));
            vi.resetModules();
          });

          test("through another mock", async () => {
            mock.module("./a", () => ({ a: "first" }));
            const star = await import("./star");
            mock.module("./b", () => star);
            const b = await import("./b");
            expect(b.a).toBe("first");
            expect(() => mock.module("./a", () => b)).toThrow(new TypeError(message));
          });
        `,
      },
      4,
    );
  });

  test("an object inheriting from the mocked module's namespace throws RangeError on read and on assignment", async () => {
    await expectFixturesToPass(
      {
        ...files,
        "inherits.test.ts": `
          import { expect, mock, test } from "bun:test";
          test("an object that inherits from the namespace object", async () => {
            mock.module("./a", () => ({ a: "first" }));
            const ns = await import("./a");
            mock.module("./a", () => Object.create(ns));
            expect(() => ns.a).toThrow(RangeError);
            expect(() => "a" in ns).toThrow(RangeError);
            expect(() => { ns.a = 1; }).toThrow(RangeError);
            expect(() => Reflect.set(ns, "a", 1)).toThrow(RangeError);
            expect(() => Object.assign(ns, { a: 1 })).toThrow(RangeError);
            expect(delete ns.a).toBe(true);
            expect(Object.keys(ns)).toEqual([]);
            Object.defineProperty(ns, "a", { value: 2, writable: true, enumerable: true, configurable: true });
            expect(ns.a).toBe(2);
          });
        `,
      },
      1,
    );
  });

  test("user code can't import the internal module that calls importOriginal factories", async () => {
    await expectFixturesToPass(
      {
        "a.ts": `
          export const a = "real-a";
          export const importByKey = () => import("\\0bun:module-mock");
        `,
        "static.ts": `import evaluate from "\\0bun:module-mock"; export { evaluate };`,
        "reach.test.ts": `
          import { expect, test, vi } from "bun:test";
          import * as ns from "./a";
          vi.mock("./a", async importOriginal => ({ ...(await importOriginal()), a: "mocked-a" }));

          test("for a module that is not one of those mocks", async () => {
            await expect(import("\\0bun:module-mock")).rejects.toThrow("Cannot find");
            await expect(import("./static")).rejects.toThrow("Cannot find");
          });

          test("and for the original of one, which an import() names like the mock", async () => {
            await expect(ns.importByKey()).rejects.toThrow("Cannot find");
          });
        `,
      },
      2,
    );
  });
});

describe.concurrent("a mock behind a barrel", () => {
  test.each([
    ["a sync factory", `() => ({ x: "mocked", own: "mocked" })`, "mocked"],
    ["an async factory", `async () => ({ x: "mocked", own: "mocked" })`, "mocked"],
    ["importOriginal", `async importOriginal => ({ ...(await importOriginal()), x: "mocked" })`, "real"],
  ])("a name from a mock and from another export * isn't ambiguous, with %s", async (_, factory, own) => {
    await expectFixturesToPass(
      {
        "leaf.ts": `export const x = "real";`,
        "barrel.ts": `export * from "./leaf"; export const own = "real";`,
        "leaf-first.ts": `export * from "./leaf"; export * from "./barrel";`,
        "barrel-first.ts": `export * from "./barrel"; export * from "./leaf";`,
        "bindings.ts": `
          import { x as leafFirst, own } from "./leaf-first";
          import { x as barrelFirst } from "./barrel-first";
          export const seen = () => [leafFirst, barrelFirst, own];
        `,
        "order.test.ts": `
          import { expect, test, vi } from "vitest";
          import { seen } from "./bindings";
          import * as leafFirst from "./leaf-first";
          import * as barrelFirst from "./barrel-first";
          vi.mock("./barrel", ${factory});
          test("the first export * that has it wins", () => {
            expect(seen()).toEqual(["real", "mocked", "${own}"]);
            expect([{ ...leafFirst }, { ...barrelFirst }]).toEqual([{ x: "real", own: "${own}" }, { x: "mocked", own: "${own}" }]);
          });
        `,
      },
      1,
    );
  });

  test.each([
    ["a sync factory", `() => ({ a: "mocked" })`],
    ["an async factory", `async () => ({ a: "mocked" })`],
    ["importOriginal", `async importOriginal => ({ a: "mocked", own: (await importOriginal()).own })`],
  ])("a name the factory didn't return can be imported from a barrel, with %s", async (_, factory) => {
    await expectFixturesToPass(
      {
        "leaf.ts": `export const a = "real"; export const missing = "real";`,
        "barrel.ts": `export * from "./leaf"; export const own = "own";`,
        "outer.ts": `export * from "./barrel";`,
        "bindings.ts": `
          import { a, missing, own } from "./barrel";
          import { missing as outer } from "./outer";
          export const seen = () => [a, missing, own, outer];
        `,
        "barrel.test.ts": `
          import { expect, test, vi } from "vitest";
          import { seen } from "./bindings";
          import * as barrel from "./barrel";
          vi.mock("./leaf", ${factory});
          test("and is undefined", () => {
            expect(seen()).toEqual(["mocked", undefined, "own", undefined]);
            expect(barrel.missing).toBeUndefined();
          });
        `,
      },
      1,
    );
  });

  test("a name the factory didn't return is undefined through a re-export", async () => {
    await expectFixturesToPass(
      {
        "a.ts": `export const a = "real-a"; export const missing = "real";`,
        "named.ts": `export { missing, missing as renamed } from "./a";`,
        "star.ts": `export * from "./named";`,
        "bindings.ts": `
          import { missing as direct } from "./a";
          import { missing as reexported } from "./named";
          import { renamed } from "./star";
          export const readDirect = () => direct;
          export const readReexported = () => [reexported, renamed];
        `,
        "missing.test.ts": `
          import { expect, test, vi } from "vitest";
          import * as named from "./named";
          import * as star from "./star";
          import { readDirect, readReexported } from "./bindings";
          vi.mock("./a", () => ({ a: "mocked-a" }));
          test("and only throws when it's imported from the mock itself", () => {
            expect(readReexported()).toEqual([undefined, undefined]);
            expect([Object.keys(named), Object.keys(star)]).toEqual([["missing", "renamed"], ["missing", "renamed"]]);
            expect([{ ...named }, { ...star }]).toEqual(Array(2).fill({ missing: undefined, renamed: undefined }));
            expect(readDirect).toThrow('No "missing" export is defined on the');
          });
        `,
      },
      1,
    );
  });
});

describe.concurrent("an export the factory did not return", () => {
  const files = {
    "dep.ts": `export const a = "real-a"; export const b = "real-b"; export default "real-default";`,
    "user.ts": `
      import def, { a, b } from "./dep";
      export const readA = () => a;
      export const readB = () => b;
      export const readDefault = () => def;
      export const typeofB = () => typeof b;
    `,
    "named.ts": `export { a, b } from "./dep";`,
    "star.ts": `export * from "./dep";`,
    "user.cjs": `const { a, b } = require("./dep"); module.exports = { a, b };`,
  };

  test("throws when it is read, not when the module that imports it is loaded", async () => {
    await expectFixturesToPass(
      {
        ...files,
        "missing.test.ts": `
          import { expect, test, vi } from "bun:test";
          import * as ns from "./dep";
          import * as user from "./user";
          import * as named from "./named";
          import * as star from "./star";

          vi.mock("./dep", () => ({ a: "mocked-a" }));

          const message = name =>
            'No "' + name + '" export is defined on the mock of "./dep". Did you forget to return it from the vi.mock() factory?\\n' +
            "To keep the exports of the original module, spread them:\\n\\n" +
            'vi.mock("./dep", async importOriginal => ({\\n  ...(await importOriginal()),\\n}));\\n';

          test("read", () => {
            expect(user.readA()).toBe("mocked-a");
            expect(() => user.readB()).toThrow(new Error(message("b")));
            expect(() => user.readDefault()).toThrow(new Error(message("default")));
            expect(() => user.typeofB()).toThrow(new Error(message("b")));
            expect(() => ns.b).toThrow(new Error(message("b")));
            expect(() => ns["0"]).toThrow(new Error(message("0")));
            expect(named.b).toBeUndefined();
          });

          test("asked about", async () => {
            expect("b" in ns).toBe(false);
            expect(Object.hasOwn(ns, "b")).toBe(false);
            expect(Object.keys(ns)).toEqual(["a"]);
            expect({ ...ns }).toEqual({ a: "mocked-a" });
            expect(ns).toEqual({ a: "mocked-a" });
            expect(Bun.inspect(ns)).toBe('Module {\\n  a: "mocked-a",\\n}');
            expect(await import("./dep")).toBe(ns);
            expect([ns.then, ns.__esModule, ns[Symbol.iterator]]).toEqual([undefined, undefined, undefined]);
          });

          test("export * has the exports the factory returned", () => {
            expect([star.a, star.b, Object.keys(star)]).toEqual(["mocked-a", undefined, ["a"]]);
          });

          test("require() gives the object itself", () => {
            expect(require("./user.cjs")).toEqual({ a: "mocked-a", b: undefined });
          });
        `,
        "star-first.ts": `export * from "./dep"; export * from "./named";`,
        "named-first.ts": `export * from "./named"; export * from "./dep";`,
        "star-first-user.ts": `import { a, b } from "./star-first"; export const read = () => [a, b];`,
        "named-first-user.ts": `import { a, b } from "./named-first"; export const read = () => [a, b];`,
        "order.test.ts": `
          import { expect, test, vi } from "bun:test";
          vi.mock("./dep", () => ({ a: "mocked-a" }));
          test.each(["./star-first", "./named-first"])("export * and export {} of it next to each other: %s", async specifier => {
            const ns = await import(specifier);
            expect(ns.a).toBe("mocked-a");
            expect(ns.b).toBeUndefined();
            expect((await import(specifier + "-user")).read()).toEqual(["mocked-a", undefined]);
          });
        `,
        "names.test.ts": `
          import { expect, jest, mock, test, vi } from "bun:test";
          test("vi.doMock", async () => {
            vi.doMock("./dep", () => ({}));
            const { readA } = await import("./user");
            expect(readA).toThrow('Did you forget to return it from the vi.doMock() factory?\\nTo keep the exports of the original module, spread them:\\n\\nvi.doMock("./dep", ');
          });
          test.each([
            ["mock.module", mock.module],
            ["jest.mock", jest.mock],
            ["jest.doMock", jest.doMock],
          ])("%s: it is undefined", async (name, mockIt) => {
            mockIt("./dep", () => ({ x: 1 }));
            vi.resetModules();
            const user = await import("./user");
            expect([user.readA(), user.readB(), user.readDefault(), user.typeofB()]).toEqual([undefined, undefined, undefined, "undefined"]);
            const ns = await import("./dep");
            const { a } = ns;
            expect([a, ns.a?.(), typeof ns.a, ns.default ?? "none", JSON.stringify(ns)]).toEqual([undefined, undefined, "undefined", "none", '{"x":1}']);
          });
        `,
        "__mocks__/pkg.ts": `export const a = "manual-a";`,
        "node_modules/pkg/package.json": JSON.stringify({ name: "pkg", type: "module", main: "./index.js" }),
        "node_modules/pkg/index.js": `export const a = "real-a"; export const b = "real-b";`,
        "pkg-user.ts": `import { a, b } from "pkg"; export const read = () => [a, b];`,
        "no-factory.test.ts": `
          import { expect, test, vi } from "bun:test";
          import { read } from "./pkg-user";
          vi.mock("pkg");
          test("a file in __mocks__ is not asked to have them all", () => {
            expect(read()).toEqual(["manual-a", undefined]);
          });
        `,
      },
      11,
      ["--isolate"],
    );
  });
});

describe.concurrent("import cycles through a mocked module", () => {
  // m0 imports m1, m1 imports m2, and so on. The last one imports m0, which is the mocked module.
  function cycleOf(length: number, only?: string[]) {
    const files: Record<string, string> = {
      "log.ts": `export const order = (globalThis.order ??= []);`,
      "outside.ts": `
        import { order } from "./log";
        import { seesNext } from "./m1";
        import { name } from "./m0";
        order.push("outside");
        export const sees = () => [seesNext(), name];
      `,
      "helper.ts": `
        import { vi } from "bun:test";
        import { order } from "./log";
        export function mockFromHere() {
          vi.doMock("./m0", async importOriginal => {
            const original = await importOriginal();
            order.push("factory");
            return { ...original, name: "mock" };
          });
        }
      `,
    };
    for (let i = 0; i < length; i++) {
      files[`m${i}.ts`] = `
        import { order } from "./log";
        import { name as next, fn as nextFn } from "./m${(i + 1) % length}";
        order.push("m${i}");
        export const name = "m${i}";
        export function fn() { return "fn${i}"; }
        export const seesNext = () => [next, nextFn()];
      `;
    }

    const descending = (from: number, to: number) => Array.from({ length: from - to + 1 }, (_, i) => `m${from - i}`);
    const last = length - 1;
    const entries = {
      // The original m0 evaluates first, then the factory runs, then the module that imports the mock.
      [`m${last}`]: (factory: string[]) => [...descending(last - 1, 0), ...factory, `m${last}`],
      "m0": (factory: string[]) => [...descending(last, 0), ...factory],
      "outside": (factory: string[]) => ["m0", ...factory, ...descending(last, 1), "outside"],
    };
    const mocks = {
      importOriginal: `vi.mock("./m0", async importOriginal => {
        const original = await importOriginal();
        order.push("factory");
        return { ...original, name: "mock" };
      });`,
      importActual: `vi.mock("./m0", async () => {
        const original = await vi.importActual("./m0");
        order.push("factory");
        return { ...original, name: "mock" };
      });`,
      requireActual: `jest.mock("./m0", () => {
        order.push("factory");
        return { ...jest.requireActual("./m0"), name: "mock" };
      });`,
      automock: `vi.mock("./m0");`,
      spy: `vi.mock("./m0", { spy: true });`,
      helper: `mockFromHere();`,
    };
    for (const [entry, order] of Object.entries(entries)) {
      for (const [kind, mock] of Object.entries(mocks)) {
        if (only && !only.includes(kind)) continue;
        const hasFactory = kind !== "automock" && kind !== "spy";
        files[`${kind}-${entry}.test.ts`] = `
          import { expect, jest, test, vi } from "bun:test";
          import { order } from "./log";
          import { mockFromHere } from "./helper";
          ${mock}
          ${kind === "helper" ? `await import("./${entry}");` : `import "./${entry}";`}
          test("loads", async () => {
            expect(order).toEqual(${JSON.stringify(order(hasFactory ? ["factory"] : []))});
            const mocked = await import("./m0");
            const importer = await import("./m${last}");
            expect(importer.seesNext()).toEqual([mocked.name, mocked.fn()]);
            expect([mocked.name, mocked.fn(), vi.isMockFunction(mocked.fn)]).toEqual(${
              hasFactory ? `["mock", "fn0", false]` : kind === "spy" ? `["m0", "fn0", true]` : `["m0", undefined, true]`
            });
            const actual = await vi.importActual("./m0");
            expect([actual.name, actual.fn(), vi.isMockFunction(actual.fn), actual.seesNext()]).toEqual(["m0", "fn0", false, ["m1", "fn1"]]);
          });
        `;
      }
    }
    return files;
  }

  test.each([2, 4])("of %d modules", async length => {
    await expectFixturesToPass(cycleOf(length), 18, ["--isolate"]);
  });

  test.each(["importOriginal", "automock", "helper"])("of 20 modules: %s", async kind => {
    await expectFixturesToPass(cycleOf(20, [kind]), 3, ["--isolate"]);
  });

  test("files that share their modules", async () => {
    await expectFixturesToPass(
      Object.fromEntries(
        Object.entries(cycleOf(3)).map(([name, text]) => [name, text.replace(/expect\(order\).*\n/, "")]),
      ),
      18,
    );
  });

  test("a module of the cycle that is first loaded for the original gets the mock too", async () => {
    await expectFixturesToPass(
      {
        "a.ts": `import { seen } from "./b"; export const a = "real-a"; export const seenByB = () => seen();`,
        "b.ts": `import { a } from "./a"; export const seen = () => a;`,
        "mock-first.test.ts": `
          import { expect, test, vi } from "bun:test";
          import { a, seenByB } from "./a";
          vi.mock("./a", async importOriginal => ({ ...(await importOriginal()), a: "mocked-a" }));
          test("there is one instance of it", async () => {
            expect([a, seenByB(), (await import("./b")).seen()]).toEqual(["mocked-a", "mocked-a", "mocked-a"]);
          });
        `,
      },
      1,
    );
  });

  test("the cycle is first loaded by vi.importActual() of the mocked module", async () => {
    await expectFixturesToPass(
      {
        "a.ts": `import { seen } from "./b"; export const a = "real-a"; export const seenByB = () => seen();`,
        "b.ts": `import { a } from "./a"; export const seen = () => a;`,
        "given-the-original.test.ts": `
          import { expect, test, vi } from "bun:test";
          vi.mock("./a", async importOriginal => ({ ...(await importOriginal()), a: "mocked-a" }));
          test("the factory is called for the module that imports the mock", async () => {
            const actual = await vi.importActual("./a");
            expect([actual.a, actual.seenByB()]).toEqual(["real-a", "mocked-a"]);
            expect(await vi.importActual("./a")).toBe(actual);
          });
        `,
        "not-given-the-original.test.ts": `
          import { expect, test, vi } from "bun:test";
          vi.mock("./a", () => ({ a: "mocked-a" }));
          test("the factory is called for the module that imports the mock", async () => {
            const actual = await vi.importActual("./a");
            expect([actual.a, actual.seenByB()]).toEqual(["real-a", "mocked-a"]);
          });
        `,
      },
      2,
      ["--isolate"],
    );
  });

  test("the original re-exports a module that is not evaluated yet", async () => {
    await expectFixturesToPass(
      {
        "index.ts": `export * from "./component"; export * from "./util";`,
        "component.ts": `import { util } from "./index"; export const component = () => util();`,
        "util.ts": `export const util = () => "real-util";`,
        "given-the-original.test.ts": `
          import { expect, test, vi } from "bun:test";
          import { component } from "./component";
          import * as index from "./index";
          vi.mock("./index", async importOriginal => ({ ...(await importOriginal()), util: () => "mocked-util" }));
          test("the exports that have no value yet are undefined in what the factory is given", async () => {
            expect(component()).toBe("mocked-util");
            expect({ ...index }).toEqual({ component: undefined, util: expect.any(Function) });
            expect(Object.keys(await vi.importActual("./index"))).toEqual(["component", "util"]);
          });
        `,
        "automock.test.ts": `
          import { expect, test, vi } from "bun:test";
          import { component } from "./component";
          vi.mock("./index");
          test("they are what is mocked", () => {
            expect(component()).toBeUndefined();
          });
        `,
      },
      2,
      ["--isolate"],
    );
  });

  test("export * from the mock has the names of the original", async () => {
    await expectFixturesToPass(
      {
        "a.ts": `export const a = "real-a"; export const kept = "kept";`,
        "star.ts": `export * from "./a";`,
        "star.test.ts": `
          import { expect, test, vi } from "bun:test";
          import * as star from "./star";
          import * as ns from "./a";
          import { a, kept } from "./star";
          vi.mock("./a", async importOriginal => ({ ...(await importOriginal()), a: "mocked-a", added: "added" }));
          test("and reads them from the mock", () => {
            expect([a, kept, ns.added, star.added, Object.keys(star)]).toEqual(["mocked-a", "kept", "added", undefined, ["a", "kept"]]);
          });
          test.each(["mock", "original", "evaluate", "default"])("the module has no %s of its own", name => {
            expect(() => ns[name]).toThrow('No "' + name + '" export is defined on the mock of "./a".');
          });
        `,
      },
      5,
    );
  });

  test("the mock's exports are ready when the importer's top-level code uses them", async () => {
    await expectFixturesToPass(
      {
        "base.ts": `
          import { Derived } from "./derived";
          export class Base { who() { return "real"; } }
          export const increment = x => x + 1;
          export const makeDerived = () => new Derived();
        `,
        "derived.ts": `
          import { Base, increment } from "./base";
          export class Derived extends Base {}
          export const two = increment(1);
        `,
        "use.test.ts": `
          import { expect, test, vi } from "bun:test";
          import { Derived, two } from "./derived";
          import { makeDerived } from "./base";
          vi.mock("./base", async importOriginal => ({
            ...(await importOriginal()),
            Base: class { who() { return "mocked"; } },
            increment: x => x + 100,
          }));
          test("extends, calls", () => {
            expect([new Derived().who(), two, makeDerived() instanceof Derived]).toEqual(["mocked", 101, true]);
          });
        `,
      },
      1,
    );
  });

  test("a factory that fails", async () => {
    await expectFixturesToPass(
      {
        "a.ts": `import "./b"; export const a = "real-a";`,
        "b.ts": `import { a } from "./a"; export const seen = () => a;`,
        "fails.test.ts": `
          import { expect, test, vi } from "bun:test";
          let calls = 0;
          vi.doMock("./a", async importOriginal => {
            const original = await importOriginal();
            if (++calls === 1) throw new Error("the factory failed");
            return { ...original, a: "mocked-a" };
          });
          test("rejects the import, and is called again by the next import of the module", async () => {
            const error = await import("./b").catch(error => error);
            expect(error.message).toBe("the factory failed");
            expect(error.stack).toContain("fails.test.ts:");
            expect((await import("./a")).a).toBe("mocked-a");
            expect((await import("./b")).seen()).toBe("mocked-a");
            expect(calls).toBe(2);
          });
        `,
        "after.test.ts": `
          import { expect, test } from "bun:test";
          import { seen } from "./b";
          test("the next file is not affected", () => expect(seen()).toBe("real-a"));
        `,
      },
      2,
      ["./fails.test.ts", "./after.test.ts"],
    );
  });

  test("a factory that takes importOriginal gets the hoisting note on its TDZ error too", async () => {
    using dir = tempDir("mock-module-tdz", {
      "a.ts": `import "./b"; export const a = "real-a";`,
      "b.ts": `import { a } from "./a"; export const seen = () => a;`,
      "hoisted.test.ts": `
        import { test, vi } from "bun:test";
        import { seen } from "./b";
        const later = String("later");
        vi.mock("./a", async importOriginal => ({ ...(await importOriginal()), a: later }));
        test("never runs", () => seen());
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
      timeout: 60_000,
    });
    const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toContain(
      "ReferenceError: Cannot access 'later' before initialization.\nnote: vi.mock() and jest.mock() are hoisted above the file's imports",
    );
    expect(stderr).toContain(" 0 pass\n 1 fail\n 1 error\n");
    expect(exitCode).toBe(1);
  });

  test("require() of a module that imports the mock", async () => {
    await expectFixturesToPass(
      {
        "a.ts": `import "./b.mjs"; export const a = "real-a"; export function fn() { return "real-fn"; }`,
        "b.mjs": `import { a, fn } from "./a"; export const seen = () => [a, fn()];`,
        "require.test.ts": `
          import { expect, jest, test, vi } from "bun:test";
          import { join } from "node:path";

          test("calls a factory that does not wait", () => {
            jest.doMock("./a", () => ({ ...jest.requireActual("./a"), a: "mocked-a" }));
            expect(require("./b.mjs").seen()).toEqual(["mocked-a", "real-fn"]);
          });

          test("makes the mocks of a module without a factory", () => {
            vi.resetModules();
            vi.doMock("./a");
            expect(require("./b.mjs").seen()).toEqual(["real-a", undefined]);
          });

          test("does not wait for one that does", async () => {
            vi.resetModules();
            const { promise: settled, resolve } = Promise.withResolvers();
            vi.doMock("./a", async importOriginal => {
              const original = await importOriginal();
              queueMicrotask(resolve);
              return { ...original, a: "mocked-a" };
            });
            expect(() => require("./b.mjs")).toThrow('require() async module "' + join(import.meta.dir, "b.mjs") + '" is unsupported. use "await import()" instead.');
            await settled;
            expect((await import("./b.mjs")).seen()).toEqual(["mocked-a", "real-fn"]);
          });
        `,
      },
      3,
    );
  });
});

describe.concurrent("a module that a factory loads while it runs", () => {
  const files = {
    "log.ts": `export const order = (globalThis.order ??= []);`,
    "node_modules/pkg/package.json": JSON.stringify({ name: "pkg", type: "module", main: "./index.js" }),
    "node_modules/pkg/index.js": `(globalThis.order ??= []).push("pkg"); export const kind = "real";`,
    "uses-pkg.ts": `
      import { order } from "./log";
      import { kind } from "pkg";
      order.push("uses-pkg");
      export const sees = () => kind;
      export const helper = () => "helper";
    `,
    "mock-pkg.ts": `
      import { vi } from "bun:test";
      import { order } from "./log";
      vi.doMock("pkg", async () => {
        const actual = await vi.importActual("./uses-pkg");
        order.push("factory");
        return { kind: "mocked", helper: actual.helper(), seenByWhatTheFactoryLoaded: actual.sees() };
      });
    `,
  };

  test("gets the original of the module that is being mocked", async () => {
    await expectFixturesToPass(
      {
        ...files,
        "app.ts": `import { kind } from "pkg"; export const sees = () => kind;`,
        "only-the-factory.test.ts": `
          import { expect, test } from "bun:test";
          import { order } from "./log";
          import "./mock-pkg";
          const app = await import("./app");
          const pkg = await import("pkg");
          test("a module that nothing else has imported", async () => {
            expect(order).toEqual(["pkg", "uses-pkg", "factory"]);
            expect({ ...pkg }).toEqual({ kind: "mocked", helper: "helper", seenByWhatTheFactoryLoaded: "real" });
            expect(app.sees()).toBe("mocked");
            // That instance was the factory's own.
            expect((await import("./uses-pkg")).sees()).toBe("mocked");
            expect(order).toEqual(["pkg", "uses-pkg", "factory", "uses-pkg"]);
          });
        `,
      },
      1,
    );
  });

  test.each([
    ["before", `import { sees as other } from "./uses-pkg"; import { kind } from "pkg";`],
    ["after", `import { kind } from "pkg"; import { sees as other } from "./uses-pkg";`],
  ])("gets its own copy of a module that waits for the mock, imported %s the mock", async (_, imports) => {
    await expectFixturesToPass(
      {
        ...files,
        "app.ts": `${imports} export const sees = () => [kind, other()];`,
        "waits.test.ts": `
          import { expect, test } from "bun:test";
          import { order } from "./log";
          import "./mock-pkg";
          const app = await import("./app");
          const pkg = await import("pkg");
          test("the copy sees the original, the module itself the mock", () => {
            expect(order).toEqual(["pkg", "uses-pkg", "factory", "uses-pkg"]);
            expect({ ...pkg }).toEqual({ kind: "mocked", helper: "helper", seenByWhatTheFactoryLoaded: "real" });
            expect(app.sees()).toEqual(["mocked", "mocked"]);
          });
        `,
      },
      1,
    );
  });

  test("with import() and require()", async () => {
    await expectFixturesToPass(
      {
        "a.ts": `export const a = "real-a";`,
        "b.ts": `import { a } from "./a"; export const seen = () => a;`,
        "a.cjs": `exports.a = "real-a";`,
        "b.cjs": `const a = require("./a.cjs"); exports.seen = () => a.a;`,
        "import.test.ts": `
          import { expect, test, vi } from "bun:test";
          import * as a from "./a";
          vi.mock("./a", async () => ({ a: "mocked-a", seenInTheFactory: (await import("./b")).seen() }));
          test("import()", () => expect({ ...a }).toEqual({ a: "mocked-a", seenInTheFactory: "real-a" }));
        `,
        // Here the factory imports the same module that imported the mock.
        "importer.test.ts": `
          import { expect, test, vi } from "bun:test";
          import { seen } from "./b";
          import * as a from "./a";
          vi.mock("./a", async () => ({ a: "mocked-a", seenInTheFactory: (await import("./b")).seen() }));
          test("import()", () => expect([{ ...a }, seen()]).toEqual([{ a: "mocked-a", seenInTheFactory: "real-a" }, "mocked-a"]));
        `,
        // query.test.ts spells out what vi.importActual("./c") does.
        "c.ts": `import { seen } from "./d"; export const c = "real-c"; export const seenByD = () => seen();`,
        "d.ts": `import { c } from "./c"; export const seen = () => c;`,
        "query.test.ts": `
          import { expect, mock, test } from "bun:test";
          mock.module("./c", async () => ({ ...(await import("./c?actual")), c: "mocked-c" }));
          const d = await import("./d");
          test("import() of the original of a module in an import cycle", async () => {
            const c = await import("./c");
            expect([d.seen(), c.c, c.seenByD()]).toEqual(["mocked-c", "mocked-c", "real-c"]);
          });
        `,
        // When the factory imports "./d", the original is already evaluated and "./d" is waiting for this very factory.
        "given-the-original.test.ts": `
          import { expect, test, vi } from "bun:test";
          import { seen } from "./d";
          import * as c from "./c";
          vi.mock("./c", async importOriginal => ({
            ...(await importOriginal()),
            c: "mocked-c",
            seenInTheFactory: (await import("./d")).seen(),
          }));
          test("import() of a module of the import cycle", () => {
            expect([seen(), c.c, c.seenByD(), c.seenInTheFactory]).toEqual(["mocked-c", "mocked-c", "mocked-c", "real-c"]);
          });
        `,
        "require-esm.test.ts": `
          import { expect, mock, test } from "bun:test";
          mock.module("./a", () => ({ a: "mocked-a", seenInTheFactory: require("./b").seen() }));
          test("require() of an ES module", async () => {
            expect({ ...(await import("./a")) }).toEqual({ a: "mocked-a", seenInTheFactory: "real-a" });
          });
        `,
        "require-cjs.test.ts": `
          import { expect, jest, test } from "bun:test";
          jest.mock("./a.cjs", () => ({ a: "mocked-a", seenInTheFactory: require("./b.cjs").seen() }));
          test("require() of a CommonJS module", () => {
            expect(require("./a.cjs")).toEqual({ a: "mocked-a", seenInTheFactory: "real-a" });
          });
        `,
      },
      6,
      ["--isolate"],
    );
  });

  test("gets the original if the factory has no source file either", async () => {
    await expectFixturesToPass(
      {
        "a.ts": `export const a = "real-a";`,
        "b.ts": `import { a } from "./a"; export const seen = () => a;`,
        "mock-function.test.ts": `
          import { expect, mock, test } from "bun:test";
          mock.module("./a", mock(() => ({ a: "mocked-a", seen: require("./b").seen })));
          test("a mock function as the factory", async () => {
            const { a, seen } = await import("./a");
            expect([a, seen()]).toEqual(["mocked-a", "real-a"]);
          });
        `,
      },
      1,
    );
  });

  test("a module that re-exports the mocked module, and is re-exported next to it", async () => {
    await expectFixturesToPass(
      {
        "a.ts": `export const a = "real-a";`,
        "helper.ts": `export * from "./a"; export const helper = "helper";`,
        "both.ts": `export * from "./helper"; export * from "./a";`,
        "named.ts": `import { a, helper } from "./both"; export const seen = () => [a, helper];`,
        "both.test.ts": `
          import { expect, test, vi } from "bun:test";
          import { seen } from "./named";
          import * as both from "./both";
          vi.mock("./a", async () => ({ a: "mocked, not " + (await import("./helper")).a }));
          test("there is one binding of the name", () => {
            expect([seen(), { ...both }]).toEqual([["mocked, not real-a", "helper"], { a: "mocked, not real-a", helper: "helper" }]);
          });
        `,
      },
      1,
    );
  });

  test("a module that is loading for something else meanwhile gets the mock", async () => {
    const files: Record<string, string> = {
      "a.ts": `export const a = "real-a";`,
      "slow.ts": `await new Promise(resolve => setImmediate(resolve)); export {};`,
      "meanwhile.test.ts": `
        import { expect, test, vi } from "bun:test";
        import { seen } from "./chain0";
        vi.mock("./a", async () => {
          await import("./slow");
          return { a: "mocked-a" };
        });
        test("every one of them", () => expect(seen()).toEqual(Array(12).fill("mocked-a")));
      `,
    };
    // Each chain module is fetched only after the previous one, so some are still in flight while the factory waits.
    for (let i = 0; i < 12; i++) {
      files[`chain${i}.ts`] =
        `import { a } from "./a";` +
        (i < 11 ? `import { seen as rest } from "./chain${i + 1}";` : `const rest = () => [];`) +
        `export const seen = () => [a, ...rest()];`;
    }
    await expectFixturesToPass(files, 1);
  });
});

describe.concurrent("a test file's module mocks are undone when it ends", () => {
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
        // importer.ts reloads once for the file with the mocks and once more after it.
        "4.test.ts": loads([1, 3, 1]),
        "5.test.ts": loads([1, 3, 1]),
      },
      5,
    );
  });

  test("also when the file fails to load, or has already removed the mock itself", async () => {
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

  test("a preload's mocks are kept", async () => {
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
        // The preload loads this before mocking "./patched-by-preload", which this imports.
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
          import { expect, jest, test } from "bun:test";
          test("a file replaces them", async () => {
            expect((await import("./importer")).seen).toBe("preload");
            const configured = await import("./configured");
            expect(configured.patched()).toBe("preload");
            jest.doMock("./mocked-by-preload", () => ({ which: "file" }));
            jest.doMock("./patched-by-preload", () => ({ which: "file" }));
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
          import { expect, jest, test } from "bun:test";
          jest.mock("./dependency", () => ({ dependency: () => "mocked" }));
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

describe.concurrent("a mocked module that exports then", () => {
  const files = {
    "real.ts": `
      export const a = 1;
      export function then(resolve, reject) {
        globalThis.receivers.push(this);
        globalThis.settle(resolve, reject);
      }
    `,
    "mocked.ts": `export const a = 0;`,
    "given-the-original.ts": `export const a = 0;`,
    "namespaces.ts": `
      export * as real from "./real";
      export * as mocked from "./mocked";
      export * as givenTheOriginal from "./given-the-original";
    `,
  };
  const mocks = `
    function then(resolve, reject) {
      globalThis.receivers.push(this);
      globalThis.settle(resolve, reject);
    }
    globalThis.receivers = [];
    mock.module("./mocked", () => ({ a: 1, then }));
    vi.doMock("./given-the-original", importOriginal => ({ a: 1, then }));
  `;

  test("is a thenable for import(), like a real module that exports then", async () => {
    await expectFixturesToPass(
      {
        ...files,
        "then.test.ts": `
          import { expect, mock, test, vi } from "bun:test";
          ${mocks}

          async function outcome(promise) {
            try {
              return { fulfilled: await promise };
            } catch (error) {
              return { rejected: error };
            }
          }

          test.each([
            [resolve => resolve({ evil: 1 }), { fulfilled: { evil: 1 } }],
            [resolve => resolve("a string"), { fulfilled: "a string" }],
            [resolve => resolve(), { fulfilled: undefined }],
            [resolve => resolve({ then: resolve => resolve("from a thenable") }), { fulfilled: "from a thenable" }],
            [resolve => resolve(Promise.resolve("from a promise")), { fulfilled: "from a promise" }],
            [(resolve, reject) => reject("rejected"), { rejected: "rejected" }],
            [() => { throw "thrown"; }, { rejected: "thrown" }],
          ])("%s", async (settle, expected) => {
            globalThis.settle = settle;
            globalThis.receivers.length = 0;
            expect(await outcome(import("./real"))).toEqual(expected);
            expect(await outcome(import("./mocked"))).toEqual(expected);
            expect(await outcome(import("./given-the-original"))).toEqual(expected);

            const { real, mocked, givenTheOriginal } = await import("./namespaces");
            expect(globalThis.receivers.length).toBe(3);
            expect(globalThis.receivers[0]).toBe(real);
            expect(globalThis.receivers[1]).toBe(mocked);
            expect(globalThis.receivers[2]).toBe(givenTheOriginal);
          });
        `,
      },
      7,
    );
  });

  test("exposes it as a plain export to import statements and require()", async () => {
    await expectFixturesToPass(
      {
        ...files,
        "importer.ts": `
          import * as mocked from "./mocked";
          import { a, then } from "./mocked";
          import { then as thenOfGivenTheOriginal } from "./given-the-original";
          export const seen = { keys: Object.keys(mocked), a, then, same: mocked.then === then, thenOfGivenTheOriginal };
        `,
        "then.test.ts": `
          import { expect, mock, test, vi } from "bun:test";
          ${mocks}

          test("it is not called", async () => {
            const { seen } = await import("./importer");
            expect(seen).toEqual({ keys: ["a", "then"], a: 1, then, same: true, thenOfGivenTheOriginal: then });
            expect(require("./mocked")).toEqual({ a: 1, then });
            expect(globalThis.receivers).toEqual([]);
          });
        `,
      },
      1,
    );
  });

  test("has its `then` read only by import()", async () => {
    await expectFixturesToPass(
      {
        "sync.ts": ``,
        "pending.ts": ``,
        "namespaces.ts": `export * as pending from "./pending";`,
        "then.test.ts": `
          import { expect, mock, test } from "bun:test";

          test("a factory that returns the exports", async () => {
            let reads = 0;
            mock.module("./sync", () => ({ a: 1, get then() { reads++; } }));
            expect((await import("./sync")).a).toBe(1);
            const readsOfTheImportThatLoadsIt = reads;
            expect(readsOfTheImportThatLoadsIt).toBeGreaterThan(0);
            await import("./sync");
            expect(reads).toBe(2 * readsOfTheImportThatLoadsIt);
          });

          test("a factory that returns a promise for them, which reads it too", async () => {
            let reads = 0;
            const receivers = [];
            mock.module("./pending", async () => {
              await 0;
              return {
                get then() {
                  if (++reads === 2) return function (resolve) { receivers.push(this); resolve("the second time"); };
                },
              };
            });
            expect(await import("./pending")).toBe("the second time");
            expect(reads).toBe(2);
            expect(receivers).toEqual([(await import("./namespaces")).pending]);
          });
        `,
      },
      2,
    );
  });

  test("is unwrapped like any thenable when an async factory returns it", async () => {
    await expectFixturesToPass(
      {
        "mocked.ts": ``,
        "then.test.ts": `
          import { expect, mock, test } from "bun:test";
          test("as any promise does", async () => {
            mock.module("./mocked", async () => ({ a: 1, then: resolve => resolve({ b: 2 }) }));
            expect({ ...(await import("./mocked")) }).toEqual({ b: 2 });
          });
        `,
      },
      1,
    );
  });
});

describe.concurrent("user code can't load a module by its internal key", () => {
  const attempts = `
    export async function attempts() {
      const outcomes = [];
      for (const specifier of ["\\0bun:module-mock", "\\0\\0bun:module-mock", "\\0node:fs", "\\0/etc/hostname"]) {
        for (const load of [() => import(specifier), () => vi.importActual(specifier), () => vi.importMock(specifier), () => require(specifier)]) {
          try {
            outcomes.push(Object.keys(await load()));
          } catch (error) {
            outcomes.push(error.constructor.name);
          }
        }
      }
      return outcomes;
    }
  `;
  const refused = Array.from({ length: 4 }, () => [
    "ResolveMessage",
    "TypeError",
    "TypeError",
    "ResolveMessage",
  ]).flat();

  test("in the original of a module that is mocked", async () => {
    await expectFixturesToPass(
      {
        "mocked.ts": `import { vi } from "bun:test"; ${attempts}`,
        "key.test.ts": `
          import { expect, test, vi } from "bun:test";
          test("import()", async () => {
            vi.doMock("./mocked.ts", async importOriginal => ({ ...(await importOriginal()) }));
            expect(await (await import("./mocked.ts")).attempts()).toEqual(${JSON.stringify(refused)});
          });
        `,
      },
      1,
    );
  });

  test("in a test file that mocks itself", async () => {
    await expectFixturesToPass(
      {
        "key.test.ts": `
          import { expect, test, vi } from "bun:test";
          ${attempts}
          test("import()", async () => {
            vi.doMock(import.meta.path, async importOriginal => ({ a: 1 }));
            expect(await attempts()).toEqual(${JSON.stringify(refused)});
          });
        `,
      },
      1,
    );
  });
});

test.concurrent("a mocked module loads after require() of a module that imports one with a syntax error", async () => {
  await expectFixturesToPass(
    {
      "broken.js": `export const = ;`,
      "importer.js": `import "./broken.js"; export const y = 1;`,
      "mocked.js": `export const x = "real";`,
      "1.test.js": `
        import { expect, mock, test } from "bun:test";
        test("in the same file", async () => {
          expect(() => require("./importer.js")).toThrow();
          mock.module("./mocked.js", () => ({ x: "mock" }));
          expect((await import("./mocked.js")).x).toBe("mock");
        });
      `,
      "2.test.js": `
        import { expect, mock, test } from "bun:test";
        test("in the next file", async () => {
          mock.module("./mocked.js", () => ({ x: "mock" }));
          expect((await import("./mocked.js")).x).toBe("mock");
        });
      `,
    },
    2,
  );
});

test.concurrent("a getter of a pending factory's exports that calls Bun.plugin.clearAll() and throws", async () => {
  await expectFixturesToPass(
    {
      "mocked.js": `export const x = "real";`,
      "clears.test.js": `
        import { expect, mock, test } from "bun:test";
        test("rejects the promise of mock.module()", async () => {
          const mocked = await import("./mocked.js");
          const patched = mock.module("./mocked.js", async () => {
            await null;
            return {
              get x() {
                Bun.plugin.clearAll();
                throw new Error("from the getter");
              },
            };
          });
          expect(patched).rejects.toThrow("from the getter");
          await patched.catch(() => {});
          expect(mocked.x).toBe("real");
        });
      `,
    },
    1,
  );
});

test("a module name containing a null byte throws", () => {
  const nameless = " requires a module name without null bytes";
  for (const name of ["/tmp/a\0b.ts", "./a\0b.ts", "\0a"]) {
    expect(() => mock.module(name, () => ({}))).toThrow("mock(module, fn)" + nameless);
    expect(() => vi.doMock(name)).toThrow("mock(module, fn)" + nameless);
    expect(() => vi.doMock(name, { spy: true })).toThrow("mock(module, fn)" + nameless);
    expect(() => vi.doUnmock(name)).toThrow("unmock(module)" + nameless);
    expect(() => vi.importActual(name)).toThrow("importActual(module)" + nameless);
    expect(() => vi.importMock(name)).toThrow("importMock(module)" + nameless);
    expect(() => jest.requireActual(name)).toThrow("requireActual(module)" + nameless);
    expect(() => jest.requireMock(name)).toThrow("requireMock(module)" + nameless);
  }
  expect(() => mock.module("file:///tmp/a%00b.ts", () => ({}))).toThrow('Invalid "file:" URL');
});

test("concurrent import()s of a mocked module don't leak the global object under --isolate", async () => {
  const files: Record<string, string> = { "mocked.ts": `export const a = 0;` };
  for (let i = 0; i < 8; i++) {
    files[`${i}.test.ts`] = `
      import { mock, test } from "bun:test";
      test("imports", async () => {
        mock.module("./mocked", () => ({ a: 1 }));
        await Promise.all([import("./mocked"), import("./mocked")]);
      });
    `;
  }
  files["9.test.ts"] = `
    import { generateHeapSnapshotForDebugging } from "bun:jsc";
    import { test } from "bun:test";
    ${Heap}
    let heap;
    test("counts", async () => {
      heap = new Promise(resolve => setTimeout(() => resolve(new Heap({ followers: false })), 0));
      heap = await heap;
      const ofThisFile = "root(ProtectedValues) GlobalObject -";
      console.log(
        JSON.stringify({
          GlobalObject: heap.pathsTo("GlobalObject"),
          ModuleMock: heap.pathsTo("ModuleMock"),
          JSSourceCode: heap.pathsTo("JSSourceCode").filter(path => !path.startsWith(ofThisFile)),
        }),
      );
    });
  `;
  using dir = tempDir("mock-module-leak", files);
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--isolate"],
    cwd: String(dir),
    // An in-flight JIT compilation roots the code it's compiling, which would show up in the heap snapshot.
    env: { ...bunEnv, BUN_JSC_useConcurrentJIT: "0" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  // A leak shows up as 9 GlobalObjects and 8 ModuleMocks. A leaked JSSourceCode would keep the mock's exports alive.
  expect(JSON.parse(stdout.slice(stdout.indexOf("{")))).toEqual({
    GlobalObject: ["root(ProtectedValues) GlobalObject"],
    ModuleMock: [],
    JSSourceCode: [],
  });
  expect(stderr).toContain(" 9 pass\n 0 fail\n");
  expect(exitCode).toBe(0);
});

describe.concurrent("a module that is evicted while it is still loading", () => {
  const graph = {
    "k.js": `export const x = "real";`,
    "a.js": `import { x } from "./k.js"; export const seen = x;`,
    "b.js": `import "./root.js"; export const b = 1;`,
    "root.js": `import { seen } from "./a.js"; import "./b.js"; export { seen };`,
    "count.js": `globalThis.loads = (globalThis.loads ?? 0) + 1; export const n = globalThis.loads;`,
  };

  test("finishes loading, and the next import loads it again", async () => {
    await expectFixturesToPass(
      {
        ...graph,
        "own.test.js": `
          import { expect, jest, test, vi } from "bun:test";
          const loaders = [["import()", path => import(path)], ["require()", async path => require(path)]];
          test.each(loaders)("a factory that removes its own mock: %s", async (_, load) => {
            vi.resetModules();
            vi.doMock("./k.js", () => (vi.doUnmock("./k.js"), { x: "mock" }));
            expect((await load("./root.js")).seen).toBe("mock");
            expect((await load("./k.js")).x).toBe("real");
            expect((await load("./root.js")).seen).toBe("real");
          });
          test.each(loaders)("a factory that mocks its module again: %s", async (_, load) => {
            vi.resetModules();
            vi.doMock("./k.js", () => (vi.doMock("./k.js", () => ({ x: "second" })), { x: "first" }));
            expect((await load("./root.js")).seen).toBe("first");
            expect((await load("./k.js")).x).toBe("second");
            vi.doUnmock("./k.js");
          });
          test.each(loaders.flatMap(([name, load]) => [[name, "vi", load], [name, "jest", load]]))("a factory that resets the modules: %s, %s.resetModules()", async (_, api, load) => {
            vi.resetModules();
            globalThis.loads = 0;
            const before = await load("./count.js");
            vi.doMock("./k.js", () => {
              ({ vi, jest })[api].resetModules();
              return { x: "mock", isLoadedAgain: require("./count.js") !== before };
            });
            const root = await load("./root.js");
            expect(root.seen).toBe("mock");
            expect((await load("./k.js")).isLoadedAgain).toBe(true);
            expect(await load("./root.js")).not.toBe(root);
            expect(globalThis.loads).toBe(2);
            vi.doUnmock("./k.js");
          });
        `,
      },
      8,
    );
  });

  test("a graph with CommonJS modules and cycles that require() loads", async () => {
    using dir = tempDir("mock-module-evict", {
      "entry.js": `import "./one.js"; export * as sub from "./zero.cjs";`,
      "one.js": `import "./seven.js";`,
      "two.js": `import "./six.js";`,
      "six.js": `export * from "./entry.js";`,
      "seven.js": `import "./two.js"; import { a } from "./five.cjs";`,
      "zero.cjs": `try { require("./five.cjs"); } catch {}`,
      "five.cjs": `try { require("./two.js"); } catch {}`,
      "graph.test.js": `
        import { test, vi } from "bun:test";
        test("loads", () => {
          vi.doMock("./zero.cjs", importOriginal => (void importOriginal().catch(() => {}), { a: 2 }));
          vi.doMock("./seven.js", () => (vi.doUnmock("./seven.js"), { a: 3 }));
          console.log(Object.keys(require("./entry.js")));
        });
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
      timeout: 60_000,
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout).toContain(`[ "sub" ]`);
    expect(stderr).toContain(" 1 pass\n 0 fail\n");
    expect(exitCode).toBe(0);
  });
  test("resolves the import()s waiting for it even if its mock is replaced or removed", async () => {
    await expectFixturesToPass(
      {
        ...graph,
        "again.test.js": `
          import { beforeEach, expect, test, vi } from "bun:test";
          beforeEach(() => {
            vi.doUnmock("./k.js");
            vi.resetModules();
          });
          function pendingFactory(result) {
            const called = Promise.withResolvers(), gate = Promise.withResolvers();
            vi.doMock("./k.js", async () => (called.resolve(), await gate.promise, result));
            return { called: called.promise, settle: gate.resolve };
          }
          test("mocked again, and the modules reset between import() and its await", async () => {
            vi.doMock("./k.js", () => ({ first: 1 }));
            await import("./k.js");
            vi.doMock("./k.js", () => ({ second: 2 }));
            const importing = import("./k.js");
            vi.resetModules();
            expect(Object.keys(await importing)).toEqual(["second"]);
            expect(Object.keys(await import("./k.js"))).toEqual(["second"]);
          });
          test("mocked again while the factory runs", async () => {
            const factory = pendingFactory({ x: "first" });
            const importing = import("./a.js");
            await factory.called;
            vi.doMock("./k.js", () => ({ x: "second" }));
            factory.settle();
            expect((await importing).seen).toBe("first");
            expect((await import("./k.js")).x).toBe("second");
          });
          test("not mocked any more while the factory runs", async () => {
            const factory = pendingFactory({ x: "mock" });
            const importing = import("./a.js");
            await factory.called;
            vi.doUnmock("./k.js");
            factory.settle();
            expect((await importing).seen).toBe("mock");
            expect([(await import("./a.js")).seen, (await import("./k.js")).x]).toEqual(["real", "real"]);
          });
          test("mocked again before the factory is called", async () => {
            let calls = 0;
            vi.doMock("./k.js", () => (calls++, { x: "first" }));
            const importing = [import("./a.js"), import("./k.js")];
            vi.doMock("./k.js", () => ({ x: "second" }));
            expect([(await importing[0]).seen, (await importing[1]).x, calls]).toEqual(["second", "second", 0]);
          });
          test("not mocked any more before the factory is called", async () => {
            let calls = 0;
            vi.doMock("./k.js", () => (calls++, { x: "mock" }));
            const importing = [import("./a.js"), import("./k.js")];
            vi.doUnmock("./k.js");
            expect([(await importing[0]).seen, (await importing[1]).x, calls]).toEqual(["real", "real", 0]);
          });
          test("mocked a thousand times while it is loaded", async () => {
            const factory = pendingFactory({ x: "first" });
            const importing = import("./root.js");
            await factory.called;
            for (let i = 0; i < 1000; i++) vi.doMock("./k.js", () => ({ x: i }));
            factory.settle();
            expect((await importing).seen).toBe("first");
            expect((await import("./k.js")).x).toBe(999);
          });
        `,
      },
      6,
    );
  });
  test("and fails to load", async () => {
    await expectFixturesToPass(
      {
        ...graph,
        "syntax.js": `export const = ;`,
        "throws.js": `throw new Error("thrown by throws.js");`,
        "uses-syntax.js": `import { x } from "./k.js"; import "./syntax.js"; export const seen = x;`,
        "uses-throws.js": `import { x } from "./k.js"; import "./throws.js"; export const seen = x;`,
        "uses-missing.js": `import { x } from "./k.js"; import "./missing.js"; export const seen = x;`,
        "fails.test.js": `
          import { expect, test, vi } from "bun:test";
          test.each(["syntax", "throws", "missing"].flatMap(kind => [[kind, "import()", path => import(path)], [kind, "require()", async path => require(path)]]))("%s: %s", async (kind, _, load) => {
            vi.resetModules();
            let calls = 0;
            vi.doMock("./k.js", () => (calls++, vi.doUnmock("./k.js"), { x: "mock" }));
            expect(load("./uses-" + kind + ".js")).rejects.toThrow();
            await load("./uses-" + kind + ".js").catch(() => {});
            expect((await load("./a.js")).seen).toBe("real");
            expect(calls).toBeLessThan(2);
          });
        `,
      },
      6,
    );
  });
  test("with a pending plugin, require() in a factory, and vi.dynamicImportSettled()", async () => {
    await expectFixturesToPass(
      {
        ...graph,
        "slow.js": `export const s = "slow";`,
        "user.js": `import { x } from "./k.js"; import { s } from "./slow.js"; export const seen = x + "/" + s;`,
        "inner.js": `import { n } from "./count.js"; export const inner = "inner" + n;`,
        "interplay.test.js": `
          import { afterEach, expect, test, vi } from "bun:test";
          afterEach(() => {
            Bun.plugin.clearAll();
            vi.resetModules();
          });
          test("an onLoad() callback that is pending", async () => {
            const called = Promise.withResolvers(), gate = Promise.withResolvers();
            Bun.plugin({
              name: "slow",
              setup(build) {
                build.onLoad({ filter: /slow\\.js$/ }, async () => (called.resolve(), await gate.promise, undefined));
              },
            });
            vi.doMock("./k.js", () => ({ x: "mock" }));
            await import("./k.js");
            const importing = import("./user.js");
            await called.promise;
            vi.doUnmock("./k.js");
            const joining = import("./user.js");
            vi.resetModules();
            gate.resolve();
            expect((await importing).seen).toBe("mock/slow");
            expect(await joining).toBe(await importing);
            expect((await import("./user.js")).seen).toBe("real/slow");
          });
          test("require() of ES modules in a factory that import() called", async () => {
            globalThis.loads = 0;
            vi.doMock("./k.js", () => {
              const before = require("./inner.js").inner;
              vi.resetModules();
              return { x: before + "+" + require("./inner.js").inner };
            });
            expect((await import("./root.js")).seen).toBe("inner1+inner2");
            expect((await import("./root.js")).seen).toBe("inner1+inner2");
            expect(globalThis.loads).toBe(2);
            vi.doUnmock("./k.js");
          });
          test("vi.dynamicImportSettled()", async () => {
            vi.doMock("./k.js", async () => (vi.doUnmock("./k.js"), await null, { x: "mock" }));
            let seen;
            void import("./root.js").then(root => (seen = root.seen));
            await vi.dynamicImportSettled();
            expect([seen, (await import("./root.js")).seen]).toEqual(["mock", "real"]);
          });
          test("script that is terminated in a factory", async () => {
            let calls = 0;
            globalThis.load = () => require("./k.js");
            vi.doMock("./k.js", () => {
              if (++calls === 1) for (;;);
              return { x: "mock" };
            });
            expect(() => require("node:vm").runInThisContext("load()", { timeout: 100 })).toThrow(expect.objectContaining({ code: "ERR_SCRIPT_EXECUTION_TIMEOUT" }));
            expect((await import("./root.js")).seen).toBe("mock");
            vi.doUnmock("./k.js");
          });
        `,
      },
      4,
    );
  });

  test("as a mock that is removed before import() calls its factory", async () => {
    await expectFixturesToPass(
      {
        "k.js": `export const x = "real";`,
        "slow.js": `export const s = "slow";`,
        "user.js": `import { x } from "./k.js"; import { s } from "./slow.js"; export const seen = x + "/" + s;`,
        "requires.cjs": `exports.x = require("./k.js").x;`,
        "both.js": `import { x } from "./k.js"; import required from "./requires.cjs"; export const seen = x + "/" + required.x;`,
        "removed.test.js": `
          import { expect, test, vi } from "bun:test";
          test.each([
            ["vi.doUnmock()", () => vi.doUnmock("./k.js"), "real"],
            ["another mock", () => vi.doMock("./k.js", () => ({ x: "second" })), "second"],
            ["Bun.plugin.clearAll()", () => Bun.plugin.clearAll(), "real"],
          ])("by %s, while another module is being fetched", async (_, remove, x) => {
            vi.resetModules();
            const asked = Promise.withResolvers(), gate = Promise.withResolvers();
            Bun.plugin({
              name: "slow",
              setup(build) {
                build.onLoad({ filter: /slow\\.js$/ }, async () => {
                  asked.resolve();
                  await gate.promise;
                });
              },
            });
            let calls = 0;
            vi.doMock("./k.js", () => (calls++, { x: "first" }));
            const user = import("./user.js");
            await asked.promise;
            remove();
            gate.resolve();
            expect((await user).seen).toBe(x + "/slow");
            expect([(await import("./user.js")).seen, (await import("./k.js")).x, calls]).toEqual([x + "/slow", x, 0]);
            Bun.plugin.clearAll();
          });

          test("by its factory, which a require() has called meanwhile", async () => {
            vi.resetModules();
            let calls = 0;
            vi.doMock("./k.js", () => (calls++, vi.doUnmock("./k.js"), { x: "mock" }));
            expect((await import("./both.js")).seen).toBe("mock/mock");
            expect([(await import("./k.js")).x, calls]).toEqual(["real", 1]);
          });
        `,
      },
      4,
    );
  });

  test("is dropped once its own load settles, even while other loads are pending", async () => {
    await expectFixturesToPass(
      {
        "one.js": `globalThis.one = (globalThis.one ?? 0) + 1; export const n = globalThis.one;`,
        "two.js": `globalThis.two = (globalThis.two ?? 0) + 1; export const n = globalThis.two;`,
        "root-one.js": `export { n } from "./one.js";`,
        "root-two.js": `export { n } from "./two.js";`,
        "each.test.js": `
          import { expect, test, vi } from "bun:test";
          test.each([["one", "two"], ["two", "one"]])("%s, while %s is held", async (fast, slow) => {
            vi.resetModules();
            const asked = { one: Promise.withResolvers(), two: Promise.withResolvers() };
            const gates = { one: Promise.withResolvers(), two: Promise.withResolvers() };
            Bun.plugin({
              name: "gates",
              setup(build) {
                build.onLoad({ filter: /[\\\\/](one|two)\\.js$/ }, async ({ path }) => {
                  const name = path.endsWith("one.js") ? "one" : "two";
                  asked[name].resolve();
                  await gates[name].promise;
                });
              },
            });
            const held = import("./root-" + slow + ".js"), first = import("./root-" + fast + ".js");
            await Promise.all([asked.one.promise, asked.two.promise]);
            vi.resetModules();
            gates[fast].resolve();
            const before = (await first).n;
            Bun.plugin.clearAll();
            expect((await import("./root-" + fast + ".js")).n).toBe(before + 1);
            gates[slow].resolve();
            await held;
          });
        `,
      },
      2,
    );
  });

  test("a file that never finishes loading", async () => {
    using dir = tempDir("mock-module-evict", {
      ...graph,
      "a.test.js": `
        import { test, vi } from "bun:test";
        vi.doMock("./k.js", async () => (vi.doUnmock("./k.js"), vi.resetModules(), await new Promise(() => {})));
        await import("./root.js");
        test("never runs", () => {});
      `,
      "b.test.js": `
        import { expect, test } from "bun:test";
        import { seen } from "./root.js";
        test("the next file loads the modules", () => expect(seen).toBe("real"));
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "./a.test.js", "./b.test.js"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
      timeout: 60_000,
    });
    const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toContain('a.test.js" never finished loading');
    expect(stderr).toContain(" 1 pass\n 1 fail\n 1 error\n");
    expect(exitCode).toBe(1);
  });
});

describe.concurrent("a test file's module mocks are undone when it ends, even with loads in flight", () => {
  const modules = {
    "k.js": `export const x = "real";`,
    "slow.js": `export const s = "slow";`,
    "user.js": `import { x } from "./k.js"; import { s } from "./slow.js"; export const seen = x + "/" + s;`,
  };
  const next = `
    import { expect, test } from "bun:test";
    import { seen } from "./user.js";
    test("the next file gets the original", async () => {
      expect([seen, (await import("./k.js")).x]).toEqual(["real/slow", "real"]);
      await globalThis.settle?.();
      expect([(await import("./user.js")).seen, (await import("./k.js")).x]).toEqual(["real/slow", "real"]);
      expect(globalThis.events).toEqual(EVENTS);
    });
  `;

  test.each(["", "--rerun-each=2"])("a factory that is still running is not waited for: bun test %s", async flags => {
    await expectFixturesToPass(
      {
        ...modules,
        "a.test.js": `
          import { test, vi } from "bun:test";
          test("leaves an import of a mock whose factory has not settled", async () => {
            const events = (globalThis.events = []);
            const called = Promise.withResolvers(), gate = Promise.withResolvers();
            vi.doMock("./k.js", async () => (called.resolve(), await gate.promise, events.push("factory settled"), { x: "mock" }));
            void import("./user.js").then(() => events.push("import settled"), () => events.push("import rejected"));
            await called.promise;
            globalThis.settle = async () => {
              gate.resolve();
              await new Promise(resolve => setImmediate(resolve));
            };
          });
        `,
        "b.test.js": next.replace("EVENTS", `["factory settled"]`),
      },
      flags ? 4 : 2,
      ["./a.test.js", "./b.test.js", ...flags.split(" ").filter(Boolean)],
    );
  });

  test("a load that has imported a mock has settled before the next file is loaded", async () => {
    await expectFixturesToPass(
      {
        ...modules,
        "a.test.js": `
          import { test, vi } from "bun:test";
          test("leaves an import that waits for a plugin", async () => {
            const events = (globalThis.events = []);
            const called = Promise.withResolvers();
            Bun.plugin({
              name: "slow",
              setup(build) {
                build.onLoad({ filter: /slow\\.js$/ }, async () => {
                  called.resolve();
                  await new Promise(resolve => setImmediate(resolve));
                  events.push("plugin settled");
                });
              },
            });
            vi.doMock("./k.js", () => ({ x: "mock" }));
            await import("./k.js");
            void import("./user.js").then(user => events.push("import settled: " + user.seen));
            await called.promise;
          });
        `,
        "b.test.js": next.replace("EVENTS", `["plugin settled", "import settled: mock/slow"]`),
      },
      2,
      ["./a.test.js", "./b.test.js"],
    );
  });
  test("the factory of a preload's mock that is still running is called again for the next file", async () => {
    await expectFixturesToPass(
      {
        ...modules,
        "preload.js": `
          import { mock } from "bun:test";
          globalThis.called = Promise.withResolvers();
          let calls = 0;
          mock.module("./k.js", async () => {
            globalThis.called.resolve();
            if (++calls === 1) await new Promise(() => {});
            return { x: "preload" + calls };
          });
        `,
        "a.test.js": `
          import { test } from "bun:test";
          test("leaves an import of the mock", async () => {
            void import("./user.js");
            await globalThis.called.promise;
          });
        `,
        "b.test.js": `
          import { expect, test } from "bun:test";
          import { seen } from "./user.js";
          test("gets the mock", () => expect(seen).toBe("preload2/slow"));
        `,
      },
      2,
      ["--preload", "./preload.js", "./a.test.js", "./b.test.js"],
    );
  });

  test("mocks whose factories have not been called when the file fails to load", async () => {
    using dir = tempDir("mock-module-undo", {
      ...modules,
      "k2.js": `export const y = "real2";`,
      "unrelated.js": `export const u = "real";`,
      "broken.js": `import "./k.js"; import "./k2.js"; import "./slow.js"; import "./does-not-exist.js";`,
      "preload.js": `
        Bun.plugin({
          name: "slow",
          setup(build) {
            build.onLoad({ filter: /slow\\.js$/ }, async () => {
              await new Promise(resolve => setImmediate(resolve));
            });
          },
        });
      `,
      "a.test.js": `
        import { test, vi } from "bun:test";
        import "./broken.js";
        vi.mock("./k.js", () => ({ x: "mock" }));
        vi.mock("./k2.js", () => ({ y: "mock" }));
        test("never runs", () => {});
      `,
      "b.test.js": `
        import { expect, mock, test } from "bun:test";
        import { seen } from "./user.js";
        test("the next file gets the originals, and its own mocks", async () => {
          mock.module("./unrelated.js", () => ({ u: "mock" }));
          expect([seen, (await import("./k2.js")).y, (await import("./unrelated.js")).u]).toEqual(["real/slow", "real2", "mock"]);
        });
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "--preload", "./preload.js", "./a.test.js", "./b.test.js"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
      timeout: 60_000,
    });
    const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toContain(" 1 pass\n 1 fail\n 1 error\n");
    expect(exitCode).toBe(1);
  });

  test("a load that never settles doesn't stop the next file's loads from being evicted", async () => {
    await expectFixturesToPass(
      {
        ...modules,
        "a.test.js": `
          import { test, vi } from "bun:test";
          test("removes a mock whose factory never settles", async () => {
            const called = Promise.withResolvers();
            vi.doMock("./k.js", () => (called.resolve(), new Promise(() => {})));
            void import("./user.js");
            await called.promise;
            vi.doUnmock("./k.js");
          });
        `,
        "b.test.js": `
          import { expect, test, vi } from "bun:test";
          test("removes a mock while its module is being loaded", async () => {
            const called = Promise.withResolvers(), gate = Promise.withResolvers();
            vi.doMock("./k.js", async () => (called.resolve(), await gate.promise, { x: "mock" }));
            const user = import("./user.js");
            await called.promise;
            vi.doUnmock("./k.js");
            gate.resolve();
            expect([(await user).seen, (await import("./user.js")).seen, (await import("./k.js")).x]).toEqual(["mock/slow", "real/slow", "real"]);
          });
        `,
      },
      2,
      ["./a.test.js", "./b.test.js"],
    );
  });

  test("a load that imported a mock and never finishes isn't reused by the next file", async () => {
    await expectFixturesToPass(
      {
        ...modules,
        "preload.js": `
          globalThis.asked = Promise.withResolvers();
          let calls = 0;
          Bun.plugin({
            name: "does not answer the first time",
            setup(build) {
              build.onLoad({ filter: /slow\\.js$/ }, () => {
                globalThis.asked.resolve();
                if (++calls === 1) return new Promise(() => {});
              });
            },
          });
        `,
        "a.test.js": `
          import { test, vi } from "bun:test";
          test("leaves an import that never settles", async () => {
            vi.doMock("./k.js", () => ({ x: "mock" }));
            await import("./k.js");
            void import("./user.js");
            await globalThis.asked.promise;
          });
        `,
        "b.test.js": `
          import { expect, test } from "bun:test";
          import { seen } from "./user.js";
          test("the next file loads the modules", () => expect(seen).toBe("real/slow"));
        `,
      },
      2,
      ["--preload", "./preload.js", "./a.test.js", "./b.test.js"],
    );
  });
});

describe.concurrent("a test file's module mocks are undone when it ends, for modules that import one another", () => {
  const apis = ["vi.doMock", "mock.module", "jest.doMock"];

  test.each(apis)("a module that was mocked after it had imported a mock: %s", async api => {
    await expectFixturesToPass(
      {
        "dep.js": `export const x = "real";`,
        "user.js": `import { x } from "./dep.js"; export const seen = () => x;`,
        "a.test.js": `
          import { expect, jest, mock, test, vi } from "bun:test";
          test("imports a mock", async () => {
            ${api}("./dep.js", () => ({ x: "mock" }));
            expect((await import("./user.js")).seen()).toBe("mock");
          });
          test("is mocked itself", async () => {
            ${api}("./user.js", () => ({ seen: () => "mocked user" }));
            expect((await import("./user.js")).seen()).toBe("mocked user");
          });
        `,
        "b.test.js": `
          import { expect, test } from "bun:test";
          import { seen } from "./user.js";
          test("the next file gets the originals", () => expect(seen()).toBe("real"));
        `,
      },
      3,
      ["./a.test.js", "./b.test.js"],
    );
  });

  test.each(apis)(
    "the next file gets the originals after a file mocks a loaded module and then one of its imports: %s",
    async api => {
      await expectFixturesToPass(
        {
          "j.js": `export const y = "real-j";`,
          "k.js": `import { y } from "./j.js"; export const x = "real-k:" + y; export const live = () => y;`,
          "l.js": `import { x, live } from "./k.js"; export const top = () => x + "/" + live();`,
          "q.cjs": `const k = require("./k.js"); exports.top = () => k.x + "/" + k.live();`,
          "a.test.js": `
          import { test } from "bun:test";
          test("loads everything", async () => {
            await import("./l.js");
            require("./q.cjs");
          });
        `,
          "b.test.js": `
          import { expect, jest, mock, test, vi } from "bun:test";
          test("mocks what is loaded, from the middle down", async () => {
            await ${api}("./k.js", () => ({ x: "mock-k", live: () => "mock-live" }));
            await import("./l.js");
            await ${api}("./j.js", () => ({ y: "mock-j" }));
            expect([(await import("./l.js")).top(), require("./q.cjs").top()]).toEqual(["mock-k/mock-live", "mock-k/mock-live"]);
          });
        `,
          "c.test.js": `
          import { expect, test } from "bun:test";
          test("the next file gets the originals", async () => {
            expect([(await import("./l.js")).top(), require("./q.cjs").top(), (await import("./k.js")).x, (await import("./j.js")).y]).toEqual([
              "real-k:real-j/real-j",
              "real-k:real-j/real-j",
              "real-k:real-j",
              "real-j",
            ]);
          });
        `,
        },
        3,
        ["./a.test.js", "./b.test.js", "./c.test.js"],
      );
    },
  );

  test.each(["", "vi.resetModules();", "jest.resetModules();"])(
    "modules a preload loaded see the preload's mock again after a file replaced it: %s",
    async reset => {
      await expectFixturesToPass(
        {
          "dep.js": `export const x = "real";`,
          "user.js": `import { x } from "./dep.js"; export const seen = () => x;`,
          "preload.js": `
            import { mock } from "bun:test";
            mock.module("./dep.js", () => ({ x: "preload" }));
            globalThis.helper = await import("./user.js");
          `,
          "a.test.js": `
            import { expect, jest, mock, test, vi } from "bun:test";
            test("replaces the mock", async () => {
              mock.module("./dep.js", () => ({ x: "mock of this file" }));
              expect(helper.seen()).toBe("mock of this file");
              ${reset}
              expect((await import("./dep.js")).x).toBe("mock of this file");
            });
          `,
          "b.test.js": `
            import { expect, test } from "bun:test";
            test("the next file gets the preload's", async () => {
              expect([helper.seen(), (await import("./user.js")).seen(), (await import("./dep.js")).x]).toEqual(["preload", "preload", "preload"]);
            });
          `,
        },
        2,
        ["--preload", "./preload.js", "./a.test.js", "./b.test.js"],
      );
    },
  );

  test.each([
    "vi.resetModules();",
    "jest.resetModules();",
    "for (const key of Object.keys(require.cache)) delete require.cache[key];",
  ])("modules a preload loaded see the original again after a file patched and evicted it: %s", async evict => {
    await expectFixturesToPass(
      {
        "dep.js": `export const x = "real";`,
        "user.js": `import { x } from "./dep.js"; export const seen = () => x;`,
        "preload.js": `globalThis.helper = await import("./user.js");`,
        "a.test.js": `
            import { expect, jest, mock, test, vi } from "bun:test";
            test("mocks what is loaded", async () => {
              mock.module("./dep.js", () => ({ x: "mock" }));
              ${evict}
              expect([helper.seen(), (await import("./dep.js")).x]).toEqual(["mock", "mock"]);
            });
          `,
        "b.test.js": `
            import { expect, test } from "bun:test";
            test("the next file gets the originals", async () => {
              expect([helper.seen(), (await import("./user.js")).seen(), (await import("./dep.js")).x]).toEqual(["real", "real", "real"]);
            });
          `,
      },
      2,
      ["--preload", "./preload.js", "./a.test.js", "./b.test.js"],
    );
  });

  test("a module that failed to load because of a mock is loaded again once the mock has changed", async () => {
    await expectFixturesToPass(
      {
        "dep.js": `export const x = "real";`,
        "user.js": `import { x } from "./dep.js"; export const seen = () => x;`,
        "a.test.js": `
          import { expect, mock, test, vi } from "bun:test";
          test("with another mock", async () => {
            mock.module("./dep.js", () => {
              throw new Error("the factory failed");
            });
            await expect(import("./user.js")).rejects.toThrow("the factory failed");
            mock.module("./dep.js", () => ({ x: "mock" }));
            expect((await import("./user.js")).seen()).toBe("mock");
          });
          test("and fails again for the next file to find", async () => {
            vi.resetModules();
            mock.module("./dep.js", () => {
              throw new Error("the factory failed");
            });
            await expect(import("./user.js")).rejects.toThrow("the factory failed");
          });
        `,
        "b.test.js": `
          import { expect, test } from "bun:test";
          import { seen } from "./user.js";
          test("the next file gets the originals", () => expect(seen()).toBe("real"));
        `,
      },
      3,
      ["./a.test.js", "./b.test.js"],
    );
  });
});

test.concurrent.each(["vi.mock", "vi.doMock", "mock.module"])(
  "the next file gets the originals after %s mocks a loaded module and one of its imports",
  async mockIt => {
    const imports = mockIt === "vi.mock" ? `import { x } from "./k.js";` : "";
    await expectFixturesToPass(
      {
        "j.js": `export const y = "real-j";`,
        "k.js": `import { y } from "./j.js"; export const x = "real-k"; export const viaJ = () => y;`,
        "0.test.js": `
          import { expect, test } from "bun:test";
          import { x } from "./k.js";
          test("loads them", () => expect(x).toBe("real-k"));
        `,
        "1.test.js": `
          import { expect, mock, test, vi } from "bun:test";
          ${imports}
          ${mockIt}("./k.js", () => ({ x: "mock-k" }));
          ${mockIt}("./j.js", () => ({ y: "mock-j" }));
          test("mocks them", async () => expect((await import("./k.js")).x).toBe("mock-k"));
        `,
        "2.test.js": `
          import { expect, test } from "bun:test";
          test("mocks nothing", async () => {
            const k = await import("./k.js");
            expect([k.x, k.viaJ()]).toEqual(["real-k", "real-j"]);
          });
        `,
      },
      3,
      ["./0.test.js", "./1.test.js", "./2.test.js"],
    );
  },
);

test.concurrent(
  "the next --rerun-each run gets the original after a factory resets modules while patching a loaded one",
  async () => {
    await expectFixturesToPass(
      {
        "k.js": `export const x = "real";`,
        "reset.test.js": `
        import { expect, test, vi } from "bun:test";
        test("mocks", async () => {
          expect((await import("./k.js")).x).toBe("real");
          vi.doMock("./k.js", () => (vi.resetModules(), { x: "mock" }));
          expect((await import("./k.js")).x).toBe("mock");
        });
      `,
      },
      2,
      ["--rerun-each=2"],
    );
  },
);

test.concurrent("jest.resetModules() keeps bindings already imported from a mock", async () => {
  await expectFixturesToPass(
    {
      "dep.js": `export const x = "real"; export function f() { return "real-f"; }`,
      "user.js": `import { x, f } from "./dep.js"; export const read = () => [x, f()];`,
      "reset.test.js": `
        import { expect, jest, test } from "bun:test";
        import * as ns from "./dep.js";
        import { f, x } from "./dep.js";
        import { read } from "./user.js";
        let calls = 0;
        jest.mock("./dep.js", () => ({ x: "mock" + ++calls, f: jest.fn(() => "mock-f") }));
        test("and calls the factory again for the next import", async () => {
          jest.resetModules();
          expect([x, f(), ns.x, Object.keys(ns), read()]).toEqual(["mock1", "mock-f", "mock1", ["x", "f"], ["mock1", "mock-f"]]);
          expect((await import("./user.js")).read()).toEqual(["mock2", "mock-f"]);
          expect([x, read()[0], require("./dep.js").x]).toEqual(["mock1", "mock1", "mock2"]);
        });
      `,
    },
    1,
  );
});

test.concurrent("importOriginal() and automocks work for modules imported with a `type` attribute", async () => {
  await expectFixturesToPass(
    {
      "data.json": `{ "a": "real", "b": 1 }`,
      "note.txt": `real`,
      "conf.toml": `a = "real"`,
      "uses-json.js": `import data from "./data.json" with { type: "json" }; export const read = () => data;`,
      "uses-text.js": `import text from "./note.txt" with { type: "text" }; export const read = () => text;`,
      "uses-toml.js": `import conf from "./conf.toml" with { type: "toml" }; export const read = () => conf;`,
      "uses-js-as-text.js": `import text from "./uses-text.js" with { type: "text" }; export const read = () => text.slice(0, 11);`,
      "type.test.js": `
        import { afterEach, expect, test, vi } from "bun:test";
        afterEach(() => vi.resetModules());
        test.each([
          ["./data.json", "./uses-json.js", { a: "real", b: 1 }],
          ["./note.txt", "./uses-text.js", "real"],
          ["./conf.toml", "./uses-toml.js", { a: "real" }],
          ["./uses-text.js", "./uses-js-as-text.js", "import text"],
        ])("%s", async (path, user, real) => {
          using _ = vi.doMock(path, async importOriginal => ({ default: [(await importOriginal()).default] }));
          const [original] = (await import(user)).read();
          expect(path === "./uses-text.js" ? original.slice(0, 11) : original).toEqual(real);
        });
        test("without a factory", async () => {
          using _ = vi.doMock("./data.json");
          expect((await import("./uses-json.js")).read()).toEqual({ a: "real", b: 1 });
        });
      `,
    },
    5,
  );
});

test.concurrent(
  "a failing factory that import()s its own module, whose original imports itself, is only called once",
  async () => {
    await expectFixturesToPass(
      {
        "m.js": `import "./m.js"; export const b = 1;`,
        "user.js": `import "./m.js"; export const a = 1;`,
        "fails.test.js": `
        import { expect, mock, test, vi } from "bun:test";
        const loaders = [["require()", async path => require(path)], ["import()", path => import(path)]];
        const failures = [
          ["throws", () => { throw new Error("the factory failed"); }],
          ["returns no object", () => 1],
          ["rejects", () => Promise.reject(new Error("the factory failed"))],
          ["resolves to no object", async () => (await null, 1)],
        ];
        test.each(loaders.flatMap(([name, load]) => failures.map(([how, fail]) => [name, how, load, fail])))("%s, %s", async (_, how, load, fail) => {
          vi.resetModules();
          let calls = 0;
          const imports = [];
          mock.module("./m.js", () => {
            calls++;
            imports.push(import("./m.js").catch(() => {}));
            return fail();
          });
          await expect(load("./user.js")).rejects.toThrow();
          await Promise.all(imports);
          await vi.dynamicImportSettled();
          expect(calls).toBe(1);
        });
      `,
      },
      8,
    );
  },
);

test.concurrent("importOriginal() fails with the error a getter on the original's exports throws", async () => {
  await expectFixturesToPass(
    {
      "other.js": `export const boom = 1;`,
      "barrel.js": `export * from "./other.js"; export const own = "own";`,
      "getter.test.js": `
        import { expect, test, vi } from "bun:test";
        test("instead of taking it for an export that is not initialized", async () => {
          vi.doMock("./other.js", () => ({ get boom() { throw new RangeError("from the getter"); } }));
          vi.doMock("./barrel.js", async importOriginal => ({ ...(await importOriginal()) }));
          expect(import("./barrel.js")).rejects.toThrow(new RangeError("from the getter"));
        });
      `,
    },
    1,
  );
});

test.concurrent("a factory that require()s a module that is waiting for the mock", async () => {
  await expectFixturesToPass(
    {
      "k.js": `export const x = "real";`,
      "a.js": `import { x } from "./k.js"; export const seen = x;`,
      "root.js": `export { seen } from "./a.js";`,
      "helper.cjs": `try { module.exports = require("./a.js").seen; } catch (error) { module.exports = error.message; }`,
      "nested.test.js": `
        import { expect, test, vi } from "bun:test";
        test("fails there, and the module that was waiting gets the mock", () => {
          vi.doMock("./k.js", () => ({ x: "mock", nested: require("./helper.cjs") }));
          expect(require("./root.js").seen).toBe("mock");
          expect(require("./k.js").nested).toStartWith("Circular import: ");
        });
      `,
    },
    1,
  );
});

test.concurrent("importOriginal() of a module that re-exports a name the mock of another module lacks", async () => {
  await expectFixturesToPass(
    {
      "other.js": `export const a = "real-a"; export const b = "real-b";`,
      "barrel.js": `export { a, b } from "./other.js"; export const own = "own";`,
      "lacks.test.js": `
        import { expect, test, vi } from "bun:test";
        test("has undefined for it", async () => {
          vi.doMock("./other.js", () => ({ a: "mock-a" }));
          vi.doMock("./barrel.js", async importOriginal => ({ ...(await importOriginal()), extra: 1 }));
          expect({ ...(await import("./barrel.js")) }).toEqual({ a: "mock-a", b: undefined, own: "own", extra: 1 });
        });
      `,
    },
    1,
  );
});

test.concurrent("a factory that require()s a module which imports an importer of the mock, and throws", async () => {
  await expectFixturesToPass(
    {
      "k.js": `export const a = "real";`,
      "l.js": `export const l = "l";`,
      "m.js": `import { l } from "./l.js"; import { a } from "./k.js"; export const m = l + a;`,
      "imports-m.js": `import { m } from "./m.js"; export const x = m;`,
      "throws.test.js": `
        import { expect, mock, test } from "bun:test";
        test("fails the require() that asked for the mock", () => {
          let calls = 0;
          mock.module("./k.js", () => {
            calls++;
            try {
              require("./imports-m.js");
            } catch {}
            throw new Error("the factory failed");
          });
          expect(() => require("./m.js")).toThrow("the factory failed");
          expect(() => require("./m.js")).toThrow("the factory failed");
          expect(calls).toBe(1);
        });
      `,
    },
    1,
  );
});

test.concurrent(
  "requiring the original of a module in a cycle before its async factory runs throws, and the mock still loads",
  async () => {
    await expectFixturesToPass(
      {
        "two.js": `import "./three.js"; export const two = 2;`,
        "three.js": `import "./two.js"; export const three = 3;`,
        "cycle.test.js": `
        import { expect, jest, test, vi } from "bun:test";
        test.each([
          ["jest.requireActual()", () => jest.requireActual("./two.js")],
          ["jest.createMockFromModule()", () => jest.createMockFromModule("./two.js")],
        ])("by %s", async (_, load) => {
          vi.resetModules();
          let calls = 0;
          const returned = Promise.withResolvers();
          vi.doMock("./two.js", async importOriginal => {
            calls++;
            const original = await importOriginal();
            returned.resolve();
            return { a: "mock", ...original };
          });
          const imported = async () => [{ ...(await import("./two.js")) }, { ...(await import("./three.js")) }];
          expect(load).toThrow("require() async module");
          // From the file of a factory that is running: the original.
          expect(await imported()).toEqual([{ two: 2 }, { three: 3 }]);
          await returned.promise;
          expect(await imported()).toEqual([{ a: "mock", two: 2 }, { three: 3 }]);
          expect(calls).toBe(1);
        });
      `,
      },
      2,
    );
  },
);

test.concurrent(
  "a factory that never settles doesn't hide the module's next mock from the file that defined the factory",
  async () => {
    await expectFixturesToPass(
      {
        "dep.js": `export const x = "real";`,
        "user.js": `import { x } from "./dep.js"; export const seen = () => x;`,
        "window.test.js": `
        import { expect, test, vi } from "bun:test";
        test.each([
          ["removed", () => vi.doUnmock("./dep.js")],
          ["replaced", () => {}],
        ])("once its mock is %s", async (_, remove) => {
          const called = Promise.withResolvers();
          vi.doMock("./dep.js", () => (called.resolve(), new Promise(() => {})));
          void import("./dep.js");
          await called.promise;
          remove();
          vi.resetModules();
          vi.doMock("./dep.js", () => ({ x: "mock" }));
          expect([(await import("./dep.js")).x, (await import("./user.js")).seen(), require("./dep.js").x]).toEqual(["mock", "mock", "mock"]);
          vi.doUnmock("./dep.js");
        });
      `,
      },
      2,
    );
  },
);

// While a factory runs, what its file imports gets the original of the mocked module. The file of a vi.doMock() factory is
// the test file, so a factory that never settles claimed every module the later tests imported.
test.concurrent(
  "a factory that never settles doesn't hide the module's next mock from a module that a later test imports",
  async () => {
    await expectFixturesToPass(
      {
        "part.js": `export const part = "real part";`,
        "host.js": `import { part } from "./part.js"; export const host = "real host, " + part;`,
        "opener.js": `export const open = async () => (await import("./host.js")).host;`,
        "lazy.test.js": `
        import { beforeEach, expect, test, vi } from "bun:test";
        beforeEach(() => vi.resetModules());
        let isStillWaiting = true;
        test("the factory never settles", async () => {
          const called = Promise.withResolvers();
          vi.doMock("./host.js", () => (called.resolve(), new Promise(() => {})));
          const { open } = await import("./opener.js");
          void open().finally(() => (isStillWaiting = false));
          await called.promise;
        });
        test("the real module, with one of its imports mocked", async () => {
          vi.doUnmock("./host.js");
          vi.doMock("./part.js", () => ({ part: "mock part" }));
          const { open } = await import("./opener.js");
          expect(await open()).toBe("real host, mock part");
          vi.doUnmock("./part.js");
        });
        test.each([1, 2])("the next mock, %i", async n => {
          vi.doMock("./host.js", () => ({ host: "mock " + n }));
          const { open } = await import("./opener.js");
          expect(await open()).toBe("mock " + n);
        });
        // If it woke up, it would load the real module, and whichever test was running would get that one.
        test("the first test's import() is still waiting", async () => {
          await new Promise(resolve => setImmediate(resolve));
          expect(isStillWaiting).toBe(true);
        });
      `,
      },
      5,
    );
  },
);

test.concurrent(
  "an import() gets the exports of the mock it started under, however late the factory settles",
  async () => {
    await expectFixturesToPass(
      {
        "part.js": `export const part = "real part";`,
        "host.js": `export const host = "real host";`,
        "opener.js": `export const open = async () => (await import("./host.js")).host;`,
        "late.test.js": `
        import { expect, test, vi } from "bun:test";
        test("the mock is removed and something else is imported while the factory waits", async () => {
          const called = Promise.withResolvers(), gate = Promise.withResolvers();
          vi.doMock("./host.js", async () => (called.resolve(), await gate.promise, { host: "mock" }));
          const { open } = await import("./opener.js");
          const opened = open();
          await called.promise;
          vi.doUnmock("./host.js");
          await import("./part.js");
          gate.resolve();
          expect(await opened).toBe("mock");
        });
      `,
      },
      1,
    );
  },
);

test.concurrent("listing the keys of a barrel runs no getter of the mock behind it", async () => {
  await expectFixturesToPass(
    {
      "leaf.js": `export const token = "real"; export const other = 1;`,
      "star.js": `export * from "./leaf.js";`,
      "named.js": `export { token } from "./leaf.js";`,
      "keys.test.js": `
        import { beforeEach, expect, test, vi } from "bun:test";
        let reads = 0;
        vi.mock("./leaf.js", () => ({ get token() { reads++; return "mock"; }, other: 2 }));
        import * as star from "./star.js";
        import * as named from "./named.js";
        beforeEach(() => void (reads = 0));
        test("Object.keys()", () => {
          expect(Object.keys(star).sort()).toEqual(["other", "token"]);
          expect(Object.keys(named)).toEqual(["token"]);
          expect(reads).toBe(0);
        });
        test("JSON.stringify() reads each name once", () => {
          expect(JSON.parse(JSON.stringify(star))).toEqual({ token: "mock", other: 2 });
          expect(reads).toBe(1);
        });
      `,
    },
    2,
  );
});

test.concurrent("evicting modules calls no accessor of module.children", async () => {
  await expectFixturesToPass(
    {
      "dep.cjs": `exports.x = "real";`,
      "parent.cjs": `
        require("./dep.cjs");
        const child = module.children[0];
        Object.defineProperty(module.children, 0, { get: () => (globalThis.reads++, child), configurable: true });
      `,
      "children.test.js": `
        import { expect, test, vi } from "bun:test";
        test("of script's", () => {
          globalThis.reads = 0;
          require("./parent.cjs");
          vi.doMock("./dep.cjs", () => ({ x: "mock" }));
          vi.doUnmock("./dep.cjs");
          vi.resetModules();
          expect(globalThis.reads).toBe(0);
        });
      `,
    },
    1,
  );
});

describe.concurrent("a running factory's imports don't wait for its own mock", () => {
  test("after it has removed its mock, or all of them", async () => {
    await expectFixturesToPass(
      {
        "self.js": `import * as self from "./self.js"; export const x = "real";`,
        "user.js": `import "./self.js"; export const y = 1;`,
        "removes.test.js": `
          import { expect, jest, test, vi } from "bun:test";
          test.each([
            ["Bun.plugin.clearAll()", () => Bun.plugin.clearAll()],
            ["Bun.plugin.clearAll() and vi.resetModules()", () => (Bun.plugin.clearAll(), vi.resetModules())],
            ["vi.doUnmock() and vi.resetModules()", () => (vi.doUnmock("./self.js"), vi.resetModules())],
          ])("with %s", async (_, remove) => {
            vi.resetModules();
            const returned = Promise.withResolvers();
            vi.doMock("./self.js", async importOriginal => {
              await null;
              remove();
              returned.resolve(await importOriginal());
              return {};
            });
            expect(() => jest.createMockFromModule("./user.js")).toThrow("require() async module");
            expect({ ...(await returned.promise) }).toEqual({ x: "real" });
          });
        `,
      },
      3,
    );
  });

  test("while another running factory imports a module that waits for this one's mock", async () => {
    await expectFixturesToPass(
      {
        "two.js": `import "./three.js"; import "./four.js"; export { c } from "./five.cjs";`,
        "three.js": `import "./two.js"; import "./four.js"; export const three = 3;`,
        "four.js": `import { c } from "./five.cjs"; export const four = c;`,
        "five.cjs": `try { require("./three.js"); } catch {} exports.c = "real";`,
        "both.test.js": `
          import { expect, test, vi } from "bun:test";
          test("both settle", async () => {
            vi.doMock("./five.cjs", async () => ({ c: "mock, made with " + (await vi.importActual("./two.js")).c }));
            vi.doMock("./three.js", async () => ({ three: "mock, made with " + (await vi.importActual("./three.js")).three }));
            expect({ ...(await import("./three.js")) }).toEqual({ three: "mock, made with 3" });
            expect((await import("./five.cjs")).c).toBe("mock, made with real");
          });
        `,
      },
      1,
    );
  });

  test("through another mock whose original imports the mocked module", async () => {
    await expectFixturesToPass(
      {
        "k.js": `export const x = "real";`,
        "a.js": `import { viaK } from "./b.js"; export const seen = viaK;`,
        "b.js": `import { x } from "./k.js"; export const viaK = x;`,
        "through.test.js": `
          import { expect, test, vi } from "bun:test";
          test("the original", async () => {
            vi.doMock("./b.js", async importOriginal => ({ ...(await importOriginal()), extra: 1 }));
            vi.doMock("./k.js", async () => ({ x: "mock, made with " + (await import("./a.js")).seen }));
            expect((await import("./k.js")).x).toBe("mock, made with real");
          });
        `,
      },
      1,
    );
  });
});

test.concurrent(
  "a factory that replaces an earlier mock and calls jest.resetModules() still installs its own mock",
  async () => {
    await expectFixturesToPass(
      {
        "k.js": `export const x = "real";`,
        "replaces.test.js": `
        import { expect, jest, mock, test, vi } from "bun:test";
        test("the second mock is the module's", async () => {
          vi.doMock("./k.js", () => ({ x: "first" }));
          expect((await import("./k.js")).x).toBe("first");
          mock.module("./k.js", () => (jest.resetModules(), { x: "second" }));
          expect([require("./k.js").x, (await import("./k.js")).x]).toEqual(["second", "second"]);
        });
      `,
      },
      1,
    );
  },
);

describe.concurrent("a test file that has mocked modules", () => {
  test("doesn't leak the modules that imported a mock after it ends", async () => {
    const files: Record<string, string> = { "dep.js": `export const x = "real";` };
    for (let i = 0; i < 20; i++)
      files[`m${i}.js`] =
        `import { x } from "./dep.js"; ${i ? `import "./m${i - 1}.js";` : ""} export const seen = () => x;`;
    for (let i = 0; i < 12; i++)
      files[`a${i}.test.js`] = `
        import { expect, test, vi } from "bun:test";
        import { seen } from "./m19.js";
        vi.mock("./dep.js", () => ({ x: "mock" }));
        export const value = { n: ${i} };
        test("imports a mock", () => expect(seen()).toBe("mock"));
      `;
    files["z.test.js"] = `
      import { heapStats } from "bun:jsc";
      import { expect, test } from "bun:test";
      test("one copy of each module is left at most", () => {
        Bun.gc(true);
        expect(heapStats().objectTypeCounts.ModuleRecord).toBeLessThan(100);
      });
    `;
    await expectFixturesToPass(files, 13);
  });

  test("isn't evaluated again when a later file imports it, and keeps its exports", async () => {
    await expectFixturesToPass(
      {
        "dep.js": `export const x = "real";`,
        "user.js": `import { x } from "./dep.js"; export const seen = () => x;`,
        "a.test.js": `
          import { expect, test, vi } from "bun:test";
          import { seen } from "./user.js";
          vi.mock("./dep.js", () => ({ x: "mock" }));
          globalThis.loaded = (globalThis.loaded ?? 0) + 1;
          export const helper = () => "helper: " + seen();
          export const value = 42;
          export let live = 1;
          export default function () { return "default"; }
          test("a", () => { live = 2; expect(seen()).toBe("mock"); });
        `,
        "b.test.js": `
          import { expect, test } from "bun:test";
          import byDefault, { helper, value, live } from "./a.test.js";
          import * as namespace from "./a.test.js";
          import { seen } from "./user.js";
          test("b", async () => {
            expect([helper(), value, live, byDefault(), Object.keys(namespace).sort()]).toEqual(["helper: mock", 42, 2, "default", ["default", "helper", "live", "value"]]);
            expect([require("./a.test.js").value, (await import("./a.test.js")).value, globalThis.loaded, seen()]).toEqual([42, 42, 1, "real"]);
          });
        `,
      },
      2,
    );
  });
});

describe.concurrent("a module that is being fetched as a mock whose factory has not returned", () => {
  const changes = `[
    ["removed", () => vi.doUnmock("./k.js"), "real"],
    ["replaced", () => vi.doMock("./k.js", () => ({ x: "second" })), "second"],
  ]`;
  test("loads as the real module or the new mock once the mock is removed or replaced", async () => {
    await expectFixturesToPass(
      {
        "k.js": `export const x = "real";`,
        "user.js": `export * from "./k.js";`,
        "again.test.js": `
          import { expect, jest, test, vi } from "bun:test";
          test.each(${changes})("%s, after require() has given up on it", async (_, change, expected) => {
            vi.resetModules();
            vi.doMock("./k.js", () => new Promise(() => {}));
            expect(() => jest.createMockFromModule("./user.js")).toThrow("require() async module");
            change();
            expect((await import("./k.js")).x).toBe(expected);
            vi.doUnmock("./k.js");
          });
          test.each(${changes})("%s, while import() waits for it", async (_, change, expected) => {
            vi.resetModules();
            const called = Promise.withResolvers();
            vi.doMock("./k.js", () => (called.resolve(), new Promise(() => {})));
            const importing = import("./user.js");
            await called.promise;
            change();
            expect([(await import("./k.js")).x, (await importing).x]).toEqual([expected, expected]);
            vi.doUnmock("./k.js");
          });
          test.each(${changes})("%s, and what waits for it is imported again", async (_, change, expected) => {
            vi.resetModules();
            const called = Promise.withResolvers();
            vi.doMock("./k.js", () => (called.resolve(), new Promise(() => {})));
            const importing = import("./user.js");
            await called.promise;
            change();
            expect([(await import("./user.js")).x, (await importing).x]).toEqual([expected, expected]);
            vi.doUnmock("./k.js");
          });
        `,
      },
      6,
    );
  });
});

test.concurrent(
  "an automock is built from the copy of its original module that a running factory was given",
  async () => {
    await expectFixturesToPass(
      {
        "zero.js": `export * from "./two.js";`,
        "one.js": `import "./zero.js";`,
        "two.js": `import "./zero.js"; export const d = "real";`,
        "copy.test.js": `
        import { expect, test, vi } from "bun:test";
        test("while what require() has given up on is still being loaded", async () => {
          vi.doMock("./two.js");
          vi.doMock("./one.js");
          vi.doMock("./zero.js", async importOriginal => (await importOriginal().catch(() => {}), { ...(await importOriginal()) }));
          expect(() => require("./one.js")).toThrow("require() async module");
          const importing = import("./one.js");
          vi.resetModules();
          expect(Object.keys(await vi.importMock("./two.js"))).toEqual(["d"]);
          expect(Object.keys(await importing)).toEqual([]);
        });
      `,
      },
      1,
    );
  },
);

test.concurrent("a module that imports a mock whose factory has failed with the error of another module", async () => {
  await expectFixturesToPass(
    {
      "k.js": `export const x = "real";`,
      "user.js": `import { x } from "./k.js"; export const seen = x;`,
      "broken.js": `import { nope } from "./empty.js";`,
      "empty.js": `export {};`,
      "fails.test.js": `
        import { expect, mock, test } from "bun:test";
        test("fails too, and loads once the factory does not fail", async () => {
          let calls = 0;
          mock.module("./k.js", async () => (calls++, await import("./broken.js")));
          await expect(import("./k.js")).rejects.toThrow("Export named 'nope' not found");
          await expect(import("./user.js")).rejects.toThrow("Export named 'nope' not found");
          mock.module("./k.js", () => ({ x: "mock" }));
          expect([(await import("./user.js")).seen, calls]).toEqual(["mock", 2]);
        });
      `,
    },
    1,
  );
});

describe.concurrent("modules a preload loaded and a test file evicted are restored for the next file", () => {
  const files = {
    "preload.js": `
      import * as helper from "./helper.js";
      globalThis.helper = helper;
      globalThis.store = require("./store.cjs");
    `,
    "db.js": `globalThis.loads = (globalThis.loads ?? 0) + 1; export const name = "db " + globalThis.loads;`,
    "helper.js": `import { name } from "./db.js"; export const who = () => name; export const lazy = () => import("./lazy.js");`,
    "lazy.js": `import { name } from "./db.js"; export const who = () => name;`,
    "store.cjs": `exports.id = globalThis.stores = (globalThis.stores ?? 0) + 1;`,
    "b.test.js": `
      import { expect, test } from "bun:test";
      test("as the preload left it", async () => {
        expect([(await import("./db.js")).name, (await import("./helper.js")) === helper, (await helper.lazy()).who(), helper.who()]).toEqual(["db 1", true, "db 1", "db 1"]);
        expect(require("./store.cjs")).toBe(store);
      });
    `,
  };
  test.each([
    ["vi.resetModules()", `vi.resetModules();`, "db 2"],
    ["vi.resetModules() and a mock", `vi.resetModules(); vi.doMock("./db.js", () => ({ name: "mock" }));`, "mock"],
    ["jest.resetModules()", `jest.resetModules();`, "db 2"],
  ])("%s", async (_, evict, name) => {
    await expectFixturesToPass(
      {
        ...files,
        "a.test.js": `
          import { expect, jest, test, vi } from "bun:test";
          test("loaded again in this file", async () => {
            ${evict}
            expect([(await import("./db.js")).name, (await import("./helper.js")).who(), (await helper.lazy()).who(), helper.who()]).toEqual([${JSON.stringify(name)}, ${JSON.stringify(name)}, ${JSON.stringify(name)}, "db 1"]);
            expect(require("./store.cjs").id).toBe(2);
          });
        `,
      },
      2,
      ["--preload", "./preload.js"],
    );
  });
});

test.concurrent(
  "a module imported with and without a `type` attribute is mocked, re-mocked and unmocked for both imports",
  async () => {
    await expectFixturesToPass(
      {
        "d.json": `{"a":1}`,
        "user.js": `
        import typed from "./d.json" with { type: "json" };
        import plain from "./d.json";
        export const both = () => [typed.a, plain.a];
      `,
        "types.test.js": `
        import { expect, test, vi } from "bun:test";
        test("both", async () => {
          vi.doMock("./d.json", () => ({ default: { a: "first" } }));
          expect((await import("./user.js")).both()).toEqual(["first", "first"]);
          vi.doMock("./d.json", () => ({ default: { a: "second" } }));
          expect((await import("./user.js")).both()).toEqual(["second", "second"]);
          vi.doUnmock("./d.json");
          expect((await import("./user.js")).both()).toEqual([1, 1]);
          vi.doMock("./d.json", () => ({ default: { a: "third" } }));
          expect((await import("./user.js")).both()).toEqual(["third", "third"]);
        });
      `,
      },
      1,
    );
  },
);

test.concurrent(
  "a mock deleted from require.cache by user code doesn't reach the next file through its importers",
  async () => {
    await expectFixturesToPass(
      {
        "dep.js": `export const x = "real";`,
        "user.js": `export * from "./dep.js";`,
        "a.test.js": `
        import { expect, test, vi } from "bun:test";
        import * as user from "./user.js";
        vi.mock("./dep.js", () => ({ x: "mock" }));
        test("stays linked to the mock in this file", () => {
          for (const key of Object.keys(require.cache)) if (key.endsWith("dep.js")) delete require.cache[key];
          expect(user.x).toBe("mock");
        });
      `,
        "b.test.js": `
        import { expect, test } from "bun:test";
        test("is loaded again", async () => {
          expect([(await import("./user.js")).x, require("./user.js").x, (await import("./dep.js")).x]).toEqual(["real", "real", "real"]);
        });
      `,
      },
      2,
    );
  },
);

describe.concurrent("a factory doesn't wait for an onLoad() callback in an unrelated load", () => {
  const files = {
    "k.js": `export const x = "real";`,
    "user.js": `import { x } from "./k.js"; export const seen = x;`,
    "unrelated.js": `export { s } from "./slow.js";`,
    "slow.js": `export const s = 1;`,
  };

  test("it is called while another load is fetching", async () => {
    await expectFixturesToPass(
      {
        ...files,
        "another.test.js": `
          import { expect, test, vi } from "bun:test";
          const started = Promise.withResolvers(), gate = Promise.withResolvers();
          Bun.plugin({
            name: "slow",
            setup(build) {
              build.onLoad({ filter: /slow\\.js$/ }, async () => (started.resolve(), await gate.promise, { contents: "export const s = 2;", loader: "js" }));
            },
          });
          test("the gate is closed", async () => {
            const unrelated = import("./unrelated.js");
            await started.promise;
            vi.doMock("./k.js", () => ({ x: "mock" }));
            expect((await import("./user.js")).seen).toBe("mock");
            gate.resolve();
            expect((await unrelated).s).toBe(2);
          });
        `,
      },
      1,
    );
  });

  test("a fetch that never settles in one file doesn't block the next file's mocks", async () => {
    await expectFixturesToPass(
      {
        ...files,
        "a.test.js": `
          import { test } from "bun:test";
          test("leaves a fetch that never settles", async () => {
            const started = Promise.withResolvers();
            Bun.plugin({
              name: "never",
              setup(build) {
                build.onLoad({ filter: /slow\\.js$/ }, () => (started.resolve(), new Promise(() => {})));
              },
            });
            void import("./unrelated.js");
            await started.promise;
          });
        `,
        "b.test.js": `
          import { expect, test, vi } from "bun:test";
          test("its mock is loaded all the same", async () => {
            vi.doMock("./k.js", () => ({ x: "mock" }));
            expect((await import("./user.js")).seen).toBe("mock");
          });
        `,
      },
      2,
    );
  });

  test("a module that the factory shares with the importers of the mock stays linked to the mock", async () => {
    await expectFixturesToPass(
      {
        ...files,
        "root.js": `import { x } from "./k.js"; import { seen } from "./user.js"; export const both = [x, seen];`,
        "shared.test.js": `
          import { expect, test, vi } from "bun:test";
          test("the factory has a copy", async () => {
            vi.doMock("./k.js", async () => ({ x: "mock, made with " + (await import("./user.js")).seen }));
            expect((await import("./root.js")).both).toEqual(["mock, made with real", "mock, made with real"]);
          });
        `,
      },
      1,
    );
  });

  test("a factory that imports a module another load is fetching gets its own copy", async () => {
    await expectFixturesToPass(
      {
        ...files,
        "other.js": `export { seen } from "./user.js";`,
        "race.test.js": `
          import { expect, test, vi } from "bun:test";
          const started = Promise.withResolvers(), gate = Promise.withResolvers();
          let fetches = 0;
          Bun.plugin({
            name: "held",
            setup(build) {
              build.onLoad({ filter: /user\\.js/ }, async () => (fetches++, started.resolve(), await gate.promise, undefined));
            },
          });
          test("and the other load gets the mock", async () => {
            const other = import("./other.js");
            await started.promise;
            vi.doMock("./k.js", async () => {
              const user = import("./user.js");
              gate.resolve();
              return { x: "mock, made with " + (await user).seen };
            });
            expect((await import("./k.js")).x).toBe("mock, made with real");
            expect([(await other).seen, fetches]).toEqual(["mock, made with real", 2]);
          });
        `,
      },
      1,
    );
  });

  test("but shares a package, which can't import the mocked module and would register itself twice", async () => {
    await expectFixturesToPass(
      {
        ...files,
        "node_modules/registers/package.json": JSON.stringify({
          name: "registers",
          type: "module",
          main: "./index.js",
        }),
        "node_modules/registers/index.js": `export const evaluations = (globalThis.evaluations = (globalThis.evaluations ?? 0) + 1);`,
        "other.js": `export { evaluations } from "registers";`,
        "package.test.js": `
          import { expect, test, vi } from "bun:test";
          const started = Promise.withResolvers(), gate = Promise.withResolvers();
          Bun.plugin({
            name: "held",
            setup(build) {
              build.onLoad({ filter: /registers.index\\.js/ }, async () => (started.resolve(), await gate.promise, undefined));
            },
          });
          test("it is evaluated once", async () => {
            const other = import("./other.js");
            await started.promise;
            vi.doMock("./k.js", async () => {
              const registers = import("registers");
              gate.resolve();
              return { x: (await registers).evaluations };
            });
            expect([(await import("./k.js")).x, (await other).evaluations, globalThis.evaluations]).toEqual([1, 1, 1]);
          });
        `,
      },
      1,
    );
  });
});

describe.concurrent("a factory that loads a module which imports another mock", () => {
  // hook.js is mocked in part. wrapper.js is mocked by a factory that loads the real component, which imports hook.js and store.js.
  const files = {
    "hook.js": `import { everything } from "./everything.js"; export const useHook = () => "real"; export const other = () => everything;`,
    "everything.js": `import { state } from "./store.js"; import { useHook } from "./hook.js"; export const everything = () => [state, useHook];`,
    "store.js": `import { everything } from "./everything.js"; globalThis.stores = (globalThis.stores ?? 0) + 1; export const state = { uses: () => everything };`,
    "wrapper.js": `export const Lazy = () => import("./component.js").then(m => m.Component());`,
    "component.js": `import { useHook } from "./hook.js"; import { state } from "./store.js"; export const Component = () => useHook(); export { state };`,
    "page.js": `import { Lazy } from "./wrapper.js"; import { useHook } from "./hook.js"; export const page = () => [useHook(), Lazy()];`,
  };
  const mocks = `
    import { expect, test, vi } from "vitest";
    vi.mock("./hook.js", async importOriginal => ({ ...(await importOriginal()), useHook: () => "mock" }));
    vi.mock("./wrapper.js", async () => {
      const actual = await vi.importActual("./component.js");
      globalThis.stateOfComponent = actual.state;
      return { Lazy: actual.Component };
    });
    import { page } from "./page.js";
    import { state } from "./store.js";
  `;

  test("is called once the modules behind that mock are fetched, so what it loads gets that mock and shares them", async () => {
    await expectFixturesToPass(
      {
        ...files,
        "shared.test.js": `${mocks}
          test("one of each", () => {
            expect(page()).toEqual(["mock", "mock"]);
            expect([globalThis.stores, globalThis.stateOfComponent === state]).toEqual([1, true]);
          });
        `,
      },
      1,
    );
  });

  test("a mock that waits for the factory is a mock for what the factory loads too", async () => {
    await expectFixturesToPass(
      {
        ...files,
        "everything.js": `import { page } from "./page.js"; ${files["everything.js"]}`,
        "a.test.js": `${mocks}
          test("the original of hook.js imports wrapper.js", () => {
            expect(page()).toEqual(["mock", "mock"]);
          });
        `,
        "b.test.js": `
          import { expect, test } from "vitest";
          import { Component } from "./component.js";
          test("until the file ends", () => {
            expect(Component()).toBe("real");
          });
        `,
      },
      2,
    );
  });
});

test.concurrent(
  "a factory that asks vi.importActual() for another mocked module, which imports the one it mocks",
  async () => {
    await expectFixturesToPass(
      {
        "four.js": `import "./one.cjs"; export const four = 4;`,
        "one.cjs": `exports.a = 1;`,
        "actual.test.js": `
        import { expect, test, vi } from "bun:test";
        test.each([
          ["spied on", { spy: true }],
          ["mocked without a factory", undefined],
        ])("that is %s", async (_, options) => {
          vi.resetModules();
          vi.doMock("./four.js", options);
          vi.doMock("./one.cjs", async () => ({ a: "mock, made with " + (await vi.importActual("./four.js")).four }));
          expect((await import("./four.js")).four).toBe(4);
          expect((await import("./one.cjs")).a).toBe("mock, made with 4");
          vi.doUnmock("./four.js");
          vi.doUnmock("./one.cjs");
        });
      `,
      },
      2,
    );
  },
);

describe.concurrent(
  "two mocks that patch one variable, which two modules export, are both undone when the file ends",
  () => {
    test.each([
      [
        "the module that re-exports it, then the one that re-exports that",
        `
      await mock.module("./inner.js", async () => ({ a: "mock of inner" }));
      await mock.module("./outer.js", async () => ({ a: "mock of outer" }));
    `,
        "mock of outer",
      ],
      [
        "the other way round",
        `
      await mock.module("./outer.js", async () => ({ a: "mock of outer" }));
      await mock.module("./inner.js", async () => ({ a: "mock of inner" }));
    `,
        "mock of inner",
      ],
      [
        "the second without a factory",
        `
      await mock.module("./inner.js", async () => ({ a: "mock of inner" }));
      vi.mock("./outer.js");
    `,
        "mock of inner",
      ],
      [
        "the first made is the last to patch",
        `
      const gate = Promise.withResolvers();
      const patched = mock.module("./inner.js", async () => (await gate.promise, { a: "mock of inner" }));
      await mock.module("./outer.js", async () => ({ a: "mock of outer" }));
      gate.resolve();
      await patched;
    `,
        "mock of inner",
      ],
    ])("%s", async (_, mocks, seen) => {
      await expectFixturesToPass(
        {
          "variable.js": `export const a = "real";`,
          "inner.js": `export * from "./variable.js";`,
          "outer.js": `export * from "./inner.js";`,
          "a.test.js": `
          import { expect, mock, test, vi } from "bun:test";
          test("both are patches in place", async () => {
            const outer = await import("./outer.js");
            ${mocks}
            expect(outer.a).toBe(${JSON.stringify(seen)});
          });
        `,
          "b.test.js": `
          import { expect, test } from "bun:test";
          test("the variable has its value back", async () => {
            expect([(await import("./outer.js")).a, (await import("./inner.js")).a, (await import("./variable.js")).a]).toEqual(["real", "real", "real"]);
          });
        `,
        },
        2,
      );
    });
  },
);

describe.concurrent("vi.mock() with an async factory, of a module that is loaded already", () => {
  const files = {
    "dep.js": `export const who = "real"; export const other = "real other";`,
    "user.js": `import { who } from "./dep.js"; export const viaUser = () => who;`,
    "helper.js": `import { who } from "./dep.js"; export const viaHelper = () => who;`,
    "preload.js": `
      import { vi } from "bun:test";
      import { viaHelper } from "./helper.js";
      vi.mock("./dep.js", () => ({ who: "preload", other: "preload other" }));
    `,
    "a.test.js": `
      import { expect, test } from "bun:test";
      import * as dep from "./dep.js";
      test("loads it", () => expect(dep.who).toBeString());
    `,
    "b.test.js": `
      import { expect, test, vi } from "bun:test";
      import * as dep from "./dep.js";
      import { viaUser } from "./user.js";
      vi.mock("./dep.js", async importOriginal => ({ ...(await importOriginal()), who: "mock" }));
      test("made from the original", () => expect([dep.who, dep.other, viaUser()]).toEqual(["mock", "real other", "mock"]));
    `,
    "c.test.js": `
      import { expect, test, vi } from "bun:test";
      import * as dep from "./dep.js";
      import { viaUser } from "./user.js";
      vi.mock("./dep.js", async () => (await null, { who: "mock" }));
      test("made from nothing", () => expect([dep.who, viaUser()]).toEqual(["mock", "mock"]));
    `,
  };
  test.each([
    ["by an earlier test file", []],
    ["by a preload, as its mock", ["--preload", "./preload.js"]],
    ["by a preload, as its mock, under --isolate", ["--preload", "./preload.js", "--isolate"]],
  ])("%s: the imports of the file get the mock", async (_, args) => {
    await expectFixturesToPass(files, 3, args);
  });
});

describe.concurrent("a module that a preload loaded, after a test file evicts it", () => {
  test("is the same instance, and a new importer still links to all of its re-exports", async () => {
    await expectFixturesToPass(
      {
        "variable.js": `export const four = 4;`,
        "star.js": `export * from "./variable.js";`,
        "later.js": `export * from "./star.js"; export const later = 1;`,
        "preload.js": `globalThis.star = await import("./star.js"); globalThis.variable = await import("./variable.js");`,
        "a.test.js": `
          import { test, vi } from "bun:test";
          test("require()s one of the modules, and resets", () => {
            require("./variable.js");
            vi.resetModules();
          });
        `,
        "b.test.js": `
          import { expect, test } from "bun:test";
          test("the same modules", async () => {
            expect(await import("./variable.js")).toBe(variable);
            expect(await import("./star.js")).toBe(star);
            expect({ ...(await import("./later.js")) }).toEqual({ four: 4, later: 1 });
          });
        `,
      },
      2,
      ["--preload", "./preload.js"],
    );
  });

  test("fails to link again if it failed to link in the preload", async () => {
    await expectFixturesToPass(
      {
        "empty.js": `export {};`,
        "broken.js": `export { nope } from "./empty.js";`,
        "middle.js": `import "./broken.js";`,
        "top.js": `import "./middle.js";`,
        "preload.js": `await import("./top.js").catch(() => {});`,
        "a.test.js": `
          import { test, vi } from "bun:test";
          test("mocks the module in the middle", () => void vi.doMock("./middle.js", { spy: true }));
        `,
        "b.test.js": `
          import { expect, test } from "bun:test";
          test("the same error", async () => {
            await expect(import("./top.js")).rejects.toThrow("nope");
          });
        `,
      },
      2,
      ["--preload", "./preload.js"],
    );
  });

  test.each(["jest.doMock", "mock.module", "vi.doMock"])(
    "a CommonJS module that %s() patched gets its exports back",
    async mock => {
      await expectFixturesToPass(
        {
          "one.cjs": `exports.a = "real";`,
          "user.js": `import * as one from "./one.cjs"; export const seen = () => one.a;`,
          "preload.js": `globalThis.user = await import("./user.js"); globalThis.one = require("./one.cjs");`,
          "a.test.js": `
          import { expect, jest, mock, test, vi } from "bun:test";
          test("mocks it, and resets", () => {
            ${mock}("./one.cjs", () => ({ a: "mock" }));
            vi.resetModules();
            expect(require("./one.cjs").a).toBe("mock");
          });
        `,
          "b.test.js": `
          import { expect, test } from "bun:test";
          test("as the preload left it", async () => {
            expect(require("./one.cjs")).toBe(one);
            expect([one.a, user.seen(), (await import("./user.js")) === user]).toEqual(["real", "real", true]);
          });
        `,
        },
        2,
        ["--preload", "./preload.js"],
      );
    },
  );

  test.each(["jest.doMock", "mock.module", "vi.doMock"])(
    "require() returns the preload's mock again after %s() replaced it in a test file",
    async mock => {
      await expectFixturesToPass(
        {
          "two.js": `export const a = "real";`,
          "user.js": `export { a as seen } from "./two.js";`,
          "preload.js": `
          import { mock } from "bun:test";
          mock.module("./two.js", () => ({ a: "preload" }));
          globalThis.user = await import("./user.js");
        `,
          "a.test.js": `
          import { expect, jest, mock, test, vi } from "bun:test";
          test("mocks it again, and require()s it", () => {
            ${mock}("./two.js", () => ({ a: "file" }));
            expect(require("./two.js").a).toBe("file");
          });
        `,
          "b.test.js": `
          import { expect, test } from "bun:test";
          test("the preload's mock", async () => {
            expect([require("./two.js").a, (await import("./two.js")).a, user.seen, (await import("./user.js")).seen]).toEqual(["preload", "preload", "preload", "preload"]);
          });
        `,
        },
        2,
        ["--preload", "./preload.js"],
      );
    },
  );
});

test.concurrent(
  "a preload's mock is restored, without calling its factory again, after files reset modules and replace it",
  async () => {
    await expectFixturesToPass(
      {
        "dep.js": `export const a = "real";`,
        "user.js": `import * as dep from "./dep.js"; export const seen = () => dep.a;`,
        "preload.js": `
        import { mock } from "bun:test";
        globalThis.calls = 0;
        mock.module("./dep.js", () => (calls++, { a: "preload" }));
        globalThis.user = await import("./user.js");
      `,
        "a.test.js": `
        import { expect, jest, test } from "bun:test";
        test("resets, and imports nothing", () => void jest.resetModules());
      `,
        "b.test.js": `
        import { expect, jest, test } from "bun:test";
        test("mocks it again", async () => {
          jest.doMock("./dep.js", () => ({ a: "file" }));
          expect((await import("./dep.js")).a).toBe("file");
        });
      `,
        "c.test.js": `
        import { expect, test } from "bun:test";
        test("the preload's", async () => {
          expect([(await import("./dep.js")).a, user.seen(), (await import("./user.js")) === user, calls]).toEqual(["preload", "preload", true, 1]);
        });
      `,
      },
      3,
      ["--preload", "./preload.js"],
    );
  },
);

describe.concurrent("a CommonJS module that a preload has loaded", () => {
  test.each(["jest.doMock", "mock.module", "vi.doMock"])(
    "is not patched by %s() once a getter of the mock has evicted it",
    async mock => {
      await expectFixturesToPass(
        {
          "one.cjs": `exports.a = "real";`,
          "preload.js": `await import("./one.cjs"); globalThis.one = require("./one.cjs");`,
          "a.test.js": `
            import { jest, mock, test, vi } from "bun:test";
            test("mocks it", () => {
              ${mock}("./one.cjs", () => ({
                get a() {
                  vi.resetModules();
                  return "mock";
                },
              }));
            });
          `,
          "b.test.js": `
            import { expect, test } from "bun:test";
            test("as the preload left it", async () => {
              expect(require("./one.cjs")).toBe(one);
              expect([one.a, (await import("./one.cjs")).a]).toEqual(["real", "real"]);
            });
          `,
        },
        2,
        ["--preload", "./preload.js"],
      );
    },
  );

  test("is still the preload's instance after a test file imports it and resets modules", async () => {
    await expectFixturesToPass(
      {
        "store.cjs": `exports.id = globalThis.stores = (globalThis.stores ?? 0) + 1;`,
        "preload.js": `globalThis.store = require("./store.cjs");`,
        "a.test.js": `
          import { expect, test, vi } from "bun:test";
          import * as imported from "./store.cjs";
          test("imports it, and resets", () => {
            expect(imported.id).toBe(1);
            vi.resetModules();
            expect(require("./store.cjs").id).toBe(2);
          });
        `,
        "b.test.js": `
          import { expect, test } from "bun:test";
          test("the same module", () => {
            expect(require("./store.cjs")).toBe(store);
          });
        `,
      },
      2,
      ["--preload", "./preload.js"],
    );
  });
});

describe.concurrent("a test file mocks a module that a preload has loaded", () => {
  const apis = {
    vi: {
      mock: "vi.mock",
      inTest: "vi.doMock",
      unmock: "vi.unmock",
      fromOriginal: `async importOriginal => ({ ...(await importOriginal()), who: "file" })`,
    },
    jest: {
      mock: "jest.mock",
      inTest: "jest.doMock",
      unmock: "jest.unmock",
      fromOriginal: `() => ({ ...jest.requireActual("./dep.js"), who: "file" })`,
    },
    mock: { mock: "mock.module", inTest: "mock.module", unmock: "", fromOriginal: "" },
  };

  // user.js is loaded by the test file. helper.js was already loaded by the preload.
  type Row = [who: string, names: string, viaUser: string, viaHelper: string];
  type Rows = Partial<Record<"factory" | "none" | "automock" | "inTest" | "unmock" | "fromOriginal" | "async", Row>>;

  function fixture(name: keyof typeof apis, preloadMocks: boolean, rows: Rows) {
    const api = apis[name];
    const bunTest = `import { expect, jest, mock, test, vi } from "bun:test";`;
    const imports = `
      import * as dep from "./dep.js";
      import { viaUser } from "./user.js";
      import { viaHelper } from "./helper.js";
    `;
    const row = `[dep.who, Object.keys(dep).sort().join(), viaUser(), viaHelper()]`;
    const mocks = {
      factory: `${api.mock}("./dep.js", () => ({ who: "file" }));`,
      none: ``,
      automock: `${api.mock}("./dep.js");`,
      unmock: `${api.unmock}("./dep.js");`,
      fromOriginal: `${api.mock}("./dep.js", ${api.fromOriginal});`,
      async: `${api.mock}("./dep.js", async () => (await null, { who: "file" }));`,
    };
    const preloaded = preloadMocks ? "preload" : "real";
    const files: Record<string, string> = {
      "dep.js": `export const who = "real"; export const other = "real other";`,
      "user.js": `import { who } from "./dep.js"; export const viaUser = () => who;`,
      "helper.js": `import { who } from "./dep.js"; export const viaHelper = () => who;`,
      "preload.js": `
        ${bunTest}
        import { viaHelper } from "./helper.js";
        ${preloadMocks ? `${api.mock}("./dep.js", () => ({ who: "preload", other: "preload other" }));` : ""}
        globalThis.heldByPreload = viaHelper;
      `,
      // Mocks helper.js itself, the module the preload imported.
      "x-helper.test.js": `
        ${bunTest}
        ${imports}
        ${api.mock}("./helper.js", () => ({ viaHelper: () => "file" }));
        test("helper.js", () => {
          expect(${row}).toEqual(${JSON.stringify([preloaded, "other,who", preloaded, "file"])});
          expect([heldByPreload(), viaHelper === heldByPreload]).toEqual([${JSON.stringify(preloaded)}, false]);
        });
      `,
      "z-last.test.js": `
        ${bunTest}
        ${imports}
        test("as the preload left them", () => {
          expect(${row}).toEqual(${JSON.stringify([preloaded, "other,who", preloaded, preloaded])});
          expect(viaHelper).toBe(heldByPreload);
        });
      `,
    };
    for (const [kind, expected] of Object.entries(rows))
      files[`${kind}.test.js`] =
        kind === "inTest"
          ? `
            ${bunTest}
            test("inTest", async () => {
              ${api.inTest}("./dep.js", () => ({ who: "file" }));
              const dep = await import("./dep.js");
              const { viaUser } = await import("./user.js");
              const { viaHelper } = await import("./helper.js");
              expect(${row}).toEqual(${JSON.stringify(expected)});
            });
          `
          : `
            ${bunTest}
            ${imports}
            ${mocks[kind as keyof typeof mocks]}
            test(${JSON.stringify(kind)}, () => expect(${row}).toEqual(${JSON.stringify(expected)}));
          `;
    return files;
  }

  describe.each([
    ["in one process", []],
    ["under --isolate", ["--isolate"]],
  ])("%s", (_, isolate) => {
    // These rows match Vitest 5.0.3 with the preload as a setup file.
    test.each<[string, boolean, Rows]>([
      [
        "and mocked",
        true,
        {
          factory: ["file", "who", "file", "preload"],
          none: ["preload", "other,who", "preload", "preload"],
          automock: ["real", "other,who", "real", "preload"],
          inTest: ["file", "who", "file", "preload"],
          unmock: ["real", "other,who", "real", "preload"],
          fromOriginal: ["file", "other,who", "file", "preload"],
          async: ["file", "who", "file", "preload"],
        },
      ],
      [
        "and not mocked",
        false,
        {
          factory: ["file", "who", "file", "real"],
          none: ["real", "other,who", "real", "real"],
          automock: ["real", "other,who", "real", "real"],
          inTest: ["file", "who", "file", "real"],
          unmock: ["real", "other,who", "real", "real"],
          fromOriginal: ["file", "other,who", "file", "real"],
          async: ["file", "who", "file", "real"],
        },
      ],
    ])("with vi.mock(), modules the preload loaded %s are left as they are", async (_, preloadMocks, rows) => {
      await expectFixturesToPass(fixture("vi", preloadMocks, rows), 9, ["--preload", "./preload.js", ...isolate]);
    });

    test.each<[string, boolean, Rows]>([
      [
        "and mocked",
        true,
        {
          factory: ["file", "who", "file", "file"],
          none: ["preload", "other,who", "preload", "preload"],
          automock: ["real", "other,who", "real", "real"],
          inTest: ["file", "who", "file", "file"],
          unmock: ["real", "other,who", "real", "preload"],
          fromOriginal: ["file", "other,who", "file", "file"],
          async: ["file", "who", "file", "file"],
        },
      ],
      [
        "and not mocked",
        false,
        {
          factory: ["file", "other,who", "file", "file"],
          none: ["real", "other,who", "real", "real"],
          automock: ["real", "other,who", "real", "real"],
          inTest: ["file", "other,who", "file", "file"],
          unmock: ["real", "other,who", "real", "real"],
          fromOriginal: ["file", "other,who", "file", "file"],
          async: ["file", "other,who", "file", "file"],
        },
      ],
    ])("with jest.mock(), the mock reaches modules the preload loaded %s", async (_, preloadMocks, rows) => {
      await expectFixturesToPass(fixture("jest", preloadMocks, rows), 9, ["--preload", "./preload.js", ...isolate]);
    });

    test.each<[string, boolean, string]>([
      ["and mocked", true, "preload"],
      ["and not mocked", false, "real"],
    ])("with mock.module(), the mock reaches modules the preload loaded %s", async (_, preloadMocks, preloaded) => {
      const rows: Rows = {
        factory: ["file", "other,who", "file", "file"],
        none: [preloaded, "other,who", preloaded, preloaded],
        inTest: ["file", "other,who", "file", "file"],
        async: ["file", "other,who", "file", "file"],
      };
      await expectFixturesToPass(fixture("mock", preloadMocks, rows), 6, ["--preload", "./preload.js", ...isolate]);
    });
  });
});

describe.concurrent("vi.doMock() of a module that a preload has loaded and the file has patched before", () => {
  test.each([
    ["mock.module", "dep.js"],
    ["jest.doMock", "dep.js"],
    ["mock.module", "dep.cjs"],
    ["jest.doMock", "dep.cjs"],
  ])("with %s(), undoes the patch of %s", async (patch, dep) => {
    await expectFixturesToPass(
      {
        "dep.js": `export const a = "real";`,
        "dep.cjs": `exports.a = "real";`,
        "helper.js": `import * as dep from "./${dep}"; export const seen = () => dep.a;`,
        "preload.js": `globalThis.helper = await import("./helper.js");`,
        "a.test.js": `
          import { expect, jest, mock, test, vi } from "bun:test";
          test("patches, then mocks", async () => {
            ${patch}("./${dep}", () => ({ a: "patch" }));
            expect(helper.seen()).toBe("patch");
            vi.doMock("./${dep}", () => ({ a: "mock" }));
            expect([(await import("./${dep}")).a, helper.seen()]).toEqual(["mock", "real"]);
          });
        `,
        "b.test.js": `
          import { expect, test } from "bun:test";
          test("as the preload left it", async () => {
            expect([(await import("./${dep}")).a, require("./${dep}").a, helper.seen(), (await import("./helper.js")) === helper]).toEqual(["real", "real", "real", true]);
          });
        `,
      },
      2,
      ["--preload", "./preload.js"],
    );
  });
});

// For a few ticks after a plain factory has returned, the module of its mock is still being fetched. It used to count as a module
// that may wait for the running factory, and with it everything that imports it, so import() gave an empty copy that doesn't wait.
test.concurrent.each([[[]], [["--isolate"]]])(
  "a factory imports a partly mocked module whose original imports a mocked one, after any number of ticks %j",
  async args => {
    const files: Record<string, string> = {};
    const ticks = 16;
    for (let i = 0; i < ticks; i++) {
      files[`${i}/unit.ts`] = `export const unit = "real";`;
      files[`${i}/token.ts`] = `
        import { unit } from "./unit";
        export const token = { unit };
        export function read() { return "real"; }
      `;
      files[`${i}/panel.ts`] = `
        import { token } from "./token";
        export const panel = () => token;
      `;
      files[`${i}/page.ts`] = `
        import { panel } from "./panel";
        import { token, read } from "./token";
        export const page = () => ({ own: token, given: panel(), read: read() });
      `;
      files[`${i}/ticks.test.ts`] = `
        import { expect, test, vi } from "bun:test";
        vi.mock("./unit", () => ({ unit: "mock" }));
        vi.mock("./token", async importOriginal => ({ ...(await importOriginal()), read: () => "mock" }));
        vi.mock("./panel", async () => {
          for (let i = 0; i < ${i}; i++) await null;
          const { token } = await import("./token");
          return { panel: () => token };
        });
        import { page } from "./page";
        test("${i} ticks", () => {
          const { own, given, read } = page();
          expect(own).toEqual({ unit: "mock" });
          expect(given).toBe(own);
          expect(read).toBe("mock");
        });
      `;
    }
    await expectFixturesToPass(files, ticks, args);
  },
);

describe.concurrent("a module that is linked, but not evaluated yet, when it is mocked", () => {
  // linked.test.ts hoists nothing, so all its imports are linked before the first of them is evaluated, which mocks the last.
  function linked(name: string, mocksTax: string, expected: string, startOfTax = "") {
    return {
      [`${name}/tax.ts`]: `
        const evaluations = (globalThis.evaluations ??= {});
        evaluations[import.meta.dir] = (evaluations[import.meta.dir] ?? 0) + 1;
        ${startOfTax}
        export const rate = 0.2;
        export let currency = "EUR";
        export function withTax(net) { return net * (1 + rate); }
      `,
      [`${name}/cart.ts`]: `import { currency, withTax } from "./tax"; export const price = net => withTax(net) + " " + currency;`,
      [`${name}/mocks-tax.ts`]: `
        import { jest, mock, vi } from "bun:test";
        ${mocksTax}
        export const price = net => priceOfCart(net);
      `,
      [`${name}/linked.test.ts`]: `
        import { price } from "./mocks-tax";
        import { expect, test } from "bun:test";
        import * as tax from "./tax";
        test(${JSON.stringify(name)}, () => {
          expect([tax.rate, tax.currency, tax.withTax(10), price(10), globalThis.evaluations[import.meta.dir]]).toEqual(${expected});
        });
      `,
    };
  }
  const statement = `import { price as priceOfCart } from "./cart";`;
  const expression = `const { price: priceOfCart } = await import("./cart");`;
  const spreadsOriginal = `vi.mock("./tax", async importOriginal => ({ ...(await importOriginal()), currency: "USD" }));`;
  const whole = `({ rate: 0.5, currency: "USD", withTax: net => net * 2 })`;
  const partlyMocked = `[0.2, "USD", 12, "12 USD", 1]`;
  const whollyMocked = `[0.5, "USD", 20, "20 USD", 1]`;

  test.each([[[]], [["--isolate"]]])("is evaluated first, so the mock isn't assigned over %j", async args => {
    await expectFixturesToPass(
      {
        ...linked("importOriginal, import statement", spreadsOriginal + statement, partlyMocked),
        ...linked("importOriginal, import expression", spreadsOriginal + expression, partlyMocked),
        ...linked(
          "importOriginal, top-level await in the module",
          spreadsOriginal + statement,
          partlyMocked,
          "await 0;",
        ),
        ...linked(
          "importActual",
          `vi.mock("./tax", async () => ({ ...(await vi.importActual("./tax")), currency: "USD" }));` + statement,
          partlyMocked,
        ),
        ...linked(
          "requireActual",
          `jest.mock("./tax", () => ({ ...jest.requireActual("./tax"), currency: "USD" }));` + statement,
          `[0.2, "USD", 12, "12 USD", expect.any(Number)]`,
        ),
        ...linked("nothing of the original", `vi.mock("./tax", () => ${whole});` + statement, whollyMocked),
        ...linked("mock.module", `mock.module("./tax", () => ${whole});` + expression, whollyMocked),
        ...linked(
          "importOriginal, the module imports the one that mocks it",
          spreadsOriginal + statement,
          partlyMocked,
          `import "./mocks-tax";`,
        ),
      },
      8,
      args,
    );
  });

  // Its body can't run at once then, and would assign over a patch that is made before it.
  test.each([[[]], [["--isolate"]]])("an import of its own has an async factory from a preload %j", async args => {
    await expectFixturesToPass(
      {
        "bunfig.toml": `[test]\npreload = ["./mocks-region.ts"]`,
        "mocks-region.ts": `
          import { vi } from "bun:test";
          vi.mock("./region", async importOriginal => ({ ...(await importOriginal()) }));
        `,
        "region.ts": `export const region = "EU";`,
        "tax.ts": `
          import { region } from "./region";
          export const rate = region === "EU" ? 0.2 : 0.1;
          export let label = "real " + region;
          export class Tax {}
          export function round() { return "real"; }
        `,
        "invoice.ts": `
          import { rate, label, round, Tax } from "./tax";
          export const read = () => [rate, label, round(), Tax.name];
        `,
        "mocks-tax.ts": `
          import { vi } from "bun:test";
          vi.mock("./tax", () => ({ rate: 1, label: "mock", round: () => "mock", Tax: class Mock {} }));
        `,
        "linked.test.ts": `
          import "./mocks-tax";
          import { expect, test, vi } from "bun:test";
          import { read } from "./invoice";
          test("every kind of export is the mock's", async () => {
            expect(read()).toEqual([1, "mock", "mock", "Mock"]);
            const { rate, label, round, Tax } = await vi.importActual("./tax");
            expect([rate, label, round(), Tax.name]).toEqual([0.2, "real EU", "real", "Tax"]);
          });
        `,
      },
      1,
      args,
    );
  });

  // Static imports are all linked before any of them runs. Vitest finishes running each import before it starts the next.
  describe("a Vitest test file with no mock call of its own still runs its imports one at a time", () => {
    const files = {
      "flags.ts": `export const flags = {}; export const limit = 3;`,
      "panel.ts": `
        import { flags, limit } from "./flags";
        export const limitAtLoad = limit;
        export const isOn = () => "on" in flags;
      `,
      "suite.test.ts": `
        import { expect, test, vi } from "vitest";
        import { isOn, limitAtLoad } from "./panel";
        const on = vi.fn(() => true);
        vi.mock("./flags", () => ({
          get flags() { return on() ? { on: 1 } : {}; },
          limit: 1,
          onlyInTheMock: true,
        }));
        test("the suite", () => expect([isOn(), limitAtLoad]).toEqual([true, 1]));
      `,
    };
    const imports = `
      import "./suite.test";
      import { isOn, limitAtLoad } from "./panel";
      import * as flags from "./flags";
    `;
    const own = `test("the file that imports the suite", () => expect([isOn(), limitAtLoad, flags.onlyInTheMock]).toEqual([true, 1, true]));`;

    test.each([
      ["it imports vitest", [], `${imports} import { expect, test } from "vitest"; ${own}`],
      ["it imports vitest", ["--isolate"], `${imports} import { expect, test } from "vitest"; ${own}`],
      ["the globals are those of vitest", ["--globals=vitest"], imports + own],
      ["the globals are those of vitest", ["--globals=vitest", "--isolate"], imports + own],
    ])("%s %j", async (_, args, file) => {
      await expectFixturesToPass({ ...files, "again.test.ts": file }, 2, [...args, "./again.test.ts"]);
    });

    test("a preload does too", async () => {
      await expectFixturesToPass(
        {
          ...files,
          "mocks.ts": `
            import { vi } from "vitest";
            vi.mock("./flags", () => ({ onlyInTheMock: true }));
          `,
          "setup.ts": `
            import "./mocks";
            import * as flags from "./flags";
            globalThis.inSetup = flags.onlyInTheMock;
          `,
          "setup.test.ts": `test("the preload", () => expect(globalThis.inSetup).toBe(true));`,
        },
        1,
        ["--globals=vitest", "--preload=./setup.ts", "./setup.test.ts"],
      );
    });

    test("a bun:test file keeps its static imports", async () => {
      using dir = tempDir("mock-module", {
        "flags.ts": files["flags.ts"],
        "panel.ts": files["panel.ts"],
        "static.test.ts": `
          import { isOn } from "./panel";
          import { absent } from "./flags";
          import { test } from "bun:test";
          test("never runs", () => { isOn(absent); });
        `,
      });
      await using proc = Bun.spawn({
        cmd: [bunExe(), "test", "./static.test.ts"],
        cwd: String(dir),
        env: bunEnv,
        stdout: "ignore",
        stderr: "pipe",
      });
      const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
      expect(stderr).toContain("SyntaxError: Export named 'absent' not found in module");
      expect(exitCode).toBe(1);
    });

    // The file is big enough to be cached, and never mentions the test API by name.
    test("the transpiler cache doesn't mix up a file run as a test with the same file imported", async () => {
      using dir = tempDir("mock-module", {
        "flags.ts": files["flags.ts"],
        "mocks.ts": `
          import { vi } from "vitest";
          vi.mock("./flags", () => ({ onlyInTheMock: true }));
        `,
        "print.ts": `export const print = value => test("prints", () => console.log("only in the mock: " + value));`,
        "again.test.ts": `
          import "./mocks";
          import * as flags from "./flags";
          import { print } from "./print";
          print(flags.onlyInTheMock); // ${"-".repeat(8192)}
        `,
        "importer.test.ts": `import "./again.test";`,
      });
      const cache = join(String(dir), "cache");
      const outputs: string[] = [];
      for (const file of ["./importer.test.ts", "./again.test.ts", "./importer.test.ts"]) {
        await using proc = Bun.spawn({
          cmd: [bunExe(), "test", "--globals=vitest", file],
          cwd: String(dir),
          env: { ...bunEnv, BUN_RUNTIME_TRANSPILER_CACHE_PATH: cache },
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        expect(stderr).toContain(" 1 pass\n 0 fail\n");
        expect(exitCode).toBe(0);
        outputs.push(stdout.match(/only in the mock: \w+/)?.[0] ?? stdout);
      }
      // When it's imported, its own imports stay static, so the mock is applied in place and can't add an export.
      expect(outputs).toEqual(["only in the mock: undefined", "only in the mock: true", "only in the mock: undefined"]);
      expect(readdirSync(cache)).not.toBeEmpty();
    });
  });

  // When a factory finishes, the modules that were linked to the original on its behalf are evicted once nothing is still loading them.
  // Each load that settled used to add another reaction to every load still pending, which doubled the registry walks per load.
  test("evicting modules stays fast while many loads are pending", async () => {
    const loads = 40;
    const files: Record<string, string> = {
      "rate.ts": `export const rate = "real";`,
      "chain.ts": `import { shared } from "./shared"; export { shared };`,
      "shared.ts": `import { rate } from "./rate"; export const shared = () => rate;`,
      "many.test.ts": `
        import { expect, test, vi } from "bun:test";
        const started = Promise.withResolvers();
        vi.mock("./rate", async () => {
          const chain = import("./chain");
          started.resolve();
          await chain;
          return { rate: "mock" };
        });
        const late = [];
        for (let i = 0; i < ${loads}; i++) {
          late.push(Promise.withResolvers());
          vi.doMock("./late" + i, async () => (await late[i].promise, { late: -i }));
        }
        test("every load ends", async () => {
          const rate = import("./rate");
          await started.promise;
          const pending = late.map((_, i) => import("./uses" + i));
          expect((await rate).rate).toBe("mock");
          for (const { resolve } of late) {
            resolve();
            await new Promise(resolve => setImmediate(resolve));
          }
          expect((await Promise.all(pending)).map(uses => uses.late)).toEqual(late.map((_, i) => -i));
        });
      `,
    };
    for (let i = 0; i < loads; i++) {
      files[`late${i}.ts`] = `export const late = ${i};`;
      files[`uses${i}.ts`] = `import { shared } from "./shared"; export { late } from "./late${i}"; export { shared };`;
    }
    await expectFixturesToPass(files, 1);
  });

  test("every file that imports the module that mocks gets the mock", async () => {
    const file = `
      import { price } from "./mocks-tax";
      import { expect, test } from "bun:test";
      import * as tax from "./tax";
      test("the mock", () => expect([tax.currency, price(10)]).toEqual(["USD", "12 USD"]));
    `;
    const { "shared/linked.test.ts": _, ...shared } = linked("shared", spreadsOriginal + statement, "[]");
    await expectFixturesToPass({ ...shared, "shared/first.test.ts": file, "shared/second.test.ts": file }, 2);
  });

  test.each([[[]], [["--isolate"]]])("a package is patched for the modules that have yet to run %j", async args => {
    const file = `
      import "./mocks-rates";
      import { expect, test, vi } from "bun:test";
      import * as esm from "esm-rates";
      import * as cjs from "cjs-rates";
      import { rates } from "./invoice";
      test("the file and what it imports get the mock", async () => {
        expect([esm.base, esm.rate(), cjs.base, cjs.rate(), rates()]).toEqual([0.2, "mock", 0.2, "mock", ["mock", "mock"]]);
        expect([(await vi.importActual("esm-rates")).rate(), (await vi.importActual("cjs-rates")).rate()]).toEqual(["real", "real"]);
        expect(globalThis.evaluationsOfRates).toEqual(["cjs-rates", "esm-rates"]);
      });
    `;
    await expectFixturesToPass(
      {
        "node_modules/esm-rates/package.json": `{ "name": "esm-rates", "type": "module", "main": "index.js" }`,
        "node_modules/esm-rates/index.js": `(globalThis.evaluationsOfRates ??= []).push("esm-rates"); export const base = 0.2; export function rate() { return "real"; }`,
        "node_modules/cjs-rates/package.json": `{ "name": "cjs-rates", "main": "index.js" }`,
        "node_modules/cjs-rates/index.js": `(globalThis.evaluationsOfRates ??= []).push("cjs-rates"); exports.base = 0.2; exports.rate = function rate() { return "real"; };`,
        "invoice.ts": `
          import { rate as esm } from "esm-rates";
          import { rate as cjs } from "cjs-rates";
          export const rates = () => [esm(), cjs()];
        `,
        "mocks-rates.ts": `
          import { vi } from "bun:test";
          vi.mock("esm-rates", async importOriginal => ({ ...(await importOriginal()), rate: () => "mock" }));
          vi.mock("cjs-rates", async importOriginal => ({ ...(await importOriginal()), rate: () => "mock" }));
        `,
        "first.test.ts": file,
        "second.test.ts": file,
        // The file that calls vi.doMock() has run its imports, so it keeps the real package, as in Vitest.
        "third.test.ts": `
          import { expect, test, vi } from "bun:test";
          import * as esm from "esm-rates";
          const factory = vi.fn(() => ({ rate: () => "mock" }));
          vi.doMock("esm-rates", factory);
          test("the file that mocks it itself keeps what it imported", async () => {
            expect([esm.rate(), factory.mock.calls.length]).toEqual(["real", 0]);
            expect([(await import("esm-rates")).rate(), factory.mock.calls.length]).toEqual(["mock", 1]);
          });
        `,
      },
      3,
      args,
    );
  });

  test.each([[[]], [["--isolate"]]])(
    "a module that a preload loaded is patched for the modules that have yet to run %j",
    async args => {
      await expectFixturesToPass(
        {
          "tax.ts": `export const rate = 0.2; export let currency = "EUR";`,
          "preload.ts": `globalThis.preloaded = await import("./tax");`,
          "mocks-tax.ts": `
          import { vi } from "bun:test";
          vi.mock("./tax", async importOriginal => ({ ...(await importOriginal()), currency: "USD" }));
        `,
          "first.test.ts": `
          import "./mocks-tax";
          import { expect, test } from "bun:test";
          import * as tax from "./tax";
          test("the file gets the mock", () => expect([tax.rate, tax.currency]).toEqual([0.2, "USD"]));
        `,
          "second.test.ts": `
          import { expect, test } from "bun:test";
          import * as tax from "./tax";
          test("the next file gets what the preload loaded", () => expect([tax.currency, tax === preloaded]).toEqual(["EUR", true]));
        `,
        },
        2,
        ["--preload", "./preload.ts", ...args],
      );
    },
  );

  test("isn't evaluated ahead of an import that is being evaluated, or if it is the module of an earlier mock", async () => {
    await expectFixturesToPass(
      {
        "imports-back/tax.ts": `import { defaultRate } from "./mocks-tax"; export const rate = defaultRate; export let currency = "EUR";`,
        "imports-back/mocks-tax.ts": `
          import { vi } from "bun:test";
          vi.mock("./tax", async importOriginal => ({ ...(await importOriginal()), currency: "USD" }));
          export const defaultRate = 0.2;
        `,
        "imports-back/linked.test.ts": `
          import "./mocks-tax";
          import { expect, test } from "bun:test";
          import * as tax from "./tax";
          test("it imports the module that mocks it", () => expect([tax.rate, tax.currency]).toEqual([0.2, "USD"]));
        `,
        "preload.ts": `
          import { vi } from "bun:test";
          globalThis.callsOfReplacedFactory = 0;
          vi.mock("./mocked-twice/tax", async importOriginal => (globalThis.callsOfReplacedFactory++, { ...(await importOriginal()), currency: "GBP" }));
        `,
        "mocked-twice/tax.ts": `export const rate = 0.2; export let currency = "EUR";`,
        "mocked-twice/mocks-tax.ts": `
          import { vi } from "bun:test";
          vi.mock("./tax", () => ({ rate: 0.5, currency: "USD" }));
        `,
        "mocked-twice/linked.test.ts": `
          import "./mocks-tax";
          import { expect, test } from "bun:test";
          import * as tax from "./tax";
          test("the factory that was replaced isn't called", () => {
            expect([tax.rate, tax.currency, globalThis.callsOfReplacedFactory]).toEqual([0.5, "USD", 0]);
          });
        `,
      },
      2,
      ["--preload", "./preload.ts"],
    );
  });

  test("because the module imported before it threw", async () => {
    await expectFixturesToPass(
      {
        "throws.ts": `throw new Error("throws.ts threw");`,
        "tax.ts": `export const rate = 0.2;`,
        "throws-too.ts": `export const rate = 0.2; throw new Error("throws-too.ts threw");`,
        "all.ts": `import "./throws"; import "./tax"; import "./throws-too";`,
        "left.test.ts": `
          import { expect, test, vi } from "bun:test";
          test("the mock is what the next import gets, and an error of the module is thrown", async () => {
            await expect(import("./all")).rejects.toThrow("throws.ts threw");
            vi.mock("./tax", () => ({ rate: 0.5 }));
            expect((await import("./tax")).rate).toBe(0.5);
            expect(() => vi.mock("./throws-too", async importOriginal => ({ ...(await importOriginal()) }))).toThrow("throws-too.ts threw");
          });
        `,
      },
      1,
    );
  });
});
