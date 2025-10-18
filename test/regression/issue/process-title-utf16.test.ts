import { expect, test } from "bun:test";

test("process.title with UTF-16 characters should not panic", () => {
  // Test with various UTF-16 characters
  process.title = "Hello, 世界! 🌍";
  expect(process.title).toBe("Hello, 世界! 🌍");

  // Test with emoji only
  process.title = "🌍🌎🌏";
  expect(process.title).toBe("🌍🌎🌏");

  // Test with mixed ASCII and UTF-16
  process.title = "Test 测试 тест";
  expect(process.title).toBe("Test 测试 тест");

  // Test with emoji and text
  process.title = "Bun 🐰";
  expect(process.title).toBe("Bun 🐰");
});
