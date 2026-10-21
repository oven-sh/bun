import { afterAll, describe, expect, test } from "bun:test";
import { bunExe, isASAN, isDebug, tempDir } from "harness";
import { endChildren, longLimit, spawn } from "../children";
import { env } from "./differential";

afterAll(endChildren);

// The module specifier of an import or an export has to be a string literal (TS1141), and a file with another
// expression there still gets a declaration file. TypeScript's declaration emitter keeps the node of such a specifier,
// and its printer writes the node: each token with the printer's own spacing, line breaks and indentation, the comments
// that a declaration file keeps, and the literals as the printer normalizes them. A project that references this one
// parses that text, so its bytes decide which errors the project reports in the `.d.ts` file, and where.
//
// In each case `lib` has the modules, and `app`, which references `lib`, imports them all. `lines` is what
// TypeScript 7.0.2 prints for `tsc -b --pretty false`.

const globals = "Array<T> Boolean CallableFunction Function IArguments NewableFunction Number Object RegExp String"
  .split(" ")
  .map(name => `interface ${name} {}\n`)
  .join("");

function layout(modules: Record<string, string>, options: object = {}) {
  const config = (rest: object = {}) =>
    JSON.stringify({
      compilerOptions: {
        strict: true,
        target: "esnext",
        module: "esnext",
        moduleResolution: "bundler",
        types: [],
        skipLibCheck: true,
        noLib: true,
        composite: true,
        ...options,
      },
      ...rest,
    });
  return {
    "tsconfig.json": `{ "files": [], "references": [{ "path": "./lib" }, { "path": "./app" }] }`,
    "lib/tsconfig.json": config(),
    "lib/globals.d.ts": globals,
    "lib/m.ts": "export const a = 1;\n",
    ...Object.fromEntries(Object.entries(modules).map(([path, text]) => [`lib/${path}`, text])),
    "app/tsconfig.json": config({ references: [{ path: "../lib" }] }),
    "app/globals.d.ts": globals,
    "app/main.ts": Object.keys(modules)
      .map(path => `import "../lib/${path.replace(/\.\w+$/, "")}";\n`)
      .join(""),
  };
}

/** The lines of a file. */
const file = (...lines: string[]) => lines.join("\n") + "\n";

// `"".repeat` is slow in debug builds of JavaScriptCore.
const repeat = (text: string, count: number) => Buffer.alloc(text.length * count, text).toString();

async function check(cwd: string) {
  await using proc = spawn({
    cmd: [bunExe(), "check", "-b"],
    cwd,
    env,
    timeout: longLimit,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  // A crash, a failed assertion or a sanitizer report. The assertions below don't show why, so print stderr.
  if (exitCode !== 1) console.error(`bun check -b exited with ${exitCode}:\n${stderr}`);
  return { lines: stdout.replaceAll("\\", "/").trim().split(/\r?\n/), exitCode };
}

const cases: Record<string, { modules: Record<string, string>; options?: object; lines: string }> = {
  "in each kind of import and export declaration": {
    modules: {
      "star.ts": "export * from (a , )\n",
      "namespace.ts": "export * as ns from (a , )\n",
      "named.ts": "export { a } from (a , )\n",
      "type-star.ts": "export type * from (a , )\n",
      "type-named.ts": "export type { a } from (a , )\n",
      "default-import.ts": file("import d from (a , )", "export declare const c: typeof d;"),
      "named-import.ts": file("import { n } from (a , )", "export declare const c: typeof n;"),
      "namespace-import.ts": file("import * as s from (a , )", "export declare const c: typeof s;"),
      "type-import.ts": file("import type { T } from (a , )", "export declare const c: T;"),
      "import-equals.ts": file("import x = require((a , ))", "export declare const c: typeof x;"),
      "export-import-equals.ts": "export import x = require((a , ))\n",
      "type-import-equals.ts": file("import type x = require((a , ))", "export declare const c: typeof x;"),
      "require-nothing.ts": file("import x = require();", "export declare const c: typeof x;"),
    },
    lines: `
lib/default-import.ts(1,20): error TS1109: Expression expected.
lib/export-import-equals.ts(1,32): error TS1109: Expression expected.
lib/import-equals.ts(1,25): error TS1109: Expression expected.
lib/named-import.ts(1,24): error TS1109: Expression expected.
lib/named.ts(1,24): error TS1109: Expression expected.
lib/namespace-import.ts(1,25): error TS1109: Expression expected.
lib/namespace.ts(1,26): error TS1109: Expression expected.
lib/require-nothing.ts(1,20): error TS1109: Expression expected.
lib/star.ts(1,20): error TS1109: Expression expected.
lib/type-import-equals.ts(1,30): error TS1109: Expression expected.
lib/type-import.ts(1,29): error TS1109: Expression expected.
lib/type-named.ts(1,29): error TS1109: Expression expected.
lib/type-star.ts(1,25): error TS1109: Expression expected.
lib/default-import.d.ts(1,19): error TS1109: Expression expected.
lib/export-import-equals.d.ts(1,31): error TS1109: Expression expected.
lib/import-equals.d.ts(1,24): error TS1109: Expression expected.
lib/named-import.d.ts(1,23): error TS1109: Expression expected.
lib/named.d.ts(1,23): error TS1109: Expression expected.
lib/namespace-import.d.ts(1,24): error TS1109: Expression expected.
lib/namespace.d.ts(1,25): error TS1109: Expression expected.
lib/require-nothing.d.ts(1,20): error TS1109: Expression expected.
lib/star.d.ts(1,19): error TS1109: Expression expected.
lib/type-import-equals.d.ts(1,29): error TS1109: Expression expected.
lib/type-import.d.ts(1,28): error TS1109: Expression expected.
lib/type-named.d.ts(1,28): error TS1109: Expression expected.
lib/type-star.d.ts(1,24): error TS1109: Expression expected.
`,
  },
  "in the body of an ambient module and of a namespace, with their indentation": {
    modules: {
      "ambient.ts": file(
        `declare module "ambient" {`,
        "  export * from (a , )",
        "  export * as ns from f(",
        "    a,",
        "    b +",
        "  )",
        "  export { a } from { a: 1,",
        "    b: }",
        "  import d from (a , )",
        "  import { n } from a ?",
        "    b : ",
        "  import * as s from [",
        "    a, b +]",
        "  import x = require(function () { return a + })",
        "  export import y = require((a , ))",
        "  export const c: typeof d | typeof n | typeof s | typeof x;",
        "}",
      ),
      "namespace.ts": file(
        "export namespace outer {",
        "  export declare namespace inner {",
        "    import x = require(a +",
        "      b + )",
        "    export const c: typeof x;",
        "  }",
        "}",
      ),
    },
    lines: `
lib/ambient.ts(2,22): error TS1109: Expression expected.
lib/ambient.ts(6,3): error TS1109: Expression expected.
lib/ambient.ts(8,8): error TS1109: Expression expected.
lib/ambient.ts(9,22): error TS1109: Expression expected.
lib/ambient.ts(12,3): error TS1109: Expression expected.
lib/ambient.ts(13,11): error TS1109: Expression expected.
lib/ambient.ts(14,47): error TS1109: Expression expected.
lib/ambient.ts(15,34): error TS1109: Expression expected.
lib/namespace.ts(4,11): error TS1109: Expression expected.
lib/ambient.d.ts(2,23): error TS1109: Expression expected.
lib/ambient.d.ts(4,5): error TS1109: Expression expected.
lib/ambient.d.ts(6,13): error TS1109: Expression expected.
lib/ambient.d.ts(7,23): error TS1109: Expression expected.
lib/ambient.d.ts(10,5): error TS1109: Expression expected.
lib/ambient.d.ts(13,5): error TS1109: Expression expected.
lib/ambient.d.ts(14,49): error TS1109: Expression expected.
lib/ambient.d.ts(15,35): error TS1109: Expression expected.
lib/namespace.d.ts(4,17): error TS1109: Expression expected.
`,
  },
  "where the source lacks a token or an operand": {
    modules: {
      "nothing.ts": "export *\n",
      "operand.ts": "export * from a +\n",
      "call.ts": "export * from f(\n",
      "array.ts": "export * from [1,\n",
      "index.ts": "export * from a[\n",
      "member.ts": "export * from a.\n",
      "conditional.ts": "export * from a ? b\n",
      "object.ts": "export * from { a: , b\n",
      "import.ts": file("import { A } from", "export declare const c: A;"),
      "import-number.ts": file("import a from 1 +", "export declare const c: typeof a;"),
      "string.ts": `export * from ("./m")\n`,
      "spaces.ts": `export * from (  "./m"  ,  )\n`,
      "unterminated.ts": `export * from ('a' + "b" + 'c\n`,
    },
    lines: `
lib/array.ts(2,1): error TS1005: ']' expected.
lib/call.ts(2,1): error TS1005: ')' expected.
lib/conditional.ts(2,1): error TS1005: ':' expected.
lib/import-number.ts(2,1): error TS1109: Expression expected.
lib/import.ts(2,1): error TS1109: Expression expected.
lib/index.ts(1,17): error TS1109: Expression expected.
lib/index.ts(2,1): error TS1005: ']' expected.
lib/member.ts(1,17): error TS1003: Identifier expected.
lib/nothing.ts(1,9): error TS1109: Expression expected.
lib/nothing.ts(2,1): error TS1005: 'from' expected.
lib/object.ts(1,20): error TS1109: Expression expected.
lib/object.ts(2,1): error TS1005: '}' expected.
lib/operand.ts(1,18): error TS1109: Expression expected.
lib/spaces.ts(1,28): error TS1109: Expression expected.
lib/unterminated.ts(1,30): error TS1002: Unterminated string literal.
lib/unterminated.ts(2,1): error TS1005: ')' expected.
lib/conditional.d.ts(3,1): error TS1109: Expression expected.
lib/import-number.d.ts(2,1): error TS1109: Expression expected.
lib/import.d.ts(1,19): error TS1109: Expression expected.
lib/index.d.ts(1,17): error TS1011: An element access expression should take an argument.
lib/member.d.ts(2,1): error TS1003: Identifier expected.
lib/nothing.d.ts(1,15): error TS1109: Expression expected.
lib/object.d.ts(1,20): error TS1109: Expression expected.
lib/operand.d.ts(2,1): error TS1109: Expression expected.
lib/spaces.d.ts(1,23): error TS1109: Expression expected.
lib/unterminated.d.ts(1,32): error TS1002: Unterminated string literal.
lib/unterminated.d.ts(2,1): error TS1005: ')' expected.
`,
  },
  "with its comments": {
    modules: {
      "jsdoc.ts": "export * from ( /** c */a + )\n",
      "plain.ts": "export * from ( /* c */a + )\n",
      "pinned.ts": "export * from ( /*! c */a + )\n",
      "after-from.ts": file("export * from /** c */ f( /** d */ a, // e", "  /** g */ b + )"),
      "lines.ts": file("export * from [ // c", "  a, /** d */", "  b +", "]"),
      "import.ts": file("import d from /** c */ (a , ) /** e */", "export declare const c: typeof d;"),
      "require.ts": file(
        "import x = require( /** c */ a /** d */ + /** e */ ) /** f */",
        "export declare const c: typeof x;",
      ),
    },
    lines: `
lib/after-from.ts(2,16): error TS1109: Expression expected.
lib/import.ts(1,29): error TS1109: Expression expected.
lib/jsdoc.ts(1,29): error TS1109: Expression expected.
lib/lines.ts(4,1): error TS1109: Expression expected.
lib/pinned.ts(1,29): error TS1109: Expression expected.
lib/plain.ts(1,28): error TS1109: Expression expected.
lib/require.ts(1,52): error TS1109: Expression expected.
lib/after-from.d.ts(2,14): error TS1109: Expression expected.
lib/import.d.ts(1,28): error TS1109: Expression expected.
lib/jsdoc.d.ts(1,29): error TS1109: Expression expected.
lib/lines.d.ts(4,1): error TS1109: Expression expected.
lib/pinned.d.ts(1,29): error TS1109: Expression expected.
lib/plain.d.ts(1,20): error TS1109: Expression expected.
lib/require.d.ts(1,42): error TS1109: Expression expected.
`,
  },
  "with its literals as the printer writes them": {
    modules: {
      "octal.ts": "export * from (010 , )\n",
      "separators.ts": "export * from (1_0 + 1__0 , )\n",
      "bigint.ts": "export * from (0X1Fn , )\n",
      "template.ts": "export * from (`a${ b }c${d}` , )\n",
      "regex.ts": "export * from (/a[/]b/g . c , )\n",
      "number-member.ts": "export * from (1 . a + 1.5 . b , )\n",
    },
    lines: `
lib/bigint.ts(1,24): error TS1109: Expression expected.
lib/number-member.ts(1,34): error TS1109: Expression expected.
lib/octal.ts(1,16): error TS1121: Octal literals are not allowed. Use the syntax '0o10'.
lib/octal.ts(1,22): error TS1109: Expression expected.
lib/regex.ts(1,31): error TS1109: Expression expected.
lib/separators.ts(1,24): error TS6189: Multiple consecutive numeric separators are not permitted.
lib/separators.ts(1,29): error TS1109: Expression expected.
lib/template.ts(1,33): error TS1109: Expression expected.
lib/bigint.d.ts(1,23): error TS1109: Expression expected.
lib/number-member.d.ts(1,30): error TS1109: Expression expected.
lib/octal.d.ts(1,19): error TS1109: Expression expected.
lib/regex.d.ts(1,28): error TS1109: Expression expected.
lib/separators.d.ts(1,26): error TS1109: Expression expected.
lib/template.d.ts(1,30): error TS1109: Expression expected.
`,
  },
  "with each kind of node in it": {
    options: { jsx: "preserve" },
    modules: {
      "function.ts": file(
        "export * from (function f<T>(this: T, { a, b: [c] }: any, ...rest: string[]): void {",
        "  if (a) return",
        "  for (const d of rest) c(d)",
        "} , )",
      ),
      "arrow.ts": "export * from (async <T,>(a: T, b?: T) => { b ??= a }, (a) => a ? 1 : 2 , )\n",
      "class.ts": file(
        "export * from (class C<T> extends B<T> implements I {",
        "  static #count = 0",
        "  constructor(private readonly a: T) { super() }",
        "  get value(): T { return this.a }",
        "  @decorated method?(): void",
        "} , )",
      ),
      "object.ts": `export * from ({ a, b: 1, ["c"]: 2, d() {}, get e() { return 1 }, ...f } , )\n`,
      "type.ts": "export * from (a as { [K in keyof T]?: T[K] extends (infer U)[] ? U : never } , )\n",
      "types.ts": `export * from (a satisfies [a: string, b?: import("./m").a, ...c: Array<typeof a>] | (new () => void) , )\n`,
      "call.ts": "export * from (new a.b<T>(c, ...d)?.[e]!.f`g${h}` , )\n",
      "element.tsx": file(`export * from (<div a = "1" b = { c } { ...d }>`, "  text { e }<f.g/><></>", "</div> , )"),
      "statements.ts": file(
        "export * from (function () {",
        "  label: while (a) { if (b) continue label; else break }",
        "  do { var c = 1, d } while (c)",
        "  switch (c) { case 1: d = 2",
        "    default: throw d }",
        "  try { e() } catch { f() } finally { g() }",
        "} , )",
      ),
    },
    lines: `
lib/arrow.ts(1,75): error TS1109: Expression expected.
lib/call.ts(1,53): error TS1109: Expression expected.
lib/class.ts(6,5): error TS1109: Expression expected.
lib/element.tsx(3,10): error TS1109: Expression expected.
lib/function.ts(4,5): error TS1109: Expression expected.
lib/object.ts(1,76): error TS1109: Expression expected.
lib/statements.ts(7,5): error TS1109: Expression expected.
lib/type.ts(1,81): error TS1109: Expression expected.
lib/types.ts(1,105): error TS1109: Expression expected.
lib/arrow.d.ts(1,75): error TS1109: Expression expected.
lib/call.d.ts(1,59): error TS1109: Expression expected.
lib/class.d.ts(7,4): error TS1109: Expression expected.
lib/element.d.ts(1,21): error TS1005: '>' expected.
lib/element.d.ts(1,22): error TS1005: ')' expected.
lib/element.d.ts(1,27): error TS1005: ';' expected.
lib/element.d.ts(1,33): error TS1005: ';' expected.
lib/element.d.ts(1,34): error TS1128: Declaration or statement expected.
lib/element.d.ts(1,39): error TS1109: Expression expected.
lib/element.d.ts(2,8): error TS1005: ';' expected.
lib/element.d.ts(2,16): error TS1005: '>' expected.
lib/element.d.ts(3,2): error TS1110: Type expected.
lib/element.d.ts(3,9): error TS1005: ';' expected.
lib/function.d.ts(6,4): error TS1109: Expression expected.
lib/object.d.ts(1,77): error TS1109: Expression expected.
lib/statements.d.ts(24,4): error TS1109: Expression expected.
lib/type.d.ts(3,4): error TS1109: Expression expected.
lib/types.d.ts(5,23): error TS1109: Expression expected.
`,
  },
  "in a JavaScript file and in its JSDoc `@import` tags": {
    options: { allowJs: true, checkJs: true, outDir: "out" },
    modules: {
      "named.js": file("/** @import { A } from (a , ) */", "/** @type {A} */", "export const c = 1;"),
      "namespace.js": file("/** @import * as ns from f(a +) */", "/** @type {ns.A} */", "export const c = 1;"),
      "default.js": file(
        "/**",
        " * @import d from a ?",
        " *   b : (c , )",
        " */",
        "/** @type {d} */",
        "export const c = 1;",
      ),
      "export.js": "export * from (a , )\n",
    },
    lines: `
lib/export.js(1,20): error TS1109: Expression expected.
lib/out/default.d.ts(2,9): error TS1109: Expression expected.
lib/out/default.d.ts(2,19): error TS1109: Expression expected.
lib/out/export.d.ts(1,19): error TS1109: Expression expected.
lib/out/named.d.ts(1,28): error TS1109: Expression expected.
lib/out/namespace.d.ts(1,32): error TS1109: Expression expected.
`,
  },
  "for a project that checks the declaration files": {
    options: { skipLibCheck: false },
    modules: {
      "export.ts": "export * from a . b\n",
      "import.ts": file("import d from f ( 1 , 2 )", "export declare const c: typeof d;"),
      "import-equals.ts": file("import x = require( 1 + 2 )", "export declare const c: typeof x;"),
    },
    lines: `
lib/export.ts(1,15): error TS1141: String literal expected.
lib/import-equals.ts(1,21): error TS1141: String literal expected.
lib/import.ts(1,15): error TS1141: String literal expected.
lib/export.d.ts(1,15): error TS1141: String literal expected.
lib/import-equals.d.ts(1,20): error TS1141: String literal expected.
lib/import.d.ts(1,15): error TS1141: String literal expected.
`,
  },
};

// A debug build with ASAN needs more than the default of 5 s. `check` ends the process after `longLimit`.
const limit = longLimit + 10_000;

async function expectLines(modules: Record<string, string>, options: object | undefined, lines: string) {
  using dir = tempDir("bun-check-specifier", layout(modules, options));
  const ours = await check(String(dir));
  expect(ours.lines).toEqual(lines.trim().split("\n"));
  expect(ours.exitCode).toBe(1);
}

describe.concurrent("bun check -b prints a module specifier that isn't a string literal the way tsc does", () => {
  test.each(Object.entries(cases))(
    "%s",
    async (_, { modules, options, lines }) => {
      await expectLines(modules, options, lines);
    },
    limit,
  );

  // A chain of operators can have more links than the printer's stack has room for, so the printer follows one in a
  // loop.
  const links = 10_000;

  test(
    "in a chain of 10,000 operators that the parser reads in a loop",
    async () => {
      await expectLines(
        {
          "binary.ts": `export * from ${repeat("a + ", links)}\n`,
          "array-type.ts": `export * from a as T${repeat("[]", links)} +\n`,
        },
        undefined,
        `
lib/array-type.ts(1,20023): error TS1109: Expression expected.
lib/binary.ts(1,40014): error TS1109: Expression expected.
lib/array-type.d.ts(2,1): error TS1109: Expression expected.
lib/binary.d.ts(2,1): error TS1109: Expression expected.
`,
      );
    },
    limit,
  );

  // The parser of an unoptimized build has larger frames, and refuses these files: they are nested too deeply for it.
  test.skipIf(isDebug || isASAN)(
    "in a chain of 10,000 operators that the parser recurses for",
    async () => {
      await expectLines(
        {
          "member.ts": `export * from a${repeat(".a", links)} +\n`,
          "call.ts": `export * from a${repeat("()", links)} +\n`,
          "assignment.ts": `export * from ${repeat("a = ", links)}\n`,
          "conditional.ts": `export * from ${repeat("a ? a : ", links)}\n`,
          "unary.ts": `export * from ${repeat("typeof ", links)}\n`,
          "conditional-type.ts": `export * from a as ${repeat("T extends U ? X : ", links)}Y +\n`,
        },
        undefined,
        `
lib/assignment.ts(1,40014): error TS1109: Expression expected.
lib/call.ts(1,20018): error TS1109: Expression expected.
lib/conditional-type.ts(1,180023): error TS1109: Expression expected.
lib/conditional.ts(1,80014): error TS1109: Expression expected.
lib/member.ts(1,20018): error TS1109: Expression expected.
lib/unary.ts(1,70014): error TS1109: Expression expected.
lib/assignment.d.ts(2,1): error TS1109: Expression expected.
lib/call.d.ts(2,1): error TS1109: Expression expected.
lib/conditional-type.d.ts(2,1): error TS1109: Expression expected.
lib/conditional.d.ts(2,1): error TS1109: Expression expected.
lib/member.d.ts(2,1): error TS1109: Expression expected.
lib/unary.d.ts(1,70015): error TS1109: Expression expected.
`,
      );
    },
    limit,
  );
});
