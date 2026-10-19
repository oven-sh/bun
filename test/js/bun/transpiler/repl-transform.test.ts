import { describe, expect, test } from "bun:test";
import { isASAN, isDebug } from "harness";
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
      // In REPL mode, top-level `this` must survive the visit pass: the input
      // runs as a script, or in an arrow IIFE that inherits `this` from it.
      // Before the fix, it was rewritten to `exports`, which REPL input does
      // not bind, and blew up with `ReferenceError: exports is not defined`.
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

  // A sloppy input with no top-level await, import or return is the statements of a
  // script, not the body of a function. It declares what the same text declares as a script.
  describe("sloppy input as a script", () => {
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

    const redefinition = [
      "function rate() { return 3 }; function price(n) { return n * rate() }",
      "function rate() { return 5 }",
      "price(10)",
    ];

    describe("a top-level function", () => {
      test.each<[string, string[], unknown]>([
        ["is the one that a function of its input calls, after a new declaration", redefinition, 50],
        [
          "is the one that a function of its input calls, after an assignment",
          ["function a() { return b() }; function b() { return 1 }", "b = () => 2", "a()"],
          2,
        ],
        [
          "calls its replacement when it calls itself by name",
          [
            "var calls = 0; function fib(n) { calls++; return n < 2 ? n : fib(n - 1) + fib(n - 2) }",
            "var slow = fib, seen = new Map(); fib = n => seen.get(n) ?? (seen.set(n, slow(n)), seen.get(n))",
            "fib(20); calls",
          ],
          21,
        ],
        ["is the variable of its name: an assignment to it stays", ["function cnt() {}; cnt = 5", "cnt"], 5],
        ["is declared before its input runs", ["throw 1; function late() {}", "typeof late"], "function"],
      ])("%s", async (_, lines, expected) => {
        expect(await lastOf(lines)).toBe(expected);
      });

      // An input that runs in a function declares its functions in that function, and
      // copies each one out once. Node.js does the same for an input with `await`.
      test("beside a top-level await is a copy that a later declaration does not replace", async () => {
        const [first, ...rest] = redefinition;
        expect(await lastOf([`await 1; ${first}`, ...rest])).toBe(30);
      });

      test.failing("in a strict input is the one that a function of its input calls", async () => {
        const [first, ...rest] = redefinition;
        expect(await lastOf([`"use strict"; ${first}`, ...rest])).toBe(50);
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

      // These inputs run in a function, and that function is the scope of the eval.
      // Node.js loses the `var` beside a top-level await too.
      test.each<[string, string[]]>([
        ["in a strict input", ['"use strict"; eval("var q = 1")', "typeof q"]],
        ["beside a top-level await", ['await 1; eval("var q = 1")', "typeof q"]],
        ["beside a top-level return", ['if (0) return; eval("var q = 1")', "typeof q"]],
      ])("keeps what it declares %s", async (_, lines) => {
        expect(await lastOf(lines)).toBe("undefined");
      });
    });

    // The visit pass makes a plain function in a block a `let`, unless the block holds a
    // direct eval. Only a declaration gets its `var` from the engine (ECMA-262 Annex B.3.3).
    describe("a function in a block", () => {
      test("beside a direct eval in its block is a function in the next input", async () => {
        expect(await lastOf(['if (1) { eval("0"); function w() {} }', "typeof w"])).toBe("function");
        expect(await lastOf(['if (1) { function w() { return eval("1") } }', "typeof w"])).toBe("function");
      });

      // https://github.com/oven-sh/bun/issues/23633
      test.failing("with no direct eval in its block is a function in the next input", async () => {
        expect(await lastOf(["if (1) { function w() {} }", "typeof w"])).toBe("function");
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
          run("var x"),
        ]).toEqual([undefined, undefined, undefined, undefined, undefined]);
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
      const wrapped = (code: string) => /^\((async )?\(\) => \{$/m.test(transpiler.transformSync(code));
      expect({
        expression: wrapped("1 + 1"),
        declarations: wrapped("var a = 1; let b = 2; const c = 3; function f() {} class C {}"),
        directEval: wrapped('eval("var q = 1")'),
        returnInFunction: wrapped("function f() { return 1 }"),
        await: wrapped("await 1"),
        strict: wrapped('"use strict"; 1'),
        return: wrapped("return 1"),
        nestedReturn: wrapped("for (;;) { if (1) { return 1 } }"),
      }).toEqual({
        expression: false,
        declarations: false,
        directEval: false,
        returnInFunction: false,
        await: true,
        strict: true,
        return: true,
        nestedReturn: true,
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

    // node:vm mirrors only the first two writes of a global variable to the context
    // object, and a function declaration is one write:
    // https://github.com/oven-sh/bun/issues/45116
    test.failing("a function declared three times is the last one on the context object", () => {
      const ctx = vm.createContext({});
      for (const n of [1, 2, 3]) vm.runInContext(transpiler.transformSync(`function g() { return ${n} }`), ctx);
      expect([vm.runInContext("g()", ctx), ctx.g()]).toEqual([3, 3]);
    });

    // Seeded sessions of sloppy script code. Each input runs as written and as replMode
    // text, both as a script in this global. Both sessions must log and leave the same.
    // Replay a failure with BUN_REPL_FUZZ_SEED=<seed>.
    test("a session leaves the state that its inputs leave as written", () => {
      const seed = Number(process.env.BUN_REPL_FUZZ_SEED ?? 0x7265706c) >>> 0;
      const sessions = Number(process.env.BUN_REPL_FUZZ_ITERS ?? (isDebug || isASAN ? 30 : 150));
      const different: unknown[] = [];
      for (let i = 0; i < sessions; i++) {
        const inputs = generateSession(seed + i);
        const asWritten = runSession(inputs, `_w${i}`, input => input);
        const asRepl = runSession(inputs, `_r${i}`, input => transpiler.transformSync(input));
        if (asWritten !== asRepl) different.push({ seed: seed + i, inputs, asWritten, asRepl });
      }
      expect(different.slice(0, 3)).toEqual([]);
    });

    // F and G are the names a session declares, LOG is what it records, K is a new number.
    // A function in a block is not generated: see "a function in a block" above.
    function generateSession(seed: number): string[] {
      let state = seed >>> 0;
      const random = () => {
        state = (state + 0x6d2b79f5) | 0;
        let t = Math.imul(state ^ (state >>> 15), 1 | state);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
      const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)];
      let k = 0;
      const name = () => pick(["F", "G"]);
      const simple = (): string =>
        pick([
          () => `var ${name()} = ${++k}`,
          () => `var ${name()}`,
          () => `${name()} = ${++k}`,
          () => `LOG.push(typeof ${name()})`,
          () => `LOG.push(typeof globalThis.${name()})`,
          () => `LOG.push(typeof ${name()} === "function" ? ${name()}() : ${++k})`,
          () => `eval("var ${name()} = ${++k}")`,
          () => `eval("function ${name()}() { return ${++k} }")`,
          () => `eval("${name()} = ${++k}")`,
          () => `eval("LOG.push(typeof ${name()})")`,
          () => `(eval)("var ${name()} = ${++k}")`,
          () => `(0, eval)("var ${name()} = ${++k}")`,
          () => `((p = eval("var ${name()} = ${++k}")) => LOG.push(typeof ${name()}))()`,
          () => `(function () { eval("var ${name()} = ${++k}"); LOG.push(typeof ${name()}) })()`,
          () => `{ let B = ${++k}; eval("var ${name()} = B") }`,
        ])();
      const nested = (depth: number): string => {
        const list = () => statements(depth - 1, 2).join("; ");
        return pick([
          () => `{ ${list()} }`,
          () => `if (${pick([0, 1])}) { ${list()} } else { ${list()} }`,
          () => `try { ${list()}; ${pick(["", "throw 1"])} } catch (e) { ${list()} } finally { ${list()} }`,
          () =>
            `switch (${pick([0, 1, 2])}) { case 0: ${list()}; ${pick(["break", ""])}; case 1: ${list()}; default: ${list()} }`,
          () => `L: { ${list()}; ${pick(["break L", ""])}; ${list()} }`,
          () => `for (var I = 0; I < 2; I++) { ${list()} }`,
        ])();
      };
      const statements = (depth: number, max: number): string[] =>
        Array.from({ length: 1 + Math.floor(random() * max) }, () =>
          depth > 0 && random() < 0.3 ? nested(depth) : simple(),
        );
      const topLevel = (): string =>
        random() < 0.3
          ? pick([
              () => `function ${name()}() { return ${++k} }`,
              () => `function ${name()}() { return typeof ${name()} === "function" ? ${++k} : ${++k} }`,
              () => `throw ${++k}`,
            ])()
          : statements(2, 1)[0];
      return Array.from({ length: 1 + Math.floor(random() * 3) }, () =>
        ["void 0", ...Array.from({ length: 1 + Math.floor(random() * 4) }, topLevel)].join("; "),
      );
    }

    // Runs the inputs in this global under names that no other session uses. Gives the
    // errors, the log and the final F and G as one string.
    function runSession(inputs: string[], suffix: string, text: (input: string) => string): string {
      const evaluate = (source: string) => vm.runInThisContext(source.replace(/\b(F|G|LOG|I)\b/g, `$1${suffix}`));
      (globalThis as any)[`LOG${suffix}`] = [];
      const errors = inputs.map(input => {
        try {
          evaluate(text(input));
          return "";
        } catch (e) {
          return (e as Error)?.name ?? String(e);
        }
      });
      const final = ["F", "G"].map(name =>
        evaluate(
          `["${name}" in globalThis, typeof ${name} === "function" ? "fn" + ${name}() : typeof ${name} === "undefined" ? "undefined" : String(${name})].join()`,
        ),
      );
      const log = (globalThis as any)[`LOG${suffix}`].join();
      delete (globalThis as any)[`LOG${suffix}`];
      return JSON.stringify({ errors, log, final });
    }
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
