// TODO:
// - Write tests for errors
// - Write tests for Promise
// - Write test for export * from
// - Write test for export {foo} from "./foo"
// - Write test for import {foo} from "./foo"; export {foo}

import { expect, mock, spyOn, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
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

test("adding a default on a module with no default", async () => {
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

test("mocking a bun: module that is not a builtin", async () => {
  mock.module("bun:not-a-builtin", () => {
    return {
      wow: () => 42,
    };
  });

  // @ts-expect-error
  expect((await import("bun:not-a-builtin")).wow()).toBe(42);
  expect(require("bun:not-a-builtin").wow()).toBe(42);
});

test("a factory export getter that throws fails the import", async () => {
  mock.module("mock-module-getter-throws", () => ({
    get a() {
      throw new Error("export getter");
    },
    b: 2,
  }));
  await expect(import("mock-module-getter-throws" as string)).rejects.toThrow("export getter");
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

test("a second mock.module() of a mocked module adds an export that a later importer links against", async () => {
  using dir = tempDir("mock-module-remock-adds-export", {
    "lib.ts": `export const a = "real a";`,
    "uses-b.ts": `import { b } from "./lib";\nexport const readB = () => b;`,
  });
  const path = join(String(dir), "lib.ts");

  mock.module(path, () => ({ a: "mock a" }));
  const first = await import(path);
  expect(first.a).toBe("mock a");

  mock.module(path, () => ({ a: "mock a2", b: "mock b2" }));
  expect(first.a).toBe("mock a2");

  const second = await import(path);
  expect({ a: second.a, b: second.b }).toEqual({ a: "mock a2", b: "mock b2" });

  const { readB } = await import(join(String(dir), "uses-b.ts"));
  expect(readB()).toBe("mock b2");
});

test("mock.module() of an already imported module adds an export to the next import()", async () => {
  using dir = tempDir("mock-module-loaded-adds-export", {
    "other.ts": `export const x = "real x";`,
  });
  const path = join(String(dir), "other.ts");
  const real = await import(path);
  expect(real.x).toBe("real x");

  mock.module(path, () => ({ x: "mock x", y: "mock y" }));
  expect(real.x).toBe("mock x");

  const mocked = await import(path);
  expect({ x: mocked.x, y: mocked.y }).toEqual({ x: "mock x", y: "mock y" });
  expect(require(path).y).toBe("mock y");
});

test("mock.module() that adds a default export to a module without one serves it to the next import()", async () => {
  using dir = tempDir("mock-module-adds-default", {
    "named.ts": `export const n = 1;`,
  });
  const path = join(String(dir), "named.ts");
  await import(path);

  mock.module(path, () => ({ n: 2, default: "mock default", __esModule: true }));
  const mocked = await import(path);
  expect({ n: mocked.n, default: mocked.default, __esModule: mocked.__esModule }).toEqual({
    n: 2,
    default: "mock default",
    __esModule: true,
  });
});

test("mock.module() that adds an export to a loaded barrel re-exports its star and named exports", async () => {
  using dir = tempDir("mock-module-barrel-adds-export", {
    "inner.ts": `export const a = "inner a";\nexport const s = "inner s";`,
    "barrel.ts": `export { a } from "./inner";\nexport * from "./inner";\nexport const own = "own";`,
    "uses.ts": `import { a, s, own, extra } from "./barrel";\nexport const read = () => ({ a, s, own, extra });`,
  });
  const path = join(String(dir), "barrel.ts");
  const inner = await import(join(String(dir), "inner.ts"));
  const barrel = await import(path);

  mock.module(path, () => ({ a: "mock a", extra: "mock extra" }));
  expect([inner.a, barrel.a]).toEqual(["mock a", "mock a"]);
  const after = await import(path);
  expect(Object.keys(after).sort()).toEqual(["a", "extra", "own", "s"]);
  const { read } = await import(join(String(dir), "uses.ts"));
  expect(read()).toEqual({ a: "mock a", s: "inner s", own: "own", extra: "mock extra" });

  mock.module(path, () => ({ a: "mock a2", s: "mock s2", own: "own2" }));
  expect(read()).toEqual({ a: "mock a2", s: "mock s2", own: "own2", extra: "mock extra" });
  expect([inner.a, inner.s, barrel.a, barrel.s, barrel.own]).toEqual([
    "mock a2",
    "mock s2",
    "mock a2",
    "mock s2",
    "own2",
  ]);
});

test("mock.module() that adds an export to a CommonJS module loaded with import() keeps its other exports", async () => {
  using dir = tempDir("mock-module-cjs-adds-export", {
    "lib.cjs": `exports.a = "real a";\nexports.c = "real c";`,
  });
  const path = join(String(dir), "lib.cjs");
  const ns = await import(path);

  mock.module(path, () => ({ a: "mock a", b: "mock b" }));
  expect({ a: ns.a, c: ns.c }).toEqual({ a: "mock a", c: "real c" });
  const after = await import(path);
  expect({ a: after.a, b: after.b, c: after.c }).toEqual({ a: "mock a", b: "mock b", c: "real c" });
  expect(require(path)).toEqual({ a: "mock a", b: "mock b" });

  mock.module(path, () => ({ a: "mock a2" }));
  expect([ns.a, after.a, after.b]).toEqual(["mock a2", "mock a2", "mock b"]);
});

test("mock.module() of a module still awaiting top-level await keeps its entry for later importers", async () => {
  using dir = tempDir("mock-module-tla-in-flight", {
    "lib.ts": `export const a = "real a";\nglobalThis.__tlaStarted.resolve();\nawait globalThis.__tlaGate.promise;\nexport const c = "real c";`,
    "uses-c.ts": `import { c } from "./lib";\nexport const value = c;`,
  });
  const path = join(String(dir), "lib.ts");
  const started = Promise.withResolvers<void>();
  const gate = Promise.withResolvers<void>();
  (globalThis as any).__tlaStarted = started;
  (globalThis as any).__tlaGate = gate;
  try {
    const inFlight = import(path);
    await started.promise;
    mock.module(path, () => ({ a: "mock a", extra: "mock extra" }));
    const later = import(join(String(dir), "uses-c.ts"));
    gate.resolve();
    const ns = await inFlight;
    expect({ a: ns.a, c: ns.c }).toEqual({ a: "mock a", c: "real c" });
    expect((await later).value).toBe("real c");
  } finally {
    delete (globalThis as any).__tlaStarted;
    delete (globalThis as any).__tlaGate;
  }
});

test("a pending factory that adds an export serves it to the next import() once it settles", async () => {
  using dir = tempDir("mock-module-pending-adds-export", {
    "a.ts": `export const a = "real a";\nexport const c = "real c";`,
  });
  const path = join(String(dir), "a.ts");
  const ns = await import(path);

  const factory = Promise.withResolvers<object>();
  const patched = mock.module(path, () => factory.promise);
  factory.resolve({ a: "mock a", b: "mock b" });
  await patched;
  expect(ns.a).toBe("mock a");

  const mocked = await import(path);
  expect({ a: mocked.a, b: mocked.b, c: mocked.c }).toEqual({ a: "mock a", b: "mock b", c: "real c" });
});

test("mock.module() that adds an export keeps the other exports of the loaded module for later importers", async () => {
  using dir = tempDir("mock-module-adds-export-keeps-rest", {
    "lib.ts": `export const a = "real a";\nexport const b = "real b";`,
    "uses-b.ts": `import { b } from "./lib";\nexport const readB = () => b;`,
  });
  const path = join(String(dir), "lib.ts");
  const ns = await import(path);

  mock.module(path, () => ({ a: "mock a", c: "mock c" }));
  expect({ a: ns.a, b: ns.b }).toEqual({ a: "mock a", b: "real b" });

  const mocked = await import(path);
  expect({ a: mocked.a, b: mocked.b, c: mocked.c }).toEqual({ a: "mock a", b: "real b", c: "mock c" });
  const { readB } = await import(join(String(dir), "uses-b.ts"));
  expect(readB()).toBe("real b");
});

test("mock.module() calls after one that added an export patch importers from before and after it", async () => {
  using dir = tempDir("mock-module-remock-after-add", {
    "lib.ts": `export const a = "real a";`,
  });
  const path = join(String(dir), "lib.ts");
  const before = await import(path);

  mock.module(path, () => ({ a: "mock a", b: "mock b" }));
  const added = await import(path);
  expect({ a: added.a, b: added.b }).toEqual({ a: "mock a", b: "mock b" });

  mock.module(path, () => ({ a: "mock a2", c: "mock c" }));
  const addedAgain = await import(path);
  expect({ a: addedAgain.a, b: addedAgain.b, c: addedAgain.c }).toEqual({ a: "mock a2", b: "mock b", c: "mock c" });

  mock.module(path, () => ({ a: "mock a3" }));
  expect(await import(path)).toBe(addedAgain);
  expect([before.a, added.a, addedAgain.a]).toEqual(["mock a3", "mock a3", "mock a3"]);
  expect([added.b, addedAgain.b, addedAgain.c]).toEqual(["mock b", "mock b", "mock c"]);
  expect(require(path).a).toBe("mock a3");
});

test.concurrent("a static import follows every mock.module() in beforeEach when a factory adds an export", async () => {
  using dir = tempDir("mock-module-static-import-remock", {
    "lib.ts": `export const a = "real a";`,
    "remock.test.ts": `
      import { beforeEach, expect, mock, test } from "bun:test";
      import { a } from "./lib";

      let n = 0;
      beforeEach(() => {
        n++;
        mock.module("./lib", () => ({ a: "mock a" + n, default: {} }));
      });

      test("one", () => expect(a).toBe("mock a1"));
      test("two", () => expect(a).toBe("mock a2"));
      test("three", () => expect(a).toBe("mock a3"));
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "./remock.test.ts"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toContain(" 3 pass");
  expect(exitCode).toBe(0);
});

test("an import() in flight when mock.module() adds an export gets the mock and does not evaluate the module again", async () => {
  using dir = tempDir("mock-module-add-export-in-flight", {
    "lib.ts": `globalThis.__libEvaluations = (globalThis.__libEvaluations ?? 0) + 1;\nexport const a = "real a";`,
  });
  const path = join(String(dir), "lib.ts");
  await import(path);

  const inFlight = import(path);
  mock.module(path, () => ({ a: "mock a", b: "mock b" }));
  const fromInFlight = await inFlight;
  expect({ a: fromInFlight.a, b: fromInFlight.b }).toEqual({ a: "mock a", b: "mock b" });
  expect(await import(path)).toBe(fromInFlight);
  expect((globalThis as any).__libEvaluations).toBe(1);
});

test("a factory with __esModule keeps patching the loaded module in place", async () => {
  using dir = tempDir("mock-module-esmodule-flag", {
    "dep.ts": `export default () => "real";`,
  });
  const path = join(String(dir), "dep.ts");
  const ns = await import(path);

  for (const version of ["v1", "v2", "v3"]) {
    mock.module(path, () => ({ __esModule: true, default: () => version }));
    expect(ns.default()).toBe(version);
    expect(await import(path)).toBe(ns);
  }
});

test("mock.module() whose factory only overrides existing exports keeps the module namespace", async () => {
  using dir = tempDir("mock-module-same-exports", {
    "a.ts": `export const a = "real a";\nexport const b = "real b";`,
  });
  const path = join(String(dir), "a.ts");
  const ns = await import(path);

  mock.module(path, () => ({ a: "mock a" }));
  expect(await import(path)).toBe(ns);
  expect({ a: ns.a, b: ns.b }).toEqual({ a: "mock a", b: "real b" });
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

// For a module that isn't loaded yet, mock.module() only registers the factory. import() runs it.
test.concurrent.each([
  ["undefined", `async () => { await 1; }`],
  ["a number", `async () => { await 1; return 42; }`],
])("import() of a module that isn't loaded yet rejects when the factory promise resolves to %s", async (_, factory) => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `import { mock } from "bun:test";
      mock.module("mm-async-non-object", ${factory});
      try {
        await import("mm-async-non-object");
        console.log("imported");
      } catch (e) {
        console.log("rejected:", e?.message);
      }`,
    ],
    env: bunEnv,
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout).toBe("rejected: mock(module, fn) requires a function that returns an object\n");
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
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

// In a URL, the "%de" in "50%deposit.ts" escapes the byte 0xDE, which isn't valid UTF-8. Windows decodes it to U+FFFD.
test.concurrent.skipIf(isWindows)("supports module names with a % that isn't a valid UTF-8 escape", async () => {
  using dir = tempDir("mock-module-percent", {
    "real%deposit.ts": `export default "the real file";`,
    "percent.test.ts": `
      import { expect, mock, test } from "bun:test";

      test("mocks a relative name that doesn't resolve", async () => {
        mock.module("./50%deposit.ts", () => ({ default: "the mock" }));
        expect((await import("./50%deposit.ts")).default).toBe("the mock");
        expect(require("./50%deposit.ts").default).toBe("the mock");
      });

      test("mock.module() of a file: URL throws", () => {
        expect(() => mock.module("file:///50%deposit.ts", () => ({}))).toThrow(new TypeError('Invalid "file:" URL'));
      });

      test("loads a real file with a % in its name", async () => {
        expect((await import("./real%deposit.ts")).default).toBe("the real file");
      });

      test("import() of a file: URL rejects", async () => {
        await expect(import("file:///50%deposit.ts")).rejects.toThrow("Cannot find module");
      });
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "./percent.test.ts"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toContain(" 4 pass\n 0 fail");
  expect(exitCode).toBe(0);
});
