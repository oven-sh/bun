// TODO:
// - Write tests for errors
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

// https://github.com/oven-sh/bun/issues/6751
describe("mock.module with an async factory when the module is already loaded", () => {
  function check(name: string, files: Record<string, string>) {
    test.concurrent(
      name,
      async () => {
        using dir = tempDir("mock-module-async-factory", {
          "dep.ts": `export const getValue = () => "real";\n`,
          "dep.mock.ts": `export const getValue = () => "mocked";\n`,
          ...files,
        });
        await using proc = Bun.spawn({
          cmd: [bunExe(), "test", "fixture.test.ts"],
          env: bunEnv,
          cwd: String(dir),
          stdout: "pipe",
          stderr: "pipe",
          timeout: 10000,
          killSignal: "SIGKILL",
        });
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        expect({ stderr, signal: proc.signalCode }).toEqual({
          stderr: expect.stringContaining("1 pass"),
          signal: null,
        });
        expect(exitCode).toBe(0);
      },
      15000,
    );
  }

  check("factory using import() does not hang and overrides the namespace", {
    "fixture.test.ts": `
      import { expect, test, mock } from "bun:test";
      import { getValue } from "./dep";
      await mock.module("./dep", () => import("./dep.mock"));
      test("t", () => {
        expect(getValue()).toBe("mocked");
      });
    `,
  });

  check("factory awaiting an event-loop tick does not hang and overrides the namespace", {
    "fixture.test.ts": `
      import { expect, test, mock } from "bun:test";
      import { getValue } from "./dep";
      await mock.module("./dep", async () => {
        await new Promise(resolve => setImmediate(resolve));
        return { getValue: () => "mocked" };
      });
      test("t", () => {
        expect(getValue()).toBe("mocked");
      });
    `,
  });

  check("factory reached via a transitive static import does not hang", {
    "consumer.ts": `
      import { getValue } from "./dep";
      export const callDep = () => getValue();
    `,
    "fixture.test.ts": `
      import { expect, test, mock } from "bun:test";
      import { callDep } from "./consumer";
      await mock.module("./dep", () => import("./dep.mock"));
      test("t", () => {
        expect(callDep()).toBe("mocked");
      });
    `,
  });

  check("factory rejecting propagates the rejection to the returned promise", {
    "fixture.test.ts": `
      import { expect, test, mock } from "bun:test";
      import { getValue } from "./dep";
      test("t", async () => {
        const p = mock.module("./dep", async () => {
          await new Promise(resolve => setImmediate(resolve));
          throw new Error("factory-boom");
        });
        await expect(p).rejects.toThrow("factory-boom");
        expect(getValue()).toBe("real");
      });
    `,
  });

  check("sync factory on an already-loaded module returns undefined", {
    "fixture.test.ts": `
      import { expect, test, mock } from "bun:test";
      import { getValue } from "./dep";
      test("t", () => {
        const r = mock.module("./dep", () => ({ getValue: () => "mocked" }));
        expect(r).toBeUndefined();
        expect(getValue()).toBe("mocked");
      });
    `,
  });

  check("factory is not executed when the module has never been loaded", {
    "fixture.test.ts": `
      import { expect, test, mock } from "bun:test";
      let called = 0;
      test("t", async () => {
        const r = mock.module("never-loaded-module", () => {
          called++;
          return { a: 1 };
        });
        expect(r).toBeUndefined();
        expect(called).toBe(0);
        const m = await import("never-loaded-module");
        expect(m.a).toBe(1);
        expect(called).toBe(1);
      });
    `,
  });

  check("factory returning a module namespace object overrides the already-loaded namespace", {
    "fixture.test.ts": `
      import { expect, test, mock } from "bun:test";
      import { getValue } from "./dep";
      import * as depMock from "./dep.mock";
      mock.module("./dep", () => depMock);
      test("t", () => {
        expect(getValue()).toBe("mocked");
      });
    `,
  });
});
