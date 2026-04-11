// https://github.com/oven-sh/bun/issues/29187
//
// `bun build --format cjs --no-bundle` silently ignored the format and
// emitted ESM output (`import` / `export`). The `--no-bundle` path in
// `Transpiler.buildWithResolveResultEager` hardcoded `.esm` / `.esm_ascii`
// based on target, never reading `transpiler.options.output_format`.
//
// Fix: route through the `.cjs` printer when `output_format == .cjs`,
// rewriting ESM imports/exports to `require(...)` / `exports.*`.

import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SOURCE = `import { readFileSync } from "fs";
import path from "path";

export function hello() {
  console.log("Hello", readFileSync, path);
}
`;

async function buildCjs(target: "node" | "bun"): Promise<string> {
  using dir = tempDir("issue-29187", { "index.ts": SOURCE });
  const out = join(String(dir), "out.js");

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "./index.ts", "--outfile", out, "--target", target, "--format", "cjs", "--no-bundle"],
    cwd: String(dir),
    env: bunEnv,
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
  expect(stdout).toBeTruthy();

  return readFileSync(out, "utf8");
}

test.concurrent("--format cjs --no-bundle emits CommonJS for --target node", async () => {
  const output = await buildCjs("node");

  // The CJS printer rewrites `import` / `export` to `require` / `exports.*`.
  // Neither of the original ESM keywords should appear as top-level
  // statements in the output.
  expect(output).not.toMatch(/^\s*import\s+/m);
  expect(output).not.toMatch(/^\s*export\s+/m);

  // It should contain `require("fs")` / `require("path")` and assign
  // `hello` onto `exports`.
  expect(output).toContain('require("fs")');
  expect(output).toContain('require("path")');
  expect(output).toMatch(/exports\b/);
});

test.concurrent("--format cjs --no-bundle emits CommonJS for --target bun", async () => {
  const output = await buildCjs("bun");

  expect(output).not.toMatch(/^\s*import\s+/m);
  expect(output).not.toMatch(/^\s*export\s+/m);

  expect(output).toContain('require("fs")');
  expect(output).toContain('require("path")');
  expect(output).toMatch(/exports\b/);
});
