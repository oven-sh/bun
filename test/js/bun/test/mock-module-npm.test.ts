import { expect, test, mock } from "bun:test";
import { tempDir } from "harness";
import path from "path";

// Test that mock.restoreModule() works for modules that were already loaded
// This is the key scenario for NPM modules: they're loaded before mock is called
test("mock and restore pre-loaded module (in-place restore)", async () => {
  using dir = tempDir("mock-restore-preloaded", {
    "calculator.ts": `export function add(a: number, b: number) { return a + b; }
export function multiply(a: number, b: number) { return a * b; }`,
  });

  const modulePath = path.join(String(dir), "calculator.ts");

  // 1. First, import the original module (simulates NPM package already loaded)
  const original = await import(modulePath);
  expect(original.add(2, 3)).toBe(5);
  expect(original.multiply(2, 3)).toBe(6);

  // 2. Mock the module (module was already loaded)
  mock.module(modulePath, () => ({
    add: () => 999,
    multiply: () => 888,
  }));

  // 3. The original reference should now see mocked values (in-place modification)
  expect(original.add(2, 3)).toBe(999);
  expect(original.multiply(2, 3)).toBe(888);

  // 4. Restore the module
  mock.restoreModule(modulePath);

  // 5. After restore, the original reference should have original values back (in-place restoration)
  expect(original.add(2, 3)).toBe(5); // Should be 5 again, not 999!
  expect(original.multiply(2, 3)).toBe(6); // Should be 6 again, not 888!
});
