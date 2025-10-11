import { expect, test } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot, tempDir } from "harness";

test("TypeScript file imported with type: 'text' should be treated as text, not executed - issue #23299", async () => {
  using dir = tempDir("issue-23299", {
    "asset.ts": `console.error("Unreachable!");`,
    "frontend.ts": `
//@ts-ignore
import code from "./asset.ts" with { type: "text" };

console.log(code);
`,
    "index.html": `
<html>
  <head>
    <script type="module" src="./frontend.ts"></script>
  </head>
  <body></body>
</html>
`,
  });

  // Build the frontend module
  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "frontend.ts", "--outdir=dist", "--target=browser"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(exitCode).toBe(0);
  expect(stderr).not.toContain("error");

  // Read the bundled output
  const bundled = await Bun.file(`${dir}/dist/frontend.js`).text();

  // The asset.ts content should be a string literal, not executed code
  expect(bundled).toContain('console.error("Unreachable!")');

  // Make sure the error is NOT executed (it should be in a string)
  expect(normalizeBunSnapshot(bundled, dir)).toMatchInlineSnapshot(`
"// asset.ts
var asset_default = 'console.error("Unreachable!");';

// frontend.ts
console.log(asset_default);"
`);
});

test("TypeScript file should compile when imported normally even if also imported as text - issue #23299", async () => {
  using dir = tempDir("issue-23299-text-only", {
    "code.ts": `export const value = 42;`,
    "text-import.ts": `
//@ts-ignore
import text from "./code.ts" with { type: "text" };
console.log("Source:", text);
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "text-import.ts", "--outdir=dist", "--target=browser"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(exitCode).toBe(0);

  const bundled = await Bun.file(`${dir}/dist/text-import.js`).text();

  // The TypeScript file should be loaded as text, not compiled
  expect(bundled).toContain("export const value = 42");
  expect(bundled).toContain("Source:");
});
