import { test, expect, mock, afterEach } from "bun:test";

// Test fixtures
const createFixture = (value: number) => ({
  "age-fixture.ts": `export function getAge() { return ${value}; }`,
});

test("mock.restoreModule() restores a specific module", async () => {
  using dir = require("harness").tempDir("mock-restore-specific", createFixture(36));

  const modulePath = require("path").join(String(dir), "age-fixture.ts");

  // Import original
  const original = await import(modulePath);
  expect(original.getAge()).toBe(36);

  // Mock the module
  mock.module(modulePath, () => ({
    getAge: () => 25,
  }));

  // Should return mocked value
  expect(original.getAge()).toBe(25);

  // Restore the module
  mock.restoreModule(modulePath);

  // Should reload original after clearing cache
  delete require.cache[require.resolve(modulePath)];
  const restored = await import(modulePath + "?v=1");
  expect(restored.getAge()).toBe(36);
});

test("mock.restore() without args restores ALL module mocks", async () => {
  using dir1 = require("harness").tempDir("mock-restore-all-1", createFixture(10));
  using dir2 = require("harness").tempDir("mock-restore-all-2", createFixture(20));

  const module1Path = require("path").join(String(dir1), "age-fixture.ts");
  const module2Path = require("path").join(String(dir2), "age-fixture.ts");

  // Mock both modules
  mock.module(module1Path, () => ({ getAge: () => 100 }));
  mock.module(module2Path, () => ({ getAge: () => 200 }));

  const mod1 = await import(module1Path);
  const mod2 = await import(module2Path);

  expect(mod1.getAge()).toBe(100);
  expect(mod2.getAge()).toBe(200);

  // Restore all mocks
  mock.restore();

  // Clear cache and reimport
  delete require.cache[require.resolve(module1Path)];
  delete require.cache[require.resolve(module2Path)];

  const restored1 = await import(module1Path + "?v=2");
  const restored2 = await import(module2Path + "?v=2");

  expect(restored1.getAge()).toBe(10);
  expect(restored2.getAge()).toBe(20);
});

test("mock.restoreModule() works with relative paths", async () => {
  using dir = require("harness").tempDir("mock-restore-relative", {
    "test-module.ts": `export const value = "original";`,
    "test-file.ts": `
      import { mock } from "bun:test";
      import { value as originalValue } from "./test-module.ts";

      export function testRestore() {
        console.log("Before mock:", originalValue);

        mock.module("./test-module.ts", () => ({
          value: "mocked"
        }));

        const { value: mockedValue } = require("./test-module.ts");
        console.log("After mock:", mockedValue);

        mock.restoreModule("./test-module.ts");

        delete require.cache[require.resolve("./test-module.ts")];
        const { value: restoredValue } = require("./test-module.ts" + "?v=3");
        console.log("After restore:", restoredValue);

        return { original: originalValue, mocked: mockedValue, restored: restoredValue };
      }
    `,
  });

  const testFile = require("path").join(String(dir), "test-file.ts");
  const { testRestore } = await import(testFile);

  const result = testRestore();
  expect(result.mocked).toBe("mocked");
  expect(result.restored).toBe("original");
});

test("mocking same module multiple times, then restoring", async () => {
  using dir = require("harness").tempDir("mock-restore-multi", createFixture(50));

  const modulePath = require("path").join(String(dir), "age-fixture.ts");

  // Mock version 1
  mock.module(modulePath, () => ({ getAge: () => 10 }));
  const mod1 = await import(modulePath);
  expect(mod1.getAge()).toBe(10);

  // Mock version 2 (overwrite)
  mock.module(modulePath, () => ({ getAge: () => 20 }));
  expect(mod1.getAge()).toBe(20);

  // Mock version 3 (overwrite again)
  mock.module(modulePath, () => ({ getAge: () => 30 }));
  expect(mod1.getAge()).toBe(30);

  // Restore
  mock.restoreModule(modulePath);

  delete require.cache[require.resolve(modulePath)];
  const restored = await import(modulePath + "?v=4");
  expect(restored.getAge()).toBe(50);
});

test("mock.restore() restores both function mocks AND module mocks", async () => {
  using dir = require("harness").tempDir("mock-restore-both", createFixture(42));

  const modulePath = require("path").join(String(dir), "age-fixture.ts");

  // Create a function mock
  const mockFn = mock(() => "function mock");
  mockFn();
  expect(mockFn).toHaveBeenCalledTimes(1);

  // Create a module mock
  mock.module(modulePath, () => ({ getAge: () => 999 }));
  const mod = await import(modulePath);
  expect(mod.getAge()).toBe(999);

  // Restore everything
  mock.restore();

  // Function mock should be cleared
  expect(mockFn).toHaveBeenCalledTimes(0);

  // Module mock should be cleared
  delete require.cache[require.resolve(modulePath)];
  const restored = await import(modulePath + "?v=5");
  expect(restored.getAge()).toBe(42);
});

test("restoring non-existent module doesn't throw", () => {
  expect(() => {
    mock.restoreModule("./this-module-does-not-exist-anywhere.ts");
  }).not.toThrow();
});

test("mock.restore() with no mocks doesn't throw", () => {
  expect(() => {
    mock.restore();
  }).not.toThrow();
});

test("ESM and CJS mocks are both restored", async () => {
  using dir = require("harness").tempDir("mock-restore-esm-cjs", {
    "module.ts": `export const value = "original-esm";`,
    "module.cjs": `module.exports = { value: "original-cjs" };`,
  });

  const esmPath = require("path").join(String(dir), "module.ts");
  const cjsPath = require("path").join(String(dir), "module.cjs");

  // Mock both
  mock.module(esmPath, () => ({ value: "mocked-esm" }));
  mock.module(cjsPath, () => ({ value: "mocked-cjs" }));

  const esm1 = await import(esmPath);
  const cjs1 = require(cjsPath);

  expect(esm1.value).toBe("mocked-esm");
  expect(cjs1.value).toBe("mocked-cjs");

  // Restore all
  mock.restore();

  // Clear caches
  delete require.cache[require.resolve(esmPath)];
  delete require.cache[require.resolve(cjsPath)];

  const esm2 = await import(esmPath + "?v=6");
  const cjs2 = require(cjsPath);

  expect(esm2.value).toBe("original-esm");
  expect(cjs2.value).toBe("original-cjs");
});
