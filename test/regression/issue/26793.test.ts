import { expect, test } from "bun:test";
import { tempDir } from "harness";

// Regression test for https://github.com/oven-sh/bun/issues/26793
// Bun.build() API tsconfig option does not work - path aliases are not resolved

test("Bun.build() tsconfig option should resolve path aliases", async () => {
  using dir = tempDir("issue-26793", {
    "src/index.ts": `import { sum } from "@/utils";\nexport { sum };\n`,
    "src/utils.ts": `export function sum(a: number, b: number) { return a + b; }\n`,
    "tsconfig.custom.json": JSON.stringify({
      compilerOptions: {
        baseUrl: ".",
        paths: {
          "@/*": ["./src/*"],
        },
      },
    }),
  });

  const result = await Bun.build({
    entrypoints: [`${dir}/src/index.ts`],
    outdir: `${dir}/dist`,
    tsconfig: `${dir}/tsconfig.custom.json`,
  });

  expect(result.success).toBe(true);
  expect(result.outputs.length).toBe(1);

  const output = await result.outputs[0].text();
  // The bundled output should contain the sum function
  expect(output).toContain("sum");
});

test("Bun.build() tsconfig option should work with relative path in tsconfig", async () => {
  using dir = tempDir("issue-26793-relative", {
    "src/index.ts": `import { multiply } from "@lib/math";\nexport { multiply };\n`,
    "lib/math.ts": `export function multiply(a: number, b: number) { return a * b; }\n`,
    "tsconfig.json": JSON.stringify({
      compilerOptions: {
        baseUrl: ".",
        paths: {
          "@lib/*": ["./lib/*"],
        },
      },
    }),
  });

  // Test that tsconfig with relative paths inside it (baseUrl, paths) works correctly
  const result = await Bun.build({
    entrypoints: [`${dir}/src/index.ts`],
    outdir: `${dir}/dist`,
    tsconfig: `${dir}/tsconfig.json`,
  });

  expect(result.success).toBe(true);
  expect(result.outputs.length).toBe(1);

  const output = await result.outputs[0].text();
  expect(output).toContain("multiply");
});

test("Bun.build() without tsconfig option should not resolve custom aliases", async () => {
  using dir = tempDir("issue-26793-no-tsconfig", {
    "src/index.ts": `import { divide } from "@custom/math";\nexport { divide };\n`,
    "custom/math.ts": `export function divide(a: number, b: number) { return a / b; }\n`,
    // No tsconfig at root, custom tsconfig is not passed
    "other/tsconfig.json": JSON.stringify({
      compilerOptions: {
        baseUrl: ".",
        paths: {
          "@custom/*": ["./custom/*"],
        },
      },
    }),
  });

  const result = await Bun.build({
    entrypoints: [`${dir}/src/index.ts`],
    outdir: `${dir}/dist`,
    // No tsconfig option - should fail to resolve the alias
    throw: false, // Don't throw, just return success=false
  });

  // Without the tsconfig option, the path alias should not be resolved
  expect(result.success).toBe(false);
  expect(result.logs.some(log => log.message?.includes("@custom/math"))).toBe(true);
});
