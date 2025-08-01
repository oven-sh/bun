// Test that both the original and new syntax work correctly
// This is a regression test to ensure the new parameter order doesn't break existing usage

describe("test() parameter order", () => {
  // Original syntax: test(name, fn, options)
  test(
    "original syntax works",
    () => {
      expect(true).toBe(true);
    },
    { timeout: 1000 },
  );

  test("original syntax with number timeout", () => {
    expect(true).toBe(true);
  }, 500);

  // Vitest compatability syntax: test(name, options, fn)
  test("vitest compatability syntax - options object as second parameter", { timeout: 1000 }, () => {
    expect(true).toBe(true);
  });

  // Test other methods work with vitest compatability syntax
  test.skip("skip with vitest compatability syntax", { timeout: 1000 }, () => {
    expect(true).toBe(true);
  });

  test.todo("todo with vitest-compatible syntax", { timeout: 1000 });
});
