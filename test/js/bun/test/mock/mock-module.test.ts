// TODO:
// - Write tests for errors
// - Write tests for Promise
// - Write test for export * from
// - Write test for export {foo} from "./foo"
// - Write test for import {foo} from "./foo"; export {foo}

import { expect, mock, spyOn, test } from "bun:test";
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
  // The failed mock does not stay registered.
  expect(require(path).a()).toBe("real-a");

  // Already rejected when the factory returns: thrown, and not also reported as an unhandled rejection.
  expect(() =>
    mock.module(path, async () => {
      throw error;
    }),
  ).toThrow(error);
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
