import { describe, expect, test } from "bun:test";
import vm from "node:vm";
import { knownDifferences, notStored, positions, replacesGlobal, stored, strict } from "./repl-block-function-rows";

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

  // In sloppy code a function declared in a block is also a `var` of its script
  // (ECMA-262 Annex B.3.3). A REPL input is such a script, so the function is a name
  // of the session once its declaration runs.
  describe("a function declared in a block", () => {
    const transpiler = new Bun.Transpiler({ loader: "tsx", replMode: true });

    /**
     * Runs the inputs in one new context, as `bun repl` runs its inputs in one global scope.
     * Gives the value of the last input, or "!Name" if it threw an error of that name.
     */
    async function lastOf(inputs: string[], transform: (input: string) => string | Promise<string>) {
      const context = vm.createContext({});
      let last: unknown;
      for (const input of inputs) {
        try {
          last = (await vm.runInContext(await transform(input), context))?.value;
        } catch (e) {
          last = `!${(e as Error).name}`;
        }
      }
      return last;
    }

    describe.each<[string, (input: string) => string | Promise<string>]>([
      ["of an input", input => transpiler.transformSync(input)],
      ["of an input that transform() prints", input => transpiler.transform(input)],
      // This input runs in an async wrapper function.
      ["of an input with a top-level await", input => transpiler.transformSync("await 0; " + input)],
    ])("%s", (_, transform) => {
      test.each(positions)("`%s` is a function in the next input", async input => {
        expect(await lastOf([input, "typeof f"], transform)).toBe("function");
      });

      test.each(stored)("%s", async (_, inputs, expected) => {
        expect(await lastOf(inputs, transform)).toBe(expected);
      });

      test.each(replacesGlobal)("%s is a function in the next input", async (_, inputs, expected) => {
        expect(await lastOf(inputs, transform)).toBe(expected);
      });

      test.each(notStored)("stays in its block %s", async (_, inputs, expected) => {
        expect(await lastOf(inputs, transform)).toBe(expected);
      });

      test.failing.each(knownDifferences)("%s", async (_, inputs, expected) => {
        expect(await lastOf(inputs, transform)).toBe(expected);
      });
    });

    test.each(strict)("stays in its block %s", async (_, inputs, expected) => {
      expect(await lastOf(inputs, input => transpiler.transformSync(input))).toBe(expected);
    });

    test("is declared in front of the wrapper and stored where it is declared", () => {
      const input = "if (c) { g(); function f() {} }";
      expect(transpiler.transformSync(input)).toBe(
        "var f;\n(() => {\n  if (c) {\n    let f = function() {};\n    g();\n    this.f = f;\n  }\n})();\n",
      );
      // Only a REPL input has a session to store to.
      expect(new Bun.Transpiler({ loader: "tsx" }).transformSync(input)).toBe(
        "if (c) {\n  let f = function() {};\n  g();\n}\n",
      );
    });

    // Statements that run their body once. Some of them bind `f` around it.
    const around: Record<string, (body: string) => string> = {
      "a block": body => `{ ${body} }`,
      "an if": body => `if (1) { ${body} }`,
      "an else": body => `if (0) {} else { ${body} }`,
      "a try": body => `try { ${body} } catch (e) {}`,
      "a catch": body => `try { throw 1 } catch (e) { ${body} }`,
      "a catch with no parameter": body => `try { throw 1 } catch { ${body} }`,
      "a catch (f)": body => `try { throw 1 } catch (f) { { ${body} } }`,
      "a catch ({ f })": body => `try { throw {} } catch ({ f }) { { ${body} } }`,
      "a finally": body => `try {} finally { ${body} }`,
      "a label": body => `l: { ${body} }`,
      "a switch case": body => `switch (0) { case 0: ${body} }`,
      "a block of a switch case": body => `switch (0) { default: { ${body} } }`,
      "a for": body => `for (var i = 0; i < 1; i++) { ${body} }`,
      "a for (var f)": body => `for (var f = 0; ; ) { ${body} break; }`,
      "a for (let f)": body => `for (let f = 0; ; ) { ${body} break; }`,
      "a for (let f of)": body => `for (let f of [0]) { ${body} }`,
      "a while": body => `while (1) { ${body} break; }`,
      "a do": body => `do { ${body} } while (0)`,
      "a with": body => `with ({}) { ${body} }`,
      "a block with let f": body => `{ let f; { ${body} } }`,
      "a block with const f": body => `{ const f = 0; { ${body} } }`,
      "a block with class f": body => `{ class f {} { ${body} } }`,
      "a block with var f": body => `{ var f; { ${body} } }`,
      "a block with an async function f": body => `{ async function f() {} { ${body} } }`,
      "a block with a generator f": body => `{ function* f() {} { ${body} } }`,
    };

    // The engine decides for a script whether `f` is a `var`, and stores the function when
    // its declaration runs. The input has to give the session the same.
    test.each(Object.keys(around))("in %s is stored as the engine stores it for a script", async outer => {
      const declaration = "globalThis.f = 0; function f() {} stored = typeof globalThis.f;";
      const observed = (nested: string) =>
        `var declared = Object.hasOwn(globalThis, "f"), stored; ${nested} [declared, stored].join()`;
      const run = async (text: () => string) => {
        try {
          const result = await vm.runInContext(text(), vm.createContext({}));
          return typeof result === "string" ? result : result.value;
        } catch {
          return "error";
        }
      };

      const differences: string[] = [];
      const shapes = [around[outer](declaration)];
      for (const inner of Object.values(around)) shapes.push(around[outer](inner(declaration)));
      for (const shape of shapes) {
        const script = await run(() => observed(shape));
        const input = await run(() => transpiler.transformSync(observed(shape)));
        if (input !== script) differences.push(`${shape}: ${input}, as a script: ${script}`);
      }
      const script = await run(() => observed(shapes[0]));
      const input = await run(() => transpiler.transformSync("await 0; " + observed(shapes[0])));
      if (input !== script) differences.push(`await 0; ${shapes[0]}: ${input}, as a script: ${script}`);

      expect(differences).toEqual([]);
    });
  });

  // The REPL runs every input in a sloppy function. An `await`, an `import` or an `export`
  // makes only a module strict code.
  describe("an input with a top-level await or an export", () => {
    const transpiler = new Bun.Transpiler({ loader: "tsx", replMode: true });

    test.each(["await 0; var yield = 5; yield", "export const e = 1; var yield = 5; yield"])(
      "`%s` is sloppy code",
      async input => {
        const result = await vm.runInContext(transpiler.transformSync(input), vm.createContext({}));
        expect(result).toEqual({ value: 5 });
      },
    );

    test("is strict code after a directive", () => {
      expect(() => transpiler.transformSync('"use strict"; await 0; var yield = 5; yield')).toThrow(
        '"yield" is a reserved word and cannot be used in strict mode',
      );
    });

    test("is strict code without replMode", () => {
      expect(() => new Bun.Transpiler({ loader: "tsx" }).transformSync("await 0; var yield = 5; yield")).toThrow(
        '"yield" is a reserved word and cannot be used in strict mode',
      );
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
