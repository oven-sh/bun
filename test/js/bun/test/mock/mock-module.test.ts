// TODO:
// - Write tests for errors
// - Write tests for Promise
// - Write tests for Promise rejection
// - Write tests for pending promise when a module already exists
// - Write test for export * from
// - Write test for export {foo} from "./foo"
// - Write test for import {foo} from "./foo"; export {foo}

import { expect, mock, spyOn, test } from "bun:test";
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

// require() used to hand every "node:" id straight to the builtin table. That threw for a mocked
// name that is not a builtin and skipped the mock of a name that is, while import() returned the
// mock in both cases.
test("mocking a node: name that is not a builtin applies to require()", async () => {
  mock.module("node:i-am-not-a-builtin", () => ({ default: 42, named: "yes" }));

  const required = require("node:i-am-not-a-builtin");
  expect({ ...required }).toEqual({ default: 42, named: "yes" });
  expect(require("node:i-am-not-a-builtin")).toBe(required);
  // @ts-expect-error
  expect(await import("node:i-am-not-a-builtin")).toBe(required);
  expect(require.resolve("node:i-am-not-a-builtin")).toBe("node:i-am-not-a-builtin");
});

test("mocking a node: name with __esModule returns the default export from require()", () => {
  const defaultExport = { unwrapped: true };
  mock.module("node:i-am-not-a-builtin-either", () => ({ __esModule: true, default: defaultExport }));

  expect(require("node:i-am-not-a-builtin-either")).toBe(defaultExport);
});

test("mocking a builtin applies to require() like it does to import()", async () => {
  mock.module("querystring", () => ({ stringify: () => "mocked" }));

  const imported = await import("node:querystring");
  expect(imported.stringify({})).toBe("mocked");
  expect(require("node:querystring")).toBe(imported);
  expect(require("querystring")).toBe(imported);
});

test("outside of bun test, a node: mock applies to require() unless a builtin has that name", async () => {
  using dir = tempDir("mock-module-node-prefix", {
    "index.ts": `
      import { mock } from "bun:test";

      mock.module("node:i-am-not-a-builtin", () => ({ default: 42 }));
      mock.module("node:querystring", () => ({ stringify: () => "mocked" }));

      function attempt(fn) {
        try {
          return fn();
        } catch (error) {
          return "threw: " + error.message;
        }
      }

      console.log(
        JSON.stringify({
          importedMock: (await import("node:i-am-not-a-builtin")).default,
          requiredMock: attempt(() => require("node:i-am-not-a-builtin").default),
          importedBuiltin: (await import("node:querystring")).stringify({ a: 1 }),
          requiredBuiltin: attempt(() => require("node:querystring").stringify({ a: 1 })),
        }),
      );
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "index.ts"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // The script reports its own failures, so empty stdout means it crashed.
  expect(stdout.trim() ? JSON.parse(stdout) : { crashed: stderr }).toEqual({
    importedMock: 42,
    requiredMock: 42,
    // Builtins cannot be mocked outside of `bun test`; require() agrees with import() on that.
    importedBuiltin: "a=1",
    requiredBuiltin: "a=1",
  });
  expect(exitCode).toBe(0);
});
