// https://github.com/oven-sh/bun/issues/29187
//
// `bun build --format cjs --no-bundle` used to silently emit ESM output.
// These tests exercise every export form that `printCommonJS` has to
// handle on the no-bundle path so future regressions are caught.

import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";

async function buildCjs(files: Record<string, string>, entry: string, target: "node" | "bun"): Promise<string> {
  using dir = tempDir("issue-29187", files);
  const out = join(String(dir), "out.js");

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", entry, "--outfile", out, "--target", target, "--format", "cjs", "--no-bundle"],
    cwd: String(dir),
    env: bunEnv,
  });

  const [, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(exitCode).toBe(0);

  return readFileSync(out, "utf8");
}

for (const target of ["node", "bun"] as const) {
  test.concurrent(`--format cjs --no-bundle: imports + export function (${target})`, async () => {
    const output = await buildCjs(
      {
        "index.ts": `import { readFileSync } from "fs";
import path from "path";
export function hello() {
  console.log("Hello", readFileSync, path);
}
`,
      },
      "./index.ts",
      target,
    );

    expect(output).not.toMatch(/^\s*import\s+/m);
    expect(output).not.toMatch(/^\s*export\s+/m);
    expect(output).toContain('require("fs")');
    expect(output).toContain('require("path")');
    expect(output).toMatch(/exports\b/);
    expect(output).toContain("hello");
  });

  test.concurrent(`--format cjs --no-bundle: export const/let/var + destructuring (${target})`, async () => {
    // Pre-fix this hit `runtime_imports.__export.?` → panic. The rewrite
    // also has to recurse into nested destructuring.
    const output = await buildCjs(
      {
        "index.ts": `export const one = 1;
export let two = 2;
export var three = 3;
export const { a, b } = { a: 10, b: 20 };
export const [x, y] = [30, 40];
export const { nested: { deep } } = { nested: { deep: 99 } };
`,
      },
      "./index.ts",
      target,
    );

    expect(output).not.toMatch(/^\s*export\s+/m);
    for (const name of ["one", "two", "three", "a", "b", "x", "y", "deep"]) {
      expect(output).toMatch(new RegExp(`Object\\.defineProperty\\(module\\.exports,\\s*"${name}"`));
    }
  });

  test.concurrent(`--format cjs --no-bundle: export default value (${target})`, async () => {
    const output = await buildCjs({ "index.ts": `export default 42;\n` }, "./index.ts", target);

    expect(output).not.toMatch(/^\s*export\s+default/m);
    expect(output).toMatch(/module\.exports\.default\s*=\s*42/);
  });

  test.concurrent(`--format cjs --no-bundle: export default function (${target})`, async () => {
    const output = await buildCjs(
      { "index.ts": `export default function greet() { return "hi"; }\n` },
      "./index.ts",
      target,
    );

    expect(output).not.toMatch(/^\s*export\s+default/m);
    expect(output).toContain("function greet");
    expect(output).toMatch(/module\.exports\.default\s*=\s*greet/);
  });

  test.concurrent(`--format cjs --no-bundle: export * from (${target})`, async () => {
    const output = await buildCjs(
      {
        "index.ts": `export * from "./other";\n`,
        "other.ts": `export const foo = 1;\n`,
      },
      "./index.ts",
      target,
    );

    expect(output).not.toMatch(/^\s*export\s+/m);
    expect(output).toMatch(/Object\.assign\(module\.exports,\s*require\(["']\.\/other["']\)\)/);
  });

  test.concurrent(`--format cjs --no-bundle: export * as ns from (${target})`, async () => {
    const output = await buildCjs(
      {
        "index.ts": `export * as ns from "./other";\n`,
        "other.ts": `export const foo = 1;\n`,
      },
      "./index.ts",
      target,
    );

    expect(output).not.toMatch(/^\s*export\s+/m);
    expect(output).toMatch(/module\.exports\.ns\s*=\s*require\(["']\.\/other["']\)/);
  });

  test.concurrent(`--format cjs --no-bundle: export { a, b as c } from (${target})`, async () => {
    const output = await buildCjs(
      {
        "index.ts": `export { foo, bar as baz } from "./other";\n`,
        "other.ts": `export const foo = 1;\nexport const bar = 2;\n`,
      },
      "./index.ts",
      target,
    );

    expect(output).not.toMatch(/^\s*export\s+/m);
    expect(output).toContain('require("./other")');
    expect(output).toMatch(/module\.exports\.foo\s*=/);
    expect(output).toMatch(/module\.exports\.baz\s*=/);
  });
}
