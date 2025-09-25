import { describe, expect, test } from "bun:test";

test("Bun.clipboard exists", () => {
  expect(Bun.clipboard).toBeDefined();
  expect(typeof Bun.clipboard.writeText).toBe("function");
  expect(typeof Bun.clipboard.readText).toBe("function");
});

describe.skipIf(!process.env.DISPLAY && process.platform === "linux")("clipboard operations", () => {
  test("writeText and readText work", () => {
    const text = "Hello from Bun clipboard!";
    Bun.clipboard.writeText(text);
    const result = Bun.clipboard.readText();
    expect(result).toBe(text);
  });

  test("handles empty string", () => {
    Bun.clipboard.writeText("");
    const result = Bun.clipboard.readText();
    expect(result).toBe("");
  });

  test("handles unicode", () => {
    const text = "Hello 世界 🚀";
    Bun.clipboard.writeText(text);
    const result = Bun.clipboard.readText();
    expect(result).toBe(text);
  });
});
