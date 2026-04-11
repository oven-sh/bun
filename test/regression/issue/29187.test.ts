// https://github.com/oven-sh/bun/issues/29187
//
// `bun build --format cjs --no-bundle` silently ignored the format and
// emitted ESM output (`import` / `export`). The `--no-bundle` path in
// `Transpiler.buildWithResolveResultEager` hardcoded `.esm` / `.esm_ascii`
// based on target, never reading `transpiler.options.output_format`.
//
// Fix: route through the `.cjs` printer when `output_format == .cjs`,
// rewriting ESM imports/exports to `require(...)` / `exports.*`.
//
// Additionally the `S.Local` export branch in `printDeclStmt` used to
// dereference `runtime_imports.__export.?` — a symbol the linker populates
// for the bundler path but which is always null in `transform_only` mode.
// `export const` / `export let` / `export var` must emit inline
// `Object.defineProperty(exports, ...)` via `printBundledExport`, the same
// as `export function` / `export class` already did.

import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";

async function buildCjs(source: string, target: "node" | "bun"): Promise<string> {
  using dir = tempDir("issue-29187", { "index.ts": source });
  const out = join(String(dir), "out.js");

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "./index.ts", "--outfile", out, "--target", target, "--format", "cjs", "--no-bundle"],
    cwd: String(dir),
    env: bunEnv,
  });

  const [, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(exitCode).toBe(0);

  return readFileSync(out, "utf8");
}

const FUNCTION_SOURCE = `import { readFileSync } from "fs";
import path from "path";

export function hello() {
  console.log("Hello", readFileSync, path);
}
`;

const LOCAL_SOURCE = `export const one = 1;
export let two = 2;
export var three = 3;
export const { a, b } = { a: 10, b: 20 };
export const [x, y] = [30, 40];
`;

for (const target of ["node", "bun"] as const) {
  test.concurrent(`--format cjs --no-bundle emits CommonJS (export function, --target ${target})`, async () => {
    const output = await buildCjs(FUNCTION_SOURCE, target);

    // The CJS printer rewrites `import` / `export` to `require` / `exports.*`.
    // Neither of the original ESM keywords should appear as top-level
    // statements in the output.
    expect(output).not.toMatch(/^\s*import\s+/m);
    expect(output).not.toMatch(/^\s*export\s+/m);

    // It should contain `require("fs")` / `require("path")` and expose
    // `hello` on `exports`.
    expect(output).toContain('require("fs")');
    expect(output).toContain('require("path")');
    expect(output).toMatch(/exports\b/);
    expect(output).toContain("hello");
  });

  test.concurrent(`--format cjs --no-bundle handles export const/let/var without crashing (--target ${target})`, async () => {
    // Pre-fix this panicked on `p.options.runtime_imports.__export.?` —
    // that optional is only populated by the bundler linker, which
    // `--no-bundle` / `transform_only` skips.
    const output = await buildCjs(LOCAL_SOURCE, target);

    expect(output).not.toMatch(/^\s*export\s+/m);

    // Every declared name should be exposed on `exports` via
    // Object.defineProperty (the printBundledExport form).
    for (const name of ["one", "two", "three", "a", "b", "x", "y"]) {
      expect(output).toMatch(new RegExp(`Object\\.defineProperty\\(exports,\\s*"${name}"`));
    }
  });
}
