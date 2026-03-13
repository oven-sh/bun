import { describe, expect, test } from "bun:test";
import { tempDirWithFiles } from "harness";

/**
 * Tests for bun.intFromFloat function
 *
 * This function implements Rust-like semantics for float-to-integer conversion:
 * - If finite and within target integer range: truncates toward zero
 * - If NaN: returns 0
 * - If positive infinity: returns target max value
 * - If negative infinity: returns target min value
 * - If finite but larger than target max: returns target max value
 * - If finite but smaller than target min: returns target min value
 */

// Helper function to normalize CSS output for snapshots
function normalizeCSSOutput(output: string): string {
  return output
    .replace(/\/\*.*?\*\//g, "/* [path] */") // Replace comment paths
    .trim();
}

describe("bun.intFromFloat function", () => {
  test("handles normal finite values within range", async () => {
    // Test CSS dimension serialization which uses intFromFloat(i32, value)
    const dir = tempDirWithFiles("int-from-float-normal", {
      "input.css": ".test { width: 42px; height: -10px; margin: 0px; }",
    });

    const result = await Bun.build({
      entrypoints: [`${dir}/input.css`],
      outdir: dir,
    });

    expect(result.success).toBe(true);
    expect(result.logs).toHaveLength(0);

    const output = await result.outputs[0].text();
    expect(normalizeCSSOutput(output)).toMatchInlineSnapshot(`
      "/* [path] */
      .test {
        width: 42px;
        height: -10px;
        margin: 0;
      }"
    `);
  });

  test("handles extremely large values (original crash case)", async () => {
    // This was the original failing case - large values should not crash
    const dir = tempDirWithFiles("int-from-float-large", {
      "input.css": `
.test-large { border-radius: 3.40282e38px; }
.test-negative-large { border-radius: -3.40282e38px; }
`,
    });

    const result = await Bun.build({
      entrypoints: [`${dir}/input.css`],
      outdir: dir,
    });

    expect(result.success).toBe(true);
    expect(result.logs).toHaveLength(0);

    const output = await result.outputs[0].text();
    expect(normalizeCSSOutput(output)).toMatchInlineSnapshot(`
      "/* [path] */
      .test-large {
        border-radius: 3.40282e+38px;
      }

      .test-negative-large {
        border-radius: -3.40282e+38px;
      }"
    `);
  });

  test("handles percentage values", async () => {
    // Test percentage conversion which uses intFromFloat(i32, value)
    const dir = tempDirWithFiles("int-from-float-percentage", {
      "input.css": `
.test-percent1 { width: 50%; }
.test-percent2 { width: 100.0%; }
.test-percent3 { width: 33.333%; }
`,
    });

    const result = await Bun.build({
      entrypoints: [`${dir}/input.css`],
      outdir: dir,
    });

    expect(result.success).toBe(true);
    expect(result.logs).toHaveLength(0);

    const output = await result.outputs[0].text();
    expect(normalizeCSSOutput(output)).toMatchInlineSnapshot(`
      "/* [path] */
      .test-percent1 {
        width: 50%;
      }

      .test-percent2 {
        width: 100%;
      }

      .test-percent3 {
        width: 33.333%;
      }"
    `);
  });

  test("fractional values that should not convert to int", async () => {
    // Test that fractional values are properly handled
    const dir = tempDirWithFiles("int-from-float-fractional", {
      "input.css": `
.test-frac { 
  width: 10.5px;
  height: 3.14159px;
  margin: 2.718px;
}
`,
    });

    const result = await Bun.build({
      entrypoints: [`${dir}/input.css`],
      outdir: dir,
    });

    expect(result.success).toBe(true);
    expect(result.logs).toHaveLength(0);

    const output = await result.outputs[0].text();
    expect(normalizeCSSOutput(output)).toMatchInlineSnapshot(`
      "/* [path] */
      .test-frac {
        width: 10.5px;
        height: 3.14159px;
        margin: 2.718px;
      }"
    `);
  });
});
