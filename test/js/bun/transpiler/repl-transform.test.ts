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
