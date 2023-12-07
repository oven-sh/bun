import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { _nodeModulePaths, builtinModules, isBuiltin, wrap } from "module";
import Module from "module";
import path from "path";

test("builtinModules exists", () => {
  expect(Array.isArray(builtinModules)).toBe(true);
  expect(builtinModules).toHaveLength(77);
});

test("isBuiltin() works", () => {
  expect(isBuiltin("fs")).toBe(true);
  expect(isBuiltin("path")).toBe(true);
  expect(isBuiltin("crypto")).toBe(true);
  expect(isBuiltin("assert")).toBe(true);
  expect(isBuiltin("util")).toBe(true);
  expect(isBuiltin("events")).toBe(true);
  expect(isBuiltin("node:events")).toBe(true);
  expect(isBuiltin("node:bacon")).toBe(false);
});

test("module.globalPaths exists", () => {
  expect(Array.isArray(require("module").globalPaths)).toBe(true);
});

test("Module exists", () => {
  expect(Module).toBeDefined();
});

test("module.Module works", () => {
  expect(Module.Module === Module).toBeTrue();

  const m = new Module("asdf");
  expect(m.exports).toEqual({});
});

test("_nodeModulePaths() works", () => {
  expect(() => {
    _nodeModulePaths();
  }).toThrow();
  expect(_nodeModulePaths(".").length).toBeGreaterThan(0);
  expect(_nodeModulePaths(".").pop()).toBe("/node_modules");
  expect(_nodeModulePaths("")).toEqual(_nodeModulePaths("."));
  expect(_nodeModulePaths("/")).toEqual(["/node_modules"]);
  expect(_nodeModulePaths("/a/b/c/d")).toEqual([
    "/a/b/c/d/node_modules",
    "/a/b/c/node_modules",
    "/a/b/node_modules",
    "/a/node_modules",
    "/node_modules",
  ]);
  expect(_nodeModulePaths("/a/b/../d")).toEqual(["/a/d/node_modules", "/a/node_modules", "/node_modules"]);
});

test("Module.wrap", () => {
  var mod = { exports: {} };
  expect(eval(wrap("exports.foo = 1; return 42"))(mod.exports, mod)).toBe(42);
  expect(mod.exports.foo).toBe(1);
  expect(wrap()).toBe("(function (exports, require, module, __filename, __dirname) { undefined\n});");
});

test("Overwriting _resolveFilename", () => {
  const { stdout, exitCode } = Bun.spawnSync({
    cmd: [bunExe(), "run", path.join(import.meta.dir, "resolveFilenameOverwrite.cjs")],
    env: bunEnv,
    stderr: "inherit",
  });

  expect(stdout.toString().trim().endsWith("--pass--")).toBe(true);
  expect(exitCode).toBe(0);
});

test("Overwriting Module.prototype.require", () => {
  const { stdout, exitCode } = Bun.spawnSync({
    cmd: [bunExe(), "run", path.join(import.meta.dir, "modulePrototypeOverwrite.cjs")],
    env: bunEnv,
    stderr: "inherit",
  });

  expect(stdout.toString().trim().endsWith("--pass--")).toBe(true);
  expect(exitCode).toBe(0);
});

test("Module.prototype._compile", () => {
  const module = new Module("module id goes here");
  const starting_exports = module.exports;
  const r = module._compile(
    "module.exports = { module, exports, require, __filename, __dirname }",
    "/file/path/goes/here.js",
  );
  expect(r).toBe(undefined);
  expect(module.exports).not.toBe(starting_exports);
  const { module: m, exports: e, require: req, __filename: fn, __dirname: dn } = module.exports;
  expect(m).toBe(module);
  expect(e).toBe(starting_exports);
  expect(req).toBe(module.require);
  expect(fn).toBe("/file/path/goes/here.js");
  expect(dn).toBe("/file/path/goes");
});

test("Module._extensions", () => {
  expect(".js" in Module._extensions).toBeTrue();
  expect(".json" in Module._extensions).toBeTrue();
  expect(".node" in Module._extensions).toBeTrue();
  expect(require.extensions).toBe(Module._extensions);
});
