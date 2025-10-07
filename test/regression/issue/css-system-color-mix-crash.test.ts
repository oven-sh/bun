import { cssInternals } from "bun:internal-for-testing";
import { expect, test } from "bun:test";
import { normalizeBunSnapshot } from "harness";

test("CSS system colors in color-mix should not crash", () => {
  // This test reproduces a crash that was happening when using system colors
  // in color-mix() functions. The crash was caused by system colors reaching
  // the color interpolation code which had a panic for system colors.

  const testCases = [
    "color-mix(in srgb, ButtonFace, red)",
    "color-mix(in srgb, Canvas, blue)",
    "color-mix(in srgb, AccentColor, white)",
    "color-mix(in srgb, red, ButtonFace)",
    "color-mix(in srgb, ButtonFace 50%, red)",
    "color-mix(in srgb, ButtonFace, Canvas)",
    "color-mix(in oklch, AccentColor, FieldText)",
    "color-mix(in hsl, WindowFrame, LinkText)",
  ];

  for (const testCase of testCases) {
    const css = `
      .test {
        color: ${testCase};
      }
    `;

    // This should not crash - it should either parse successfully or fail gracefully
    try {
      const result = cssInternals._test(css, css);
      expect(result).toBeDefined();
    } catch (error) {
      // If it fails, it should be a parsing error, not a crash
      expect(error.message).not.toContain("system colors cannot be converted to a color");
      expect(error.message).not.toContain("unreachable");
      expect(error.message).not.toContain("panic");
    }
  }
});

test("CSS system colors in color-mix - snapshot outputs", () => {
  const testCases = [
    "color-mix(in srgb, ButtonFace, red)",
    "color-mix(in srgb, Canvas, blue)",
    "color-mix(in srgb, AccentColor, white)",
    "color-mix(in srgb, red, ButtonFace)",
    "color-mix(in srgb, ButtonFace 50%, red)",
    "color-mix(in srgb, ButtonFace, Canvas)",
    "color-mix(in oklch, AccentColor, FieldText)",
    "color-mix(in hsl, WindowFrame, LinkText)",
    "color-mix(in srgb, HighlightText, GrayText)",
    "color-mix(in srgb, Canvas 25%, AccentColor 75%)",
    "color-mix(in lch, ButtonFace, transparent)",
    "color-mix(in hsl, AccentColor, currentColor)",
  ];

  const results = {};

  for (const testCase of testCases) {
    const css = `.test { color: ${testCase}; }`;

    try {
      const result = cssInternals._test(css, css);
      results[testCase] = { success: true, output: result };
    } catch (error) {
      results[testCase] = { success: false, error: error.message };
    }
  }

  expect(normalizeBunSnapshot(JSON.stringify(results, null, 2))).toMatchSnapshot();
});
