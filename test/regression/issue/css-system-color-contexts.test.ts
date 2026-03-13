import { cssInternals } from "bun:internal-for-testing";
import { test } from "bun:test";

test("CSS system colors in various contexts should not crash", () => {
  // Test system colors in contexts where they might be converted/processed
  const testCases = [
    // Basic system colors
    "color: ButtonFace",
    "background-color: Canvas",
    "border-color: WindowFrame",

    // System colors in color functions (might trigger conversion)
    "color: color-mix(in srgb, ButtonFace, red)",
    "color: color-mix(in srgb, Canvas 50%, blue)",
    "color: color-mix(in oklch, AccentColor, white)",

    // System colors in relative color syntax (likely to trigger conversion)
    "color: hsl(from ButtonFace h s l)",
    "color: hsl(from Canvas h s l)",
    "color: hsl(from AccentColor h s l)",
    "color: rgb(from ButtonFace r g b)",
    "color: rgb(from Canvas r g b)",
    "color: hwb(from AccentColor h w b)",
    "color: oklch(from ButtonFace l c h)",
    "color: color(from Canvas srgb r g b)",

    // System colors with calc() (might trigger conversion)
    "color: hsl(from ButtonFace calc(h + 10) s l)",
    "color: rgb(from Canvas calc(r * 0.5) g b)",
    "color: hwb(from AccentColor h calc(w + 10%) b)",

    // System colors with alpha modifications (might trigger conversion)
    "color: color(from ButtonFace srgb r g b / 0.5)",
    "color: hsl(from Canvas h s l / 0.8)",
    "color: rgb(from AccentColor r g b / 50%)",

    // System colors in gradients (might trigger conversion)
    "background: linear-gradient(to right, ButtonFace, Canvas)",
    "background: radial-gradient(circle, AccentColor, WindowFrame)",

    // System colors in complex expressions
    "color: color-mix(in srgb, color-mix(in srgb, ButtonFace, red), Canvas)",
    "color: hsl(from color-mix(in srgb, ButtonFace, red) h s l)",

    // Light-dark with system colors
    "color: light-dark(ButtonFace, Canvas)",
    "color: light-dark(Canvas, ButtonFace)",
    "color: hsl(from light-dark(ButtonFace, Canvas) h s l)",
  ];

  for (const testCase of testCases) {
    const css = `
      .test {
        ${testCase};
      }
    `;

    console.log(`Testing: ${testCase}`);

    try {
      const result = cssInternals._test(css, css);
      console.log(`Result: ${result ? "parsed" : "failed"}`);
    } catch (error) {
      console.log(`Error: ${error.message}`);

      // Check if this is the specific crash we're looking for
      if (
        error.message.includes("system colors cannot be converted to a color") ||
        error.message.includes("unreachable") ||
        error.message.includes("panic")
      ) {
        console.log("🎯 FOUND THE SYSTEM COLOR CRASH!");
        throw error; // Re-throw to make the test fail and show the crash
      }
    }
  }
});
