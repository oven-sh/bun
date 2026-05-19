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
    cmd: [
      bunExe(),
      "build",
      entry,
      "--outfile",
      out,
      "--target",
      target,
      "--format",
      "cjs",
      "--no-bundle",
      ...extraArgs,
    ],
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

  test.concurrent(`--format cjs --no-bundle: all import shapes (${target})`, async () => {
    // Exhaustive coverage so future regressions in the s_import rewrite
    // are caught. Previously `import foo, * as ns from "x"` silently
    // dropped the `ns` binding, which threw `ReferenceError: ns is not
    // defined` at runtime.
    const output = await buildCjs(
      {
        "index.ts": `import "./side-effect";
import def from "./mod";
import * as ns from "./mod";
import { a } from "./mod";
import { a as aa, b } from "./mod";
import def2, { a as a2 } from "./mod";
import def3, * as ns3 from "./mod";

export const used = [def, ns, a, aa, b, def2, a2, def3, ns3];
`,
        "side-effect.ts": `\n`,
        "mod.ts": `export default 1;\nexport const a = 2;\nexport const b = 3;\n`,
      },
      "./index.ts",
      target,
    );

    expect(output).not.toMatch(/^\s*import\s+/m);
    // `import "./side-effect"` → bare require, no binding.
    expect(output).toMatch(/^\s*require\(["']\.\/side-effect["']\)/m);
    // Every binding that appears in `used` must have been declared.
    for (const name of ["def", "ns", "a", "aa", "b", "def2", "a2", "def3", "ns3"]) {
      expect(output).toMatch(new RegExp(`\\b${name}\\b`));
    }
    // Sanity-run the emitted CJS via `new Function` with a minimal
    // `require` stub so we catch any ReferenceError shadow.
    const mods: Record<string, { default: number; a: number; b: number }> = {
      "./mod": { default: 1, a: 2, b: 3 },
    };
    const mod = { exports: {} as any };
    const fakeRequire = (p: string) => {
      if (p === "./side-effect") return {};
      return mods[p];
    };
    // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
    new Function("module", "exports", "require", output)(mod, mod.exports, fakeRequire);
    expect(Array.isArray(mod.exports.used)).toBe(true);
    expect(mod.exports.used.length).toBe(9);
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

test.concurrent(
  "--format cjs --no-bundle --minify-whitespace: export const preserves `;` before Object.defineProperty",
  async () => {
    // Regression: `export const a = 1` must not collapse to
    // `const a=1Object.defineProperty(...)` under minify — the deferred
    // semicolon has to be flushed before the `Object.defineProperty` call.
    const output = await buildCjs({ "index.ts": `export const a = 1;\nexport const b = 2;\n` }, "./index.ts", "node", [
      "--minify-whitespace",
    ]);
    // `1Object` / `2Object` would be a NumericLiteral immediately followed
    // by an IdentifierStart — a SyntaxError.
    expect(output).not.toMatch(/[0-9]Object/);
    expect(output).toContain("Object.defineProperty");
    // Running the file should not throw — real sanity check.
    const mod = { exports: {} as Record<string, unknown> };
    // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
    new Function("module", "exports", output)(mod, mod.exports);
    expect(mod.exports).toMatchObject({ a: 1, b: 2 });
  },
);

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

test.concurrent(
  "--format cjs --no-bundle --minify-identifiers: export function/class keep external names",
  async () => {
    // Regression: with MinifyRenamer active, local bindings get renamed but
    // the public export contract must still use the source name. Consumers
    // doing `require("./m").hello` must not see `undefined`.
    const output = await buildCjs(
      {
        "index.ts": `export function veryLongFunctionName() { return 42; }
export class VeryLongClassName { get a() { return 1; } }
const veryLongLocalName = 7;
const anotherLongOne = 8;
export { veryLongLocalName, anotherLongOne as renamedExport };
`,
      },
      "./index.ts",
      "node",
      ["--minify-identifiers"],
    );

    // External contract is preserved — the Object.defineProperty /
    // Object.assign emissions use the SOURCE names as keys.
    expect(output).toMatch(/"veryLongFunctionName"/);
    expect(output).toMatch(/"VeryLongClassName"/);
    // Sanity-run: all four exports must be reachable by source name.
    const mod = { exports: {} as any };
    // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
    new Function("module", "exports", output)(mod, mod.exports);
    expect(typeof mod.exports.veryLongFunctionName).toBe("function");
    expect(mod.exports.veryLongFunctionName()).toBe(42);
    expect(typeof mod.exports.VeryLongClassName).toBe("function");
    expect(new mod.exports.VeryLongClassName().a).toBe(1);
    expect(mod.exports.veryLongLocalName).toBe(7);
    expect(mod.exports.renamedExport).toBe(8);
  },
);

test.concurrent("--format cjs --no-bundle --minify-identifiers: module/exports stay reserved", async () => {
  // Regression: if `printCommonJS` doesn't pass `module_type: .cjs` to
  // the MinifyRenamer, the names "module" and "exports" aren't in the
  // reserved set, so the renamer can legally assign them to user locals
  // and poison `module.exports` at runtime.
  //
  // Emit enough top-level locals that the frequency-based renamer would
  // normally reach for single-letter names including `m`, then verify the
  // emitted code still uses a literal `module.exports` target that isn't
  // shadowed by a user binding.
  const locals = Array.from({ length: 80 }, (_, i) => `const v${i} = ${i};`).join("\n");
  const output = await buildCjs(
    {
      "index.ts": `${locals}
export const sum = ${Array.from({ length: 80 }, (_, i) => `v${i}`).join(" + ")};
`,
    },
    "./index.ts",
    "node",
    ["--minify-identifiers"],
  );

  expect(output).not.toMatch(/\bvar\s+module\b/);
  expect(output).not.toMatch(/\bvar\s+exports\b/);
  const mod = { exports: {} as any };
  // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
  new Function("module", "exports", output)(mod, mod.exports);
  expect(mod.exports.sum).toBe((80 * 79) / 2);
});

test.concurrent("--format cjs --no-bundle: import.meta is replaced with CJS equivalents", async () => {
  // Regression: raw `import.meta` in CJS output is a SyntaxError at
  // runtime (`Cannot use 'import.meta' outside a module`). The
  // --no-bundle CJS rewrite now emits an inline object literal whose
  // properties map onto `__filename` / `__dirname` / `require.main`.
  const output = await buildCjs(
    {
      "index.ts": `export const info = {
  url: import.meta.url,
  dirname: import.meta.dirname,
  filename: import.meta.filename,
  main: import.meta.main,
};
`,
    },
    "./index.ts",
    "node",
  );

  // The raw `import.meta` token must not appear in the output.
  expect(output).not.toMatch(/\bimport\s*\.\s*meta\b/);
  // Should reference the CJS-level globals the inline shim uses.
  expect(output).toContain("__filename");
  expect(output).toContain("__dirname");
  expect(output).toContain("require.main");

  // Sanity-run with faked __filename / __dirname / require to verify
  // the emitted shape actually resolves the property accesses.
  const fakeFilename = "/fake/path/to/mod.js";
  const fakeDirname = "/fake/path/to";
  const fakeRequire = (p: string) => {
    if (p === "url") {
      return { pathToFileURL: (f: string) => ({ href: `file://${f}` }) };
    }
    throw new Error(`unexpected require(${JSON.stringify(p)})`);
  };
  (fakeRequire as any).main = {};
  const mod = { exports: {} as any };
  // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
  new Function("module", "exports", "require", "__filename", "__dirname", output)(
    mod,
    mod.exports,
    fakeRequire,
    fakeFilename,
    fakeDirname,
  );
  expect(mod.exports.info).toMatchObject({
    url: `file://${fakeFilename}`,
    dirname: fakeDirname,
    filename: fakeFilename,
    main: false, // require.main === module is false when module !== require.main
  });
});
