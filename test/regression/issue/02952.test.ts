/**
 * Regression test for GitHub issue #2952
 * https://github.com/oven-sh/bun/issues/2952
 *
 * When an onResolve plugin returns null (no match), the bundler should still
 * respect the sideEffects field from package.json for tree-shaking.
 *
 * This is a critical issue because packages like lodash-es use sideEffects: false
 * to enable proper tree-shaking of unused exports.
 *
 * The bug manifested when:
 * 1. A plugin's onResolve callback returned null for all resolutions
 * 2. The resolved module had sideEffects: false in package.json
 * 3. The module used barrel exports (re-exports from individual files)
 *
 * The fix ensures that when onResolve returns null and the bundler falls back
 * to default resolution, the sideEffects field from package.json is properly
 * propagated to the parse task.
 */
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import * as path from "path";

test("issue#2952: onResolve plugin returning null should preserve sideEffects for tree-shaking", async () => {
  using dir = tempDir("issue-2952", {
    "entry.ts": `
import { isArray } from "tree-shakeable-lib";
export default function isArray2(value: any): boolean {
  return isArray(value);
}
    `,
    "node_modules/tree-shakeable-lib/index.js": `
export { default as isArray } from './isArray.js';
export { default as isString } from './isString.js';
export { default as isNumber } from './isNumber.js';
export { default as isObject } from './isObject.js';
    `,
    "node_modules/tree-shakeable-lib/isArray.js": `
export default function isArray(value) {
  return Array.isArray(value);
}
    `,
    "node_modules/tree-shakeable-lib/isString.js": `
export default function isString(value) {
  console.log("TREESHAKE_FAILED_isString");
  return typeof value === "string";
}
    `,
    "node_modules/tree-shakeable-lib/isNumber.js": `
export default function isNumber(value) {
  console.log("TREESHAKE_FAILED_isNumber");
  return typeof value === "number";
}
    `,
    "node_modules/tree-shakeable-lib/isObject.js": `
export default function isObject(value) {
  console.log("TREESHAKE_FAILED_isObject");
  return typeof value === "object" && value !== null;
}
    `,
    "node_modules/tree-shakeable-lib/package.json": JSON.stringify({
      name: "tree-shakeable-lib",
      main: "index.js",
      sideEffects: false,
    }),
    "build-with-plugin.ts": `
import type { BunPlugin } from "bun";

const myPlugin: BunPlugin = {
  name: "Test plugin",
  setup(build) {
    build.onResolve({ filter: /.*/ }, async (args) => {
      return null;  // Return null to let default resolution handle it
    });
  },
};

const result = await Bun.build({
  entrypoints: ["entry.ts"],
  minify: true,
  outdir: "dist-with-plugin",
  plugins: [myPlugin],
});

if (!result.success) {
  console.error("Build failed");
  process.exit(1);
}
    `,
    "build-without-plugin.ts": `
const result = await Bun.build({
  entrypoints: ["entry.ts"],
  minify: true,
  outdir: "dist-without-plugin",
});

if (!result.success) {
  console.error("Build failed");
  process.exit(1);
}
    `,
  });

  // Build without plugin
  await using procWithout = Bun.spawn({
    cmd: [bunExe(), "build-without-plugin.ts"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  await procWithout.exited;

  // Build with plugin
  await using procWith = Bun.spawn({
    cmd: [bunExe(), "build-with-plugin.ts"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  await procWith.exited;

  // Read outputs
  const outputWithout = await Bun.file(path.join(String(dir), "dist-without-plugin/entry.js")).text();
  const outputWith = await Bun.file(path.join(String(dir), "dist-with-plugin/entry.js")).text();

  // Both should tree-shake correctly
  expect(outputWithout).not.toContain("TREESHAKE_FAILED");
  expect(outputWith).not.toContain("TREESHAKE_FAILED");

  // Output sizes should be similar (both properly tree-shaken)
  // Allow some variance for potential formatting differences
  expect(Math.abs(outputWithout.length - outputWith.length)).toBeLessThan(100);
});
