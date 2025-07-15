import { cssInternals } from "bun:internal-for-testing";
import { expect, test } from "bun:test";
import { normalizeBunSnapshot } from "harness";

test("CSS calc with percentage and NaN should not crash", () => {
  // This test reproduces a crash that was happening when parsing calc() expressions
  // containing NaN values in percentage contexts. The crash was caused by an
  // unreachable panic in the calc.zig file when trying to convert calc expressions
  // to simple values.

  const testCases = [
    "calc(50% + NaN)",
    "calc(50% - NaN)",
    "calc(50% * NaN)",
    "calc(50% / NaN)",
    "calc(NaN + 50%)",
    "calc(NaN - 50%)",
    "calc(NaN * 50%)",
    "calc(NaN / 50%)",
  ];

  for (const testCase of testCases) {
    const css = `
      .test {
        color: hsl(200, ${testCase}, 50%);
      }
    `;

    // This should not crash - it should either parse successfully or fail gracefully
    try {
      const result = cssInternals._test(css, css);
      expect(result).toBeDefined();
    } catch (error) {
      // If it fails, it should be a parsing error, not a crash
      expect(error.message).not.toContain("unreachable");
      expect(error.message).not.toContain("panic");
    }
  }
});

test("CSS calc with percentage and NaN - snapshot outputs", () => {
  const testCases = [
    "calc(50% + NaN)",
    "calc(50% - NaN)",
    "calc(50% * NaN)",
    "calc(50% / NaN)",
    "calc(NaN + 50%)",
    "calc(NaN - 50%)",
    "calc(NaN * 50%)",
    "calc(NaN / 50%)",
    "calc(Infinity)",
    "calc(-Infinity)",
    "calc(50% + Infinity)",
    "calc(50% - Infinity)",
    "calc(50% * Infinity)",
    "calc(50% / Infinity)",
  ];

  const results = {};

  for (const testCase of testCases) {
    const css = `.test { color: hsl(200, ${testCase}, 50%); }`;

    try {
      const result = cssInternals._test(css, css);
      results[testCase] = { success: true, output: result };
    } catch (error) {
      results[testCase] = { success: false, error: error.message };
    }
  }

  expect(normalizeBunSnapshot(JSON.stringify(results, null, 2))).toMatchSnapshot();
});
