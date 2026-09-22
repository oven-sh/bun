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

  // transform() parses off the JS thread and makes its own source, so each case runs through both methods.
  describe.each(["transformSync", "transform"] as const)("object literal detection with %s()", method => {
    const transpiler = new Bun.Transpiler({ loader: "tsx", replMode: true });

    async function runRepl(code: string | Uint8Array, context?: object) {
      const ctx = vm.createContext(context ?? { console, Promise });
      const transformed = await transpiler[method](code);
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
      const code = await transpiler[method]("{foo: await bar()}");
      const result = await vm.runInContext(code, ctx);
      expect(result.value).toEqual({ foo: 42 });
    });

    test("{x: 1}; is NOT wrapped (has trailing semicolon)", async () => {
      // With semicolon, it's explicitly a block statement
      const code = await transpiler[method]("{x: 1};");
      // The output should NOT treat this as an object literal
      // It should be a block with a labeled statement, no value wrapper
      expect(code).not.toContain("value:");
      expect(code).toContain("x:");
    });

    test("whitespace around object literal is handled", async () => {
      const result = await runRepl("  { a: 1 }  ");
      expect(result.value).toEqual({ a: 1 });
    });

    test("Uint8Array input is parsed as object literal", async () => {
      expect(await runRepl(new TextEncoder().encode("{a: 1}"))).toEqual({ value: { a: 1 } });
    });
  });

  test.each(["{ a: 1 }", "{a: 1, b: 2}", "{foo: await bar()}", "  {}  ", "{x: 1};", "42"])(
    "transform(%j) returns the same code as transformSync()",
    async code => {
      const transpiler = new Bun.Transpiler({ loader: "ts", replMode: true });
      expect(await transpiler.transform(code)).toBe(transpiler.transformSync(code));
    },
  );

  test("scan() and scanImports() parse an object literal too", () => {
    const transpiler = new Bun.Transpiler({ loader: "tsx", replMode: true });
    // As a block statement, each input is a syntax error at the second ":".
    expect(transpiler.scan("{a: 1, b: 2}")).toEqual({ exports: [], imports: [] });
    expect(transpiler.scanImports("{a: 1, b: require('y')}")).toEqual([{ kind: "require-call", path: "y" }]);
  });

  test("every method reports a syntax error in an object literal at the same position", async () => {
    const transpiler = new Bun.Transpiler({ loader: "tsx", replMode: true });
    // The column and the line text count the added "(".
    const thrown = { name: "BuildMessage", message: "Unexpected }", line: 1, column: 7, lineText: "({ a: })" };
    const actual: Record<string, unknown> = {};
    for (const api of ["scan", "scanImports", "transformSync", "transform"] as const) {
      try {
        await transpiler[api]("{ a: }");
        actual[api] = "did not throw";
      } catch (e: any) {
        const { line, column, lineText } = e.position ?? {};
        actual[api] = { name: e.name, message: e.message, line, column, lineText };
      }
    }
    expect(actual).toEqual({ scan: thrown, scanImports: thrown, transformSync: thrown, transform: thrown });
  });

  // The heuristic is for JavaScript. A data loader reads the input as it is.
  test.each([
    ["json", '{"a":1}'],
    ["jsonc", '{"a":1}'],
    ["json5", '{"a":1}'],
    ["yaml", "{a: 1}"],
    ["text", "{hi}"],
    ["md", "{hi}"],
  ])("the %s loader does not get %j in parentheses", async (loader: any, code) => {
    const transpiler = new Bun.Transpiler({ replMode: true });
    const printed = new Bun.Transpiler().transformSync(code, loader);
    expect({
      transformSync: transpiler.transformSync(code, loader),
      transform: await transpiler.transform(code, loader),
    }).toEqual({ transformSync: printed, transform: printed });
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

    test("replMode false: every method parses { foo() } as a block", async () => {
      const transpiler = new Bun.Transpiler({ loader: "tsx" });
      // Wrapped in parentheses, this input is a syntax error.
      const code = "{ foo() }";
      const printed = "{\n  foo();\n}\n";
      expect({
        transformSync: transpiler.transformSync(code),
        transform: await transpiler.transform(code),
        scan: transpiler.scan(code),
        scanImports: transpiler.scanImports(code),
      }).toEqual({
        transformSync: printed,
        transform: printed,
        scan: { exports: [], imports: [] },
        scanImports: [],
      });
    });
  });
});
