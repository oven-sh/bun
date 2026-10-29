import * as imported from "bun:test";
import { describe, expect, test } from "bun:test";
import { bunExe, tempDir } from "harness";
import Module, { createRequire } from "node:module";
import { join } from "node:path";
import { run } from "../../../aot/harness/run";

// Computed, so that `require` learns the name when it runs.
const specifier = ["bun", "test"].join(":");

const loader = `
exports.module = module;
exports.load = name => require(name);
exports.resolve = name => require.resolve(name);
exports.cached = () => Object.keys(require.cache);
`;

interface Loader {
  module: NodeJS.Module;
  load(name: string): unknown;
  resolve(name: string): string;
  cached(): string[];
}

function loaders() {
  const dir = tempDir("require-bun-test", { "first.cjs": loader, "second.cjs": loader });
  const first: Loader = require(join(String(dir), "first.cjs"));
  const second: Loader = require(join(String(dir), "second.cjs"));
  return { first, second, [Symbol.dispose]: () => dir[Symbol.dispose]() };
}

describe("require('bun:test') under a computed name, in bun test", () => {
  test("answers the object that an import answers", () => {
    using files = loaders();
    const required = files.first.load(specifier) as typeof imported;
    expect(required).toBe(imported.default);
    expect(required.test).toBe(test);
    expect(required.expect).toBe(expect);
    expect(required.describe).toBe(describe);
  });

  test("answers the same object in every file and through every kind of require", () => {
    using files = loaders();
    const required = files.first.load(specifier);
    expect(files.second.load(specifier)).toBe(required);
    expect(files.first.module.require(specifier)).toBe(required);
    expect(createRequire(import.meta.url)(specifier)).toBe(required);
    expect(createRequire(files.second.module.filename)(specifier)).toBe(required);
    expect(Module.prototype.require.call(files.first.module, specifier)).toBe(required);
  });

  test("resolves to itself", () => {
    using files = loaders();
    expect(files.first.resolve(specifier)).toBe("bun:test");
    expect(createRequire(import.meta.url).resolve(specifier)).toBe("bun:test");
  });

  test("leaves nothing in require.cache or in module.children", () => {
    using files = loaders();
    const cached = files.first.cached();
    files.first.load(specifier);
    expect(files.first.cached()).toEqual(cached);
    expect(files.first.cached()).not.toContain("bun:test");
    expect(files.first.module.children).toEqual([]);
  });

  test("a query is not part of the name", () => {
    using files = loaders();
    expect(() => files.first.load(specifier + "?query")).toThrow("Cannot find module 'bun:test?query'");
    expect(() => files.first.resolve(specifier + "?query")).toThrow("Cannot find module 'bun:test?query'");
  });

  test("the receiver of Module.prototype.require need not be a module", () => {
    using files = loaders();
    const receiver = { filename: files.first.module.filename };
    expect(Module.prototype.require.call(receiver as NodeJS.Module, specifier)).toBe(files.first.load(specifier));
  });

  test("refuses a file name that is not an absolute path", () => {
    using files = loaders();
    const requireFrom = (filename: unknown) => () =>
      Module.prototype.require.call({ filename } as NodeJS.Module, specifier);
    expect(requireFrom("relative.js")).toThrow("Bun.jest() expects an absolute file path, got 'relative.js'");
    expect(requireFrom(5)).toThrow("Bun.jest() expects a string filename");
    expect(requireFrom(undefined)).toThrow("Bun.jest() expects a string filename");

    files.first.module.filename = "relative.js";
    expect(() => files.first.load(specifier)).toThrow("Bun.jest() expects an absolute file path, got 'relative.js'");
  });
});

test.concurrent("require('bun:test') under a computed name, outside bun test", async () => {
  using dir = tempDir("require-bun-test-outside", {
    "main.cjs": `
      const Module = require("node:module");
      const name = process.argv[2];
      const required = require(name);
      console.log(Object.keys(required).sort().join(" "));
      console.log(required === require(name), required === module.require(name), required === Module.createRequire(__filename)(name));
      console.log(require.resolve(name), Object.keys(require.cache).includes(name), module.children.length);
      try {
        required.test("never runs", () => {});
      } catch (error) {
        console.log(error.message);
      }
      // No file name is looked at while no test runs.
      module.filename = "relative.js";
      console.log(required === require(name), required === Module.prototype.require.call({}, name));
      import(name).then(namespace => console.log(namespace.default === required, namespace.test === required.test));
    `,
  });
  const { stdout, exitCode } = await run([bunExe(), "main.cjs", specifier], String(dir));
  expect(stdout.split("\n")).toEqual([
    "afterAll afterEach beforeAll beforeEach describe expect expectTypeOf it jest mock onTestFinished setDefaultTimeout setSystemTime spyOn test vi xdescribe xit xtest",
    "true true true",
    "bun:test false 0",
    'Cannot use test outside of the test runner. Run "bun test" to run tests.',
    "true true",
    "true true",
    "",
  ]);
  expect(exitCode).toBe(0);
});

test.concurrent("require('bun:test') under a computed name, in a preloaded file", async () => {
  using dir = tempDir("require-bun-test-preload", {
    "preload.cjs": `
      const name = ["bun", "test"].join(":");
      module.filename = "relative.js";
      globalThis.fromPreload = require(name);
    `,
    "uses-preload.test.cjs": `
      const name = ["bun", "test"].join(":");
      const { test, expect } = require(name);
      test("the preloaded file got the same object", () => {
        expect(globalThis.fromPreload).toBe(require(name));
      });
    `,
  });
  const { stderr, exitCode } = await run(
    [bunExe(), "test", "--preload", "./preload.cjs", "./uses-preload.test.cjs"],
    String(dir),
  );
  expect(stderr).toContain("1 pass");
  expect(stderr).toContain("0 fail");
  expect(exitCode).toBe(0);
});
