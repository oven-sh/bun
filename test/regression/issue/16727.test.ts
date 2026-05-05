import { expect, test } from "bun:test";

// https://github.com/oven-sh/bun/issues/16727
// Bun.color should accept both <number> and <percentage> for all
// lab/lch/oklab/oklch components per CSS Color 4 spec.

test("lab() accepts number and percentage for all components", () => {
  // All percentages
  expect(Bun.color("lab(50% 50% 50%)", "css")).not.toBeNull();
  // All numbers
  expect(Bun.color("lab(50 50 50)", "css")).not.toBeNull();
  // Mixed: number L, percentage a/b
  expect(Bun.color("lab(50 50% 50%)", "css")).not.toBeNull();
  // Mixed: percentage L, number a/b (this was the only combo that worked before)
  expect(Bun.color("lab(50% 50 50)", "css")).not.toBeNull();

  // Verify number and percentage produce equivalent results.
  // lab(50% 50 50) should equal lab(50 50 50) since L number 50 = 50%.
  expect(Bun.color("lab(50% 50 50)", "css")).toBe(Bun.color("lab(50 50 50)", "css"));

  // lab(50% 40% 40%): 40% of 125 = 50 → should equal lab(50% 50 50)
  expect(Bun.color("lab(50% 40% 40%)", "css")).toBe(Bun.color("lab(50% 50 50)", "css"));
});

test("lch() accepts number and percentage for l and c components", () => {
  // All numbers
  expect(Bun.color("lch(50 50 50)", "css")).not.toBeNull();
  // Percentage L, number c
  expect(Bun.color("lch(50% 50 50)", "css")).not.toBeNull();
  // Number L, percentage c
  expect(Bun.color("lch(50 50% 50)", "css")).not.toBeNull();
  // Percentage L, percentage c
  expect(Bun.color("lch(50% 50% 50)", "css")).not.toBeNull();
  // With deg suffix on hue
  expect(Bun.color("lch(50% 50% 50deg)", "css")).not.toBeNull();

  // Verify equivalence: lch(50% ...) = lch(50 ...)
  expect(Bun.color("lch(50% 50 180)", "css")).toBe(Bun.color("lch(50 50 180)", "css"));
});

test("oklab() accepts number and percentage for all components", () => {
  // All percentages
  expect(Bun.color("oklab(50% 50% 50%)", "css")).not.toBeNull();
  // All numbers
  expect(Bun.color("oklab(0.5 0.1 0.1)", "css")).not.toBeNull();
  // Mixed
  expect(Bun.color("oklab(50% 0.1 0.1)", "css")).not.toBeNull();
  expect(Bun.color("oklab(0.5 50% 50%)", "css")).not.toBeNull();

  // oklab L: number 0.5 = 50%
  expect(Bun.color("oklab(50% 0.1 0.1)", "css")).toBe(Bun.color("oklab(0.5 0.1 0.1)", "css"));

  // oklab a/b: 25% of 0.4 = 0.1
  expect(Bun.color("oklab(50% 25% 25%)", "css")).toBe(Bun.color("oklab(0.5 0.1 0.1)", "css"));
});

test("oklch() accepts number and percentage for l and c components", () => {
  // All numbers
  expect(Bun.color("oklch(0.5 0.1 180)", "css")).not.toBeNull();
  // Percentage L
  expect(Bun.color("oklch(50% 0.1 180)", "css")).not.toBeNull();
  // Percentage c
  expect(Bun.color("oklch(0.5 50% 180)", "css")).not.toBeNull();
  // Both percentages
  expect(Bun.color("oklch(50% 50% 180)", "css")).not.toBeNull();

  // oklch L: number 0.5 = 50%
  expect(Bun.color("oklch(50% 0.1 180)", "css")).toBe(Bun.color("oklch(0.5 0.1 180)", "css"));

  // oklch c: 25% of 0.4 = 0.1
  expect(Bun.color("oklch(50% 25% 180)", "css")).toBe(Bun.color("oklch(0.5 0.1 180)", "css"));
});

test("original issue: lab(50% 50% 50%) should not return null", () => {
  const result = Bun.color("lab(50% 50% 50%)", "css");
  expect(result).not.toBeNull();
  expect(typeof result).toBe("string");
});
