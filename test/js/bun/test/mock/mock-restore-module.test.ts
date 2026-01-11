import { expect, mock, test } from "bun:test";
import { tempDir } from "harness";
import path from "path";

const createFixture = (value: number) => ({
  "age-fixture.ts": `export function getAge() { return ${value}; }`,
});

test("mock.restoreModule() restores a specific module", async () => {
  using dir = tempDir("mock-restore-specific", createFixture(36));

  const modulePath = path.join(String(dir), "age-fixture.ts");

  const original = await import(modulePath);
  expect(original.getAge()).toBe(36);

  mock.module(modulePath, () => ({
    getAge: () => 25,
  }));

  expect(original.getAge()).toBe(25);

  mock.restoreModule(modulePath);

  delete require.cache[require.resolve(modulePath)];
  const restored = await import(modulePath + "?v=1");
  expect(restored.getAge()).toBe(36);
});

test("mock.restore() without args restores ALL module mocks", async () => {
  using dir1 = tempDir("mock-restore-all-1", createFixture(10));
  using dir2 = tempDir("mock-restore-all-2", createFixture(20));

  const module1Path = path.join(String(dir1), "age-fixture.ts");
  const module2Path = path.join(String(dir2), "age-fixture.ts");

  mock.module(module1Path, () => ({ getAge: () => 100 }));
  mock.module(module2Path, () => ({ getAge: () => 200 }));

  const mod1 = await import(module1Path);
  const mod2 = await import(module2Path);

  expect(mod1.getAge()).toBe(100);
  expect(mod2.getAge()).toBe(200);

  mock.restore();

  delete require.cache[require.resolve(module1Path)];
  delete require.cache[require.resolve(module2Path)];

  const restored1 = await import(module1Path + "?v=2");
  const restored2 = await import(module2Path + "?v=2");

  expect(restored1.getAge()).toBe(10);
  expect(restored2.getAge()).toBe(20);
});

test("mock.restoreModule() works with relative paths", async () => {
  using dir = tempDir("mock-restore-relative", {
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

  const testFile = path.join(String(dir), "test-file.ts");
  const { testRestore } = await import(testFile);

  const result = testRestore();
  expect(result.mocked).toBe("mocked");
  expect(result.restored).toBe("original");
});

test("mocking same module multiple times, then restoring", async () => {
  using dir = tempDir("mock-restore-multi", createFixture(50));

  const modulePath = path.join(String(dir), "age-fixture.ts");

  mock.module(modulePath, () => ({ getAge: () => 10 }));
  const mod1 = await import(modulePath);
  expect(mod1.getAge()).toBe(10);

  mock.module(modulePath, () => ({ getAge: () => 20 }));
  expect(mod1.getAge()).toBe(20);

  mock.module(modulePath, () => ({ getAge: () => 30 }));
  expect(mod1.getAge()).toBe(30);

  mock.restoreModule(modulePath);

  delete require.cache[require.resolve(modulePath)];
  const restored = await import(modulePath + "?v=4");
  expect(restored.getAge()).toBe(50);
});

test("mock.restore() restores both function mocks AND module mocks", async () => {
  using dir = tempDir("mock-restore-both", createFixture(42));

  const modulePath = path.join(String(dir), "age-fixture.ts");

  const mockFn = mock(() => "function mock");
  mockFn();
  expect(mockFn).toHaveBeenCalledTimes(1);

  mock.module(modulePath, () => ({ getAge: () => 999 }));
  const mod = await import(modulePath);
  expect(mod.getAge()).toBe(999);

  mock.restore();

  expect(mockFn).toHaveBeenCalledTimes(1);

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

test("mock.restore() handles both ESM and CJS modules", async () => {
  using dir = tempDir("mock-restore-esm-cjs", {
    "module.ts": `export const value = "original-esm";`,
    "module.cjs": `module.exports = { value: "original-cjs" };`,
  });

  const esmPath = path.join(String(dir), "module.ts");
  const cjsPath = path.join(String(dir), "module.cjs");

  mock.module(esmPath, () => ({ value: "mocked-esm" }));
  mock.module(cjsPath, () => ({ value: "mocked-cjs" }));

  const esm1 = await import(esmPath);
  const cjs1 = require(cjsPath);

  expect(esm1.value).toBe("mocked-esm");
  expect(cjs1.value).toBe("mocked-cjs");

  mock.restore();

  delete require.cache[require.resolve(esmPath)];
  delete require.cache[require.resolve(cjsPath)];

  const esm2 = await import(esmPath + "?v=6");
  const cjs2 = require(cjsPath);

  expect(esm2.value).toBe("original-esm");
  expect(cjs2.value).toBe("original-cjs");
});

test("mock and restore pre-loaded module (in-place restore)", async () => {
  // This test verifies that mock.restoreModule works correctly for modules
  // that are already loaded (like NPM modules). The module's exports should
  // be restored in-place without needing to re-import.
  using dir = tempDir("mock-restore-preloaded", {
    "fixture.ts": `export const name = "original"; export function getId() { return 123; }`,
  });

  const modulePath = path.join(String(dir), "fixture.ts");

  // First, load the module
  const original = await import(modulePath);
  expect(original.name).toBe("original");
  expect(original.getId()).toBe(123);

  // Mock the module
  mock.module(modulePath, () => ({
    name: "mocked",
    getId: () => 999,
  }));

  // The same reference should now return mocked values (in-place mock)
  expect(original.name).toBe("mocked");
  expect(original.getId()).toBe(999);

  // Restore the module
  mock.restoreModule(modulePath);

  // The same reference should now return original values (in-place restore)
  expect(original.name).toBe("original");
  expect(original.getId()).toBe(123);
});
