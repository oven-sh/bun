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

  // An input that starts with "{" and does not end with ";" is an object literal if all of it is
  // one expression, and statements if it is not. Every input below starts that way.
  const wrapped = (value: string) => `(() => {\n  return {\n    __proto__: null,\n    value: ${value}\n  };\n})();\n`;

  /** What the four methods do with `code`. */
  async function everyMethod(transpiler: Bun.Transpiler, code: string | Uint8Array) {
    const results: Record<string, unknown> = {};
    for (const method of ["transformSync", "transform", "scan", "scanImports"] as const) {
      try {
        results[method] = await transpiler[method](code);
      } catch (e: any) {
        results[method] = {
          name: e.name,
          errors: (e.errors ?? [e]).map(({ message, position }: any) => ({
            message,
            line: position?.line,
            column: position?.column,
            lineText: position?.lineText,
          })),
        };
      }
    }
    return results;
  }

  const fromEveryMethod = (transformed: unknown, scanned: unknown, imports: unknown) => ({
    transformSync: transformed,
    transform: transformed,
    scan: scanned,
    scanImports: imports,
  });

  const noImports = { exports: [], imports: [] };
  const thrown = (error: object) => ({ name: "BuildMessage", errors: [error] });

  describe("an input that starts with {", () => {
    const transpiler = new Bun.Transpiler({ loader: "tsx", replMode: true });

    test.each([
      ["{ let x = 1; x }", "(() => {\n  {\n    let x = 1;\n    x;\n  }\n})();\n"],
      ["{ foo() }", "(() => {\n  {\n    foo();\n  }\n})();\n"],
      ["{ if (a) b }", "(() => {\n  {\n    if (a)\n      b;\n  }\n})();\n"],
      [
        "{ setup(); }\nrender()",
        `(() => {\n  {\n    setup();\n  }\n  return {\n    __proto__: null,\n    value: render()\n  };\n})();\n`,
      ],
      [
        "{a: 1}; 3",
        `(() => {\n  {\n    a:\n      1;\n  }\n  return {\n    __proto__: null,\n    value: 3\n  };\n})();\n`,
      ],
      ["{a: 1}\n{b: 2}", "(() => {\n  {\n    a:\n      1;\n  }\n  {\n    b:\n      2;\n  }\n})();\n"],
      // The REPL of Node.js v26 rejects this input. transform() and scanImports() took it before.
      ["{ await x; y }", "(async () => {\n  {\n    await x;\n    y;\n  }\n})();\n"],
      // The ";" at the end makes it statements: a block, then a comparison.
      [
        '{ a: 1 }["a"] === 1;',
        `(() => {\n  {\n    a:\n      1;\n  }\n  return {\n    __proto__: null,\n    value: ["a"] === 1\n  };\n})();\n`,
      ],
      // As one expression this assigns to the call `{}(x)`. It parses, and the visit pass rejects it.
      ["{}\n(x) = 1", `(() => {\n  {}\n  return {\n    __proto__: null,\n    value: x = 1\n  };\n})();\n`],
      // The expression reading logs a warning before it fails: in its parse pass, then in its visit pass.
      [
        "{}\n/a//*\n--> y\n*/\n1",
        `(() => {\n  {}\n  /a/;\n  return {\n    __proto__: null,\n    value: 1\n  };\n})();\n`,
      ],
      [
        "{}\n/[/*@jsxRuntime nope*/]/g.x = 1",
        `(() => {\n  {}\n  return {\n    __proto__: null,\n    value: /[/*@jsxRuntime nope*/]/g.x = 1\n  };\n})();\n`,
      ],
    ])("%j is a block", async (code, printed) => {
      expect(await everyMethod(transpiler, code)).toEqual(fromEveryMethod(printed, noImports, []));
    });

    test.each([
      ["{a: 1, b: 2}", "{ a: 1, b: 2 }"],
      ["{a, b}", "{ a, b }"],
      ["{}", "{}"],
      ["{a: 1}.a", "{ a: 1 }.a"],
      ['{ a: 1 }["a"] === 1', '{ a: 1 }["a"] === 1'],
      ["{a, b} = obj", "{ a, b } = obj"],
      // The comment is not part of the expression. In the REPL of Node.js v26 this input is a block.
      ["{a: 1} // note", "{ a: 1 }"],
      ["{a: 1, b: 2} // note", "{ a: 1, b: 2 }"],
    ])("%j is an object literal", async (code, value) => {
      expect(await everyMethod(transpiler, code)).toEqual(fromEveryMethod(wrapped(value), noImports, []));
    });

    test.each(["{ foo() }", "{a: 1, b: 2}", "{ a: }"])("%j as bytes is read like the string", async code => {
      const asString = await everyMethod(transpiler, code);
      expect(Object.keys(asString)).toHaveLength(4);
      expect(await everyMethod(transpiler, new TextEncoder().encode(code))).toEqual(asString);
    });

    test("a legal comment in an object literal is printed after it", async () => {
      const printed = wrapped("{ a: 1, b: 2 }").replace("  };\n", "  };\n  /*! x */\n");
      expect(await everyMethod(transpiler, "{a: 1, /*! x */ b: 2}")).toEqual(fromEveryMethod(printed, noImports, []));
    });

    test("scanImports() returns each require() once", async () => {
      const imports = [{ kind: "require-call", path: "x" }];
      expect({
        // An object literal up to "b()", where it stops being one.
        block: await everyMethod(transpiler, "{ a: require('x'), b() }"),
        object: await everyMethod(transpiler, "{ a: require('x'), b }"),
      }).toEqual({
        block: fromEveryMethod(`(() => {\n  {\n    a:\n      require("x"), b();\n  }\n})();\n`, noImports, imports),
        object: fromEveryMethod(wrapped(`{ a: require("x"), b }`), noImports, imports),
      });
    });

    // The input is not an expression and not statements. The error is the one of the statements,
    // and its position is a position in the input.
    test.each([
      ["{ a: }", { message: "Unexpected }", line: 1, column: 6, lineText: "{ a: }" }],
      ["{a: 1, b: }", { message: 'Expected ";" but found ":"', line: 1, column: 9, lineText: "{a: 1, b: }" }],
      ["{ let x = ; }", { message: "Unexpected ;", line: 1, column: 11, lineText: "{ let x = ; }" }],
      ["{a:1}) + (2", { message: "Unexpected )", line: 1, column: 6, lineText: "{a:1}) + (2" }],
      ["{ a: 1 }.a;", { message: "Unexpected .", line: 1, column: 9, lineText: "{ a: 1 }.a;" }],
      ["{", { message: "Unexpected end of file", line: 1, column: 1, lineText: "{" }],
      ["{ let x = 1;", { message: "Unexpected end of file", line: 1, column: 12, lineText: "{ let x = 1;" }],
    ])("%j is a syntax error", async (code, error) => {
      expect(await everyMethod(transpiler, code)).toEqual(fromEveryMethod(thrown(error), thrown(error), thrown(error)));
    });

    // The input ends inside an object literal. The error is the one of the expression, so that
    // a caller that reads input line by line finds "end of file" in it.
    test.each([
      ["{ a: 1, b: 2", { message: 'Expected "}" but found end of file', line: 1, column: 12 }],
      ['{\n  name: { first: "a" },', { message: "Expected identifier but found end of file", line: 2, column: 23 }],
      ["{\n  run() { return 1 },", { message: "Expected identifier but found end of file", line: 2, column: 21 }],
      ["{\n  get x() { return 1 },", { message: "Expected identifier but found end of file", line: 2, column: 23 }],
      ["{\n  ...a,", { message: "Expected identifier but found end of file", line: 2, column: 7 }],
      ["{\n  default: 1,", { message: "Expected identifier but found end of file", line: 2, column: 13 }],
      ['{\n  "a": { "b": 1 },', { message: "Expected identifier but found end of file", line: 2, column: 18 }],
    ])("%j is an unfinished object literal", async (code, error) => {
      const unfinished = thrown({ ...error, lineText: code.slice(code.lastIndexOf("\n") + 1) });
      expect(await everyMethod(transpiler, code)).toEqual(fromEveryMethod(unfinished, unfinished, unfinished));
    });

    test("an object literal that only the visit pass rejects keeps its own error", async () => {
      const code = "{a: () => { const c = 1; c = 2 }, b: 2}";
      const rejected = thrown({
        message: 'Cannot assign to "c" because it is a constant',
        line: 1,
        column: 26,
        lineText: code,
      });
      // scanImports() has no visit pass.
      expect(await everyMethod(transpiler, code)).toEqual(fromEveryMethod(rejected, rejected, []));
    });

    test("scanImports() reads an expression that only the visit pass rejects", async () => {
      // As one expression this is two divisions, and the visit pass rejects the assignment to
      // them. As statements it is a block, and an assignment to a property of a regular expression.
      const code = "{}\n/require('a')/g.x = 1";
      const printed = `(() => {\n  {}\n  return {\n    __proto__: null,\n    value: /require('a')/g.x = 1\n  };\n})();\n`;
      expect(await everyMethod(transpiler, code)).toEqual(
        fromEveryMethod(printed, noImports, [{ kind: "require-call", path: "a" }]),
      );
    });

    test("a comment that only the expression reading sees does not set the JSX runtime", async () => {
      // As one expression, the text between the slashes is an array with a comment in it.
      const code = "{}\n/[/*@jsxRuntime classic*/]/g.x = <div/>";
      const plain = new Bun.Transpiler({ loader: "tsx" }).transformSync(code);
      const assignment = plain.slice("{}\n".length, -";\n".length);
      expect(assignment).toStartWith("/[/*@jsxRuntime classic*/]/g.x = jsxDEV");
      const printed = `(() => {\n  {}\n  return {\n    __proto__: null,\n    value: ${assignment}\n  };\n})();\n`;
      expect({
        transformSync: transpiler.transformSync(code),
        transform: await transpiler.transform(code),
      }).toEqual({ transformSync: printed, transform: printed });
    });
  });

  describe.each(["js", "jsx", "ts"] as const)("an input that starts with { (%s loader)", loader => {
    const transpiler = new Bun.Transpiler({ loader, replMode: true });

    test("is a block, an object literal or a syntax error", async () => {
      const error = { message: "Unexpected }", line: 1, column: 6, lineText: "{ a: }" };
      expect({
        block: await everyMethod(transpiler, "{ foo() }"),
        object: await everyMethod(transpiler, "{a: 1, b: 2}"),
        error: await everyMethod(transpiler, "{ a: }"),
      }).toEqual({
        block: fromEveryMethod("(() => {\n  {\n    foo();\n  }\n})();\n", noImports, []),
        object: fromEveryMethod(wrapped("{ a: 1, b: 2 }"), noImports, []),
        error: fromEveryMethod(thrown(error), thrown(error), thrown(error)),
      });
    });
  });

  test("a block with a decorated class prints as it does without replMode", async () => {
    const tsconfig = { compilerOptions: { experimentalDecorators: true, emitDecoratorMetadata: true } };
    const code = "{ foo(); class A { @dec x: Foo } }";
    const transpiler = new Bun.Transpiler({ loader: "ts", replMode: true, tsconfig });
    const printed = transpiler.transformSync(code);
    // Without replMode: the import of the decorator helpers, then the block.
    const plain = new Bun.Transpiler({ loader: "ts", tsconfig }).transformSync(code);
    const block = plain.slice(plain.indexOf("\n{\n") + 1);
    expect(block).toStartWith("{\n  foo();\n");
    expect(printed).toContain(block.replace(/^(?=.)/gm, "  "));
    expect(await transpiler.transform(code)).toBe(printed);
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

    test.each(["js", "jsx", "ts", "tsx"] as const)(
      "replMode false: no method of the %s loader reads an object literal",
      async loader => {
        const transpiler = new Bun.Transpiler({ loader });
        for (const code of ["{a: 1, b: 2}", "{a: 1, b: require('y')}"]) {
          const error = { message: 'Expected ";" but found ":"', line: 1, column: 9, lineText: code };
          expect(await everyMethod(transpiler, code)).toEqual(
            fromEveryMethod(thrown(error), thrown(error), thrown(error)),
          );
        }
      },
    );
  });
});
