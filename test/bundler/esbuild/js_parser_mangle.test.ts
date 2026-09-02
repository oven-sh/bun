import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Ported from esbuild's internal/js_parser/js_parser_test.go. Each case is a
// program and the output esbuild prints for it with `--minify-syntax`. Bun
// prints the same tokens with a different layout (indentation, `!0` for
// `true`), so both sides are compared with the layout normalized away.
//
// Two kinds of cases keep Bun's own output instead of esbuild's:
// - `// bun: relocates var`: Bun hoists a nested `var` to the top level of a
//   transform-only build (esbuild only does that when bundling), so the `var`
//   statement ends up after the loop or try instead of inside it.
// - `// bun: strict mode`: Bun parses the file as a module, so a function
//   declaration in a block does not get the sloppy-mode `var` alias.
//
// Cases that depend on esbuild's `MaybeSimplifyEqualityComparison`
// (`!a === false` => `!!a`, `(a, b) === c` => `a, b === c`) are not ported.

type Case = [input: string, expected: string];

function normalize(code: string): string {
  return code
    .replaceAll("!0", "true")
    .replaceAll("!1", "false")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/ ?([^\w$ ]) ?/g, "$1");
}

// One `bun build --no-bundle --minify-syntax` run per group, every case as its own entry point.
async function mangle(cases: Case[]): Promise<string[]> {
  const files: Record<string, string> = {};
  cases.forEach(([input], i) => {
    files[`case${i}.js`] = input;
  });
  using dir = tempDir("esbuild-mangle", files);
  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "--no-bundle", "--minify-syntax", "--outdir=out", ...Object.keys(files)],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
  return cases.map((_, i) => readFileSync(join(String(dir), "out", `case${i}.js`), "utf8"));
}

function check(name: string, cases: Case[]) {
  test.concurrent(name, async () => {
    const outputs = await mangle(cases);
    const got: Record<string, string> = {};
    const want: Record<string, string> = {};
    cases.forEach(([input, expected], i) => {
      got[`${i}: ${input}`] = normalize(outputs[i]);
      want[`${i}: ${input}`] = normalize(expected);
    });
    expect(got).toEqual(want);
  });
}

check("TestMangleFor", [
  ["var a; while (1) ;", "for (var a; ; ) ;\n"],
  ["let a; while (1) ;", "let a;\nfor (; ; ) ;\n"],
  ["const a=0; while (1) ;", "const a = 0;\nfor (; ; ) ;\n"],
  ["var a; for (var b;;) ;", "for (var a;; )\n  ;\nvar b;\n"], // bun: relocates var
  ["let a; for (let b;;) ;", "let a;\nfor (let b; ; ) ;\n"],
  ["const a=0; for (const b = 1;;) ;", "const a = 0;\nfor (const b = 1; ; ) ;\n"],
  ["export var a; while (1) ;", "export var a;\nfor (; ; ) ;\n"],
  ["export let a; while (1) ;", "export let a;\nfor (; ; ) ;\n"],
  ["export const a=0; while (1) ;", "export const a = 0;\nfor (; ; ) ;\n"],
  ["export var a; for (var b;;) ;", "export var a;\nfor (;; )\n  ;\nvar b;\n"], // bun: relocates var
  ["export let a; for (let b;;) ;", "export let a;\nfor (let b; ; ) ;\n"],
  ["export const a=0; for (const b = 1;;) ;", "export const a = 0;\nfor (const b = 1; ; ) ;\n"],
  ["var a; for (let b;;) ;", "var a;\nfor (let b; ; ) ;\n"],
  ["let a; for (const b=0;;) ;", "let a;\nfor (const b = 0; ; ) ;\n"],
  ["const a=0; for (var b;;) ;", "const a = 0;\nfor (;; )\n  ;\nvar b;\n"], // bun: relocates var
  ["a(); while (1) ;", "for (a(); ; ) ;\n"],
  ["a(); for (b();;) ;", "for (a(), b(); ; ) ;\n"],
  ["for (; ;) if (x) break;", "for (; !x; ) ;\n"],
  ["for (; ;) if (!x) break;", "for (; x; ) ;\n"],
  ["for (; a;) if (x) break;", "for (; a && !x; ) ;\n"],
  ["for (; a;) if (!x) break;", "for (; a && x; ) ;\n"],
  ["for (; ;) { if (x) break; y(); }", "for (; !x; )\n  y();\n"],
  ["for (; a;) { if (x) break; y(); }", "for (; a && !x; )\n  y();\n"],
  ["for (; ;) if (x) break; else y();", "for (; !x; ) y();\n"],
  ["for (; a;) if (x) break; else y();", "for (; a && !x; ) y();\n"],
  ["for (; ;) { if (x) break; else y(); z(); }", "for (; !x; )\n  y(), z();\n"],
  ["for (; a;) { if (x) break; else y(); z(); }", "for (; a && !x; )\n  y(), z();\n"],
  ["for (; ;) if (x) y(); else break;", "for (; x; ) y();\n"],
  ["for (; ;) if (!x) y(); else break;", "for (; !x; ) y();\n"],
  ["for (; a;) if (x) y(); else break;", "for (; a && x; ) y();\n"],
  ["for (; a;) if (!x) y(); else break;", "for (; a && !x; ) y();\n"],
  ["for (; ;) { if (x) y(); else break; z(); }", "for (; x; ) {\n  y();\n  z();\n}\n"],
  ["for (; a;) { if (x) y(); else break; z(); }", "for (; a && x; ) {\n  y();\n  z();\n}\n"],
]);

check("TestMangleLoopJump", [
  ["while (x) { if (1) break; z(); }", "for (; x; )\n  break;\n"],
  ["while (x) { if (1) continue; z(); }", "for (; x; )\n  ;\n"],
  ["foo: while (a) while (x) { if (1) continue foo; z(); }", "foo: for (; a; ) for (; x; )\n  continue foo;\n"],
  ["while (x) { y(); if (1) break; z(); }", "for (; x; ) {\n  y();\n  break;\n}\n"],
  ["while (x) { y(); if (1) continue; z(); }", "for (; x; )\n  y();\n"],
  ["while (x) { y(); debugger; if (1) continue; z(); }", "for (; x; ) {\n  y();\n  debugger;\n}\n"],
  ["while (x) { let y = z(); if (1) continue; z(); }", "for (; x; ) {\n  let y = z();\n}\n"],
  ["while (x) { debugger; if (y) { if (1) break; z() } }", "for (; x; ) {\n  debugger;\n  if (y)\n    break;\n}\n"],
  ["while (x) { debugger; if (y) { if (1) continue; z() } }", "for (; x; ) {\n  debugger;\n  y;\n}\n"],
  ["while (x) { debugger; if (1) { if (1) break; z() } }", "for (; x; ) {\n  debugger;\n  break;\n}\n"],
  ["while (x) { debugger; if (1) { if (1) continue; z() } }", "for (; x; )\n  debugger;\n"],
  ["while (x()) continue", "for (; x(); ) ;\n"],
  ["while (x) { y(); continue }", "for (; x; )\n  y();\n"],
  ["while (x) { if (y) { z(); continue } }", "for (; x; )\n  if (y) {\n    z();\n    continue;\n  }\n"],
  [
    "label: while (x) while (y) { z(); continue label }",
    "label: for (; x; ) for (; y; ) {\n  z();\n  continue label;\n}\n",
  ],
  ["while (x) { if (y) continue; z(); }", "for (; x; )\n  y || z();\n"],
  ["while (x) { if (y) continue; else z(); w(); }", "for (; x; )\n  y || (z(), w());\n"],
  ["while (x) { t(); if (y) continue; z(); }", "for (; x; )\n  t(), !y && z();\n"],
  ["while (x) { t(); if (y) continue; else z(); w(); }", "for (; x; )\n  t(), !y && (z(), w());\n"],
  ["while (x) { debugger; if (y) continue; z(); }", "for (; x; ) {\n  debugger;\n  y || z();\n}\n"],
  ["while (x) { debugger; if (y) continue; else z(); w(); }", "for (; x; ) {\n  debugger;\n  y || (z(), w());\n}\n"],
  ["while (x) { if (y) continue; function y() {} }", "for (;x; )\n  ;\n"], // bun: strict mode
  ["while (x) { if (y) continue; let y }", "for (; x; ) {\n  if (y) continue;\n  let y;\n}\n"],
  ["while (x) { if (y) continue; var y }", "for (;x; )\n  ;\nvar y;\n"], // bun: relocates var
]);

check("TestMangleBlock", [
  ["while(1) { while (1) {} }", "for (; ; )\n  for (; ; )\n    ;\n"],
  ["while(1) { const x = y; }", "for (; ; ) {\n  const x = y;\n}\n"],
  ["while(1) { let x; }", "for (; ; ) {\n  let x;\n}\n"],
  ["while(1) { var x; }", "for (;; )\n  ;\nvar x;\n"], // bun: relocates var
  ["while(1) { class X {} }", "for (; ; ) {\n  class X {\n  }\n}\n"],
  ["while(1) { function x() {} }", "for (;; ) {\n  let x = function() {};\n}\n"], // bun: strict mode
  ["while(1) { function* x() {} }", "for (; ; ) {\n  function* x() {\n  }\n}\n"],
  ["while(1) { async function x() {} }", "for (; ; ) {\n  async function x() {\n  }\n}\n"],
  ["while(1) { async function* x() {} }", "for (; ; ) {\n  async function* x() {\n  }\n}\n"],
]);

check("TestMangleIf", [
  ["1 ? a() : b()", "a();\n"],
  ["0 ? a() : b()", "b();\n"],
  ["a ? a : b", "a || b;\n"],
  ["a ? b : a", "a && b;\n"],
  ["a.x ? a.x : b", "a.x ? a.x : b;\n"],
  ["a.x ? b : a.x", "a.x ? b : a.x;\n"],
  ["a ? b() : c()", "a ? b() : c();\n"],
  ["!a ? b() : c()", "a ? c() : b();\n"],
  ["!!a ? b() : c()", "a ? b() : c();\n"],
  ["!!!a ? b() : c()", "a ? c() : b();\n"],
  ["if (1) a(); else b()", "a();\n"],
  ["if (0) a(); else b()", "b();\n"],
  ["if (a) b(); else c()", "a ? b() : c();\n"],
  ["if (!a) b(); else c()", "a ? c() : b();\n"],
  ["if (!!a) b(); else c()", "a ? b() : c();\n"],
  ["if (!!!a) b(); else c()", "a ? c() : b();\n"],
  ["if (1) a()", "a();\n"],
  ["if (0) a()", ""],
  ["if (a) b()", "a && b();\n"],
  ["if (!a) b()", "a || b();\n"],
  ["if (!!a) b()", "a && b();\n"],
  ["if (!!!a) b()", "a || b();\n"],
  ["if (1) {} else a()", ""],
  ["if (0) {} else a()", "a();\n"],
  ["if (a) {} else b()", "a || b();\n"],
  ["if (!a) {} else b()", "a && b();\n"],
  ["if (!!a) {} else b()", "a || b();\n"],
  ["if (!!!a) {} else b()", "a && b();\n"],
  ["if (a) {} else throw b", "if (!a)\n  throw b;\n"],
  ["if (!a) {} else throw b", "if (a)\n  throw b;\n"],
  ["a(); if (b) throw c", "if (a(), b) throw c;\n"],
  ["if (a) if (b) throw c", "if (a && b) throw c;\n"],
  ["if (true) { let a = b; if (c) throw d }", "{\n  let a = b;\n  if (c) throw d;\n}\n"],
  ["if (true) { if (a) throw b; if (c) throw d }", "if (a) throw b;\nif (c) throw d;\n"],
  ["if (false) throw a; else { let b = c; if (d) throw e }", "{\n  let b = c;\n  if (d) throw e;\n}\n"],
  ["if (false) throw a; else { if (b) throw c; if (d) throw e }", "if (b) throw c;\nif (d) throw e;\n"],
  [
    "if (a) { if (b) throw c; else { let d = e; if (f) throw g } }",
    "if (a) {\n  if (b) throw c;\n  {\n    let d = e;\n    if (f) throw g;\n  }\n}\n",
  ],
  [
    "if (a) { if (b) throw c; else if (d) throw e; else if (f) throw g }",
    "if (a) {\n  if (b) throw c;\n  if (d) throw e;\n  if (f) throw g;\n}\n",
  ],
  ["a = b ? true : false", "a = !!b;\n"],
  ["a = b ? false : true", "a = !b;\n"],
  ["a = !b ? true : false", "a = !b;\n"],
  ["a = !b ? false : true", "a = !!b;\n"],
  ["a = b == c ? true : false", "a = b == c;\n"],
  ["a = b != c ? true : false", "a = b != c;\n"],
  ["a = b === c ? true : false", "a = b === c;\n"],
  ["a = b !== c ? true : false", "a = b !== c;\n"],
  ["a ? b(c) : b(d)", "a ? b(c) : b(d);\n"],
  ["let a; a ? b(c) : b(d)", "let a;\na ? b(c) : b(d);\n"],
  ["let a, b; a ? b(c) : b(d)", "let a, b;\nb(a ? c : d);\n"],
  ["let a, b; a ? b(c, 0) : b(d)", "let a, b;\na ? b(c, 0) : b(d);\n"],
  ["let a, b; a ? b(c) : b(d, 0)", "let a, b;\na ? b(c) : b(d, 0);\n"],
  ["let a, b; a ? b(c, 0) : b(d, 1)", "let a, b;\na ? b(c, 0) : b(d, 1);\n"],
  ["let a, b; a ? b(c, 0) : b(d, 0)", "let a, b;\nb(a ? c : d, 0);\n"],
  ["let a, b; a ? b(...c) : b(d)", "let a, b;\na ? b(...c) : b(d);\n"],
  ["let a, b; a ? b(c) : b(...d)", "let a, b;\na ? b(c) : b(...d);\n"],
  ["let a, b; a ? b(...c) : b(...d)", "let a, b;\nb(...a ? c : d);\n"],
  ["let a, b; a ? b(a) : b(c)", "let a, b;\nb(a || c);\n"],
  ["let a, b; a ? b(c) : b(a)", "let a, b;\nb(a && c);\n"],
  ["let a, b; a ? b(...a) : b(...c)", "let a, b;\nb(...a || c);\n"],
  ["let a, b; a ? b(...c) : b(...a)", "let a, b;\nb(...a && c);\n"],
  ["let a; a.x ? b(c) : b(d)", "let a;\na.x ? b(c) : b(d);\n"],
  ["let a, b; a.x ? b(c) : b(d)", "let a, b;\na.x ? b(c) : b(d);\n"],
  ["let a, b; a ? b.y(c) : b.y(d)", "let a, b;\na ? b.y(c) : b.y(d);\n"],
  ["let a, b; a.x ? b.y(c) : b.y(d)", "let a, b;\na.x ? b.y(c) : b.y(d);\n"],
  ["a ? b : c ? b : d", "a || c ? b : d;\n"],
  ["a ? b ? c : d : d", "a && b ? c : d;\n"],
  ["a ? c : (b, c)", "a || b, c;\n"],
  ["a ? (b, c) : c", "a && b, c;\n"],
  ["a ? c : (b, d)", "a ? c : (b, d);\n"],
  ["a ? (b, c) : d", "a ? (b, c) : d;\n"],
  ["a ? b || c : c", "a && b || c;\n"],
  ["a ? b || c : d", "a ? b || c : d;\n"],
  ["a ? b && c : c", "a ? b && c : c;\n"],
  ["a ? c : b && c", "(a || b) && c;\n"],
  ["a ? c : b && d", "a ? c : b && d;\n"],
  ["a ? c : b || c", "a ? c : b || c;\n"],
  ["a = b == null ? c : b", "a = b == null ? c : b;\n"],
  ["a = b != null ? b : c", "a = b != null ? b : c;\n"],
  ["let b; a = b == null ? c : b", "let b;\na = b ?? c;\n"],
  ["let b; a = b != null ? b : c", "let b;\na = b ?? c;\n"],
  ["let b; a = b == null ? b : c", "let b;\na = b == null ? b : c;\n"],
  ["let b; a = b != null ? c : b", "let b;\na = b != null ? c : b;\n"],
  ["let b; a = null == b ? c : b", "let b;\na = b ?? c;\n"],
  ["let b; a = null != b ? b : c", "let b;\na = b ?? c;\n"],
  ["let b; a = null == b ? b : c", "let b;\na = b == null ? b : c;\n"],
  ["let b; a = null != b ? c : b", "let b;\na = b != null ? c : b;\n"],
  ["let b; a = b.x == null ? c : b.x", "let b;\na = b.x == null ? c : b.x;\n"],
  ["let b; a = b.x != null ? b.x : c", "let b;\na = b.x != null ? b.x : c;\n"],
  ["let b; a = null == b.x ? c : b.x", "let b;\na = b.x == null ? c : b.x;\n"],
  ["let b; a = null != b.x ? b.x : c", "let b;\na = b.x != null ? b.x : c;\n"],
  ["let b; a = b === null ? c : b", "let b;\na = b === null ? c : b;\n"],
  ["let b; a = b !== null ? b : c", "let b;\na = b !== null ? b : c;\n"],
  ["let b; a = null === b ? c : b", "let b;\na = b === null ? c : b;\n"],
  ["let b; a = null !== b ? b : c", "let b;\na = b !== null ? b : c;\n"],
  ["let b; a = null === b || b === undefined ? c : b", "let b;\na = b ?? c;\n"],
  ["let b; a = b !== undefined && b !== null ? b : c", "let b;\na = b ?? c;\n"],
  ["a(b ? 0 : 0)", "a((b, 0));\n"],
  ["a(b ? +0 : -0)", "a(b ? 0 : -0);\n"],
  ["a(b ? +0 : 0)", "a((b, 0));\n"],
  ["a(b ? -0 : 0)", "a(b ? -0 : 0);\n"],
  ["a ? b : b", "a, b;\n"],
  ["let a; a ? b : b", "let a;\nb;\n"],
  ["a ? -b : -b", "a, -b;\n"],
  ["a ? b.c : b.c", "a, b.c;\n"],
  ["a ? b?.c : b?.c", "a, b?.c;\n"],
  ["a ? b[c] : b[c]", "a, b[c];\n"],
  ["a ? b() : b()", "a, b();\n"],
  ["a ? b?.() : b?.()", "a, b?.();\n"],
  ["a ? b?.[c] : b?.[c]", "a, b?.[c];\n"],
  ["a ? b == c : b == c", "a, b == c;\n"],
  ["a ? b.c(d + e[f]) : b.c(d + e[f])", "a, b.c(d + e[f]);\n"],
  ["a ? -b : !b", "a ? -b : b;\n"],
  ["a ? b() : b(c)", "a ? b() : b(c);\n"],
  ["a ? b(c) : b(d)", "a ? b(c) : b(d);\n"],
  ["a ? b?.c : b.c", "a ? b?.c : b.c;\n"],
  ["a ? b?.() : b()", "a ? b?.() : b();\n"],
  ["a ? b?.[c] : b[c]", "a ? b?.[c] : b[c];\n"],
  ["a ? b == c : b != c", "a ? b == c : b != c;\n"],
  ["a ? b.c(d + e[f]) : b.c(d + e[g])", "a ? b.c(d + e[f]) : b.c(d + e[g]);\n"],
  ["(a, b) ? c : d", "a, b ? c : d;\n"],
  ["return a && ((b && c) && (d && e))", "return a && b && c && d && e;\n"],
  ["return a || ((b || c) || (d || e))", "return a || b || c || d || e;\n"],
  ["return a ?? ((b ?? c) ?? (d ?? e))", "return a ?? b ?? c ?? d ?? e;\n"],
  ["if (a) if (b) if (c) d", "a && b && c && d;\n"],
  ["if (!a) if (!b) if (!c) d", "a || b || c || d;\n"],
  ["let a, b, c; return a != null ? a : b != null ? b : c", "let a, b, c;\nreturn a ?? b ?? c;\n"],
  ["if (a) return c; if (b) return d;", "if (a) return c;\nif (b) return d;\n"],
  ["if (a) return c; if (b) return c;", "if (a || b) return c;\n"],
  ["if (a) return c; if (b) return;", "if (a) return c;\nif (b) return;\n"],
  ["if (a) return; if (b) return c;", "if (a) return;\nif (b) return c;\n"],
  ["if (a) return; if (b) return;", "if (a || b) return;\n"],
  ["if (a) throw c; if (b) throw d;", "if (a) throw c;\nif (b) throw d;\n"],
  ["if (a) throw c; if (b) throw c;", "if (a || b) throw c;\n"],
  ["while (x) { if (a) break; if (b) break; }", "for (; x && !(a || b); )\n  ;\n"],
  ["while (x) { if (a) continue; if (b) continue; }", "for (; x; )\n  a || b;\n"],
  ["while (x) { debugger; if (a) break; if (b) break; }", "for (; x; ) {\n  debugger;\n  if (a || b) break;\n}\n"],
  ["while (x) { debugger; if (a) continue; if (b) continue; }", "for (; x; ) {\n  debugger;\n  a || b;\n}\n"],
  [
    "x: while (x) y: while (y) { if (a) break x; if (b) break y; }",
    "x: for (; x; ) y: for (; y; ) {\n  if (a) break x;\n  if (b) break y;\n}\n",
  ],
  [
    "x: while (x) y: while (y) { if (a) continue x; if (b) continue y; }",
    "x: for (; x; ) y: for (; y; ) {\n  if (a) continue x;\n  if (b) continue y;\n}\n",
  ],
  [
    "x: while (x) y: while (y) { if (a) break x; if (b) break x; }",
    "x: for (; x; ) for (; y; )\n  if (a || b) break x;\n",
  ],
  [
    "x: while (x) y: while (y) { if (a) continue x; if (b) continue x; }",
    "x: for (; x; ) for (; y; )\n  if (a || b) continue x;\n",
  ],
  [
    "x: while (x) y: while (y) { if (a) break y; if (b) break y; }",
    "for (; x; ) y: for (; y; )\n  if (a || b) break y;\n",
  ],
  [
    "x: while (x) y: while (y) { if (a) continue y; if (b) continue y; }",
    "for (; x; ) y: for (; y; )\n  if (a || b) continue y;\n",
  ],
  ["if (x ? y : 0) foo()", "x && y && foo();\n"],
  ["if (x ? y : 1) foo()", "(!x || y) && foo();\n"],
  ["if (x ? 0 : y) foo()", "!x && y && foo();\n"],
  ["if (x ? 1 : y) foo()", "(x || y) && foo();\n"],
  ["if (x ? y : 0) ; else foo()", "x && y || foo();\n"],
  ["if (x ? y : 1) ; else foo()", "!x || y || foo();\n"],
  ["if (x ? 0 : y) ; else foo()", "!x && y || foo();\n"],
  ["if (x ? 1 : y) ; else foo()", "x || y || foo();\n"],
  ["(x ? y : 0) && foo();", "x && y && foo();\n"],
  ["(x ? y : 1) && foo();", "(!x || y) && foo();\n"],
  ["(x ? 0 : y) && foo();", "!x && y && foo();\n"],
  ["(x ? 1 : y) && foo();", "(x || y) && foo();\n"],
  ["(x ? y : 0) || foo();", "x && y || foo();\n"],
  ["(x ? y : 1) || foo();", "!x || y || foo();\n"],
  ["(x ? 0 : y) || foo();", "!x && y || foo();\n"],
  ["(x ? 1 : y) || foo();", "x || y || foo();\n"],
  ["if (!!a || !!b) throw 0", "if (a || b) throw 0;\n"],
  ["if (!!a && !!b) throw 0", "if (a && b) throw 0;\n"],
  ["if (!!a ? !!b : !!c) throw 0", "if (a ? b : c) throw 0;\n"],
  ["if ((a + b) !== 0) throw 0", "if (a + b !== 0) throw 0;\n"],
  ["if ((a | b) !== 0) throw 0", "if ((a | b) !== 0) throw 0;\n"],
  ["if ((a & b) !== 0) throw 0", "if ((a & b) !== 0) throw 0;\n"],
  ["if ((a ^ b) !== 0) throw 0", "if ((a ^ b) !== 0) throw 0;\n"],
  ["if ((a << b) !== 0) throw 0", "if (a << b !== 0) throw 0;\n"],
  ["if ((a >> b) !== 0) throw 0", "if (a >> b !== 0) throw 0;\n"],
  ["if ((a >>> b) !== 0) throw 0", "if (a >>> b) throw 0;\n"],
  ["if (+a !== 0) throw 0", "if (+a != 0) throw 0;\n"],
  ["if (~a !== 0) throw 0", "if (~a !== 0) throw 0;\n"],
  ["if (0 != (a + b)) throw 0", "if (a + b != 0) throw 0;\n"],
  ["if (0 != (a | b)) throw 0", "if ((a | b) != 0) throw 0;\n"],
  ["if (0 != (a & b)) throw 0", "if ((a & b) != 0) throw 0;\n"],
  ["if (0 != (a ^ b)) throw 0", "if ((a ^ b) != 0) throw 0;\n"],
  ["if (0 != (a << b)) throw 0", "if (a << b != 0) throw 0;\n"],
  ["if (0 != (a >> b)) throw 0", "if (a >> b != 0) throw 0;\n"],
  ["if (0 != (a >>> b)) throw 0", "if (a >>> b) throw 0;\n"],
  ["if (0 != +a) throw 0", "if (+a != 0) throw 0;\n"],
  ["if (0 != ~a) throw 0", "if (~a != 0) throw 0;\n"],
  ["if ((a + b) === 0) throw 0", "if (a + b === 0) throw 0;\n"],
  ["if ((a | b) === 0) throw 0", "if ((a | b) === 0) throw 0;\n"],
  ["if ((a & b) === 0) throw 0", "if ((a & b) === 0) throw 0;\n"],
  ["if ((a ^ b) === 0) throw 0", "if ((a ^ b) === 0) throw 0;\n"],
  ["if ((a << b) === 0) throw 0", "if (a << b === 0) throw 0;\n"],
  ["if ((a >> b) === 0) throw 0", "if (a >> b === 0) throw 0;\n"],
  ["if ((a >>> b) === 0) throw 0", "if (!(a >>> b)) throw 0;\n"],
  ["if (+a === 0) throw 0", "if (+a == 0) throw 0;\n"],
  ["if (~a === 0) throw 0", "if (~a === 0) throw 0;\n"],
  ["if (0 == (a + b)) throw 0", "if (a + b == 0) throw 0;\n"],
  ["if (0 == (a | b)) throw 0", "if ((a | b) == 0) throw 0;\n"],
  ["if (0 == (a & b)) throw 0", "if ((a & b) == 0) throw 0;\n"],
  ["if (0 == (a ^ b)) throw 0", "if ((a ^ b) == 0) throw 0;\n"],
  ["if (0 == (a << b)) throw 0", "if (a << b == 0) throw 0;\n"],
  ["if (0 == (a >> b)) throw 0", "if (a >> b == 0) throw 0;\n"],
  ["if (0 == (a >>> b)) throw 0", "if (!(a >>> b)) throw 0;\n"],
  ["if (0 == +a) throw 0", "if (+a == 0) throw 0;\n"],
  ["if (0 == ~a) throw 0", "if (~a == 0) throw 0;\n"],
]);

check("TestMangleWrapToAvoidAmbiguousElse", [
  ["if (a) { if (b) return c } else return d", "if (a) {\n  if (b) return c;\n} else return d;\n"],
  [
    "if (a) while (1) { if (b) return c } else return d",
    "if (a) {\n  for (; ; )\n    if (b) return c;\n} else return d;\n",
  ],
  [
    "if (a) for (;;) { if (b) return c } else return d",
    "if (a) {\n  for (; ; )\n    if (b) return c;\n} else return d;\n",
  ],
  [
    "if (a) for (x in y) { if (b) return c } else return d",
    "if (a) {\n  for (x in y)\n    if (b) return c;\n} else return d;\n",
  ],
  [
    "if (a) for (x of y) { if (b) return c } else return d",
    "if (a) {\n  for (x of y)\n    if (b) return c;\n} else return d;\n",
  ],
  [
    "if (a) with (x) { if (b) return c } else return d",
    "if (a) {\n  with (x)\n    if (b) return c;\n} else return d;\n",
  ],
  ["if (a) x: { if (b) break x } else return c", "if (a) {\n  x:\n    if (b) break x;\n} else return c;\n"],
]);

check("TestMangleOptionalChain", [
  ["let a; return a != null ? a.b : undefined", "let a;\nreturn a?.b;\n"],
  ["let a; return a != null ? a[b] : undefined", "let a;\nreturn a?.[b];\n"],
  ["let a; return a != null ? a(b) : undefined", "let a;\nreturn a?.(b);\n"],
  ["let a; return a == null ? undefined : a.b", "let a;\nreturn a?.b;\n"],
  ["let a; return a == null ? undefined : a[b]", "let a;\nreturn a?.[b];\n"],
  ["let a; return a == null ? undefined : a(b)", "let a;\nreturn a?.(b);\n"],
  ["let a; return null != a ? a.b : undefined", "let a;\nreturn a?.b;\n"],
  ["let a; return null != a ? a[b] : undefined", "let a;\nreturn a?.[b];\n"],
  ["let a; return null != a ? a(b) : undefined", "let a;\nreturn a?.(b);\n"],
  ["let a; return null == a ? undefined : a.b", "let a;\nreturn a?.b;\n"],
  ["let a; return null == a ? undefined : a[b]", "let a;\nreturn a?.[b];\n"],
  ["let a; return null == a ? undefined : a(b)", "let a;\nreturn a?.(b);\n"],
  ["return a != null ? a.b : undefined", "return a != null ? a.b : void 0;\n"],
  ["let a; return a != null ? a.b : null", "let a;\nreturn a != null ? a.b : null;\n"],
  ["let a; return a != null ? b.a : undefined", "let a;\nreturn a != null ? b.a : void 0;\n"],
  ["let a; return a != 0 ? a.b : undefined", "let a;\nreturn a != 0 ? a.b : void 0;\n"],
  ["let a; return a !== null ? a.b : undefined", "let a;\nreturn a !== null ? a.b : void 0;\n"],
  ["let a; return a != undefined ? a.b : undefined", "let a;\nreturn a?.b;\n"],
  ["let a; return a != null ? a?.b : undefined", "let a;\nreturn a?.b;\n"],
  ["let a; return a != null ? a.b.c[d](e) : undefined", "let a;\nreturn a?.b.c[d](e);\n"],
  ["let a; return a != null ? a?.b.c[d](e) : undefined", "let a;\nreturn a?.b.c[d](e);\n"],
  ["let a; return a != null ? a.b.c?.[d](e) : undefined", "let a;\nreturn a?.b.c?.[d](e);\n"],
  ["let a; return a != null ? a?.b.c?.[d](e) : undefined", "let a;\nreturn a?.b.c?.[d](e);\n"],
  ["a != null && a.b()", "a?.b();\n"],
  ["a == null || a.b()", "a?.b();\n"],
  ["null != a && a.b()", "a?.b();\n"],
  ["null == a || a.b()", "a?.b();\n"],
  ["a == null && a.b()", "a == null && a.b();\n"],
  ["a != null || a.b()", "a != null || a.b();\n"],
  ["null == a && a.b()", "a == null && a.b();\n"],
  ["null != a || a.b()", "a != null || a.b();\n"],
  ["x = a != null && a.b()", "x = a != null && a.b();\n"],
  ["x = a == null || a.b()", "x = a == null || a.b();\n"],
  ["if (a != null) a.b()", "a?.b();\n"],
  ["if (a == null) ; else a.b()", "a?.b();\n"],
  ["if (a == null) a.b()", "a == null && a.b();\n"],
  ["if (a != null) ; else a.b()", "a != null || a.b();\n"],
]);

check("TestMangleReturn", [
  ["function foo() { x(); return; }", "function foo() {\n  x();\n}\n"],
  ["let foo = function() { x(); return; }", "let foo = function() {\n  x();\n};\n"],
  ["let foo = () => { x(); return; }", "let foo = () => {\n  x();\n};\n"],
  ["function foo() { x(); return y; }", "function foo() {\n  return x(), y;\n}\n"],
  ["let foo = function() { x(); return y; }", "let foo = function() {\n  return x(), y;\n};\n"],
  ["let foo = () => { x(); return y; }", "let foo = () => (x(), y);\n"],
  ["x(); return;", "x();\nreturn;\n"],
  [
    "function foo() { a = b; if (a) return a; if (b) c = b; return c; }",
    "function foo() {\n  return a = b, a || (b && (c = b), c);\n}\n",
  ],
  [
    "function foo() { a = b; if (a) return; if (b) c = b; return c; }",
    "function foo() {\n  if (a = b, !a)\n    return b && (c = b), c;\n}\n",
  ],
  ["function foo() { if (!a) return b; return c; }", "function foo() {\n  return a ? c : b;\n}\n"],
  ["if (1) return a(); else return b()", "return a();\n"],
  ["if (0) return a(); else return b()", "return b();\n"],
  ["if (a) return b(); else return c()", "return a ? b() : c();\n"],
  ["if (!a) return b(); else return c()", "return a ? c() : b();\n"],
  ["if (!!a) return b(); else return c()", "return a ? b() : c();\n"],
  ["if (!!!a) return b(); else return c()", "return a ? c() : b();\n"],
  ["if (1) return a(); return b()", "return a();\n"],
  ["if (0) return a(); return b()", "return b();\n"],
  ["if (a) return b(); return c()", "return a ? b() : c();\n"],
  ["if (!a) return b(); return c()", "return a ? c() : b();\n"],
  ["if (!!a) return b(); return c()", "return a ? b() : c();\n"],
  ["if (!!!a) return b(); return c()", "return a ? c() : b();\n"],
  ["if (a) return b; else return c; return d;\n", "return a ? b : c;\n"],
  ["function x() { if (y) return; z(); }", "function x() {\n  y || z();\n}\n"],
  ["function x() { if (y) return; else z(); w(); }", "function x() {\n  y || (z(), w());\n}\n"],
  ["function x() { t(); if (y) return; z(); }", "function x() {\n  t(), !y && z();\n}\n"],
  ["function x() { t(); if (y) return; else z(); w(); }", "function x() {\n  t(), !y && (z(), w());\n}\n"],
  ["function x() { debugger; if (y) return; z(); }", "function x() {\n  debugger;\n  y || z();\n}\n"],
  ["function x() { debugger; if (y) return; else z(); w(); }", "function x() {\n  debugger;\n  y || (z(), w());\n}\n"],
  ["function x() { if (y) { if (z) return; } }", "function x() {\n  y && z;\n}\n"],
  [
    "function x() { if (y) { if (z) return; w(); } }",
    "function x() {\n  if (y) {\n    if (z) return;\n    w();\n  }\n}\n",
  ],
  ["function foo(x) { if (!x.y) {} else return x }", "function foo(x) {\n  if (x.y)\n    return x;\n}\n"],
  ["function foo(x) { if (!x.y) return undefined; return x }", "function foo(x) {\n  if (x.y)\n    return x;\n}\n"],
  ["function x() { if (y) return; function y() {} }", "function x() {\n  if (y) return;\n  function y() {\n  }\n}\n"],
  ["function x() { if (y) return; let y }", "function x() {\n  if (y) return;\n  let y;\n}\n"],
  ["function x() { if (y) return; var y }", "function x() {\n  if (!y)\n    var y;\n}\n"],
]);

check("TestMangleThrow", [
  [
    "function foo() { a = b; if (a) throw a; if (b) c = b; throw c; }",
    "function foo() {\n  throw a = b, a || (b && (c = b), c);\n}\n",
  ],
  ["function foo() { if (!a) throw b; throw c; }", "function foo() {\n  throw a ? c : b;\n}\n"],
  ["if (1) throw a(); else throw b()", "throw a();\n"],
  ["if (0) throw a(); else throw b()", "throw b();\n"],
  ["if (a) throw b(); else throw c()", "throw a ? b() : c();\n"],
  ["if (!a) throw b(); else throw c()", "throw a ? c() : b();\n"],
  ["if (!!a) throw b(); else throw c()", "throw a ? b() : c();\n"],
  ["if (!!!a) throw b(); else throw c()", "throw a ? c() : b();\n"],
  ["if (1) throw a(); throw b()", "throw a();\n"],
  ["if (0) throw a(); throw b()", "throw b();\n"],
  ["if (a) throw b(); throw c()", "throw a ? b() : c();\n"],
  ["if (!a) throw b(); throw c()", "throw a ? c() : b();\n"],
  ["if (!!a) throw b(); throw c()", "throw a ? b() : c();\n"],
  ["if (!!!a) throw b(); throw c()", "throw a ? c() : b();\n"],
]);

check("TestMangleNestedLogical", [
  ["(a && b) && c", "a && b && c;\n"],
  ["a && (b && c)", "a && b && c;\n"],
  ["(a || b) && c", "(a || b) && c;\n"],
  ["a && (b || c)", "a && (b || c);\n"],
  ["(a || b) || c", "a || b || c;\n"],
  ["a || (b || c)", "a || b || c;\n"],
  ["(a && b) || c", "a && b || c;\n"],
  ["a || (b && c)", "a || b && c;\n"],
]);

check("TestMangleEquals", [
  ["return typeof x === y", "return typeof x === y;\n"],
  ["return typeof x !== y", "return typeof x !== y;\n"],
  ["return y === typeof x", "return y === typeof x;\n"],
  ["return y !== typeof x", "return y !== typeof x;\n"],
  ["return typeof x === 'string'", 'return typeof x == "string";\n'],
  ["return typeof x !== 'string'", 'return typeof x != "string";\n'],
  ["return 'string' === typeof x", 'return typeof x == "string";\n'],
  ["return 'string' !== typeof x", 'return typeof x != "string";\n'],
  ["return a === 0", "return a === 0;\n"],
  ["return a !== 0", "return a !== 0;\n"],
  ["return +a === 0", "return +a == 0;\n"],
  ["return +a !== 0", "return +a != 0;\n"],
  ["return -a === 0", "return -a === 0;\n"],
  ["return -a !== 0", "return -a !== 0;\n"],
  ["return a === ''", 'return a === "";\n'],
  ["return a !== ''", 'return a !== "";\n'],
  ["return (a + '!') === 'a!'", 'return a + "!" == "a!";\n'],
  ["return (a + '!') !== 'a!'", 'return a + "!" != "a!";\n'],
  ["return (a += '!') === 'a!'", 'return (a += "!") == "a!";\n'],
  ["return (a += '!') !== 'a!'", 'return (a += "!") != "a!";\n'],
  ["return a === false", "return a === false;\n"],
  ["return a === true", "return a === true;\n"],
  ["return a !== false", "return a !== false;\n"],
  ["return a !== true", "return a !== true;\n"],
  ["return a === !b", "return a === !b;\n"],
  ["return a === !b", "return a === !b;\n"],
  ["return a !== !b", "return a !== !b;\n"],
  ["return a !== !b", "return a !== !b;\n"],
  ["return !a === !b", "return !a == !b;\n"],
  ["return !a === !b", "return !a == !b;\n"],
  ["return !a !== !b", "return !a != !b;\n"],
  ["return !a !== !b", "return !a != !b;\n"],
  ["return (a -= 1n) !== -1", "return (a -= 1n) !== -1;\n"],
  ["return (a *= 1n) !== -1", "return (a *= 1n) !== -1;\n"],
  ["return (a **= 1n) !== -1", "return (a **= 1n) !== -1;\n"],
  ["return (a /= 1n) !== -1", "return (a /= 1n) !== -1;\n"],
  ["return (a %= 1n) !== -1", "return (a %= 1n) !== -1;\n"],
  ["return (a &= 1n) !== -1", "return (a &= 1n) !== -1;\n"],
  ["return (a |= 1n) !== -1", "return (a |= 1n) !== -1;\n"],
  ["return (a ^= 1n) !== -1", "return (a ^= 1n) !== -1;\n"],
]);

check("TestMangleEqualsUndefined", [
  ["return a === void 0", "return a === void 0;\n"],
  ["return a !== void 0", "return a !== void 0;\n"],
  ["return void 0 === a", "return a === void 0;\n"],
  ["return void 0 !== a", "return a !== void 0;\n"],
  ["return a == void 0", "return a == null;\n"],
  ["return a != void 0", "return a != null;\n"],
  ["return void 0 == a", "return a == null;\n"],
  ["return void 0 != a", "return a != null;\n"],
  ["return a === null || a === undefined", "return a == null;\n"],
  ["return a === null || a !== undefined", "return a === null || a !== void 0;\n"],
  ["return a !== null || a === undefined", "return a !== null || a === void 0;\n"],
  ["return a === null && a === undefined", "return a === null && a === void 0;\n"],
  ["return a.x === null || a.x === undefined", "return a.x === null || a.x === void 0;\n"],
  ["return a === undefined || a === null", "return a == null;\n"],
  ["return a === undefined || a !== null", "return a === void 0 || a !== null;\n"],
  ["return a !== undefined || a === null", "return a !== void 0 || a === null;\n"],
  ["return a === undefined && a === null", "return a === void 0 && a === null;\n"],
  ["return a.x === undefined || a.x === null", "return a.x === void 0 || a.x === null;\n"],
  ["return a !== null && a !== undefined", "return a != null;\n"],
  ["return a !== null && a === undefined", "return a !== null && a === void 0;\n"],
  ["return a === null && a !== undefined", "return a === null && a !== void 0;\n"],
  ["return a !== null || a !== undefined", "return a !== null || a !== void 0;\n"],
  ["return a.x !== null && a.x !== undefined", "return a.x !== null && a.x !== void 0;\n"],
  ["return a !== undefined && a !== null", "return a != null;\n"],
  ["return a !== undefined && a === null", "return a !== void 0 && a === null;\n"],
  ["return a === undefined && a !== null", "return a === void 0 && a !== null;\n"],
  ["return a !== undefined || a !== null", "return a !== void 0 || a !== null;\n"],
  ["return a.x !== undefined && a.x !== null", "return a.x !== void 0 && a.x !== null;\n"],
]);

check("TestMangleTypeofEqualsUndefined", [
  ["return typeof x !== 'undefined'", 'return typeof x < "u";\n'],
  ["return typeof x != 'undefined'", 'return typeof x < "u";\n'],
  ["return 'undefined' !== typeof x", 'return typeof x < "u";\n'],
  ["return 'undefined' != typeof x", 'return typeof x < "u";\n'],
  ["return typeof x === 'undefined'", 'return typeof x > "u";\n'],
  ["return typeof x == 'undefined'", 'return typeof x > "u";\n'],
  ["return 'undefined' === typeof x", 'return typeof x > "u";\n'],
  ["return 'undefined' == typeof x", 'return typeof x > "u";\n'],
]);

check("TestMangleCatch", [
  ["try { throw 0 } catch (e) { console.log(0) }", "try {\n  throw 0;\n} catch {\n  console.log(0);\n}\n"],
  ["try { throw 0 } catch (e) { console.log(0, e) }", "try {\n  throw 0;\n} catch (e) {\n  console.log(0, e);\n}\n"],
  ["try { throw 0 } catch (e) { 0 && console.log(0, e) }", "try {\n  throw 0;\n} catch {\n}\n"],
  ["try { thrower() } catch ([a]) { console.log(0) }", "try {\n  thrower();\n} catch ([a]) {\n  console.log(0);\n}\n"],
  [
    "try { thrower() } catch ({ a }) { console.log(0) }",
    "try {\n  thrower();\n} catch ({ a }) {\n  console.log(0);\n}\n",
  ],
  [
    "try { throw 1 } catch (x) { y(x); var x = 2; y(x) }",
    "try {\n  throw 1;\n} catch (x) {\n  y(x), x = 2, y(x);\n}\nvar x;\n",
  ], // bun: relocates var
  ["try { throw 1 } catch (x) { var x = 2; y(x) }", "try {\n  throw 1;\n} catch (x) {\n  x = 2, y(x);\n}\nvar x;\n"], // bun: relocates var
  ["try { throw 1 } catch (x) { var x = 2 }", "try {\n  throw 1;\n} catch (x) {\n  x = 2;\n}\nvar x;\n"], // bun: relocates var
  ["try { throw 1 } catch (x) { eval('x') }", 'try {\n  throw 1;\n} catch (x) {\n  eval("x");\n}\n'],
  ["if (y) try { throw 1 } catch (x) {} else eval('x')", 'if (y) try {\n  throw 1;\n} catch {\n}\nelse eval("x");\n'],
]);

check("TestMangleTry", [
  ["try { throw 0 } catch (e) { foo() }", "try {\n  throw 0;\n} catch {\n  foo();\n}\n"],
  ["try {} catch (e) { var foo }", "var foo;\n"], // bun: relocates var
  ["try {} catch (e) { foo() }", ""],
  ["try {} catch (e) { foo() } finally {}", ""],
  ["try {} finally { foo() }", "foo();\n"],
  ["try {} catch (e) { foo() } finally { bar() }", "bar();\n"],
  ["try {} finally { var x = foo() }", "x = foo();\nvar x;\n"], // bun: relocates var
  ["try {} catch (e) { foo() } finally { var x = bar() }", "x = bar();\nvar x;\n"], // bun: relocates var
  ["try {} finally { let x = foo() }", "{\n  let x = foo();\n}\n"],
  ["try {} catch (e) { foo() } finally { let x = bar() }", "{\n  let x = bar();\n}\n"],
  ["try { foo() } catch {}", "try {\n  foo();\n} catch {\n}\n"],
  ["try { foo() } catch {} finally {}", "try {\n  foo();\n} catch {\n}\n"],
  ["try { foo() } finally {}", "foo();\n"],
  ["try { var x = foo() } catch {}", "try {\n  x = foo();\n} catch {}\nvar x;\n"], // bun: relocates var
  ["try { var x = foo() } catch {} finally {}", "try {\n  x = foo();\n} catch {}\nvar x;\n"], // bun: relocates var
  ["try { var x = foo() } finally {}", "x = foo();\nvar x;\n"], // bun: relocates var
  ["try { let x = foo() } catch {}", "try {\n  let x = foo();\n} catch {\n}\n"],
  ["try { let x = foo() } catch {} finally {}", "try {\n  let x = foo();\n} catch {\n}\n"],
  ["try { let x = foo() } finally {}", "{\n  let x = foo();\n}\n"],
  ["x: try { while (true) ; break x } catch {}", "x: try {\n  for (; ; ) ;\n  break x;\n} catch {\n}\n"],
  [
    "d: { e: { try { while (1) { break d } } catch { break e } } }",
    "d:\n  e:\n    try {\n      for (; ; )\n        break d;\n    } catch {\n      break e;\n    }\n",
  ],
]);
