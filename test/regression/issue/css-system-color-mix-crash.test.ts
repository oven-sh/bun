import { test, expect } from "bun:test";
import { cssInternals } from "bun:internal-for-testing";

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
      console.log(`✓ ${testCase} - parsed successfully`);
    } catch (error) {
      console.log(`✗ ${testCase} - error: ${error.message}`);
      
      // If it fails, it should be a parsing error, not a crash
      expect(error.message).not.toContain("system colors cannot be converted to a color");
      expect(error.message).not.toContain("unreachable");
      expect(error.message).not.toContain("panic");
    }
  }
});