import { expect, test } from "bun:test";
import { bunExe } from "harness";
import { tmpdir } from "os";
import { mkdirSync, writeFileSync, rmdirSync } from "fs";
import { _nodeModulePaths } from "module";

test("module.globalPaths exists", () => {
  expect(Array.isArray(require("module").globalPaths)).toBe(true);
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
