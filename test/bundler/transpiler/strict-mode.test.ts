import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// Strict-mode early errors. The cases follow esbuild's TestStrictMode corpus:
// sloppy code must parse, and the same code must be rejected once it is strict
// because of a "use strict" directive, an ECMAScript module, or a class body.

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

function expectParseError(code: string, ...messages: string[]) {
  expect(parseErrors(code).map(e => e.message)).toEqual(messages);
}

function expectNoParseError(code: string) {
  expect(parseErrors(code)).toEqual([]);
}

function expectTSParseError(code: string, ...messages: string[]) {
  expect(parseErrors(code, tsTranspiler).map(e => e.message)).toEqual(messages);
}

function expectNoTSParseError(code: string) {
  expect(parseErrors(code, tsTranspiler)).toEqual([]);
}

const useStrictNote = 'Strict mode is triggered by a "use strict" directive';
const exportNote = 'This file is considered to be an ECMAScript module because of the "export" keyword here:';
const importNote = 'This file is considered to be an ECMAScript module because of the "import" keyword here:';
const awaitNote = 'This file is considered to be an ECMAScript module because of the top-level "await" keyword here:';
const classNote = "All code inside a class is implicitly in strict mode";

describe("strict mode early errors", () => {
  describe("sloppy mode accepts legacy syntax", () => {
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
    test.each(sloppy)("%j", code => expectNoParseError(code));

    const htmlComments = ["-->", "x\n--> a comment", "<!-- a comment\nx", "x <!-- a comment\ny"];
    test.each(htmlComments)("%j", code => expect(parseErrors(code, quietTranspiler)).toEqual([]));
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
      ["'use strict'; 0123", "Legacy octal literals cannot be used in strict mode"],
      ["'use strict'; ({0123: 4})", "Legacy octal literals cannot be used in strict mode"],
      ["'use strict'; let {0123: x} = y", "Legacy octal literals cannot be used in strict mode"],
      ["'use strict'; 08", "Legacy octal literals cannot be used in strict mode"],
      ["'use strict'; ({08: 4})", "Legacy octal literals cannot be used in strict mode"],
      ["'use strict'; let {08: x} = y", "Legacy octal literals cannot be used in strict mode"],
      ["'use strict'; let x = '\\00'", "Legacy octal escape sequences cannot be used in strict mode"],
      ["'use strict'; let x = '\\08'", "Legacy octal escape sequences cannot be used in strict mode"],
      ["'use strict'; let x = '\\008'", "Legacy octal escape sequences cannot be used in strict mode"],
      ["'use strict'; let x = '\\1'", "Legacy octal escape sequences cannot be used in strict mode"],
      ["'use strict'; let x = '\\012'", "Legacy octal escape sequences cannot be used in strict mode"],
      ["'use strict'; let x = '\\8'", "Legacy octal escape sequences cannot be used in strict mode"],
      ["'use strict'; '\\00'", "Legacy octal escape sequences cannot be used in strict mode"],
      ["'use strict'; '\\08'", "Legacy octal escape sequences cannot be used in strict mode"],
      ["'use strict'; '\\008'", "Legacy octal escape sequences cannot be used in strict mode"],
      ["'\\00'; 'use strict';", "Legacy octal escape sequences cannot be used in strict mode"],
      ["'\\08'; 'use strict';", "Legacy octal escape sequences cannot be used in strict mode"],
      ["'\\008'; 'use strict';", "Legacy octal escape sequences cannot be used in strict mode"],
      ["'use strict'; function f(a, a) {}", '"a" cannot be bound multiple times in the same parameter list'],
      ["'use strict'; (function(a, a) {})", '"a" cannot be bound multiple times in the same parameter list'],
      ["'use strict'; ((a, a) => {})", '"a" cannot be bound multiple times in the same parameter list'],
    ];
    test.each(cases)("%j", (code, message) => expectParseError(code, message));

    test("\\0 is not a legacy octal escape", () => {
      expectNoParseError("'use strict'; let x = '\\0'");
      expectNoParseError("'use strict'; '\\0'");
    });

    // The parser reads `(` as the start of a possible arrow function, in a scope that it then discards.
    test("a legacy octal literal in parentheses, in a default value, and in dead code", () => {
      expectParseError("'use strict'; ('\\1')", "Legacy octal escape sequences cannot be used in strict mode");
      expectParseError("'use strict'; (010)", "Legacy octal literals cannot be used in strict mode");
      expectParseError("('\\1'); export {}", "Legacy octal escape sequences cannot be used in an ECMAScript module");
      expectParseError("class A { m(a = (010)) {} }", "Legacy octal literals cannot be used in strict mode");
      expectParseError("'use strict'; if (false) { x = 010 }", "Legacy octal literals cannot be used in strict mode");
      expectNoParseError("x = ('\\1'); y = (010); ((a = 010) => a)");
    });

    test("a TypeScript arrow function that the parser reads twice reports once", () => {
      expectTSParseError(
        "'use strict'; const f = (a: number = 010) => a",
        "Legacy octal literals cannot be used in strict mode",
      );
      expectNoTSParseError("const f = (a: number = 010) => a; const g = <T,>(b: T) => '\\1'");
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

    test("a string index that minify.syntax turns into a property name", () => {
      const minifying = new Bun.Transpiler({ loader: "js", logLevel: "error", minify: { syntax: true } });
      expect(minifying.transformSync("x['\\141']")).toBe("x.a;\n");
      expect(parseErrors("'use strict'; x['\\141']", minifying).map(e => e.message)).toEqual([
        "Legacy octal escape sequences cannot be used in strict mode",
      ]);
    });

    // The value of such a string is "use strict" or "use asm", but it is not that directive.
    describe("a string of the directive prologue that is not kept", () => {
      const message = "Legacy octal escape sequences cannot be used in strict mode";
      const cases: [string, string][] = [
        ["'use\\040strict'; 'use strict'", message],
        ["'use strict'; 'use\\040strict'", message],
        ["'use strict'; 'use\\040asm'", message],
        ["function f() { 'use\\040strict'; 'use strict' }", message],
        ["function f() { 'use strict'; function g() { 'use\\040asm' } }", message],
        ["(() => { 'use\\040asm'; 'use strict' })", message],
        ["class A { m() { 'use\\040strict' } }", message],
        ["'use\\040asm'; export {}", "Legacy octal escape sequences cannot be used in an ECMAScript module"],
      ];
      test.each(cases)("%j", (code, message) => expectParseError(code, message));

      test("in a TypeScript namespace", () => {
        expectTSParseError("namespace N { 'use\\040strict'; 'use strict'; export const x = 1 }", message);
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
      ["function f() { 'use strict'; return 010 }", "Legacy octal literals cannot be used in strict mode"],
      ["function f() { 'use strict'; return '\\1' }", "Legacy octal escape sequences cannot be used in strict mode"],
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
      ["import 'x\\1'", "Legacy octal escape sequences cannot be used in an ECMAScript module"],
      ["export * from 'x\\1'", "Legacy octal escape sequences cannot be used in an ECMAScript module"],
      ["export { x } from 'x\\1'", "Legacy octal escape sequences cannot be used in an ECMAScript module"],
      ["import { '\\141' as x } from 'y'", "Legacy octal escape sequences cannot be used in an ECMAScript module"],
      ["let x; export { x as '\\141' }", "Legacy octal escape sequences cannot be used in an ECMAScript module"],
      ["export { '\\141' as x } from 'y'", "Legacy octal escape sequences cannot be used in an ECMAScript module"],
      ["export * as '\\141' from 'y'", "Legacy octal escape sequences cannot be used in an ECMAScript module"],
      [
        "import x from 'y' with { type: '\\152son' }",
        "Legacy octal escape sequences cannot be used in an ECMAScript module",
      ],
      [
        "import x from 'y' with { 'typ\\145': 'json' }",
        "Legacy octal escape sequences cannot be used in an ECMAScript module",
      ],
      ["export let n = 010", "Legacy octal literals cannot be used in an ECMAScript module"],
      ["export let n = 08", "Legacy octal literals cannot be used in an ECMAScript module"],
      ["export let o = { 0123: 4 }", "Legacy octal literals cannot be used in an ECMAScript module"],
      ["let x = '\\00'; export {}", "Legacy octal escape sequences cannot be used in an ECMAScript module"],
      ["let x = '\\09'; export {}", "Legacy octal escape sequences cannot be used in an ECMAScript module"],
      ["let x = '\\009'; export {}", "Legacy octal escape sequences cannot be used in an ECMAScript module"],
      ["export let t = '\\012'", "Legacy octal escape sequences cannot be used in an ECMAScript module"],
      ["'\\00'; export {}", "Legacy octal escape sequences cannot be used in an ECMAScript module"],
      ["'\\09'; export {}", "Legacy octal escape sequences cannot be used in an ECMAScript module"],
      ["'\\009'; export {}", "Legacy octal escape sequences cannot be used in an ECMAScript module"],
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
        "import.meta; function f() { 'use strict'; return 010 }",
        "Legacy octal literals cannot be used in strict mode",
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
      expect(parseErrors("import { y } from './y.mjs';\nexports.x = 1;\nconsole.log(010, y)")).toEqual([
        {
          message: "Legacy octal literals cannot be used in an ECMAScript module",
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
    test("a legacy octal escape in an import-equals path and in an enum member name", () => {
      const escape = "Legacy octal escape sequences cannot be used";
      expectNoTSParseError("import x = require('\\1'); x");
      expectTSParseError("'use strict'; import x = require('\\1'); x", `${escape} in strict mode`);
      expectNoTSParseError("enum E { '\\1' = 1 }");
      expectTSParseError("export {}; enum E { '\\1' = 1 }", `${escape} in an ECMAScript module`);
    });
  });

  describe("TypeScript code that is erased", () => {
    test("a legacy octal in a declare statement is not reported", () => {
      expectNoTSParseError("export {}; declare const x = 010;");
      expectNoTSParseError("'use strict'; declare const y = '\\033';");
      expectNoTSParseError("export {}; declare global { const q = 010 }");
      expectNoTSParseError("declare module 'm' { const x: number; export { x as '\\141' } }");
    });
    test("the statements around a declare statement are still checked", () => {
      const inModule = "Legacy octal literals cannot be used in an ECMAScript module";
      expectTSParseError("export {}; declare const y: number; const x = 010;", inModule);
      expectTSParseError("export {}; const x = 010; declare const y = 011;", inModule);
    });
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
      ["class f { x() { return 010 } }", "Legacy octal literals cannot be used in strict mode"],
      ["class f { x() { return '\\01' } }", "Legacy octal escape sequences cannot be used in strict mode"],
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
  });

  describe("legacy octal escapes in template literals", () => {
    const message = "Legacy octal escape sequences cannot be used in template literals";
    test("are always an error in untagged templates", () => {
      expectParseError("`\\8`", message);
      expectParseError("`\\01`", message);
      expectParseError("`a${b}\\1`", message);
      expectParseError("`\\1${b}c`", message);
      expectParseError("export let u = `\\8`", message);
    });
    test("are allowed in tagged templates", () => {
      expectNoParseError("tag`\\8`");
      expectNoParseError("tag`\\01${x}\\8`");
    });
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

  // `scan` and `scanImports` only run the parse pass. Most early errors need the visit pass, which knows
  // what is strict mode code.
  test("scanImports reads the imports of a file that has a strict mode early error", () => {
    expect(transpiler.scanImports('"use strict"; var static = 1; with (x) y; import "x"')).toEqual([
      { kind: "import-statement", path: "x" },
    ]);
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
      expectParseError("x <!-- commented out\ny", 'Treating "<!--" as the start of a legacy HTML single-line comment');
      expectParseError("x\n--> commented out\ny", 'Treating "-->" as the start of a legacy HTML single-line comment');
    });
    test("--> without a newline before it is a decrement", () => {
      expect(transpiler.transformSync("x-->y")).toBe("x-- > y;\n");
    });
  });
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

  // Such a file is a module in Node, with no `import` or `export` in it.
  test.concurrent(
    "a file that is a module by its extension or by its package rejects a legacy HTML comment",
    async () => {
      const code = `var a = 1, b = 0;\nconsole.log(a <!--b\n);\n`;
      using dir = tempDir("strict-mode-module-by-type", {
        "by-extension.mjs": code,
        "package/package.json": JSON.stringify({ type: "module" }),
        "package/by-package.js": code,
        "commonjs.mjs": `module.exports = 1;\n--> a comment\nconsole.log(typeof module);\n`,
      });
      const run = async (file: string) => {
        await using proc = Bun.spawn({ cmd: [bunExe(), file], env: bunEnv, cwd: String(dir), stderr: "pipe" });
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        return { stdout, stderr, exitCode };
      };
      const [byExtension, byPackage, commonjs] = await Promise.all([
        run("by-extension.mjs"),
        run("package/by-package.js"),
        run("commonjs.mjs"),
      ]);
      // `module` makes a file CommonJS in Bun, whatever its extension is.
      expect(commonjs).toEqual({ stdout: "object\n", stderr: "", exitCode: 0 });
      const error = "error: Legacy HTML single-line comments are not allowed in ECMAScript modules";
      const because = "note: This file is considered to be an ECMAScript module because";
      expect(byExtension.stderr).toContain(error);
      expect(byExtension.stderr).toContain(`${because} of its file extension.`);
      expect(byPackage.stderr).toContain(error);
      expect(byPackage.stderr).toContain(`${because} the "package.json" file of its package has "type": "module".`);
      expect([byExtension.stdout, byExtension.exitCode, byPackage.stdout, byPackage.exitCode]).toEqual(["", 1, "", 1]);
    },
  );

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
