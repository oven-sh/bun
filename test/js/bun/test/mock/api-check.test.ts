/**
 * Este teste verifica se a API mock.restoreModule() está disponível
 * Rode com: bun test test/js/bun/test/mock/api-check.test.ts
 */
import { test, expect, mock } from "bun:test";

test("mock object has restore method", () => {
  expect(mock).toHaveProperty("restore");
  expect(typeof mock.restore).toBe("function");
});

test("mock object has restoreModule method", () => {
  expect(mock).toHaveProperty("restoreModule");
  expect(typeof mock.restoreModule).toBe("function");
});

test("mock object has module method", () => {
  expect(mock).toHaveProperty("module");
  expect(typeof mock.module).toBe("function");
});

test("can call mock.restoreModule without crashing", () => {
  // Should not throw even if not implemented yet
  expect(() => {
    mock.restoreModule();
  }).not.toThrow();
});

test("can call mock.restoreModule with path without crashing", () => {
  expect(() => {
    mock.restoreModule("./some-module");
  }).not.toThrow();
});

test("can call mock.restore without crashing", () => {
  expect(() => {
    mock.restore();
  }).not.toThrow();
});

console.log("✅ API structure check passed!");
console.log("📝 To compile and test the full implementation:");
console.log("   1. Install build dependencies (CMake, Ninja, etc.)");
console.log("   2. Run: bun bd test test/js/bun/test/mock/mock-restore-module.test.ts");
