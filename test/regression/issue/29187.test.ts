// https://github.com/oven-sh/bun/issues/29187
//
// `bun build --format cjs --no-bundle` used to silently emit ESM output.
// These tests exercise every export form that `printCommonJS` has to
// handle on the no-bundle path so future regressions are caught.

import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";

async function buildCjs(
  files: Record<string, string>,
  entry: string,
  target: "node" | "bun",
  extraArgs: string[] = [],
): Promise<string> {
  using dir = tempDir("issue-29187", files);
  const out = join(String(dir), "out.js");

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", entry, "--outfile", out, "--target", target, "--format", "cjs", "--no-bundle", ...extraArgs],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
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
    // Windows may serialize the path with backslashes — accept either.
    expect(output).toMatch(/Object\.assign\(module\.exports,\s*require\(["'][.\\\/]+other["']\)\)/);
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
    expect(output).toMatch(/module\.exports\.ns\s*=\s*require\(["'][.\\\/]+other["']\)/);
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
    expect(output).toMatch(/require\(["'][.\\\/]+other["']\)/);
    expect(output).toMatch(/module\.exports\.foo\s*=/);
    expect(output).toMatch(/module\.exports\.baz\s*=/);
  });

  test.concurrent(`--format cjs --no-bundle: string-literal export names (${target})`, async () => {
    // ES2022 allows `export { "hello-world" as foo }` and
    // `export * as "hello-world" from`. The CJS rewrite must use bracket
    // notation for non-identifier names, not dot access.
    const output = await buildCjs(
      {
        "index.ts": `export { "hello-world" as ok } from "./other";\n`,
        "other.ts": `const hw = 1;\nexport { hw as "hello-world" };\n`,
      },
      "./index.ts",
      target,
    );

    // LHS uses dot (`ok` is a valid identifier); RHS must use bracket
    // because `hello-world` is not. Accept any identifier for the temp
    // binder the printer picks — the assertion is about notation, not
    // the internal name.
    expect(output).toMatch(/module\.exports\.ok\s*=\s*[A-Za-z_$][\w$]*\[["']hello-world["']\]/);
    // No `identifier."string"` / `identifier.'string'` dot-string access
    // anywhere in the output.
    expect(output).not.toMatch(/[A-Za-z_$][\w$]*\.\s*["']/);
  });
}

test.concurrent("--format cjs --no-bundle --minify-whitespace: function keyword boundary", async () => {
  // Regression: `export default function greet` → must emit a space between
  // `function` and `greet` even under --minify-whitespace, otherwise it
  // collapses to `functiongreet` and is a syntax error.
  const output = await buildCjs(
    { "index.ts": `export default function greet() { return "hi"; }\n` },
    "./index.ts",
    "node",
    ["--minify-whitespace"],
  );
  expect(output).not.toMatch(/functiongreet/);
  expect(output).toMatch(/function\s+greet/);
});

test.concurrent("--format cjs --no-bundle --minify-whitespace: export const preserves `;` before Object.defineProperty", async () => {
  // Regression: `export const a = 1` must not collapse to
  // `const a=1Object.defineProperty(...)` under minify — the deferred
  // semicolon has to be flushed before the `Object.defineProperty` call.
  const output = await buildCjs(
    { "index.ts": `export const a = 1;\nexport const b = 2;\n` },
    "./index.ts",
    "node",
    ["--minify-whitespace"],
  );
  // `1Object` / `2Object` would be a NumericLiteral immediately followed
  // by an IdentifierStart — a SyntaxError.
  expect(output).not.toMatch(/[0-9]Object/);
  expect(output).toContain("Object.defineProperty");
  // Running the file should not throw — real sanity check.
  const mod = { exports: {} as Record<string, unknown> };
  // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
  new Function("module", "exports", output)(mod, mod.exports);
  expect(mod.exports).toMatchObject({ a: 1, b: 2 });
});

test.concurrent("--format cjs --no-bundle --minify-whitespace: export {...} from flushes `;` in IIFE", async () => {
  // Same pattern in the `export { ... } from` IIFE: consecutive
  // `module.exports.x = __m.x` assignments must be separated.
  const output = await buildCjs(
    {
      "index.ts": `export { foo, bar as baz } from "./other";\n`,
      "other.ts": `export const foo = 1;\nexport const bar = 2;\n`,
    },
    "./index.ts",
    "node",
    ["--minify-whitespace"],
  );
  // `.foomodule` is the telltale fusion bug.
  expect(output).not.toMatch(/foomodule/);
  expect(output).toMatch(/module\.exports\.foo\s*=/);
  expect(output).toMatch(/module\.exports\.baz\s*=/);
});
