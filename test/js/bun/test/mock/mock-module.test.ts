// TODO:
// - Write tests for errors
// - Write tests for Promise
// - Write tests for Promise rejection
// - Write tests for pending promise when a module already exists
// - Write test for export * from
// - Write test for export {foo} from "./foo"
// - Write test for import {foo} from "./foo"; export {foo}

import { expect, mock, spyOn, test } from "bun:test";
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

// https://github.com/oven-sh/bun/issues/30242
// The factory receives the module's current exports as its first argument,
// so partial stubbing can delegate to the real implementation without
// recursing through the live namespace (which has been replaced by the
// mock's own exports by the time the stub runs).
test("factory receives current exports as first argument (partial-stub delegation)", async () => {
  mock.module("mock-partial-stub-pkg", () => ({
    greet: () => "real",
    leave: () => "goodbye",
  }));
  await import("mock-partial-stub-pkg");

  mock.module("mock-partial-stub-pkg", original => ({
    ...original,
    greet: () => `wrapped: ${original.greet()}`,
  }));

  const stubbed = await import("mock-partial-stub-pkg");
  // @ts-expect-error dynamic package, no types
  expect(stubbed.greet()).toBe("wrapped: real");
  // @ts-expect-error dynamic package, no types
  expect(stubbed.leave()).toBe("goodbye");
});

test("factory argument is a snapshot — later mutations to the live namespace do not affect it", async () => {
  mock.module("mock-snapshot-pkg", () => ({
    value: 1,
    read: () => 1,
  }));
  await import("mock-snapshot-pkg");

  let capturedOriginal: any;
  mock.module("mock-snapshot-pkg", original => {
    capturedOriginal = original;
    return {
      value: 2,
      read: () => original.read(),
    };
  });

  const stubbed = await import("mock-snapshot-pkg");
  // @ts-expect-error dynamic package, no types
  expect(stubbed.value).toBe(2);
  // @ts-expect-error dynamic package, no types
  expect(stubbed.read()).toBe(1);
  // The snapshot is detached from the live namespace — it kept the original values.
  expect(capturedOriginal.value).toBe(1);
  expect(capturedOriginal.read()).toBe(1);
});

test("factory argument is an empty object when the module has not been loaded yet", async () => {
  let argumentReceived: any;
  mock.module("mock-never-loaded-before-mock-pkg", original => {
    argumentReceived = original;
    return { ok: true };
  });

  const stubbed = await import("mock-never-loaded-before-mock-pkg");
  // @ts-expect-error dynamic package, no types
  expect(stubbed.ok).toBe(true);
  expect(argumentReceived).toEqual({});
});

test("factory argument works for CJS modules loaded via require()", () => {
  mock.module("mock-cjs-partial-stub-pkg", () => ({
    original: () => "cjs-real",
  }));
  // Prime the CJS require cache.
  const first = require("mock-cjs-partial-stub-pkg");
  expect(first.original()).toBe("cjs-real");

  mock.module("mock-cjs-partial-stub-pkg", original => ({
    ...original,
    wrapped: () => `wrapped: ${original.original()}`,
  }));

  const second = require("mock-cjs-partial-stub-pkg");
  expect(second.original()).toBe("cjs-real");
  expect(second.wrapped()).toBe("wrapped: cjs-real");
});

test("factory argument preserves callable CJS exports (`module.exports = function`)", () => {
  // The fixture does `module.exports = function callable() { ... }` — the CJS
  // exports slot is a bare function, not a property bag. When `mock.module`
  // installs the first override, the factory's `original` must still be
  // callable so partial stubs can wrap or delegate to the real function.
  const realFn: any = require("./mock-module-callable-cjs-fixture.cjs");
  expect(typeof realFn).toBe("function");
  expect(realFn()).toBe("callable-real");

  let receivedOriginal: any;
  mock.module("./mock-module-callable-cjs-fixture.cjs", original => {
    receivedOriginal = original;
    return function wrapped() {
      return `wrapped: ${original()}`;
    };
  });

  const stubbedFn: any = require("./mock-module-callable-cjs-fixture.cjs");
  expect(typeof receivedOriginal).toBe("function");
  expect(receivedOriginal()).toBe("callable-real");
  expect(typeof stubbedFn).toBe("function");
  expect(stubbedFn()).toBe("wrapped: callable-real");
});
