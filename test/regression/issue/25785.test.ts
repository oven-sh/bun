import { cssInternals } from "bun:internal-for-testing";
import { expect, test } from "bun:test";
import { tempDir } from "harness";

const { prefixTest } = cssInternals;

// Regression test for https://github.com/oven-sh/bun/issues/25785
// CSS logical border-radius properties were being silently dropped

test("CSS bundler should preserve logical border-radius properties", async () => {
  using dir = tempDir("issue-25785", {
    "test.css": `
.test1 {
  border-start-start-radius: 0.75rem;
}
.test2 {
  border-end-start-radius: 0.75rem;
}
.test3 {
  border-start-end-radius: 0.75rem;
}
.test4 {
  border-end-end-radius: 0.75rem;
}
.test5 {
  border-top-left-radius: 0.75rem;
}
`,
  });

  const result = await Bun.build({
    entrypoints: [`${dir}/test.css`],
    outdir: `${dir}/dist`,
    experimentalCss: true,
    minify: false,
  });

  expect(result.success).toBe(true);
  expect(result.outputs.length).toBe(1);

  const output = await result.outputs[0].text();

  // The default browser targets support logical border-radius properties, so
  // each one passes through unchanged instead of being dropped.
  expect(output).toContain(".test1");
  expect(output).toContain("border-start-start-radius");

  expect(output).toContain(".test2");
  expect(output).toContain("border-end-start-radius");

  expect(output).toContain(".test3");
  expect(output).toContain("border-start-end-radius");

  expect(output).toContain(".test4");
  expect(output).toContain("border-end-end-radius");

  // Physical property should also be preserved
  expect(output).toContain(".test5");
  expect(output).toContain("border-top-left-radius");
});

test("CSS bundler should handle logical border-radius with targets that compile logical properties", () => {
  // Safari 14 does not support logical border-radius properties, so they are
  // compiled to physical properties with LTR/RTL rules instead of dropped.
  const output = prefixTest(
    `
.test1 {
  border-start-start-radius: 0.75rem;
}
.test2 {
  border-end-start-radius: 0.75rem;
}
.test3 {
  border-start-end-radius: 0.75rem;
}
.test4 {
  border-end-end-radius: 0.75rem;
}
`,
    "",
    { safari: 14 << 16 },
  );

  // At minimum, the output should NOT be empty (the bug caused empty output)
  expect(output.trim().length).toBeGreaterThan(0);

  // Should have border-radius output compiled to physical properties
  expect(output).toContain("border-top-left-radius");
  expect(output).toContain("border-top-right-radius");
  expect(output).toContain("border-bottom-left-radius");
  expect(output).toContain("border-bottom-right-radius");

  // All classes should be present in the output
  expect(output).toContain(".test1");
  expect(output).toContain(".test2");
  expect(output).toContain(".test3");
  expect(output).toContain(".test4");
});
