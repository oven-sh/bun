// TODO:
// - Write tests for errors
// - Write tests for Promise
// - Write tests for Promise rejection
// - Write tests for pending promise when a module already exists
// - Write test for export * from
// - Write test for export {foo} from "./foo"
// - Write test for import {foo} from "./foo"; export {foo}

import { describe, expect, mock, spyOn, test } from "bun:test";
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

// `() => mock.module(...)` is a proper tail call (test files are modules, so strict mode), which
// replaces the callback's frame with mock.module's own. When the test runner is what invoked the
// callback, nothing below mock.module on the stack says which file made the call, so the specifier
// has to be resolved against the file the callback was defined in. Each scenario imports the module
// first: the mock only takes effect if the specifier resolves to the path that is already loaded.
describe("mock.module() tail-called from a callback the runner invokes", () => {
  async function runBunTest(dir: string, ...args: string[]) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", ...args],
      cwd: dir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    return { stderr, exitCode };
  }

  const dep = `export const value = "real";\n`;
  const mocked = `() => ({ value: "mocked" })`;

  const shapes: [shape: string, register: string, passing: number][] = [
    ["beforeAll", `beforeAll(() => mock.module("./dep", ${mocked}));`, 1],
    ["beforeEach", `beforeEach(() => mock.module("./dep", ${mocked}));`, 1],
    ["describe body", `describe("registers", () => mock.module("./dep", ${mocked}));`, 1],
    ["test body", `test("registers", () => mock.module("./dep", ${mocked}));`, 2],
    ["test.each body", `test.each(["./dep"])("registers %s", specifier => mock.module(specifier, ${mocked}));`, 2],
    ["beforeAll with a relative file: URL", `beforeAll(() => mock.module("file:./dep.ts", ${mocked}));`, 1],
  ];

  test.concurrent.each(shapes)("%s", async (_shape, register, passing) => {
    using dir = tempDir("mock-module-tail-call", {
      "dep.ts": dep,
      "tail.test.ts": `
        import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
        import { value } from "./dep";
        ${register}
        test("mock applied to the already-imported module", () => expect(value).toBe("mocked"));
      `,
    });

    const { stderr, exitCode } = await runBunTest(String(dir), "tail.test.ts");
    expect(stderr).toContain(` ${passing} pass`);
    expect(exitCode).toBe(0);
  });

  test.concurrent("a package specifier is resolved to the loaded package", async () => {
    using dir = tempDir("mock-module-tail-call-pkg", {
      "node_modules/some-pkg/package.json": `{ "name": "some-pkg", "main": "index.js" }`,
      "node_modules/some-pkg/index.js": dep,
      "tail.test.ts": `
        import { beforeAll, expect, mock, test } from "bun:test";
        import { value } from "some-pkg";
        beforeAll(() => mock.module("some-pkg", ${mocked}));
        test("mock applied to the already-imported package", () => expect(value).toBe("mocked"));
      `,
    });

    const { stderr, exitCode } = await runBunTest(String(dir), "tail.test.ts");
    expect(stderr).toContain(" 1 pass");
    expect(exitCode).toBe(0);
  });

  test.concurrent("a hook from --preload resolves against the preload file, not the test file", async () => {
    using dir = tempDir("mock-module-tail-call-preload", {
      "setup/preload.ts": `
        import { beforeAll, mock } from "bun:test";
        beforeAll(() => mock.module("./dep", ${mocked}));
      `,
      "setup/dep.ts": dep,
      "dep.ts": `export const value = "sibling of the test file";\n`,
      "app.test.ts": `
        import { expect, test } from "bun:test";
        import { value } from "./setup/dep";
        import { value as sibling } from "./dep";
        test("./dep meant the preload's neighbor", () => {
          expect({ value, sibling }).toEqual({ value: "mocked", sibling: "sibling of the test file" });
        });
      `,
    });

    const { stderr, exitCode } = await runBunTest(String(dir), "--preload", "./setup/preload.ts", "app.test.ts");
    expect(stderr).toContain(" 1 pass");
    expect(exitCode).toBe(0);
  });
});
