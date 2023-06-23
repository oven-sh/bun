import { expect, test } from "bun:test";
import { tmpdir } from "os";
import { mkdirSync, writeFileSync, rmdirSync } from "fs";

const module = require("module");

test("module.globalPaths exists", () => {
  expect(Array.isArray(require("module").globalPaths)).toBe(true);
});

test("module.globalPaths exists", () => {
  const rootDir = tmpdir();
  const dirPath = rootDir + "/one/two/three/four";
  rmdirSync(rootDir + "/one", { recursive: true });

  mkdirSync(dirPath, { recursive: true });
  var paths = module._nodeModulePaths(dirPath);
  console.log(paths);
  expect(paths).toEqual([]);

  writeFileSync(dirPath + "/package.json", "{}");
  paths = module._nodeModulePaths(dirPath);
  console.log(paths);
  expect(paths).toEqual([]);

  writeFileSync(dirPath + "/package.json", '{"type":"module"}');
  mkdirSync(dirPath + "/node_modules", { recursive: true });
  paths = module._nodeModulePaths(dirPath);
  console.log(paths);
  expect(paths).toEqual([dirPath + "/node_modules"]);
});
