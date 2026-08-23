// TODO:
// - Write tests for errors
// - Write tests for Promise
// - Write test for export * from
// - Write test for export {foo} from "./foo"
// - Write test for import {foo} from "./foo"; export {foo}

import { expect, mock, spyOn, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, normalizeBunSnapshot, tempDir } from "harness";
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

// A pending factory promise is only reachable when the module is already in the
// registry, and the failure mode when it regresses is a spinning hang rather than a
// failed assertion — so these run out of process behind a kill deadline instead of
// hanging this file.
// Must fire before the per-test timeout below, so a regression fails the `hung`
// assertion rather than timing out and orphaning a spinning subprocess. Debug and
// ASAN builds spawn far slower than release, so the bound scales with them.
const HANG_DEADLINE_MS = isASAN ? 60_000 : isDebug ? 30_000 : 10_000;
const TEST_TIMEOUT_MS = HANG_DEADLINE_MS + 15_000;

async function runMockFile(files: Record<string, string>, entry: string) {
  using dir = tempDir("mock-module-pending", files);
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", entry],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  let hung = false;
  const deadline = setTimeout(() => {
    hung = true;
    proc.kill(9);
  }, HANG_DEADLINE_MS);
  try {
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    return { stderr: normalizeBunSnapshot(stderr, dir), exitCode, hung };
  } finally {
    clearTimeout(deadline);
  }
}

test.concurrent(
  "a factory promise still pending on return patches an already-imported module",
  async () => {
    const { stderr, exitCode, hung } = await runMockFile(
      {
        "moduleA.ts": `export function a() { return "real-a"; }`,
        "pending.test.ts": `
        import { expect, mock, test } from "bun:test";
        mock.module("./moduleA", async () => {
          await Promise.resolve();
          return { a: () => "mocked-a" };
        });
        import { a } from "./moduleA";
        test("patched", () => { expect(a()).toBe("mocked-a"); });
      `,
      },
      "pending.test.ts",
    );
    expect(hung).toBe(false);
    expect(stderr).toContain("1 pass");
    expect(stderr).toContain("0 fail");
    expect(exitCode).toBe(0);
  },
  TEST_TIMEOUT_MS,
);

test.concurrent(
  "a factory awaiting a dynamic import patches an already-imported module",
  async () => {
    const { stderr, exitCode, hung } = await runMockFile(
      {
        "moduleA.ts": `export function a() { return "real-a"; }`,
        "partial.test.ts": `
        import { expect, mock, test } from "bun:test";
        mock.module("./moduleA", () =>
          (async () => {
            const real = await import("./moduleA?actual");
            return { a: mock(() => "mocked-" + real.a()) };
          })(),
        );
        import { a } from "./moduleA";
        test("partially mocked", () => { expect(a()).toBe("mocked-real-a"); });
      `,
      },
      "partial.test.ts",
    );
    expect(hung).toBe(false);
    expect(stderr).toContain("1 pass");
    expect(stderr).toContain("0 fail");
    expect(exitCode).toBe(0);
  },
  TEST_TIMEOUT_MS,
);

test.concurrent(
  "a factory promise that rejects asynchronously throws from mock.module",
  async () => {
    const { stderr, exitCode, hung } = await runMockFile(
      {
        "moduleB.ts": `export const b = 1;`,
        "rejects.test.ts": `
        import { expect, mock, test } from "bun:test";
        mock.module("./moduleB", async () => {
          await Promise.resolve();
          throw new Error("factory boom");
        });
        import { b } from "./moduleB";
        test("unreachable", () => { expect(b).toBe(1); });
      `,
      },
      "rejects.test.ts",
    );
    expect(hung).toBe(false);
    expect(stderr).toContain("factory boom");
    expect(exitCode).not.toBe(0);
  },
  TEST_TIMEOUT_MS,
);

test("a factory promise that resolves to a non-object is rejected like the synchronous case", () => {
  expect(() => mock.module("./mock-module-fixture", async () => 42)).toThrow(
    "mock(module, fn) requires a function that returns an object",
  );
});
