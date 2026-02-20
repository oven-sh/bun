import { $ } from "bun";
import { expect, test } from "bun:test";

// https://github.com/oven-sh/bun/issues/12225

test("non-ASCII interpolated value with special chars needing escape", async () => {
  const rating = "3"; // Contains digit - needs escaping via __bunstr_ ref
  const label = "檢視"; // Non-ASCII

  const result = await $`echo key=${rating} ${label}`.text();
  expect(result.trim()).toBe("key=3 檢視");
});

test("non-ASCII static template text", async () => {
  const result = await $`echo 檢視`.text();
  expect(result.trim()).toBe("檢視");
});

test("non-ASCII interpolated value without special chars", async () => {
  const label = "檢視";
  const result = await $`echo ${label}`.text();
  expect(result.trim()).toBe("檢視");
});

test("mixed ASCII and non-ASCII with multiple interpolations", async () => {
  const num = "42";
  const text = "日本語";
  const result = await $`echo ${num} hello ${text} world`.text();
  expect(result.trim()).toBe("42 hello 日本語 world");
});

test("supplementary plane characters in static template", async () => {
  // U+1D573 is outside BMP, uses \u{XXXX} in raw string
  const result = await $`echo 𝕳ello`.text();
  expect(result.trim()).toBe("𝕳ello");
});

test("backslash-escaped unicode in template preserved", async () => {
  // \\弟 in source means literal backslash + 弟
  const result = await $`echo \\弟\\気`.text();
  expect(result.trim()).toBe("\\弟\\気");
});

test("latin-1 characters in static template", async () => {
  const result = await $`echo café`.text();
  expect(result.trim()).toBe("café");
});
