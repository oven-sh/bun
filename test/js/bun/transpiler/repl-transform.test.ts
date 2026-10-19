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

  // A REPL input is sloppy script code. What it declares must reach the next input:
  // a function in a block is also a `var` (ECMA-262 Annex B.3.3), and a direct eval
  // declares in the scope of its caller.
  describe("functions in blocks and direct eval", () => {
    const transpiler = new Bun.Transpiler({ loader: "tsx", replMode: true });

    /**
     * Evaluates each line as one REPL input, all in one fresh context. Gives what the
     * last line evaluated to, or "!Name" if it threw an error of that name.
     */
    async function lastOf(lines: string[]) {
      const ctx = vm.createContext({});
      let last: unknown;
      for (const line of lines) {
        try {
          const result = await vm.runInContext(transpiler.transformSync(line), ctx);
          last = result !== null && typeof result === "object" ? result.value : result;
        } catch (e) {
          last = `!${(e as Error)?.name}`;
        }
      }
      return last;
    }

    test.each([
      "if (1) { function w() {} }",
      "if (0) {} else { function w() {} }",
      "try { function w() {} } catch {}",
      "try { throw 1 } catch (e) { function w() {} }",
      "try {} finally { function w() {} }",
      "for (;;) { function w() {} break }",
      "for (const k in { a: 1 }) { function w() {} }",
      "for (const v of [1]) { function w() {} }",
      "while (true) { function w() {} break }",
      "do { function w() {} } while (false)",
      "switch (1) { case 1: function w() {} }",
      "switch (1) { default: function w() {} }",
      "with ({}) { function w() {} }",
      "l: { function w() {} }",
      "{ { function w() {} } };",
      "{ function w() {} };",
      "if (1) function w() {}",
      "l: function w() {}",
    ])("the function of `%s` is a function in the next input", async input => {
      expect(await lastOf([input, "typeof w"])).toBe("function");
    });

    describe("a function in a block", () => {
      test.each<[string, string[], unknown]>([
        ["is callable after its block in the same input", ["if (1) { function f() { return 1 } } f()"], 1],
        ["is an undefined var before its block runs", ["f(); if (1) { function f() {} }"], "!TypeError"],
        [
          "declares its var when the input throws before the block",
          ["f(); if (1) { function f() {} }", "[typeof f, 'f' in globalThis].join()"],
          "undefined,true",
        ],
        [
          "declares its var when the block never runs",
          ["if (0) { function f() {} }", "[f, 'f' in globalThis].join()"],
          ",true",
        ],
        [
          "leaves an earlier function when the block never runs",
          ["function f() { return 1 }", "if (false) { function f() { return 2 } } f()"],
          1,
        ],
        [
          "leaves an earlier function when a break skips the declaration",
          ["function f() { return 1 }", "exit: { break exit; function f() { return 2 } } f()"],
          1,
        ],
        [
          "is copied to its var where it is declared, not at the top of the block",
          ["var seen; if (1) { seen = typeof globalThis.f; function f() {} } [seen, typeof f].join()"],
          "undefined,function",
        ],
        ["replaces an earlier var", ["var f = 1", "if (1) { function f() { return 2 } }", "f()"], 2],
        [
          "replaces a top-level function of the same input",
          ["function f() { return 1 } if (1) { function f() { return 2 } } f()"],
          2,
        ],
        [
          "declared twice in one block is the last one",
          ["if (1) { function f() { return 1 } function f() { return 2 } } f()"],
          2,
        ],
        [
          "declared twice around another function leaves that function at its place",
          [
            "var log = []; if (1) { function f() { return 1 } log.push(typeof globalThis.g); function g() {} log.push(typeof globalThis.g); function f() { return 2 } } log.push(f()); log.join()",
          ],
          "undefined,function,2",
        ],
        [
          "declared in two blocks is the one of the last block",
          ["if (1) { function f() { return 1 } } if (1) { function f() { return 2 } } f()"],
          2,
        ],
        [
          "is callable from another case of its switch",
          ["var r; switch (1) { case 0: function f() { return 7 } case 1: r = f() } r"],
          7,
        ],
        ["keeps its name", ["if (1) { function named() {} } named.name"], "named"],
        [
          "is copied with the value that its block gave the name",
          ["if (1) { f = 5; function f() {} }", "typeof f"],
          "number",
        ],
        [
          "passes a catch parameter of its name",
          ["try { throw 1 } catch (f) { { function f() {} } } typeof f"],
          "function",
        ],
      ])("%s", async (_, lines, expected) => {
        expect(await lastOf(lines)).toBe(expected);
      });

      // Annex B.3.3 makes no `var` where `var f` would be an early error, for a function
      // that is not a plain function, or in strict code.
      test.each<[string, string[], unknown]>([
        ["under a `let` of the input", ["let f = 1; if (1) { function f() {} } typeof f"], "number"],
        ["under a `const` of the input", ["const f = 1; if (1) { function f() {} } f"], 1],
        ["under a `let` of an enclosing block", ["if (1) { let f = 1; { function f() {} } } typeof f"], "undefined"],
        [
          "under a destructured catch parameter",
          ["try { throw {} } catch ({ f = 1 }) { { function f() {} } } typeof f"],
          "undefined",
        ],
        [
          "under a function of an enclosing block",
          ["if (1) { function f() { return 1 } { function f() { return 2 } } } f()"],
          1,
        ],
        ["when it is async", ["if (1) { async function f() {} }", "typeof f"], "undefined"],
        ["when it is a generator", ["if (1) { function* f() {} }", "typeof f"], "undefined"],
        ["in a strict input", ['"use strict"; if (1) { function f() {} }', "typeof f"], "undefined"],
        ["in a function", ["function outer() { if (1) { function f() {} } }; outer(); typeof f"], "undefined"],
      ])("stays in its block %s", async (_, lines, expected) => {
        expect(await lastOf(lines)).toBe(expected);
      });

      // An input with a top-level await runs in an async function. The function is
      // copied out of it where it is declared, as in Node.js.
      test.each<[string, string[], unknown]>([
        ["is a function in the next input", ["await 1; if (1) { function f() { return 1 } }", "f()"], 1],
        [
          "declares its var when the block never runs",
          ["await 1; if (0) { function f() {} }", "[typeof f, 'f' in globalThis].join()"],
          "undefined,true",
        ],
        [
          "declares its var when its switch case never runs",
          ["await 1; switch (1) { case 2: function f() {} }", "[typeof f, 'f' in globalThis].join()"],
          "undefined,true",
        ],
        [
          "leaves an earlier function when a break skips the declaration",
          ["function f() { return 1 }", "await 1; exit: { break exit; function f() { return 2 } }", "f()"],
          1,
        ],
        [
          "is a function in the next input beside a direct eval",
          ["await 1; if (1) { function f() { return 7 } eval('') }", "f()"],
          7,
        ],
        [
          "stays in its block under a `let` of the input",
          ["await 1; let f = 1; if (1) { function f() {} }", "typeof f"],
          "number",
        ],
        [
          "stays in its block in a strict input",
          ['"use strict"; await 1; if (1) { function f() {} }', "typeof f"],
          "undefined",
        ],
        ["stays in its block when it is async", ["await 1; if (1) { async function f() {} }", "typeof f"], "undefined"],
      ])("beside a top-level await %s", async (_, lines, expected) => {
        expect(await lastOf(lines)).toBe(expected);
      });

      // A `return` needs a function around the input, so this input is wrapped too.
      test("beside a top-level return is a function in the same and in the next input", async () => {
        expect(await lastOf(["if (1) { function f() { return 1 } } return f() + 1"])).toBe(2);
        expect(await lastOf(["if (1) { function f() { return 1 } } if (f) return 0", "f()"])).toBe(1);
      });
    });

    describe("a direct eval", () => {
      test.each<[string, string[], unknown]>([
        ["a var", ['eval("var q = 1")', "q"], 1],
        ["a function", ['eval("function q() { return 2 }")', "q()"], 2],
        ["a var, called as (eval)(..)", ['(eval)("var q = 3")', "q"], 3],
        ["a var, from inside a block", ['if (1) { eval("var q = 4") }', "q"], 4],
        ["a var that reads a `let` of its block", ['{ let secret = 5; eval("var q = secret") };', "q"], 5],
        ["a var, from an initializer", ['var a = eval("var q = 6; 7")', "a + q"], 13],
        ["a var that an earlier input declared", ["var q = 1", 'eval("var q = 2")', "q"], 2],
        ["a function in a block of the evaluated code", ['eval("if (1) { function q() { return 8 } }")', "q()"], 8],
        ["a var, in a loop with a `let` head", ['for (let i = 0; i < 3; i++) eval("var q = i")', "q"], 2],
        [
          "a var that `delete` removes again",
          ['eval("var q = 1")', "[typeof q, delete q, typeof q].join()"],
          "number,true,undefined",
        ],
      ])("declares %s in the session", async (_, lines, expected) => {
        expect(await lastOf(lines)).toBe(expected);
      });

      test.each<[string, string[], unknown]>([
        ["in a strict input", ['"use strict"; eval("var q = 1")', "typeof q"], "undefined"],
        ["in a function", ['function f() { eval("var q = 1"); return typeof q }; f() + typeof q'], "numberundefined"],
        ["for a `let`", ['eval("let q = 1")', "typeof q"], "undefined"],
        // The async function around the input is the scope of the eval, as in Node.js.
        ["beside a top-level await", ['await 1; eval("var q = 1")', "typeof q"], "undefined"],
      ])("keeps what it declares %s", async (_, lines, expected) => {
        expect(await lastOf(lines)).toBe(expected);
      });

      test("that is indirect declares in the session", async () => {
        expect(await lastOf(['(0, eval)("var q = 1")', "q"])).toBe(1);
      });
    });

    describe("a top-level function", () => {
      test("is the variable of its name: an assignment to it stays", async () => {
        expect(await lastOf(["function cnt() {}; cnt = 5", "cnt"])).toBe(5);
      });

      test("is declared before the input runs", async () => {
        expect(await lastOf(["throw 1; function late() {}", "typeof late"])).toBe("function");
      });
    });

    describe("the value of an input", () => {
      const run = (code: string, ctx = vm.createContext({})) => vm.runInContext(transpiler.transformSync(code), ctx);

      test("is undefined when the last statement is not an expression", () => {
        expect([
          run("1; function f() {}"),
          run("x = { value: 1 }; if (1) {}"),
          run("if (1) { Promise.resolve(5) }"),
          run("if (1) { 5 }"),
          run("if (1) { function f() {} }"),
          run("var x"),
        ]).toEqual([undefined, undefined, undefined, undefined, undefined, undefined]);
      });

      test("holds a promise or an object with a `value` as it is", async () => {
        const promise = run("Promise.resolve(5)");
        expect(Object.keys(promise)).toEqual(["value"]);
        expect(await promise.value).toBe(5);
        expect(run("({ value: 1 })")).toEqual({ value: { value: 1 } });
      });

      test("is what a top-level return gives", () => {
        expect([run("return 5"), run("if (1) { return 6 }"), run("var x = 1; return x + 6")]).toEqual([5, 6, 7]);
      });

      test("is the directive of a lone 'use strict'", () => {
        expect(run('"use strict"')).toEqual({ value: "use strict" });
      });
    });

    test("an input is wrapped in a function only for await, strict code or a return", () => {
      const wrapped = (code: string) => transpiler.transformSync(code).includes("=>");
      expect({
        expression: wrapped("1 + 1"),
        declarations: wrapped("var a = 1; let b = 2; const c = 3; function f() {} class C {}"),
        blockFunction: wrapped("if (1) { function w() {} }"),
        directEval: wrapped('eval("var q = 1")'),
        await: wrapped("await 1"),
        strict: wrapped('"use strict"; 1'),
        return: wrapped("return 1"),
        nestedReturn: wrapped("if (1) { return 1 }"),
        returnInFunction: wrapped("function f() { return 1 }"),
      }).toEqual({
        expression: false,
        declarations: false,
        blockFunction: false,
        directEval: false,
        await: true,
        strict: true,
        return: true,
        nestedReturn: true,
        returnInFunction: false,
      });
    });

    // A strict script that runs through an indirect eval keeps its `var`s to itself,
    // so the declarations of a strict input stay outside of the strict code.
    test.each([
      ["strict", '"use strict"; var a = 1; let b = 2; function f() {} class C {}'],
      ["sloppy", "var a = 1; let b = 2; function f() {} class C {}"],
    ])("the declarations of a %s input reach a context that runs the text with an indirect eval", (_, input) => {
      const ctx = vm.createContext({});
      vm.runInContext(`(0, eval)(${JSON.stringify(transpiler.transformSync(input))})`, ctx);
      expect([ctx.a, ctx.b, typeof ctx.f, typeof ctx.C]).toEqual([1, 2, "function", "function"]);
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
