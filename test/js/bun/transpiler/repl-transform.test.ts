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
      expect(result).toEqual({ value: 42, variables: [], functions: "" });
    });

    test("arithmetic expression", async () => {
      const result = await runRepl("2 + 3 * 4");
      expect(result).toEqual({ value: 14, variables: [], functions: "" });
    });

    test("string expression", async () => {
      const result = await runRepl('"hello world"');
      expect(result).toEqual({ value: "hello world", variables: [], functions: "" });
    });

    test("object literal (auto-detected)", async () => {
      // Object literals don't need parentheses - the transpiler auto-detects them
      const result = await runRepl("{a: 1, b: 2}");
      expect(result).toEqual({ value: { a: 1, b: 2 }, variables: [], functions: "" });
    });

    test("array literal", async () => {
      const result = await runRepl("[1, 2, 3]");
      expect(result).toEqual({ value: [1, 2, 3], variables: [], functions: "" });
    });

    test("await expression", async () => {
      const result = await runRepl("await Promise.resolve(100)");
      expect(result).toEqual({ value: 100, variables: [], functions: "" });
    });

    test("await with variable", async () => {
      const ctx = vm.createContext({ Promise });
      const code1 = transpiler.transformSync("var x = await Promise.resolve(10)");
      await vm.runInContext(code1, ctx);
      expect(ctx.x).toBe(10);

      const code2 = transpiler.transformSync("x * 2");
      const result = await vm.runInContext(code2, ctx);
      expect(result).toEqual({ value: 20, variables: [], functions: "" });
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
      // It should be a block with a labeled statement and no completion value
      // (the wrapper's own `value` property stays undefined)
      expect(code).toContain("x:");
      const result = await runRepl("{x: 1};");
      expect("value" in result).toBe(true);
      expect(result).toEqual({ value: undefined, variables: [], functions: "" });
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
      expect(result).toEqual({ value: 3, variables: [], functions: "" });
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

  describe("result metadata", () => {
    const transpiler = new Bun.Transpiler({ loader: "tsx", replMode: true });

    async function runRepl(code: string, context?: object) {
      const ctx = vm.createContext(context ?? { console, Promise });
      return await vm.runInContext(transpiler.transformSync(code), ctx);
    }

    describe("variables", () => {
      test("lists declared names in source order", async () => {
        const result = await runRepl("var a = 1; let b = 2, c = 3; const d = await Promise.resolve(4)");
        expect(result.variables).toEqual(["a", "b", "c", "d"]);
      });

      test("destructuring declarations list every bound name", async () => {
        const result = await runRepl("const { a, b: [c, ...d], ...rest } = { a: 1, b: [2, 3], e: 4 }");
        expect(result.variables).toEqual(["a", "c", "d", "rest"]);
      });

      test("function and class declarations are listed", async () => {
        const result = await runRepl("function foo() {} class Bar {}");
        expect(result.variables).toEqual(["foo", "Bar"]);
      });

      test("duplicate declarations are listed once", async () => {
        const result = await runRepl("var x = 1; var x = 2; x");
        expect(result.value).toBe(2);
        expect(result.variables).toEqual(["x"]);
      });

      test("import bindings are listed, internal namespace refs are not", () => {
        const code = transpiler.transformSync('import def, { a, b as c } from "mod"; import * as ns from "other"');
        expect(code).toMatch(/variables: \["def",\s*"a",\s*"c",\s*"ns"\]/);
      });

      test("default + namespace import lists names in source order", () => {
        const code = transpiler.transformSync('import def, * as ns from "mod"');
        expect(code).toMatch(/variables: \["def",\s*"ns"\]/);
      });

      test("expression statements declare nothing", async () => {
        const result = await runRepl("1 + 2");
        expect(result).toEqual({ value: 3, variables: [], functions: "" });
      });
    });

    describe("functions", () => {
      test("captures replayable declarations that restore a fresh context", async () => {
        const result = await runRepl("function add(a, b) { return a + b } const base = 10; add(base, 5)");
        expect(result.value).toBe(15);
        expect(result.variables).toEqual(["add", "base"]);
        expect(result.functions).toContain("function add(a, b)");
        // Pure `const`/`let` declarations are re-printed as `var` so replaying
        // the source persists them onto a vm context.
        expect(result.functions).toContain("var base = 10");

        const fresh = vm.createContext({});
        vm.runInContext(result.functions, fresh);
        expect(vm.runInContext("add(base, 32)", fresh)).toBe(42);
      });

      test("classes are serialized as var assignments", async () => {
        const result = await runRepl("class Counter { constructor() { this.n = 3 } }");
        expect(result.functions).toContain("var Counter = class Counter");

        const fresh = vm.createContext({});
        vm.runInContext(result.functions, fresh);
        expect(vm.runInContext("new Counter().n", fresh)).toBe(3);
      });

      test("declarations with side effects are excluded", async () => {
        const ctx = vm.createContext({ effect: () => 123 });
        const code = transpiler.transformSync(
          "const pure = [1, 2]; const impure = effect(); function f() { return effect() }",
        );
        const result = await vm.runInContext(code, ctx);
        expect(result.variables).toEqual(["pure", "impure", "f"]);
        expect(result.functions).toContain("var pure = [1, 2]");
        expect(result.functions).toContain("function f()");
        expect(result.functions).not.toContain("impure");
      });

      test("declarations reading an excluded binding are excluded too", async () => {
        const ctx = vm.createContext({ effect: () => 41 });
        // `a` has a side effect, so `b` (which reads `a` when evaluated) and
        // `c` (which reads `b`) cannot be replayed; `copy` only reads `ok`.
        const code = transpiler.transformSync(
          "const ok = 1; let a = effect(); let b = a; let c = [b]; const copy = ok; b",
        );
        const result = await vm.runInContext(code, ctx);
        expect(result.value).toBe(41);
        expect(result.variables).toEqual(["ok", "a", "b", "c", "copy"]);
        expect(result.functions).toContain("var ok = 1");
        expect(result.functions).toContain("var copy = ok");
        expect(result.functions).not.toContain("var a =");
        expect(result.functions).not.toContain("var b =");
        expect(result.functions).not.toContain("var c =");

        // The whole string evaluates on an empty context.
        const fresh = vm.createContext({});
        vm.runInContext(result.functions, fresh);
        expect(vm.runInContext("copy", fresh)).toBe(1);
      });

      test("using declarations are never serialized", () => {
        // With `target: "bun"` a non-null `using` reaches the REPL transform
        // unlowered; replaying it as a plain `var` would drop its disposal
        // semantics, so it must not be captured even with a pure initializer.
        const bunTarget = new Bun.Transpiler({ loader: "tsx", replMode: true, target: "bun" });
        const code = bunTarget.transformSync("using res = { d: 1 }; 1");
        expect(code).toContain('functions: ""');
      });

      test("declaration-only input still returns the wrapper", async () => {
        const result = await runRepl("function later() { return 7 }");
        // No completion value, but `value` stays an own property and the
        // metadata is observable.
        expect("value" in result).toBe(true);
        expect(result.value).toBeUndefined();
        expect(result.variables).toEqual(["later"]);
        expect(result.functions).toContain("function later()");
      });

      test("TypeScript annotations are stripped from the printed source", async () => {
        const result = await runRepl("const n: number = 1; function id<T>(x: T): T { return x }");
        expect(result.functions).not.toContain(": number");
        expect(result.functions).not.toContain("<T>");
        expect(result.functions).toContain("var n = 1");
        expect(result.functions).toContain("function id(x)");
      });

      test("async transform() returns the same metadata as transformSync()", async () => {
        const code = await transpiler.transform("const q = 1; function g() {} q");
        const result = await vm.runInContext(code, vm.createContext({}));
        expect(result.value).toBe(1);
        expect(result.variables).toEqual(["q", "g"]);
        expect(result.functions).toContain("var q = 1");
        expect(result.functions).toContain("function g()");
      });
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
