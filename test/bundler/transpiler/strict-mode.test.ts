import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// Strict-mode early errors. The cases follow esbuild's TestStrictMode corpus:
// sloppy code must parse, and the same code must be rejected once it is strict
// because of a "use strict" directive, an ECMAScript module, or a class body.

// Warnings (for example the legacy HTML comment warning) also make
// `transformSync` throw, so only errors are recorded.
const transpiler = new Bun.Transpiler({ loader: "js", logLevel: "error" });
const tsTranspiler = new Bun.Transpiler({ loader: "ts", logLevel: "error" });

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

const useStrictNote = 'Strict mode is triggered by the "use strict" directive here:';
const exportNote = 'This file is considered to be an ECMAScript module because of the "export" keyword here:';
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
      "-->",
      "x\n--> a comment",
      "<!-- a comment\nx",
      "x <!-- a comment\ny",
    ];
    test.each(sloppy)("%j", code => expectNoParseError(code));
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

    test("the note points at the directive", () => {
      expect(parseErrors("'use strict';\nwith (x) y")).toEqual([
        {
          message: "With statements cannot be used in strict mode",
          notes: [{ message: useStrictNote, position: { line: 1, column: 1 } }],
        },
      ]);
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
      ["function eval() { 'use strict' }", evalDecl],
      ["function arguments() { 'use strict' }", argsDecl],
      ["function f(eval) { 'use strict' }", evalDecl],
      ["function f(arguments) { 'use strict' }", argsDecl],
      ["({ f(eval) { 'use strict' } })", evalDecl],
      ["({ f(arguments) { 'use strict' } })", argsDecl],
      ["(eval) => { 'use strict' }", evalDecl],
      ["function protected() { 'use strict' }", '"protected" is a reserved word and cannot be used in strict mode'],
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

    test("the note points at the directive inside the function", () => {
      expect(parseErrors("function f(arguments) {\n  'use strict'\n}")).toEqual([
        {
          message: 'Declarations with the name "arguments" cannot be used in strict mode',
          notes: [{ message: useStrictNote, position: { line: 2, column: 3 } }],
        },
      ]);
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
      ["import.meta; with (y) z", "With statements cannot be used in an ECMAScript module"],
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

    test("dynamic import does not make the file a module", () => {
      expectNoParseError("import(x); with (y) z");
      expectNoParseError("import('x'); with (y) z");
      expectNoParseError("with (y) z; import(x)");
      expectNoParseError("(import('x')); with (y) z");
    });

    test("\\0 is not a legacy octal escape", () => {
      expectNoParseError("let x = '\\0'; export {}");
    });

    test("the note points at the export keyword", () => {
      expect(parseErrors("with (x) y;\nexport {}")).toEqual([
        {
          message: "With statements cannot be used in an ECMAScript module",
          notes: [{ message: exportNote, position: { line: 2, column: 1 } }],
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

    test("var is never a duplicate", () => {
      expectNoParseError("var x; var x");
      expectNoParseError("'use strict'; var x; var x");
      expectNoParseError("var x; var x; export {}");
      expectNoParseError("'use strict'; { var x; var x }");
    });
  });

  describe("legacy HTML comments", () => {
    const message = "Legacy HTML single-line comments are not allowed in ECMAScript modules";
    test("are an error in a module", () => {
      expectParseError("export {}\n--> commented out", message);
      expectParseError("<!-- commented out\nexport {}", message);
      expectParseError("import 'x'\n--> commented out", message);
    });
    test("are comments in a script", () => {
      expect(transpiler.transformSync("x\n--> commented out\ny")).toBe("x;\ny;\n");
      expect(transpiler.transformSync("<!-- commented out\nx")).toBe("x;\n");
      expect(transpiler.transformSync("x <!-- commented out\ny")).toBe("x;\ny;\n");
    });
    test("--> without a newline before it is a decrement", () => {
      expect(transpiler.transformSync("x-->y")).toBe("x-- > y;\n");
    });
  });
});

describe("sloppy CommonJS runs as written", () => {
  test.concurrent("duplicate parameters, assignments to eval and arguments, legacy octal escapes", async () => {
    using dir = tempDir("strict-mode-sloppy", {
      "sloppy.cjs": `
        function f(a, a) { return a; }
        eval = 0; arguments++; [eval] = [0];
        var s1 = "\\1", s2 = "\\01", s3 = "a\\7", s4 = "\\08", s5 = "\\09", s6 = "\\8";
        var n = 010;
        var obj = { foo() { return "foo"; } };
        var w;
        with (obj) { w = foo(); }
        console.log(JSON.stringify([f(1, 2), eval, s1, s2, s3, s4, s5, s6, n, w]));
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
      JSON.stringify([2, 0, "\u0001", "\u0001", "a\u0007", "\u00008", "\u00009", "8", 8, "foo"]) + "\n",
    );
    expect(exitCode).toBe(0);
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
