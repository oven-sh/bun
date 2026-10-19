import { describe, expect, test } from "bun:test";
import vm from "node:vm";

describe("Bun.Transpiler replMode", () => {
  describe("basic transform output", () => {
    const transpiler = new Bun.Transpiler({ loader: "tsx", replMode: true });

    test("simple expression wrapped in value object", () => {
      const result = transpiler.transformSync("42");
      // Should contain value wrapper
      expect(result).toContain("value:");
    });

    test("variable declaration with await", () => {
      const result = transpiler.transformSync("var x = await 1");
      // Should hoist var declaration
      expect(result).toContain("var x");
      // Should have async wrapper
      expect(result).toContain("async");
    });

    test("const becomes var with await", () => {
      const result = transpiler.transformSync("const x = await 1");
      // const should become var for REPL persistence (becomes context property)
      expect(result).toContain("var x");
      expect(result).not.toContain("const x");
    });

    test("let becomes var with await", () => {
      const result = transpiler.transformSync("let x = await 1");
      // let should become var for REPL persistence (becomes context property)
      expect(result).toContain("var x");
      expect(result).not.toContain("let x");
      expect(result).toContain("async");
    });

    test("no async wrapper when no await", () => {
      const result = transpiler.transformSync("var x = 1; x + 5");
      // Should still have value wrapper for the last expression
      expect(result).toContain("value:");
      // Should not wrap in async when no await
      expect(result).not.toMatch(/\(\s*async\s*\(\s*\)\s*=>/);
    });

    test("function declaration with await", () => {
      const result = transpiler.transformSync("await 1; function foo() { return 42; }");
      // Should hoist function declaration
      expect(result).toContain("var foo");
      expect(result).toContain("async");
    });

    test("class declaration with await", () => {
      const result = transpiler.transformSync("await 1; class Bar { }");
      // Should hoist class declaration with var (not let) for vm context persistence
      expect(result).toContain("var Bar");
      expect(result).toContain("async");
    });

    // https://github.com/oven-sh/bun/issues/31225
    test("top-level `this` is preserved (not rewritten to `exports`)", () => {
      const result = transpiler.transformSync("this");
      // In REPL mode, top-level `this` must survive the visit pass so the
      // surrounding arrow IIFE inherits `this` from the global scope.
      // Before the fix, it was rewritten to `exports`, which isn't bound in
      // the IIFE and blew up with `ReferenceError: exports is not defined`.
      expect(result).toContain("this");
      expect(result).not.toContain("exports");
    });

    test("`this` inside a nested call is preserved", () => {
      const result = transpiler.transformSync("console.log(this)");
      expect(result).toContain("console.log(this)");
      expect(result).not.toContain("console.log(exports)");
    });
  });

  describe("REPL session with node:vm", () => {
    const transpiler = new Bun.Transpiler({ loader: "tsx", replMode: true });

    async function runRepl(code: string, context?: object) {
      const ctx = vm.createContext(context ?? { console, Promise });
      const transformed = transpiler.transformSync(code);
      return await vm.runInContext(transformed, ctx);
    }

    test("simple expression returns value object", async () => {
      const result = await runRepl("42");
      expect(result).toEqual({ value: 42 });
    });

    test("arithmetic expression", async () => {
      const result = await runRepl("2 + 3 * 4");
      expect(result).toEqual({ value: 14 });
    });

    test("string expression", async () => {
      const result = await runRepl('"hello world"');
      expect(result).toEqual({ value: "hello world" });
    });

    test("object literal (auto-detected)", async () => {
      // Object literals don't need parentheses - the transpiler auto-detects them
      const result = await runRepl("{a: 1, b: 2}");
      expect(result).toEqual({ value: { a: 1, b: 2 } });
    });

    test("array literal", async () => {
      const result = await runRepl("[1, 2, 3]");
      expect(result).toEqual({ value: [1, 2, 3] });
    });

    test("await expression", async () => {
      const result = await runRepl("await Promise.resolve(100)");
      expect(result).toEqual({ value: 100 });
    });

    test("await with variable", async () => {
      const ctx = vm.createContext({ Promise });
      const code1 = transpiler.transformSync("var x = await Promise.resolve(10)");
      await vm.runInContext(code1, ctx);
      expect(ctx.x).toBe(10);

      const code2 = transpiler.transformSync("x * 2");
      const result = await vm.runInContext(code2, ctx);
      expect(result).toEqual({ value: 20 });
    });
  });

  describe("variable persistence across lines", () => {
    const transpiler = new Bun.Transpiler({ loader: "tsx", replMode: true });

    async function runReplSession(lines: string[]) {
      const ctx = vm.createContext({ console, Promise });
      const results: any[] = [];

      for (const line of lines) {
        const transformed = transpiler.transformSync(line);
        const result = await vm.runInContext(transformed, ctx);
        results.push(result?.value ?? result);
      }

      return { results, context: ctx };
    }

    test("var persists across lines", async () => {
      const { results, context } = await runReplSession(["var x = 10", "x + 5", "x = 20", "x"]);

      expect(results[1]).toBe(15);
      expect(results[3]).toBe(20);
      expect(context.x).toBe(20);
    });

    test("let persists with await", async () => {
      const { results } = await runReplSession(["let y = await Promise.resolve(100)", "y * 2"]);

      expect(results[1]).toBe(200);
    });

    test("function declarations persist", async () => {
      const { results, context } = await runReplSession(["await 1; function add(a, b) { return a + b; }", "add(2, 3)"]);

      expect(results[1]).toBe(5);
      expect(typeof context.add).toBe("function");
    });

    test("class declarations persist to vm context", async () => {
      // Class declarations use 'var' hoisting so they persist to vm context
      const { results, context } = await runReplSession([
        "await 1; class Counter { constructor() { this.count = 0; } inc() { this.count++; } }",
        "new Counter()",
      ]);

      // The class is returned in the result's value
      expect(typeof results[0]).toBe("function");
      expect(results[0].name).toBe("Counter");

      // The class should be accessible in subsequent REPL lines
      expect(results[1]).toBeInstanceOf(context.Counter);
      expect(typeof context.Counter).toBe("function");
    });
  });

  describe("object literal detection", () => {
    const transpiler = new Bun.Transpiler({ loader: "tsx", replMode: true });

    async function runRepl(code: string, context?: object) {
      const ctx = vm.createContext(context ?? { console, Promise });
      const transformed = transpiler.transformSync(code);
      return await vm.runInContext(transformed, ctx);
    }

    test("{a: 1} parsed as object literal, not block", async () => {
      const result = await runRepl("{a: 1}");
      expect(result.value).toEqual({ a: 1 });
    });

    test("{a: 1, b: 2} parsed as object literal", async () => {
      const result = await runRepl("{a: 1, b: 2}");
      expect(result.value).toEqual({ a: 1, b: 2 });
    });

    test("{foo: await bar()} parsed as object literal", async () => {
      const ctx = vm.createContext({
        bar: async () => 42,
      });
      const code = transpiler.transformSync("{foo: await bar()}");
      const result = await vm.runInContext(code, ctx);
      expect(result.value).toEqual({ foo: 42 });
    });

    test("{x: 1}; is NOT wrapped (has trailing semicolon)", async () => {
      // With semicolon, it's explicitly a block statement
      const code = transpiler.transformSync("{x: 1};");
      // The output should NOT treat this as an object literal
      // It should be a block with a labeled statement, no value wrapper
      expect(code).not.toContain("value:");
      expect(code).toContain("x:");
    });

    test("whitespace around object literal is handled", async () => {
      const result = await runRepl("  { a: 1 }  ");
      expect(result.value).toEqual({ a: 1 });
    });
  });

  describe("edge cases", () => {
    const transpiler = new Bun.Transpiler({ loader: "tsx", replMode: true });

    test("empty input", () => {
      const result = transpiler.transformSync("");
      expect(result).toBe("");
    });

    test("whitespace only", () => {
      const result = transpiler.transformSync("   \n\t  ");
      expect(result.trim()).toBe("");
    });

    test("comment only produces empty output", () => {
      // Comments are stripped by the transpiler
      const result = transpiler.transformSync("// just a comment");
      expect(result.trim()).toBe("");
    });

    test("TypeScript types stripped", () => {
      const result = transpiler.transformSync("const x: number = await Promise.resolve(42)");
      expect(result).not.toContain(": number");
    });

    test("multiple await expressions", async () => {
      const ctx = vm.createContext({ Promise });
      const code = transpiler.transformSync("await 1; await 2; await 3");
      const result = await vm.runInContext(code, ctx);
      // Last expression should be wrapped
      expect(result).toEqual({ value: 3 });
    });

    test("destructuring assignment persists", async () => {
      const ctx = vm.createContext({ Promise });
      const code = transpiler.transformSync("var { a, b } = await Promise.resolve({ a: 1, b: 2 })");
      await vm.runInContext(code, ctx);
      expect(ctx.a).toBe(1);
      expect(ctx.b).toBe(2);
    });

    test("array destructuring persists", async () => {
      const ctx = vm.createContext({ Promise });
      const code = transpiler.transformSync("var [x, y, z] = await Promise.resolve([10, 20, 30])");
      await vm.runInContext(code, ctx);
      expect(ctx.x).toBe(10);
      expect(ctx.y).toBe(20);
      expect(ctx.z).toBe(30);
    });
  });

  describe("no transform cases", () => {
    const transpiler = new Bun.Transpiler({ loader: "tsx", replMode: true });

    test("async function expression - no async wrapper", () => {
      const result = transpiler.transformSync("async function foo() { await 1; }");
      // await inside async function doesn't trigger TLA transform
      // The top level has no await
      expect(result).not.toMatch(/^\(async/);
    });

    test("arrow async function - no async wrapper", () => {
      const result = transpiler.transformSync("const fn = async () => await 1");
      // await inside arrow function doesn't trigger TLA transform
      expect(result).not.toMatch(/^\(async\s*\(\)/);
    });
  });

  // An input with no top-level await and no import is printed as the statements of a script.
  describe("script inputs", () => {
    const transpiler = new Bun.Transpiler({ loader: "tsx", replMode: true });

    /** Runs each input in one context. Returns what the last input evaluates to. */
    function runSession(...inputs: string[]) {
      const context = vm.createContext({});
      let result: any;
      for (const input of inputs) result = vm.runInContext(transpiler.transformSync(input), context);
      return result;
    }

    test("are printed with no function around them", () => {
      expect(transpiler.transformSync("'use strict'; const one = 1; function f() { return one } f()"))
        .toMatchInlineSnapshot(`
        ""use strict";
        var one;
        one = 1;
        function f() {
          return one;
        }
        ({
          __proto__: null,
          value: f()
        });
        "
      `);
      // The completion value of a script can be any value. Only the object above is a result.
      expect(transpiler.transformSync("if (1) p;")).toMatchInlineSnapshot(`
        "if (1)
          p;
        void 0;
        "
      `);
    });

    test("transform() prints the same text as transformSync()", async () => {
      const input = "function f() { return 1 } f()";
      expect(await transpiler.transform(input)).toBe(transpiler.transformSync(input));
    });

    test("a function keeps an assignment to its name", () => {
      expect(
        runSession("function f() { return 1 } function wrap(g) { return () => g() + 100 } f = wrap(f)", "f()"),
      ).toEqual({ value: 101 });
    });

    test("a closure calls the newest declaration of a function", () => {
      expect(
        runSession(
          "function current() { return 1 } var call = () => current()",
          "function current() { return 2 }",
          "call()",
        ),
      ).toEqual({ value: 2 });
    });

    test("a function exists before the first statement of its input runs", () => {
      expect(runSession("var early = typeof globalThis.late; function late() {}", "early")).toEqual({
        value: "function",
      });
    });

    test.each([
      ["an if block", "if (true) { function inBlock() {} }"],
      ["a try block", "try { function inBlock() {} } finally {}"],
      ["a loop body", "for (const once of [1]) { function inBlock() {} }"],
      ["a switch case", "switch (1) { case 1: function inBlock() {} }"],
      ["a labeled block", "label: { function inBlock() {} }"],
    ])("a function declared in %s is there in the next input", (_, input) => {
      expect(runSession(input, "typeof inBlock")).toEqual({ value: "function" });
    });

    test("a name that eval declares is there in the next input", () => {
      expect(
        runSession(`eval("var fromEval = 4; function evalFn() { return fromEval }")`, "[evalFn(), typeof fromEval]"),
      ).toEqual({ value: [4, "number"] });
    });

    test.each([
      ["export function exported() { return 1 }", "exported()", 1],
      ["export async function exported() {}", "typeof exported", "function"],
      ["export function* exported() {}", "typeof exported", "function"],
      ["export default function exported() { return 2 }", "exported()", 2],
      ["export default class Exported {}", "typeof Exported", "function"],
      ["export const exported = 3", "exported", 3],
      ["var exported = 4; export { exported }", "exported", 4],
    ])("%s declares what it carries", (input, next, value) => {
      expect(runSession(input, next)).toEqual({ value });
    });

    test("export default evaluates an expression, or a function or class with no name", () => {
      expect(runSession("export default 6 * 7")).toEqual({ value: 42 });
      expect(runSession("export default function () { return 5 }").value()).toBe(5);
      expect(runSession("export default class { static five = 5 }").value.five).toBe(5);
    });

    test("a function or class with no name that an input evaluates to has no name", () => {
      for (const input of ["() => 1", "(function () {})", "(class {})", "await 1; () => 2"]) {
        const output = transpiler.transformSync(input);
        expect(output).toContain("value: (0, ");
      }
      expect(runSession("() => 1").value.name).toBe("");
      expect(runSession("(function () {})").value.name).toBe("");
      expect(runSession("(class {})").value.name).toBe("");
      // A name that the code gives stays.
      expect(runSession("(function named() {})").value.name).toBe("named");
      expect(runSession("var assigned = () => 1").value.name).toBe("assigned");
    });

    test("a top-level return is a syntax error", () => {
      expect(() => runSession("return 5")).toThrow("Return statements are only valid inside functions.");
    });

    test("only the last expression statement is the value of an input", () => {
      // The promise is the value. The input does not wait for it.
      const pending = runSession("var pending = new Promise(() => {}); pending");
      expect(Object.keys(pending)).toEqual(["value"]);
      expect(Bun.peek.status(pending.value)).toBe("pending");
      expect(runSession("if (1) ({ value: 7 })")).toBeUndefined();
      expect(runSession("var p = 1; if (1) p;")).toBeUndefined();
      expect(runSession("function only() {}")).toBeUndefined();
    });

    test("'use strict' is the directive of the script", () => {
      expect(runSession("'use strict'; function strictThis() { return this === undefined } strictThis()")).toEqual({
        value: true,
      });
      expect(runSession("function sloppyThis() { return this === globalThis } sloppyThis()")).toEqual({ value: true });
      // The directive is the value of an input that it ends.
      expect(runSession("'use strict'")).toEqual({ value: "use strict" });
    });
  });

  describe("inputs with top-level await or an import", () => {
    const transpiler = new Bun.Transpiler({ loader: "tsx", replMode: true });

    test("are printed in an async function, with each declaration handed to the global", () => {
      const inputs = [
        "await 1",
        "var x = await Promise.resolve(10)",
        "const { a, b } = await Promise.resolve({ a: 1, b: 2 }); a + b",
        "await 1; function foo() { return 42 }",
        "await 1; class Bar {}",
        "for await (const chunk of []) {}",
        'import fs from "node:fs"; fs.existsSync("/")',
        'import { join, sep as separator } from "node:path"',
        'import * as os from "node:os"',
        'import "node:fs"',
      ];
      expect(inputs.map(input => transpiler.transformSync(input)).join("\n")).toMatchInlineSnapshot(`
        "(async () => {
          return {
            __proto__: null,
            value: await 1
          };
        })();

        var x;
        (async () => {
          return {
            __proto__: null,
            value: x = await Promise.resolve(10)
          };
        })();

        var a, b;
        (async () => {
          ({ a, b } = await Promise.resolve({ a: 1, b: 2 }));
          return {
            __proto__: null,
            value: a + b
          };
        })();

        var foo;
        (async () => {
          await 1;
          this.foo = foo;
          function foo() {
            return 42;
          }
        })();

        var Bar;
        (async () => {
          await 1;
          return {
            __proto__: null,
            value: Bar = class Bar {
            }
          };
        })();

        (async () => {
          for await (const chunk of []) {}
        })();

        var fs;
        (async () => {
          fs = (await import("node:fs")).default;
          return {
            __proto__: null,
            value: fs.existsSync("/")
          };
        })();

        var import_node_path;
        var join;
        var separator;
        (async () => {
          import_node_path = await import("node:path");
          join = import_node_path.join;
          return {
            __proto__: null,
            value: separator = import_node_path.sep
          };
        })();

        var os;
        (async () => {
          return {
            __proto__: null,
            value: os = await import("node:os")
          };
        })();

        (async () => {
          return {
            __proto__: null,
            value: await import("node:fs")
          };
        })();
        "
      `);
    });
  });

  describe("replMode option", () => {
    test("replMode false by default", () => {
      const transpiler = new Bun.Transpiler({ loader: "tsx" });
      const result = transpiler.transformSync("42");
      // Without replMode, no value wrapper
      expect(result).not.toContain("value:");
    });

    test("replMode true adds transforms", () => {
      const transpiler = new Bun.Transpiler({ loader: "tsx", replMode: true });
      const result = transpiler.transformSync("42");
      // With replMode, value wrapper should be present
      expect(result).toContain("value:");
    });
  });
});
