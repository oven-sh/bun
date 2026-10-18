import { describe, expect, test } from "bun:test";
import { tempDir } from "harness";
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

  // The parser declares names of its own beside the input's: the temporaries of
  // a lowered class, the stack of a lowered `using`, the helpers it imports. It
  // prints the same names for every input.
  describe.each(["transformSync", "transform"] as const)("names the parser adds (%s)", method => {
    // A lowered input imports its helpers from "bun:wrap".
    const evalOptions = { importModuleDynamically: vm.constants.USE_MAIN_CONTEXT_DEFAULT_LOADER };
    // A field decorator: the field starts at its initial value plus `amount`.
    // A decorated field reads the temporaries of its class when an instance is made.
    const add = (amount: number) => () => (initial: number) => initial + amount;

    function replTranspiler(options: Bun.TranspilerOptions = {}) {
      const transpiler = new Bun.Transpiler({ loader: "tsx", replMode: true, ...options });
      return async (line: string) => await transpiler[method](line);
    }

    /** Evaluates the lines in one context. `added` are the names that the lines added to it. */
    async function runSession(
      lines: string[],
      { options, globals = {} }: { options?: Bun.TranspilerOptions; globals?: Record<string, unknown> } = {},
    ) {
      const transform = replTranspiler(options);
      const context = vm.createContext({ ...globals });
      const results: any[] = [];
      for (const line of lines) {
        const result = await vm.runInContext(await transform(line), context, evalOptions);
        results.push(result?.value ?? result);
      }
      return { results, added: Object.keys(context).filter(name => !Object.hasOwn(globals, name)) };
    }

    test("a lowered class keeps working after later inputs", async () => {
      const { results, added } = await runSession(
        [
          "class P { @add(100) v = 1 }",
          "class Q { @add(200) v = 2 }",
          "[new P().v, new Q().v]",
          "class A { accessor x = 1 }",
          "var a = new A()",
          "class B { accessor x = 2 }",
          "[a.x, new B().x]",
          "function tagged(value) { return class extends value { tag = value.name } }",
          "@tagged class R {}",
          "@tagged class S {}",
          "[new R().tag, new S().tag]",
        ],
        { globals: { add } },
      );
      expect({ fieldDecorators: results[2], accessors: results[6], classDecorators: results[10], added }).toEqual({
        fieldDecorators: [101, 202],
        accessors: [1, 2],
        classDecorators: ["R", "S"],
        added: ["P", "Q", "A", "a", "B", "tagged", "R", "S"],
      });
    });

    // Each input declares `K<n>`, a class expression with a decorated field,
    // and the other names listed.
    test.each([
      ["in a declaration", [], (n: number) => `var K${n} = class { @add(${n}00) x = ${n} }`],
      [
        "in a parameter default",
        ["f"],
        (n: number) => `function f${n}(C = class { @add(${n}00) x = ${n} }) { return C }; var K${n} = f${n}()`,
      ],
      [
        "in a field initializer",
        ["O"],
        (n: number) => `class O${n} { inner = class { @add(${n}00) x = ${n} } }; var K${n} = new O${n}().inner`,
      ],
      ["in the head of a loop", [], (n: number) => `for (var K${n} = class { @add(${n}00) x = ${n} };;) break`],
      // The temporaries of these three are registered in the scope of the enum (#38761).
      [
        "in an enum initializer in a block",
        [],
        (n: number) => `var K${n}; { enum E { A = (K${n} = class { @add(${n}00) x = ${n} }, 0) } }`,
      ],
      [
        "in an enum initializer in a namespace",
        ["N"],
        (n: number) =>
          `var K${n}; namespace N${n} { export enum E { A = (K${n} = class { @add(${n}00) x = ${n} }, 0) } }`,
      ],
      [
        "in an enum initializer in a function",
        ["h"],
        (n: number) =>
          `var K${n}; function h${n}() { enum E { A = (K${n} = class { @add(${n}00) x = ${n} }, 0) } }; h${n}()`,
      ],
    ])("a lowered class expression %s keeps working after a later input", async (_, names, input) => {
      const { results, added } = await runSession([input(1), input(2), "[new K1().x, new K2().x]"], {
        globals: { add },
      });
      expect({ values: results[2], added: added.sort() }).toEqual({
        values: [101, 202],
        added: ["K", ...names].flatMap(name => [name + 1, name + 2]).sort(),
      });
    });

    test("one output evaluated twice makes two classes", async () => {
      const transform = replTranspiler();
      const context = vm.createContext({ add, made: [] });
      const code = await transform("class K { @add(made.length * 100) x = 1 }; made.push(K); made.map(K => new K().x)");
      const first = await vm.runInContext(code, context, evalOptions);
      const second = await vm.runInContext(code, context, evalOptions);
      expect([first.value, second.value]).toEqual([[1], [1, 101]]);
    });

    test("an input that throws adds no name", async () => {
      const transform = replTranspiler();
      const context = vm.createContext({ add });
      const code = await transform(
        "class T { @add(1) x = 1; static thrown = (() => { throw new Error('thrown') })() }",
      );
      await expect((async () => await vm.runInContext(code, context, evalOptions))()).rejects.toThrow("thrown");
      expect(Object.keys(context)).toEqual(["add"]);
    });

    test("inputs that overlap dispose their own resources", async () => {
      const transform = replTranspiler();
      const log: string[] = [];
      const holding = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      const context = vm.createContext({ log, holding, release });
      const resource = (name: string) => `{ async [Symbol.asyncDispose]() { log.push("dispose ${name}") } }`;

      const first = vm.runInContext(
        await transform(
          `await using a = ${resource("a")}; holding.resolve(); await release.promise; log.push("first done")`,
        ),
        context,
        evalOptions,
      );
      // The first input holds `a` and waits. The second one runs to its end.
      await holding.promise;
      await vm.runInContext(
        await transform(`await using b = ${resource("b")}; log.push("second done")`),
        context,
        evalOptions,
      );
      release.resolve();
      await first;

      expect(log).toEqual(["second done", "dispose b", "first done", "dispose a"]);
      // `a` and `b` are the inputs' own names.
      expect(Object.keys(context).filter(name => name !== "a" && name !== "b")).toEqual(["log", "holding", "release"]);
    });

    test("a named import leaves a variable with the name of its module alone", async () => {
      const { results, added } = await runSession([
        'var import_node_path = "earlier"',
        'import { sep } from "node:path"; import_node_path',
        'import { join } from "node:path"; import_node_path = "assigned"',
        "import_node_path",
        // Declared in the input that imports, and two imports of one module in one input.
        'import { readFileSync } from "node:fs"; import { existsSync } from "node:fs"; var import_node_fs = "declared"',
        "[import_node_fs, typeof sep, typeof join, typeof readFileSync, typeof existsSync]",
      ]);
      expect({ read: results[1], assigned: results[3], declared: results[5], added }).toEqual({
        read: "earlier",
        assigned: "assigned",
        declared: ["declared", "string", "function", "function", "function"],
        added: ["import_node_path", "sep", "join", "readFileSync", "existsSync", "import_node_fs"],
      });
    });

    test("a function keeps the JSX runtime of its input", async () => {
      const runtime = (name: string) =>
        `export const jsxDEV = type => "${name}:" + type; export const jsx = jsxDEV, jsxs = jsxDEV;`;
      using dir = tempDir("repl-jsx-runtime", {
        "a/jsx-dev-runtime.js": runtime("a"),
        "a/jsx-runtime.js": runtime("a"),
        "b/jsx-dev-runtime.js": runtime("b"),
        "b/jsx-runtime.js": runtime("b"),
      });
      const source = (name: string) => `/** @jsxImportSource ${String(dir).replaceAll("\\", "/")}/${name} */`;
      const { results, added } = await runSession(
        [
          `${source("a")} function one() { return <a /> }`,
          `${source("b")} function two() { return <b /> }`,
          "[one(), two()]",
        ],
        { options: { autoImportJSX: true } },
      );
      expect({ values: results[2], added }).toEqual({ values: ["a:a", "b:b"], added: ["one", "two"] });
    });

    test("with tree shaking, a class stays where the input wrote it", async () => {
      const { results, added } = await runSession(
        [
          "42; class Last {}",
          "class Redeclared { static v = 1 }",
          "var old = Redeclared; class Redeclared { static v = 2 }; old.v",
          // The static block of this class calls a helper that the input imports.
          "class Lowered { static accessor x = 3 }; Lowered.x",
        ],
        { options: { treeShaking: true } },
      );
      expect({ last: results[0].name, redeclared: results[2], lowered: results[3], added: added.sort() }).toEqual({
        last: "Last",
        redeclared: 1,
        lowered: 3,
        added: ["Last", "Lowered", "Redeclared", "old"],
      });
    });

    test("every name the input declares persists beside a lowered class", async () => {
      const { results, added } = await runSession(
        [
          `class Lowered { @add(100) x = 1 }
           var v = 2; let l = 3; const c = 4;
           var { a, b: [, d, ...rest], ...others } = { a: 5, b: [0, 6, 7], e: 8 };
           var twice = 0; var twice = 19;
           function fn() { return 9 }
           async function afn() {}
           function* gen() {}
           class Cls { static v = 10 }
           abstract class Abs { static v = 11 }
           import def, { join, sep as separator } from "node:path";
           import * as ns from "node:path";
           import req = require("node:path");
           enum En { A = 12 }
           const enum ConstEn { A = 13 }
           namespace Ns { export const v = 14 }
           for (var i = 0; i < 15; i++);
           var merged; function merged() { return 16 }
           export const exported = 17;
           export class ExportedCls { static v = 18 }`,
          `[new Lowered().x, v, l, c, a, d, rest, others, fn(), typeof afn, typeof gen, Cls.v, Abs.v,
            def === ns.default, join === def.join, separator === def.sep, req === def,
            En.A, En[12], ConstEn.A, Ns.v, i, merged(), exported, ExportedCls.v, twice]`,
        ],
        { globals: { add, require } },
      );
      expect(results[1]).toEqual([
        ...[101, 2, 3, 4, 5, 6, [7], { e: 8 }, 9, "function", "function", 10, 11],
        ...[true, true, true, true],
        ...[12, "A", 13, 14, 15, 16, 17, 18, 19],
      ]);
      expect(added.sort()).toEqual(
        [
          ...["Lowered", "v", "l", "c", "a", "d", "rest", "others", "twice", "fn", "afn", "gen", "Cls", "Abs"],
          ...["def", "join", "separator", "ns", "req"],
          ...["En", "ConstEn", "Ns", "i", "merged", "exported", "ExportedCls"],
        ].sort(),
      );
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
