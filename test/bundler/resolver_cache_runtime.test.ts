import { expect, test } from "bun:test";
import * as fs from "fs";
import { tempDir } from "harness";
import * as path from "path";

// These tests verify that the resolver properly invalidates cache at runtime
// when using require() across file system changes within the same process.
// These test the same cache invalidation logic as the Bun.build tests but for runtime require().

test("runtime cache invalidation: directory with index.js deleted then recreated", async () => {
  using dir = tempDir("runtime-cache-index-js", {
    "subdir/index.js": `module.exports = { value: 42 };`,
  });

  const subdirPath = path.join(String(dir), "subdir");
  const requirePath = subdirPath;

  // Require 1: Should succeed
  const result1 = require(requirePath);
  expect(result1.value).toBe(42);

  // Clear require cache
  const resolvedPath = require.resolve(requirePath);
  delete require.cache[resolvedPath];

  // Delete directory
  fs.rmSync(subdirPath, { recursive: true });

  // Require 2: Should fail
  let require2Failed = false;
  try {
    require(requirePath);
  } catch (e) {
    require2Failed = true;
  }
  expect(require2Failed).toBe(true);

  // Recreate directory with new content
  fs.mkdirSync(subdirPath);
  fs.writeFileSync(path.join(subdirPath, "index.js"), `module.exports = { value: 99 };`);

  // Require 3: Should succeed with new value
  const result3 = require(requirePath);
  expect(result3.value).toBe(99);
});

test("runtime cache invalidation: direct file deleted then recreated", async () => {
  using dir = tempDir("runtime-cache-direct-file", {
    "config.js": `module.exports = { version: 1 };`,
  });

  const configPath = path.join(String(dir), "config.js");

  // Require 1: Should succeed
  const result1 = require(configPath);
  expect(result1.version).toBe(1);

  // Clear require cache
  const resolvedPath = require.resolve(configPath);
  delete require.cache[resolvedPath];

  // Delete file
  fs.rmSync(configPath);

  // Require 2: Should fail
  let require2Failed = false;
  try {
    require(configPath);
  } catch (e) {
    require2Failed = true;
  }
  expect(require2Failed).toBe(true);

  // Recreate file with new content
  fs.writeFileSync(configPath, `module.exports = { version: 2 };`);

  // Require 3: Should succeed with new value
  const result3 = require(configPath);
  expect(result3.version).toBe(2);
});

test("runtime cache invalidation: nested directory deleted then recreated", async () => {
  using dir = tempDir("runtime-cache-nested", {
    "deep/nested/module.js": `module.exports = { value: "original" };`,
  });

  const modulePath = path.join(String(dir), "deep", "nested", "module.js");
  const deepPath = path.join(String(dir), "deep");

  // Require 1: Should succeed
  const result1 = require(modulePath);
  expect(result1.value).toBe("original");

  // Clear require cache
  delete require.cache[require.resolve(modulePath)];

  // Delete parent directory
  fs.rmSync(deepPath, { recursive: true });

  // Require 2: Should fail
  let require2Failed = false;
  try {
    require(modulePath);
  } catch (e) {
    require2Failed = true;
  }
  expect(require2Failed).toBe(true);

  // Recreate directory structure
  const nestedPath = path.join(deepPath, "nested");
  fs.mkdirSync(deepPath);
  fs.mkdirSync(nestedPath);
  fs.writeFileSync(path.join(nestedPath, "module.js"), `module.exports = { value: "recreated" };`);

  // Require 3: Should succeed
  const result3 = require(modulePath);
  expect(result3.value).toBe("recreated");
});

test("runtime cache invalidation: require after recreating deleted file", async () => {
  using dir = tempDir("runtime-cache-resolve", {
    "module.js": `module.exports = { id: 1 };`,
  });

  const modulePath = path.join(String(dir), "module.js");

  // First require: Should succeed
  const result1 = require(modulePath);
  expect(result1.id).toBe(1);

  // Clear cache
  delete require.cache[require.resolve(modulePath)];

  // Delete file
  fs.rmSync(modulePath);

  // Second require: Should fail
  let require2Failed = false;
  try {
    require(modulePath);
  } catch (e) {
    require2Failed = true;
  }
  expect(require2Failed).toBe(true);

  // Recreate file
  fs.writeFileSync(modulePath, `module.exports = { id: 2 };`);

  // Third require: Should succeed with new value
  const result3 = require(modulePath);
  expect(result3.id).toBe(2);
});
