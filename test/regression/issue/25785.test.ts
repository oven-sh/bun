import { expect, test } from "bun:test";
import { tempDir } from "harness";

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

  // Logical properties are compiled to physical properties with LTR/RTL rules
  // .test1 with border-start-start-radius compiles to border-top-left-radius (LTR) and border-top-right-radius (RTL)
  expect(output).toContain(".test1");
  expect(output).toContain("border-top-left-radius");
  expect(output).toContain("border-top-right-radius");

  // .test2 with border-end-start-radius compiles to border-bottom-left-radius (LTR) and border-bottom-right-radius (RTL)
  expect(output).toContain(".test2");
  expect(output).toContain("border-bottom-left-radius");
  expect(output).toContain("border-bottom-right-radius");

  // .test3 with border-start-end-radius
  expect(output).toContain(".test3");

  // .test4 with border-end-end-radius
  expect(output).toContain(".test4");

  // Physical property should also be preserved
  expect(output).toContain(".test5");
});

test("CSS bundler should handle logical border-radius with targets that compile logical properties", async () => {
  using dir = tempDir("issue-25785-compiled", {
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
`,
  });

  const result = await Bun.build({
    entrypoints: [`${dir}/test.css`],
    outdir: `${dir}/dist`,
    experimentalCss: true,
    minify: false,
    // Target older browsers that don't support logical properties
    target: "browser",
  });

  expect(result.success).toBe(true);
  expect(result.outputs.length).toBe(1);

  const output = await result.outputs[0].text();

  // When logical properties are compiled down, they should produce physical properties
  // with :lang() selectors to handle LTR/RTL
  // At minimum, the output should NOT be empty (the bug caused empty output)
  expect(output.trim().length).toBeGreaterThan(0);

  // Should have some border-radius output (compiled to physical)
  expect(output).toMatch(/border-.*-radius/);

  // All classes should be present in the output
  expect(output).toContain(".test1");
  expect(output).toContain(".test2");
  expect(output).toContain(".test3");
  expect(output).toContain(".test4");
});
