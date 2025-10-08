/**
 * Tests for mock.restore() functionality with mock.module()
 *
 * Current implementation:
 * - Restores ES and CJS module registry entries
 * - Clears virtual modules (mocks)
 * - Allows fresh imports to get original modules
 *
 * Limitation:
 * - Existing module namespace objects that were mutated during mocking
 *   are NOT automatically restored. Re-import is required.
 */

import { expect, mock, test } from "bun:test";

test("mock.restore() - mock before import (ESM)", async () => {
  // Mock before importing
  mock.module("./esm-module", () => ({
    esmFunction: () => "mocked",
    esmValue: 999,
  }));

  const mocked = await import("./esm-module");
  expect(mocked.esmFunction()).toBe("mocked");
  expect(mocked.esmValue).toBe(999);

  // Restore
  mock.restore();

  // Re-import gets original
  const restored = await import("./esm-module?restored");
  expect(restored.esmFunction()).toBe("original-esm");
  expect(restored.esmValue).toBe(100);
});

test("mock.restore() - mock before require (CJS)", async () => {
  // Mock before requiring
  mock.module("./cjs-module", () => ({
    cjsFunction: () => "mocked",
  }));

  const mocked = require("./cjs-module");
  expect(mocked.cjsFunction()).toBe("mocked");

  // Restore
  mock.restore();

  // Clear cache and re-require gets original
  delete require.cache[require.resolve("./cjs-module")];
  const restored = require("./cjs-module");
  expect(restored.cjsFunction()).toBe("original-cjs");
});

test("mock.restore() - non-existent module", async () => {
  // Mock a module that doesn't exist
  mock.module("./nonexistent", () => ({
    foo: () => "mocked",
  }));

  const mocked = await import("./nonexistent");
  expect(mocked.foo()).toBe("mocked");

  // Restore
  mock.restore();

  // Module no longer available
  let threw = false;
  try {
    await import("./nonexistent");
  } catch (e) {
    threw = true;
  }
  expect(threw).toBe(true);
});

test("mock.restore() - multiple mocks", async () => {
  // Mock multiple modules
  mock.module("./esm-module", () => ({ esmFunction: () => "mock-esm" }));
  mock.module("./cjs-module", () => ({ cjsFunction: () => "mock-cjs" }));

  expect((await import("./esm-module")).esmFunction()).toBe("mock-esm");
  expect(require("./cjs-module").cjsFunction()).toBe("mock-cjs");

  // Restore all at once
  mock.restore();

  // Both restored
  expect((await import("./esm-module?r2")).esmFunction()).toBe("original-esm");

  delete require.cache[require.resolve("./cjs-module")];
  expect(require("./cjs-module").cjsFunction()).toBe("original-cjs");
});

test("mock.restore() - sequential mocks", async () => {
  // First mock
  mock.module("./esm-module", () => ({ esmFunction: () => "mock1" }));
  expect((await import("./esm-module")).esmFunction()).toBe("mock1");

  mock.restore();
  expect((await import("./esm-module?seq1")).esmFunction()).toBe("original-esm");

  // Second mock
  mock.module("./esm-module", () => ({ esmFunction: () => "mock2" }));
  expect((await import("./esm-module")).esmFunction()).toBe("mock2");

  mock.restore();
  expect((await import("./esm-module?seq2")).esmFunction()).toBe("original-esm");
});
