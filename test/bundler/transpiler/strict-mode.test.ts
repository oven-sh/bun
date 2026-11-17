import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";

// Strict-mode early errors. The cases follow esbuild's TestStrictMode corpus:
// sloppy code must parse, and the same code must be rejected once it is strict
// because of a "use strict" directive, an ECMAScript module, or a class body.
// A legacy octal number or escape is the exception: it is not reported yet.

// A warning also makes `transformSync` throw, so these fail a test whose input starts to warn.
const transpiler = new Bun.Transpiler({ loader: "js" });
const tsTranspiler = new Bun.Transpiler({ loader: "ts" });
// The parser warns about each legacy HTML comment.
const quietTranspiler = new Bun.Transpiler({ loader: "js", logLevel: "error" });

type ParseMessage = { message: string; notes: { message: string; position: { line: number; column: number } }[] };

function parseErrors(code: string, t: Bun.Transpiler = transpiler): ParseMessage[] {
  try {
    t.transformSync(code);
  } catch (e: any) {
    const errors: any[] = e instanceof AggregateError ? e.errors : [e];
    return errors.map(err => ({
      message: err.message,
      notes: (err.notes ?? []).map((note: any) => ({
        message: note.message,
        position: { line: note.position.line, column: note.position.column },
      })),
    }));
  }
  return [];
}

// Each input of the two functions below, and if the parser rejects it.
const verdicts = new Map<string, boolean>();

function expectParseError(code: string, ...messages: string[]) {
  verdicts.set(code, messages.length > 0);
  expect(parseErrors(code).map(e => e.message)).toEqual(messages);
}

function expectNoParseError(code: string) {
  verdicts.set(code, false);
  expect(parseErrors(code)).toEqual([]);
}

function expectTSParseError(code: string, ...messages: string[]) {
  expect(parseErrors(code, tsTranspiler).map(e => e.message)).toEqual(messages);
}

function expectNoTSParseError(code: string) {
  expect(parseErrors(code, tsTranspiler)).toEqual([]);
}

async function run(cwd: string, file: string, env: Record<string, string | undefined> = bunEnv) {
  await using proc = Bun.spawn({ cmd: [bunExe(), file], env, cwd, stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

const useStrictNote = 'Strict mode is triggered by a "use strict" directive';
const exportNote = 'This file is considered to be an ECMAScript module because of the "export" keyword here:';
const importNote = 'This file is considered to be an ECMAScript module because of the "import" keyword here:';
const awaitNote = 'This file is considered to be an ECMAScript module because of the top-level "await" keyword here:';
const classNote = "All code inside a class is implicitly in strict mode";

// Each of these is valid sloppy mode code. All but `let x = '\\0'` and `var x; var x` are an error in strict mode code.
const sloppy = [
  "with (x) y",
  "delete x",
  "for (var x = y in z) ;",
  "if (0) function f() {}",
  "if (0) ; else function f() {}",
  "x: function f() {}",
  "function f(a, a) {}",
  "(function(a, a) {})",
  "({ f: function(a, a) {} })",
  "({ f: function*(a, a) {} })",
  "({ f: async function(a, a) {} })",
  "eval++",
  "eval = 0",
  "eval += 0",
  "[eval] = 0",
  "arguments++",
  "arguments = 0",
  "arguments += 0",
  "[arguments] = 0",
  "function eval() {}",
  "function arguments() {}",
  "function f(eval) {}",
  "function f(arguments) {}",
  "({ f(eval) {} })",
  "({ f(arguments) {} })",
  "let protected",
  "let protecte\\u0064",
  "let x = protected",
  "let x = protecte\\u0064",
  "protected: 0",
  "var static, implements, interface, package, private, public, yield",
  "0123",
  "08",
  "({0123: 4})",
  "let {0123: x} = y",
  "let x = '\\0'",
  "let x = '\\00'",
  "let x = '\\1'",
  "let x = '\\01'",
  "let x = 'a\\7'",
  "let x = '\\08'",
  "let x = '\\09'",
  "let x = '\\008'",
  "let x = '\\012'",
  "let x = '\\8'",
  "let x = '\\9'",
  "'\\00'",
  "'\\08'",
  "require('\\1')",
  "function f() {} function f() {}",
  "function f() {} function *f() {}",
  "async function f() {} function f() {}",
  "{ function f() {} function f() {} }",
  "var x; var x",
];

describe("strict mode early errors", () => {
  describe("sloppy mode accepts legacy syntax", () => {
    test.each(sloppy)("%j", code => expectNoParseError(code));

    const htmlComments = ["-->", "x\n--> a comment", "<!-- a comment\nx", "x <!-- a comment\ny"];
    test.each(htmlComments)("%j", code => expect(parseErrors(code, quietTranspiler)).toEqual([]));

    test("a legacy octal in parentheses, in a default value, in TypeScript syntax and in a JSX attribute", () => {
      expectNoParseError("x = ('\\1'); y = (010); ((a = 010) => a)");
      expectNoTSParseError("const f = (a: number = 010) => a; const g = <T,>(b: T) => '\\1'");
      expectNoTSParseError("import x = require('\\1'); x");
      expectNoTSParseError("enum E { '\\1' = 1 }");
      // `<div {"a"} />` is the short form of `<div a="a" />` in Bun. Its string is a string literal of JavaScript.
      expect(parseErrors('<div {"\\1"} />;', new Bun.Transpiler({ loader: "jsx" }))).toEqual([]);
    });
  });

  describe("legacy octal escapes decode leniently in sloppy mode", () => {
    test("1 to 3 octal digits, also at the end of the string", () => {
      expect(transpiler.transformSync("x = ['\\1', '\\01', 'a\\7', '\\101', '\\1a', '\\0', '\\00']")).toBe(
        'x = ["\\x01", "\\x01", "a\\x07", "A", "\\x01a", "\\x00", "\\x00"];\n',
      );
    });
    test("\\08 and \\09 are \\0 followed by a digit", () => {
      expect(transpiler.transformSync("x = ['\\08', '\\09', '\\008', '\\18']")).toBe(
        'x = ["\\x008", "\\x009", "\\x008", "\\x018"];\n',
      );
    });
    test("\\8 and \\9 are the digit itself", () => {
      expect(transpiler.transformSync("x = ['\\8', '\\9', 'a\\8']")).toBe('x = ["8", "9", "a8"];\n');
    });
    test("4-digit sequences stop at 255", () => {
      expect(transpiler.transformSync("x = ['\\400', '\\377']")).toBe('x = [" 0", "ÿ"];\n');
    });
    test("a string index that minify.syntax turns into a property name", () => {
      const minifying = new Bun.Transpiler({ loader: "js", logLevel: "error", minify: { syntax: true } });
      expect(minifying.transformSync("x['\\141']")).toBe("x.a;\n");
    });
  });

  describe('"use strict" directive', () => {
    const cases: [string, string][] = [
      ["'use strict'; with (x) y", "With statements cannot be used in strict mode"],
      ["'use strict'; delete x", "Delete of a bare identifier cannot be used in strict mode"],
      [
        "'use strict'; for (var x = y in z) ;",
        "Variable initializers inside for-in loops cannot be used in strict mode",
      ],
      [
        "'use strict'; if (0) function f() {}",
        "Function declarations inside if statements cannot be used in strict mode",
      ],
      [
        "'use strict'; if (0) ; else function f() {}",
        "Function declarations inside if statements cannot be used in strict mode",
      ],
      ["'use strict'; x: function f() {}", "Function declarations inside labels cannot be used in strict mode"],
      ["'use strict'; eval++", "Invalid assignment target"],
      ["'use strict'; eval = 0", "Invalid assignment target"],
      ["'use strict'; eval += 0", "Invalid assignment target"],
      ["'use strict'; [eval] = 0", "Invalid assignment target"],
      ["'use strict'; arguments++", "Invalid assignment target"],
      ["'use strict'; arguments = 0", "Invalid assignment target"],
      ["'use strict'; arguments += 0", "Invalid assignment target"],
      ["'use strict'; [arguments] = 0", "Invalid assignment target"],
      ["'use strict'; function eval() {}", 'Declarations with the name "eval" cannot be used in strict mode'],
      ["'use strict'; function arguments() {}", 'Declarations with the name "arguments" cannot be used in strict mode'],
      ["'use strict'; function f(eval) {}", 'Declarations with the name "eval" cannot be used in strict mode'],
      [
        "'use strict'; function f(arguments) {}",
        'Declarations with the name "arguments" cannot be used in strict mode',
      ],
      ["'use strict'; class eval {}", 'Declarations with the name "eval" cannot be used in strict mode'],
      ["'use strict'; class arguments {}", 'Declarations with the name "arguments" cannot be used in strict mode'],
      ["'use strict'; var arguments = 1", 'Declarations with the name "arguments" cannot be used in strict mode'],
      ["'use strict'; let protected", '"protected" is a reserved word and cannot be used in strict mode'],
      ["'use strict'; let protecte\\u0064", '"protected" is a reserved word and cannot be used in strict mode'],
      ["'use strict'; let x = protected", '"protected" is a reserved word and cannot be used in strict mode'],
      ["'use strict'; let x = protecte\\u0064", '"protected" is a reserved word and cannot be used in strict mode'],
      ["'use strict'; protected: 0", '"protected" is a reserved word and cannot be used in strict mode'],
      ["'use strict'; protecte\\u0064: 0", '"protected" is a reserved word and cannot be used in strict mode'],
      ["'use strict'; function protected() {}", '"protected" is a reserved word and cannot be used in strict mode'],
      [
        "'use strict'; function protecte\\u0064() {}",
        '"protected" is a reserved word and cannot be used in strict mode',
      ],
      ["'use strict'; (function protected() {})", '"protected" is a reserved word and cannot be used in strict mode'],
      [
        "'use strict'; (function protecte\\u0064() {})",
        '"protected" is a reserved word and cannot be used in strict mode',
      ],
      ["'use strict'; class static {}", '"static" is a reserved word and cannot be used in strict mode'],
      ["'use strict'; (class static {})", '"static" is a reserved word and cannot be used in strict mode'],
      ["'use strict'; try {} catch (protected) {}", '"protected" is a reserved word and cannot be used in strict mode'],
      ["'use strict'; var package = 1", '"package" is a reserved word and cannot be used in strict mode'],
      ["'use strict'; const protected = 1", '"protected" is a reserved word and cannot be used in strict mode'],
      ["'use strict'; function f(package) {}", '"package" is a reserved word and cannot be used in strict mode'],
      ["'use strict'; (package) => 1", '"package" is a reserved word and cannot be used in strict mode'],
      ["'use strict'; ({ m(implements) {} })", '"implements" is a reserved word and cannot be used in strict mode'],
      ["'use strict'; let { a: interface } = x", '"interface" is a reserved word and cannot be used in strict mode'],
      ["'use strict'; let [private] = x", '"private" is a reserved word and cannot be used in strict mode'],
      ["'use strict'; var { package } = x", '"package" is a reserved word and cannot be used in strict mode'],
      ["'use strict'; for (let public of x) ;", '"public" is a reserved word and cannot be used in strict mode'],
      ["'use strict'; for (var static in x) ;", '"static" is a reserved word and cannot be used in strict mode'],
      ["'use strict'; function f(a, a) {}", '"a" cannot be bound multiple times in the same parameter list'],
      ["'use strict'; (function(a, a) {})", '"a" cannot be bound multiple times in the same parameter list'],
      ["'use strict'; ((a, a) => {})", '"a" cannot be bound multiple times in the same parameter list'],
    ];
    test.each(cases)("%j", (code, message) => expectParseError(code, message));

    test("\\0 is not a legacy octal escape", () => {
      expectNoParseError("'use strict'; let x = '\\0'");
      expectNoParseError("'use strict'; '\\0'");
    });

    test("the note names the directive", () => {
      const errors = parseErrors("'use strict';\nwith (x) y");
      expect(errors.map(e => e.message)).toEqual(["With statements cannot be used in strict mode"]);
      expect(errors[0].notes.map(n => n.message)).toEqual([useStrictNote]);
    });

    test("delete of a constant that other uses inline", () => {
      const inlining = new Bun.Transpiler({ loader: "js", logLevel: "error", inline: true });
      expect(parseErrors("'use strict'; const x = 1; delete x", inlining).map(e => e.message)).toEqual([
        "Delete of a bare identifier cannot be used in strict mode",
      ]);
      // In sloppy code the answer of `delete x` is false, and of `delete 1` it is true.
      expect(inlining.transformSync("const x = 1; console.log(delete x, x)")).toBe(
        "const x = 1;\nconsole.log(delete x, 1);\n",
      );
    });

    // The value of such a string is "use strict" or "use asm", but it is not that directive.
    describe("a string of the directive prologue that is not kept", () => {
      test("does not make the code strict", () => {
        expectNoParseError("'use\\040strict'; with (x) y");
        expectNoParseError("function f() { 'use\\040strict'; with (x) y }");
      });

      test("is dropped in sloppy code", () => {
        expect(transpiler.transformSync("'use\\040strict'; function f() { 'use\\040asm'; return 1 }")).toBe(
          "function f() {\n  return 1;\n}\n",
        );
      });
    });

    test("a directive inside a block is not a directive", () => {
      expectNoParseError("{ 'use strict'; with (x) y }");
      expectNoParseError("if (0) { 'use strict'; with (x) y }");
      expectNoParseError("while (0) { 'use strict'; with (x) y }");
      expectNoParseError("try { 'use strict'; with (x) y } catch {}");
      expectNoParseError("try {} catch { 'use strict'; with (x) y }");
      expectNoParseError("try {} finally { 'use strict'; with (x) y }");
      expectNoParseError("`use strict`; with (x) y");
    });

    test("strict mode does not leak out of a function or class", () => {
      expectNoParseError("function f() { 'use strict' } with (x) y");
      expectNoParseError("with (x) y; function f() { 'use strict' }");
      expectNoParseError("class f {} with (x) y");
      expectNoParseError("with (x) y; class f {}");
    });
  });

  describe("function body directive", () => {
    const evalDecl = 'Declarations with the name "eval" cannot be used in strict mode';
    const argsDecl = 'Declarations with the name "arguments" cannot be used in strict mode';
    const bindingError = '"a" cannot be bound multiple times in the same parameter list';
    const cases: [string, string][] = [
      ["function f() { 'use strict'; with (x) y }", "With statements cannot be used in strict mode"],
      ["function f() { 'use strict'; function y() { with (x) y } }", "With statements cannot be used in strict mode"],
      ["function f() { 'use strict'; delete x }", "Delete of a bare identifier cannot be used in strict mode"],
      ["function eval() { 'use strict' }", evalDecl],
      ["function arguments() { 'use strict' }", argsDecl],
      ["function f(eval) { 'use strict' }", evalDecl],
      ["function f(arguments) { 'use strict' }", argsDecl],
      ["({ f(eval) { 'use strict' } })", evalDecl],
      ["({ f(arguments) { 'use strict' } })", argsDecl],
      ["(eval) => { 'use strict' }", evalDecl],
      ["function protected() { 'use strict' }", '"protected" is a reserved word and cannot be used in strict mode'],
      ["function f() { 'use strict'; var package }", '"package" is a reserved word and cannot be used in strict mode'],
      ["function f(a, a) { 'use strict' }", bindingError],
      ["function *f(a, a) { 'use strict' }", bindingError],
      ["async function f(a, a) { 'use strict' }", bindingError],
      ["(function(a, a) { 'use strict' })", bindingError],
      ["(function*(a, a) { 'use strict' })", bindingError],
      ["(async function(a, a) { 'use strict' })", bindingError],
      ["function f(a, [a]) {}", bindingError],
      ["function f([a], a) {}", bindingError],
      ["(function(a, [a]) {})", bindingError],
      ["({ f(a, a) {} })", bindingError],
      ["({ *f(a, a) {} })", bindingError],
      ["({ async f(a, a) {} })", bindingError],
      ["(a, a) => {}", bindingError],
      ["class A { m(a, a) {} }", bindingError],
    ];
    test.each(cases)("%j", (code, message) => expectParseError(code, message));

    describe('"use strict" needs a simple parameter list', () => {
      const nonSimple = 'Cannot use a "use strict" directive in a function with a non-simple parameter list';
      const cases: [string, string[]][] = [
        ["function f() { 'use strict' }", []],
        ["function f(x) { 'use strict' }", []],
        ["function f([x]) { 'use strict' }", [nonSimple]],
        ["function f({x}) { 'use strict' }", [nonSimple]],
        ["function f(x = 1) { 'use strict' }", [nonSimple]],
        ["function f(x, ...y) { 'use strict' }", [nonSimple]],
        ["(function() { 'use strict' })", []],
        ["(function(x) { 'use strict' })", []],
        ["(function([x]) { 'use strict' })", [nonSimple]],
        ["(function({x}) { 'use strict' })", [nonSimple]],
        ["(function(x = 1) { 'use strict' })", [nonSimple]],
        ["(function(x, ...y) { 'use strict' })", [nonSimple]],
        ["() => { 'use strict' }", []],
        ["(x) => { 'use strict' }", []],
        ["([x]) => { 'use strict' }", [nonSimple]],
        ["({x}) => { 'use strict' }", [nonSimple]],
        ["(x = 1) => { 'use strict' }", [nonSimple]],
        ["(x, ...y) => { 'use strict' }", [nonSimple]],
        ["({ m([x]) { 'use strict' } })", [nonSimple]],
        ["class A { m(x = 1) { 'use strict' } }", [nonSimple]],
        // An outer directive does not count as the function's own.
        ["'use strict'; function f([x]) {}", []],
        ["'use strict'; function f([x]) { 'use strict' }", [nonSimple]],
      ];
      test.each(cases)("%j", (code, messages) => expectParseError(code, ...messages));
    });

    test("the note names the directive of the function", () => {
      const errors = parseErrors("function f(arguments) {\n  'use strict'\n}");
      expect(errors.map(e => e.message)).toEqual([
        'Declarations with the name "arguments" cannot be used in strict mode',
      ]);
      expect(errors[0].notes.map(n => n.message)).toEqual([useStrictNote]);
    });
  });

  describe("ECMAScript module", () => {
    const cases: [string, string][] = [
      ["with (x) y; export {}", "With statements cannot be used in an ECMAScript module"],
      ["delete x; export {}", "Delete of a bare identifier cannot be used in an ECMAScript module"],
      [
        "for (var x = y in z) ; export {}",
        "Variable initializers inside for-in loops cannot be used in an ECMAScript module",
      ],
      [
        "if (0) function f() {} export {}",
        "Function declarations inside if statements cannot be used in an ECMAScript module",
      ],
      [
        "if (0) ; else function f() {} export {}",
        "Function declarations inside if statements cannot be used in an ECMAScript module",
      ],
      ["x: function f() {} export {}", "Function declarations inside labels cannot be used in an ECMAScript module"],
      ["function f(a, a) {}; export {}", '"a" cannot be bound multiple times in the same parameter list'],
      ["(function(a, a) {}); export {}", '"a" cannot be bound multiple times in the same parameter list'],
      ["export {}; let eval = 1", 'Declarations with the name "eval" cannot be used in an ECMAScript module'],
      ["await 1; var arguments = 1", 'Declarations with the name "arguments" cannot be used in an ECMAScript module'],
      ["var protected; export {}", '"protected" is a reserved word and cannot be used in an ECMAScript module'],
      ["class protected {} export {}", '"protected" is a reserved word and cannot be used in an ECMAScript module'],
      ["(class protected {}); export {}", '"protected" is a reserved word and cannot be used in an ECMAScript module'],
      [
        "function protected() {} export {}",
        '"protected" is a reserved word and cannot be used in an ECMAScript module',
      ],
      [
        "(function protected() {}); export {}",
        '"protected" is a reserved word and cannot be used in an ECMAScript module',
      ],
      ["class static {}\nexport {}", '"static" is a reserved word and cannot be used in an ECMAScript module'],
      ["protected: 0; export {}", '"protected" is a reserved word and cannot be used in an ECMAScript module'],
      ["import protected from 'x'", '"protected" is a reserved word and cannot be used in an ECMAScript module'],
      ["import * as protected from 'x'", '"protected" is a reserved word and cannot be used in an ECMAScript module'],
      ["import { protected } from 'x'", '"protected" is a reserved word and cannot be used in an ECMAScript module'],
      [
        "import { x as protected } from 'x'",
        '"protected" is a reserved word and cannot be used in an ECMAScript module',
      ],
      ["import eval from 'x'", 'Declarations with the name "eval" cannot be used in an ECMAScript module'],
      [
        "import * as arguments from 'x'",
        'Declarations with the name "arguments" cannot be used in an ECMAScript module',
      ],
      ["import { eval } from 'x'", 'Declarations with the name "eval" cannot be used in an ECMAScript module'],
      [
        "import { x as arguments } from 'x'",
        'Declarations with the name "arguments" cannot be used in an ECMAScript module',
      ],
      ["import 'x'; with (y) z", "With statements cannot be used in an ECMAScript module"],
      ["import * as x from 'x'; with (y) z", "With statements cannot be used in an ECMAScript module"],
      ["import x from 'x'; with (y) z", "With statements cannot be used in an ECMAScript module"],
      ["import {x} from 'x'; with (y) z", "With statements cannot be used in an ECMAScript module"],
      ["export {}; with (y) z", "With statements cannot be used in an ECMAScript module"],
      ["export let x; with (y) z", "With statements cannot be used in an ECMAScript module"],
      ["export function x() {} with (y) z", "With statements cannot be used in an ECMAScript module"],
      ["export class x {} with (y) z", "With statements cannot be used in an ECMAScript module"],
      ["await 0; with (y) z", "With statements cannot be used in an ECMAScript module"],
      ["with (y) z; await 0", "With statements cannot be used in an ECMAScript module"],
      ["for await (x of y); with (y) z", "With statements cannot be used in an ECMAScript module"],
      ["with (y) z; for await (x of y);", "With statements cannot be used in an ECMAScript module"],
    ];
    test.each(cases)("%j", (code, message) => expectParseError(code, message));

    // Bun runs a file that has `import.meta` and `module` as CommonJS, which is sloppy code.
    test("import.meta alone does not make the file a module", () => {
      expectNoParseError("import.meta; with (y) z");
      expectNoParseError("module.exports = import.meta.dir; var n = 010, s = '\\1'; delete n; eval = 1");
      expectNoParseError("import.meta; function f(a, a) {} function g() {} function g() {}");
      expectParseError("import.meta; class A { m() { with (y) z } }", "With statements cannot be used in strict mode");
      expectParseError(
        "import.meta; function f() { 'use strict'; with (y) z }",
        "With statements cannot be used in strict mode",
      );
      expectParseError("import.meta; with (y) z; export {}", "With statements cannot be used in an ECMAScript module");
    });

    // TypeScript erases a type-only import, and Bun runs a file with `module` or `exports` as CommonJS.
    test("a type-only import alone does not make the file a module", () => {
      expectNoTSParseError("import type { T } from 'x'; module.exports = 010");
      expectNoTSParseError("import type T from 'x'; with (y) z");
      expectNoTSParseError("import type * as T from 'x'; var s = '\\1'");
      expectNoTSParseError("import { type T } from 'x'; delete y");
      expectNoTSParseError("import type T = require('x'); function f(a, a) {}");
      const inModule = "With statements cannot be used in an ECMAScript module";
      expectTSParseError("import type { T } from 'x'; import 'y'; with (y) z", inModule);
      expectTSParseError("import { type T, u } from 'x'; u; with (y) z", inModule);
      expectTSParseError("import type { T } from 'x'; export {}; with (y) z", inModule);
      expectTSParseError(
        "import type { T } from 'x'; class A { m() { with (y) z } }",
        "With statements cannot be used in strict mode",
      );
    });

    test("dynamic import does not make the file a module", () => {
      expectNoParseError("import(x); with (y) z");
      expectNoParseError("import('x'); with (y) z");
      expectNoParseError("with (y) z; import(x)");
      expectNoParseError("(import('x')); with (y) z");
    });

    test("\\0 is not a legacy octal escape", () => {
      expectNoParseError("let x = '\\0'; export {}");
    });

    test("a string alias without a legacy octal escape", () => {
      expectNoParseError("import { 'a-b' as x } from 'y'; export { x as 'c\\x20d', x as '\\0' }");
    });

    test("the note points at the export keyword", () => {
      expect(parseErrors("with (x) y;\nexport {}")).toEqual([
        {
          message: "With statements cannot be used in an ECMAScript module",
          notes: [{ message: exportNote, position: { line: 2, column: 1 } }],
        },
      ]);
    });

    test("the note points at the import keyword, also when the file assigns to exports", () => {
      expect(parseErrors("import { y } from './y.mjs';\nexports.x = 1;\nwith (y) x")).toEqual([
        {
          message: "With statements cannot be used in an ECMAScript module",
          notes: [{ message: importNote, position: { line: 1, column: 1 } }],
        },
      ]);
    });

    test("the note points at the top-level await keyword", () => {
      expect(parseErrors("with (x) y;\nawait 0")).toEqual([
        {
          message: "With statements cannot be used in an ECMAScript module",
          notes: [{ message: awaitNote, position: { line: 2, column: 1 } }],
        },
      ]);
    });

    test("the error points at the imported binding, not the alias", () => {
      let error: any;
      try {
        transpiler.transformSync("import { x as protected } from 'x'");
      } catch (e: any) {
        error = e instanceof AggregateError ? e.errors[0] : e;
      }
      expect(error?.message).toBe('"protected" is a reserved word and cannot be used in an ECMAScript module');
      expect(error?.position).toMatchObject({ line: 1, column: 15, length: 9 });
    });
  });

  describe("TypeScript declarations that lower to var", () => {
    const reserved = '"protected" is a reserved word and cannot be used in strict mode';
    const reservedInModule = '"protected" is a reserved word and cannot be used in an ECMAScript module';
    test("enum", () => {
      expectNoTSParseError("enum protected { A }");
      expectTSParseError("'use strict'; enum protected { A }", reserved);
      expectTSParseError("enum protected { A }\nexport {}", reservedInModule);
    });
    test("namespace", () => {
      expectNoTSParseError("namespace protected { export let x = 1 }");
      expectTSParseError("'use strict'; namespace protected { export let x = 1 }", reserved);
      expectTSParseError("namespace protected { export let x = 1 }\nexport {}", reservedInModule);
    });
    test("import equals", () => {
      expectNoTSParseError("import protected = require('x')");
      expectTSParseError("'use strict'; import protected = require('x')", reserved);
    });
  });

  describe("TypeScript code that is erased", () => {
    test("a name in erased code is not a declaration of strict mode code", () => {
      expectNoTSParseError("'use strict'; enum E { package }");
      expectNoTSParseError("'use strict'; function f(package: number): void; function f(x: any) {}");
      expectNoTSParseError("'use strict'; declare function f(package: number): void;");
      expectNoTSParseError("'use strict'; abstract class A { abstract m(package: number): void }");
      expectTSParseError(
        "class A { constructor(public package: number) {} }",
        '"package" is a reserved word and cannot be used in strict mode',
      );
    });
    // An import that only types use is not in the output, so its name is not a declaration of strict mode code.
    test("an unused import can have a reserved word as its name", () => {
      const trimming = new Bun.Transpiler({ loader: "ts", logLevel: "error", trimUnusedImports: true });
      expect(trimming.transformSync("import * as public from './schema';\nexport let y: public.Y = 1;")).toBe(
        "export let y = 1;\n",
      );
      expect(
        trimming.transformSync("import eval, { a as static } from './schema';\nexport let y: eval | static = 1;"),
      ).toBe("export let y = 1;\n");
      expect(
        parseErrors("import * as public from './schema';\nexport let y = public.z;", trimming).map(e => e.message),
      ).toEqual(['"public" is a reserved word and cannot be used in an ECMAScript module']);
      expect(parseErrors("import package from './schema';\nexport { package };", trimming).map(e => e.message)).toEqual(
        ['"package" is a reserved word and cannot be used in an ECMAScript module'],
      );
    });
    // Its `import` keyword still makes the file a module for the early errors, as in Node. Bun then runs
    // a file that uses `module` as CommonJS.
    test("an import that only types use still makes the file strict mode code", () => {
      const trimming = new Bun.Transpiler({ loader: "ts", logLevel: "error", trimUnusedImports: true });
      const code = "import { T } from './schema';\nfunction f(a: T, a: T) {}\nmodule.exports = f;";
      expect(parseErrors(code, trimming).map(e => e.message)).toEqual([
        '"a" cannot be bound multiple times in the same parameter list',
      ]);
      expect(parseErrors(code.replace("import {", "import type {"), trimming)).toEqual([]);
    });
  });

  // An exported member of a namespace is a property of the namespace object,
  // so `delete` of its name is a `delete` of a property.
  test("delete of a TypeScript namespace member is not a delete of a bare identifier", () => {
    const code = (member: string) =>
      `"use strict"; namespace N { ${member}; export function drop() { return delete x; } }`;
    expect(tsTranspiler.transformSync(code("export let x = 1"))).toContain("delete N.x");
    expectTSParseError(code("let x = 1"), "Delete of a bare identifier cannot be used in strict mode");
    const inlining = new Bun.Transpiler({ loader: "ts", logLevel: "error", inline: true });
    expect(inlining.transformSync(code("export const x = 1"))).toContain("delete N.x");
  });

  describe("class body", () => {
    const cases: [string, string][] = [
      ["class f { x() { with (x) y } }", "With statements cannot be used in strict mode"],
      ["class f { x() { function y() { with (x) y } } }", "With statements cannot be used in strict mode"],
      ["class f { x() { delete x } }", "Delete of a bare identifier cannot be used in strict mode"],
      [
        "class f { x() { function protected() {} } }",
        '"protected" is a reserved word and cannot be used in strict mode',
      ],
      ["class f { x() { var package } }", '"package" is a reserved word and cannot be used in strict mode'],
      ["class A { m(arguments) {} }", 'Declarations with the name "arguments" cannot be used in strict mode'],
      ["class A { m() { eval = 0 } }", "Invalid assignment target"],
      ["class A { static { yield } }", '"yield" is a reserved word and cannot be used in strict mode'],
      // The class name is part of the class, so it is strict mode code too.
      ["class protected {}", '"protected" is a reserved word and cannot be used in strict mode'],
      ["(class protected {})", '"protected" is a reserved word and cannot be used in strict mode'],
      ["class eval {}", 'Declarations with the name "eval" cannot be used in strict mode'],
      ["(class arguments {})", 'Declarations with the name "arguments" cannot be used in strict mode'],
    ];
    test.each(cases)("%j", (code, message) => expectParseError(code, message));

    test("the note points at the class keyword", () => {
      expect(parseErrors("class f {\n  x() { with (x) y }\n}")).toEqual([
        {
          message: "With statements cannot be used in strict mode",
          notes: [{ message: classNote, position: { line: 1, column: 1 } }],
        },
      ]);
    });

    // These are reported when the class is no longer the one that the parser visits.
    test.each(["{ function f() {} function f() {} }", "return class { y() { { function f() {} function f() {} } } }"])(
      "the note of %j points at the class keyword",
      body => {
        const errors = parseErrors(`var a;\n  class f {\n  x() { ${body} }\n}\n(class { z() {} });`);
        expect(errors.map(error => error.notes.at(-1))).toEqual([
          {
            message: expect.stringContaining(classNote),
            position: body.includes("class") ? { line: 3, column: 16 } : { line: 2, column: 3 },
          },
        ]);
      },
    );
  });

  // Node rejects each of these. Bun's parser does not report them yet: the printer writes the value of the
  // number or the escape, and the report is a change of its own.
  describe("legacy octals in strict mode code are not reported yet", () => {
    // These stay out of `verdicts`. The engine rejects them, and the parser does not.
    test.each([
      "'use strict'; 010",
      "'use strict'; 08",
      "'use strict'; ({ 010: 1 })",
      "'use strict'; let x = '\\1'",
      "'use strict'; let x = '\\12'",
      "'use strict'; let x = '\\012'",
      "'use strict'; let x = '\\08'",
      "'use strict'; let x = '\\8'",
      "export let n = 010",
      "export let s = '\\033[1m'",
      "class A { m() { return 010 } }",
      "class A { m() { return '\\01' } }",
      "x = `\\1`",
      "export let t = `\\033[1m`",
    ])("%j", code => expect(parseErrors(code)).toEqual([]));

    test.concurrent(
      "bun run, bun build and Bun.Transpiler give one answer for a strict module with legacy octals",
      async () => {
        const source = `export const n = 010;\nconsole.log(n, "\\033[1m".length, \`\\033[1m\`.length);\n`;
        using dir = tempDir("strict-mode-legacy-octal", { "octal.mjs": source });
        const cwd = String(dir);
        const build = async (...flags: string[]) => {
          await using proc = Bun.spawn({
            cmd: [bunExe(), "build", ...flags, "octal.mjs"],
            env: bunEnv,
            cwd,
            stdout: "ignore",
            stderr: "pipe",
          });
          const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
          return { stderr, exitCode };
        };
        const [ran, bundled, unbundled] = await Promise.all([run(cwd, "octal.mjs"), build(), build("--no-bundle")]);
        expect({
          "bun run": ran,
          "bun build": bundled,
          "bun build --no-bundle": unbundled,
          "Bun.Transpiler": parseErrors(source),
        }).toEqual({
          "bun run": { stdout: "8 4 4\n", stderr: "", exitCode: 0 },
          "bun build": { stderr: "", exitCode: 0 },
          "bun build --no-bundle": { stderr: "", exitCode: 0 },
          "Bun.Transpiler": [],
        });
      },
    );
  });

  // Node parses a call as the target of an assignment in sloppy mode code, and throws a ReferenceError
  // when the assignment runs. Bun does not parse it in any mode, as esbuild.
  test.each(["f() = 1", "f()++", "f() += 1", "for (f() in o) ;"])("%j is not an assignment target", code => {
    expectParseError(code, "Invalid assignment target");
  });

  describe("duplicate function declarations", () => {
    const alreadyDeclared = '"f" has already been declared';
    const cases = [
      "function f() {} function f() {}",
      "function f() {} function *f() {}",
      "function *f() {} function f() {}",
      "function f() {} async function f() {}",
      "async function f() {} function f() {}",
      "function f() {} async function *f() {}",
      "async function *f() {} function f() {}",
    ];

    describe("are allowed at the top level of a script and of a function", () => {
      test.each(cases)("%j", code => {
        expectNoParseError(code);
        expectNoParseError("'use strict'; " + code);
        expectNoParseError("function foo() { 'use strict'; " + code + " }");
      });
    });

    describe("are an error at the top level of a module", () => {
      test.each(cases)("%j export {}", code => expectParseError(code + " export {}", alreadyDeclared));
      test("the notes explain why", () => {
        expect(parseErrors("function f() {} function f() {}\nexport {}")).toEqual([
          {
            message: alreadyDeclared,
            notes: [
              { message: '"f" was originally declared here', position: { line: 1, column: 10 } },
              {
                message: `Duplicate top-level function declarations are not allowed in an ECMAScript module. ${exportNote}`,
                position: { line: 2, column: 1 },
              },
            ],
          },
        ]);
      });
    });

    describe("are an error in nested blocks in strict mode", () => {
      const strictCases: [string, string][] = [
        ["'use strict'; { function f() {} function f() {} }", useStrictNote],
        ["'use strict'; switch (0) { case 1: function f() {} default: function f() {} }", useStrictNote],
        ["function foo() { 'use strict'; { function f() {} function f() {} } }", useStrictNote],
        [
          "function foo() { 'use strict'; switch (0) { case 1: function f() {} default: function f() {} } }",
          useStrictNote,
        ],
        ["{ function f() {} function f() {} } export {}", exportNote],
        ["switch (0) { case 1: function f() {} default: function f() {} } export {}", exportNote],
        ["class A { m() { { function f() {} function f() {} } } }", classNote],
        ["class A { static { { function f() {} function f() {} } } }", classNote],
      ];
      test.each(strictCases)("%j", (code, note) => {
        const errors = parseErrors(code);
        expect(errors.map(e => e.message)).toEqual([alreadyDeclared]);
        expect(errors[0].notes.map(n => n.message)).toEqual([
          '"f" was originally declared here',
          expect.stringContaining(note),
        ]);
      });
    });

    test("each duplicate is an error where it is declared", () => {
      const at = (code: string) => {
        try {
          transpiler.transformSync(code);
        } catch (e: any) {
          return (e instanceof AggregateError ? e.errors : [e]).map((error: any) => ({
            line: error.position.line,
            declared: error.notes[0].position.line,
          }));
        }
        return [];
      };
      expect(at("function f() {}\nfunction f() {}\nfunction f() {}\nexport {}")).toEqual([
        { line: 2, declared: 1 },
        { line: 3, declared: 2 },
      ]);
      expect(at("function f() {}\nfunction f() {}\nvar f;\nexport {}")).toEqual([{ line: 2, declared: 1 }]);
      expect(at("function f() {}\nvar f;\nfunction f() {}\nexport {}")).toEqual([{ line: 3, declared: 1 }]);
    });

    test("a var between two functions does not hide the duplicate", () => {
      expectParseError("function f() {} var f; function f() {} export {}", alreadyDeclared);
      expectNoParseError("function f() {} var f; function f() {}");
      expectNoParseError("function g() { 'use strict'; function f() {} var f; function f() {} }");
    });

    test("var is never a duplicate", () => {
      expectNoParseError("var x; var x");
      expectNoParseError("'use strict'; var x; var x");
      expectNoParseError("var x; var x; export {}");
      expectNoParseError("'use strict'; { var x; var x }");
    });
  });

  // `scanImports` runs a parser that only reads the imports. The other three methods run the whole
  // parser, and its visit pass is what knows the strict mode code.
  test("scanImports reads the imports of a file that has a strict mode early error", async () => {
    const code = '"use strict"; var static = 1; with (x) y; import "x"';
    const messages = [
      '"static" is a reserved word and cannot be used in strict mode',
      "With statements cannot be used in strict mode",
    ];
    const thrown = (error: any) => (error instanceof AggregateError ? error.errors : [error]).map(e => e.message);
    const run = (method: () => unknown) => {
      try {
        return method();
      } catch (error) {
        return thrown(error);
      }
    };
    expect({
      scanImports: run(() => transpiler.scanImports(code)),
      scan: run(() => transpiler.scan(code)),
      transformSync: run(() => transpiler.transformSync(code)),
      transform: await transpiler.transform(code).catch(thrown),
    }).toEqual({
      scanImports: [{ kind: "import-statement", path: "x" }],
      scan: messages,
      transformSync: messages,
      transform: messages,
    });
  });

  describe("legacy HTML comments", () => {
    const message = "Legacy HTML single-line comments are not allowed in ECMAScript modules";
    const errors = (code: string) => parseErrors(code, quietTranspiler).map(e => e.message);
    test("are an error in a module", () => {
      expect(errors("export {}\n--> commented out")).toEqual([message]);
      expect(errors("<!-- commented out\nexport {}")).toEqual([message]);
      expect(errors("import 'x'\n--> commented out")).toEqual([message]);
    });
    test("are comments in a script", () => {
      expect(quietTranspiler.transformSync("x\n--> commented out\ny")).toBe("x;\ny;\n");
      expect(quietTranspiler.transformSync("<!-- commented out\nx")).toBe("x;\n");
      expect(quietTranspiler.transformSync("x <!-- commented out\ny")).toBe("x;\ny;\n");
    });
    test("are a warning in a script", () => {
      const warnings = (code: string) => parseErrors(code).map(warning => warning.message);
      expect(warnings("x <!-- commented out\ny")).toEqual([
        'Treating "<!--" as the start of a legacy HTML single-line comment',
      ]);
      expect(warnings("x\n--> commented out\ny")).toEqual([
        'Treating "-->" as the start of a legacy HTML single-line comment',
      ]);
    });
    test("--> without a newline before it is a decrement", () => {
      expect(transpiler.transformSync("x-->y")).toBe("x-- > y;\n");
    });

    // A type-only import and `import.meta` prove no module. Such a file is a module for this
    // error when it also runs as one.
    describe.each(["ts", "tsx"] as const)("in a %s file", loader => {
      const typescript = new Bun.Transpiler({ loader, logLevel: "error" });
      const notes = (code: string) =>
        parseErrors(code, typescript).map(error => [error.message, ...error.notes.map(note => note.message)]);
      const because = "This file is considered to be an ECMAScript module because";
      test("are an error beside a type-only import or import.meta", () => {
        expect(notes("import type { T } from 'x';\nvar r = a <!--b\n;")).toEqual([
          [message, `${because} it has a type-only import.`],
        ]);
        expect(notes("var dir = import.meta.dir;\nvar r = a <!--b\n;")).toEqual([
          [message, `${because} it uses "import.meta".`],
        ]);
      });
      test("are comments beside CommonJS syntax", () => {
        expect(notes("import type { T } from 'x';\nmodule.exports = a <!--b\n;")).toEqual([]);
        expect(notes("var dir = import.meta.dir;\nexports.r = a <!--b\n;")).toEqual([]);
      });
      // Node runs a TypeScript file with no module syntax as CommonJS.
      test("are comments in a file with no module syntax", () => {
        expect(notes("var r: number = a <!--b\n;")).toEqual([]);
        expect(notes("var r: number = a\n--> b\n;")).toEqual([]);
      });
    });
  });
});

// The engine reads the same text with no transpiler in between: `new vm.Script` reads a script, and
// `new vm.SourceTextModule` a module. This test has to stay below the tests that fill `verdicts`.
test("the parser rejects what the engine rejects", () => {
  const engineAccepts = (code: string) =>
    [vm.Script, vm.SourceTextModule].some(Goal => {
      try {
        new Goal(code);
        return true;
      } catch {
        return false;
      }
    });
  const differs = [...verdicts].filter(([code, rejects]) => engineAccepts(code) === rejects).map(([code]) => code);
  const known = [
    // Bun has `import.meta` in CommonJS. For the engine it makes the text a module.
    "import.meta; with (y) z",
    "module.exports = import.meta.dir; var n = 010, s = '\\1'; delete n; eval = 1",
    "import.meta; function f(a, a) {} function g() {} function g() {}",
    // The engine throws a ReferenceError when the assignment runs.
    "f() = 1",
    "f()++",
    "f() += 1",
    "for (f() in o) ;",
  ];
  expect(differs).toEqual(known.filter(code => verdicts.has(code)));
});

describe("sloppy CommonJS runs as written", () => {
  test.concurrent("duplicate parameters, assignments to eval and arguments, legacy octal escapes, delete", async () => {
    using dir = tempDir("strict-mode-sloppy", {
      "sloppy.cjs": `
        function f(a, a) { return a; }
        eval = 0; arguments++; [eval] = [0];
        var s1 = "\\1", s2 = "\\01", s3 = "a\\7", s4 = "\\08", s5 = "\\09", s6 = "\\8";
        var n = 010;
        var obj = { foo() { return "foo"; } };
        var w;
        with (obj) { w = foo(); }
        const c = 1;
        <!-- a legacy HTML comment
        --> and one more
        console.log(JSON.stringify([f(1, 2), eval, s1, s2, s3, s4, s5, s6, n, w, delete c, c]));
        module.exports = 1;
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "sloppy.cjs"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe(
      JSON.stringify([2, 0, "\u0001", "\u0001", "a\u0007", "\u00008", "\u00009", "8", 8, "foo", false, 1]) + "\n",
    );
    expect(exitCode).toBe(0);
  });

  test.concurrent("a CommonJS file that reads import.meta", async () => {
    using dir = tempDir("strict-mode-import-meta", {
      "meta.cjs": `
        module.exports.dir = import.meta.dir;
        var n = 010, s = "\\1";
        function init() { return 1; } function init() { return 2; }
        var x = 1, o = { a: 5 }, w;
        with (o) { w = a; }
        function f(a, a) { return a; }
        eval = 3;
        <!-- a legacy HTML comment
        --> and one more
        console.log(JSON.stringify([n, s, init(), delete x, w, f(1, 2), eval, typeof module.exports.dir]));
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "meta.cjs"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe(JSON.stringify([8, "\u0001", 2, false, 5, 2, 3, "string"]) + "\n");
    expect(exitCode).toBe(0);
  });

  test.concurrent("a TypeScript file with a type-only import and module.exports", async () => {
    using dir = tempDir("strict-mode-type-only-import", {
      "types.ts": `export type T = number;\n`,
      "sloppy.cts": `import type { T } from "./types";\nvar n: T = 010;\nmodule.exports = n;\nconsole.log(n);\n`,
      "sloppy.ts": `import type { T } from "./types";\nvar n: T = 010;\nmodule.exports = n;\nconsole.log(n);\n`,
    });
    const run = async (file: string) => {
      await using proc = Bun.spawn({ cmd: [bunExe(), file], env: bunEnv, cwd: String(dir), stderr: "pipe" });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      return { stdout, stderr, exitCode };
    };
    expect(await Promise.all([run("sloppy.cts"), run("sloppy.ts")])).toEqual([
      { stdout: "8\n", stderr: "", exitCode: 0 },
      { stdout: "8\n", stderr: "", exitCode: 0 },
    ]);
  });

  const htmlCommentError = "Legacy HTML single-line comments are not allowed in ECMAScript modules";
  const because = "This file is considered to be an ECMAScript module because";
  const withHtmlComment = `var a = 1, b = 0;\nglobalThis.value = a <!--b\n;\n`;
  // Each of these has no `import` and no `export` in it. Node decides by the extension and by the package.
  const filesWithHtmlComments = {
    "by-extension.mjs": withHtmlComment,
    "commonjs-by-extension.cjs": withHtmlComment,
    "package/package.json": JSON.stringify({ type: "module" }),
    "package/by-package.js": withHtmlComment,
    "package/commonjs-by-extension.cjs": withHtmlComment,
    // `module` makes a file CommonJS in Bun, whatever its extension is.
    "commonjs-by-syntax.mjs": `module.exports = 1;\n--> a comment\nglobalThis.value = typeof module;\n`,
    "types.ts": `export type T = number;\n`,
    "type-only-import.ts": `import type { T } from "./types";\n${withHtmlComment}`,
    "import-meta.ts": `var dir = import.meta.dir;\n${withHtmlComment}`,
    "no-module-syntax.ts": withHtmlComment,
    "no-module-syntax.js": withHtmlComment,
  };
  const answersForHtmlComments = {
    "by-extension.mjs": `${htmlCommentError}: ${because} of its file extension.`,
    "commonjs-by-extension.cjs": "runs",
    "package/by-package.js": `${htmlCommentError}: ${because} the "package.json" file of its package has "type": "module".`,
    "package/commonjs-by-extension.cjs": "runs",
    "commonjs-by-syntax.mjs": "runs",
    "type-only-import.ts": `${htmlCommentError}: ${because} it has a type-only import.`,
    "import-meta.ts": `${htmlCommentError}: ${because} it uses "import.meta".`,
    "no-module-syntax.ts": "runs",
    "no-module-syntax.js": "runs",
  };

  test.concurrent(
    "a legacy HTML comment in an entry point that is a module by its extension or by its package",
    async () => {
      using dir = tempDir("strict-mode-module-by-type", filesWithHtmlComments);
      const files = Object.keys(answersForHtmlComments);
      const results = await Promise.all(files.map(file => run(String(dir), file)));
      const answers = results.map(({ stdout, stderr, exitCode }) => {
        const error = stderr.match(/^error: (.*)$/m)?.[1];
        const note = stderr.match(/^note: (.*)$/m)?.[1];
        return exitCode === 0 && stdout === "" && stderr === "" ? "runs" : `${error}: ${note}`;
      });
      expect(Object.fromEntries(files.map((file, i) => [file, answers[i]]))).toEqual(answersForHtmlComments);
    },
  );

  // `import` hands a file to another thread with the type of its package, and without the type that its
  // extension gives. The answer has to be the same as for `require()`.
  test.concurrent("a legacy HTML comment in a file that is imported or required", async () => {
    const copy = (folder: string) =>
      Object.fromEntries(Object.entries(filesWithHtmlComments).map(([file, code]) => [`${folder}/${file}`, code]));
    using dir = tempDir("strict-mode-module-by-type-loaded", {
      ...copy("required"),
      ...copy("imported"),
      "load.cjs": `
        (async () => {
          const answers = {};
          for (const file of ${JSON.stringify(Object.keys(answersForHtmlComments))}) {
            for (const how of ["required", "imported"]) {
              const path = "./" + how + "/" + file;
              try {
                how === "required" ? require(path) : await import(path);
                (answers[how] ??= {})[file] = "runs";
              } catch (thrown) {
                // The warning about the comment comes with the error.
                const error = thrown.errors?.find(message => message.level === "error") ?? thrown;
                (answers[how] ??= {})[file] = error.message + ": " + error.notes?.[0]?.message;
              }
            }
          }
          console.log(JSON.stringify(answers));
        })();
      `,
    });
    const { stdout, stderr, exitCode } = await run(String(dir), "load.cjs");
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({ required: answersForHtmlComments, imported: answersForHtmlComments });
    expect(exitCode).toBe(0);
  });

  // How a file runs depends on the type of its package and on what loads it. The transpiler cache
  // has to keep the answers for one text apart.
  test.concurrent("the transpiler cache keeps the module types of a file apart", async () => {
    const padding = `// ${Buffer.alloc(8 * 1024, "-").toString()}\n`;
    using dir = tempDir("strict-mode-module-type-cache", {
      "package.json": JSON.stringify({ name: "cache" }),
      "comment.js": `${padding}var a = 1;\n--> a comment\nconsole.log("ran", a);\n`,
      "repeated.js": `${padding}function f(a, a) { return a; }\nconsole.log("ran", f(1, 2));\n`,
      "repeated.cjs": `${padding}function f(a, a) { return a; }\nglobalThis.answer = f(1, 2);\n`,
      "import.mjs": `await import("./repeated.cjs").catch(() => {});\nconsole.log("imported");\n`,
      "require.cjs": `require("./repeated.cjs");\nconsole.log("ran", globalThis.answer);\n`,
    });
    const cwd = String(dir);
    const env = { ...bunEnv, BUN_RUNTIME_TRANSPILER_CACHE_PATH: join(cwd, "cache") };
    const setType = (type: string) => writeFileSync(join(cwd, "package.json"), JSON.stringify({ name: "cache", type }));

    expect(await run(cwd, "comment.js", env)).toEqual({ stdout: "ran 1\n", stderr: "", exitCode: 0 });
    expect(await run(cwd, "comment.js", env)).toEqual({ stdout: "ran 1\n", stderr: "", exitCode: 0 });
    // With no type in the package the file runs as a module, where the engine rejects a repeated parameter.
    const asModule = await run(cwd, "repeated.js", env);
    expect({ stdout: asModule.stdout, exitCode: asModule.exitCode }).toEqual({ stdout: "", exitCode: 1 });
    expect(asModule.stderr).toContain("SyntaxError");

    setType("module");
    const comment = await run(cwd, "comment.js", env);
    expect(comment.stderr).toContain(`error: ${htmlCommentError}`);
    expect({ stdout: comment.stdout, exitCode: comment.exitCode }).toEqual({ stdout: "", exitCode: 1 });

    setType("commonjs");
    expect(await run(cwd, "repeated.js", env)).toEqual({ stdout: "ran 2\n", stderr: "", exitCode: 0 });
    expect(await run(cwd, "comment.js", env)).toEqual({ stdout: "ran 1\n", stderr: "", exitCode: 0 });

    // `import()` and `require()` do not give a `.cjs` file the same module type.
    expect(await run(cwd, "import.mjs", env)).toEqual({ stdout: "imported\n", stderr: "", exitCode: 0 });
    expect(await run(cwd, "require.cjs", env)).toEqual({ stdout: "ran 2\n", stderr: "", exitCode: 0 });
  });

  // What happens to valid sloppy mode code in a file that has no `import`, `export`, `require` or `module`.
  // Node decides by the file: a `.cjs` file and a `.js` file run it. A `.mjs` file and a `.js` file of a
  // "type": "module" package reject what strict mode code cannot hold.
  // Bun runs each of these files as a module, except a `.cjs` file that `require()` loads, and its parser
  // has no early error for a module that has no `import` and no `export`. So the file runs if the
  // transpiler prints the syntax in another form or leaves it out, and the engine rejects it if not.
  // Four inputs declare a function in a block, as the body of `if` or behind a label. They run, but
  // the function stays inside its block, which is not what Node does: #23633, #25737.
  test.concurrent("sloppy mode code in a file with no module syntax and no CommonJS syntax", async () => {
    const theEngineRejects = new Set([
      "delete x",
      "function f(a, a) {}",
      "eval++",
      "eval = 0",
      "eval += 0",
      "[eval] = 0",
      "arguments++",
      "arguments = 0",
      "arguments += 0",
      "[arguments] = 0",
      "function eval() {}",
      "function arguments() {}",
      "function f(eval) {}",
      "function f(arguments) {}",
      "let protected",
      "let protecte\\u0064",
      "let x = protected",
      "let x = protecte\\u0064",
      "protected: 0",
      "var static, implements, interface, package, private, public, yield",
    ]);
    const validInStrictMode = new Set(["let x = '\\0'", "var x; var x"]);
    const kinds = [
      { kind: ".cjs", folder: "plain", extension: "cjs", nodeRuns: true },
      { kind: ".mjs", folder: "plain", extension: "mjs", nodeRuns: false },
      { kind: ".js", folder: "plain", extension: "js", nodeRuns: true },
      { kind: '.js of a "type": "module" package', folder: "module", extension: "js", nodeRuns: false },
    ];
    const files: Record<string, string> = { "module/package.json": JSON.stringify({ type: "module" }) };
    const loads: { input: string; kind: string; how: string; path: string }[] = [];
    sloppy.forEach((input, i) => {
      for (const { kind, folder, extension } of kinds) {
        for (const how of ["require", "import"]) {
          const path = `${folder}/${how}${i}.${extension}`;
          // The first statement tells a file that runs from a file that the parser or the engine rejects.
          files[path] = `globalThis.started = true;\n${input}\n`;
          loads.push({ input, kind, how, path });
        }
      }
    });
    using dir = tempDir("strict-mode-sloppy-by-file", {
      ...files,
      "load.cjs": `
        (async () => {
          const answers = [];
          for (const { how, path } of ${JSON.stringify(loads)}) {
            globalThis.started = false;
            let error = "";
            try {
              how === "require" ? require("./" + path) : await import("./" + path);
            } catch (e) {
              error = e?.constructor?.name;
            }
            answers.push(globalThis.started ? "runs" : error);
          }
          console.log(JSON.stringify(answers));
        })();
      `,
    });
    const { stdout, stderr, exitCode } = await run(String(dir), "load.cjs");
    expect(stderr).toBe("");
    const answers: string[] = JSON.parse(stdout);
    const table = (answer: (load: (typeof loads)[number]) => string) =>
      Object.fromEntries(loads.map(load => [`${load.how} of a ${load.kind} file: ${load.input}`, answer(load)]));
    expect(table(load => answers[loads.indexOf(load)])).toEqual(
      table(({ input, kind, how }) =>
        theEngineRejects.has(input) && !(kind === ".cjs" && how === "require") ? "SyntaxError" : "runs",
      ),
    );
    expect(exitCode).toBe(0);

    // Where that is not the answer of Node, and what tracks it.
    const differsFromNode = { ".cjs through import(): #40940": 0, ".js: #44802": 0, ".mjs and type module: #32175": 0 };
    loads.forEach(({ input, kind, how }, i) => {
      const node = validInStrictMode.has(input) || kinds.find(k => k.kind === kind)!.nodeRuns ? "runs" : "SyntaxError";
      if (answers[i] === node) return;
      if (kind === ".cjs") differsFromNode[".cjs through import(): #40940"] += +(how === "import");
      else if (kind === ".js") differsFromNode[".js: #44802"]++;
      else differsFromNode[".mjs and type module: #32175"]++;
    });
    expect(differsFromNode).toEqual({
      ".cjs through import(): #40940": 20,
      ".js: #44802": 40,
      ".mjs and type module: #32175": 128,
    });
  });

  // Node runs a `.js` file with no module syntax as CommonJS, which is sloppy mode code. Bun runs such
  // a file as an ES module, so the engine rejects this code: https://github.com/oven-sh/bun/issues/44802
  test.failing("a file with no module syntax runs as sloppy mode code", async () => {
    using dir = tempDir("strict-mode-no-module-syntax", {
      "script.js": `function f(a, a) { return a; }\nconsole.log(f(1, 2));\n`,
    });
    await using proc = Bun.spawn({ cmd: [bunExe(), "script.js"], env: bunEnv, cwd: String(dir), stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({ stdout: "2\n", stderr: "", exitCode: 0 });
  });

  test.concurrent("the same code in an ES module is a syntax error", async () => {
    using dir = tempDir("strict-mode-esm", {
      "strict.mjs": `
        var obj = { foo() { return "foo"; } };
        with (obj) { foo(); }
        export {};
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "strict.mjs"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout).toBe("");
    expect(stderr).toContain("With statements cannot be used in an ECMAScript module");
    expect(exitCode).toBe(1);
  });
});
