import { expect, test } from "bun:test";
import { _nodeModulePaths, builtinModules, isBuiltin, wrap } from "module";
import Module from "module";

test("builtinModules exists", () => {
  expect(Array.isArray(builtinModules)).toBe(true);
  expect(builtinModules).toHaveLength(76);
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
