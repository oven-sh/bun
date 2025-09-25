import { expect, test } from "bun:test";

test("Bun.clipboard exists", () => {
  expect(Bun.clipboard).toBeDefined();
  expect(typeof Bun.clipboard.writeText).toBe("function");
  expect(typeof Bun.clipboard.readText).toBe("function");
});

test("writeText and readText work", async () => {
  const text = "Hello from Bun clipboard!";
  await Bun.clipboard.writeText(text);
  const result = await Bun.clipboard.readText();
  expect(result).toBe(text);
});

test("handles empty string", async () => {
  await Bun.clipboard.writeText("");
  const result = await Bun.clipboard.readText();
  expect(result).toBe("");
});

test("handles unicode", async () => {
  const text = "Hello 世界 🚀";
  await Bun.clipboard.writeText(text);
  const result = await Bun.clipboard.readText();
  expect(result).toBe(text);
});
