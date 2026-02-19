import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// https://github.com/oven-sh/bun/issues/15997
// Bug: When a non-entry-point file has `export * from "external-module"`,
// the bundler emits `__reExport(target, varName)` but only generates
// `import "module"` (side-effect import) instead of `import * as varName from "module"`,
// leaving varName undefined and causing a ReferenceError at runtime.

test("export * from external module in non-entry-point file generates namespace import", async () => {
  using dir = tempDir("issue-15997", {
    "wrapper.js": `export * from "node:path";
import { join } from "node:path";

export function customJoin(...args) {
  return join(...args);
}
`,
    "entry.ts": `export * from "./wrapper.js";

export function doSomething() {
  return "hello";
}
`,
  });

  const result = await Bun.build({
    entrypoints: [String(dir) + "/entry.ts"],
    outdir: String(dir) + "/out",
    target: "bun",
  });

  expect(result.success).toBe(true);
  expect(result.outputs.length).toBe(1);

  const output = await result.outputs[0].text();

  // The bundled output must contain "import * as" for the external module
  // namespace, not just a bare "import" (side-effect only).
  expect(output).toContain("import * as");

  // Verify the bundled output actually runs without ReferenceError
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `import { customJoin, doSomething } from "${String(dir)}/out/entry.js"; console.log(typeof customJoin, doSomething())`,
    ],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout.trim()).toBe("function hello");
  expect(exitCode).toBe(0);
});

test("export * from external module in non-entry-point file with --target node", async () => {
  using dir = tempDir("issue-15997-node", {
    "wrapper.js": `export * from "node:crypto";

export function customFn() {
  return "custom";
}
`,
    "entry.ts": `export * from "./wrapper.js";
`,
  });

  const result = await Bun.build({
    entrypoints: [String(dir) + "/entry.ts"],
    target: "node",
  });

  expect(result.success).toBe(true);
  const output = await result.outputs[0].text();

  // Must have namespace import, not bare import
  expect(output).toContain("import * as");
  expect(output).not.toMatch(/import\s*"node:crypto"/);
});
