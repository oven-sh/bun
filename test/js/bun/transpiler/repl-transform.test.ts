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
      // The declaration stands in front of the async wrapper
      expect(result).toStartWith("function foo() {\n  return 42;\n}\n(async () => {");
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

  describe("function declarations", () => {
    const transpiler = new Bun.Transpiler({ loader: "tsx", replMode: true });

    async function runReplSession(lines: string[]) {
      const ctx = vm.createContext({ console, Promise });
      const results: any[] = [];
      for (const line of lines) {
        const result = await vm.runInContext(transpiler.transformSync(line), ctx);
        results.push(result?.value);
      }
      return results;
    }

    test("a declaration is printed in front of the wrapper", async () => {
      const code = "var before = add(1, 2); function add(a, b) { return a + b }; before";
      const expected = `var before;
function add(a, b) {
  return a + b;
}
(() => {
  before = add(1, 2);
  return {
    __proto__: null,
    value: before
  };
})();
`;
      expect(transpiler.transformSync(code)).toBe(expected);
      expect(await transpiler.transform(code)).toBe(expected);
    });

    test("a declaration beside an import is printed in front of the async wrapper", () => {
      expect(transpiler.transformSync(`import { sep } from "node:path"; function f() { return sep }`)).toBe(
        `var import_node_path;
var sep;
function f() {
  return sep;
}
(async () => {
  import_node_path = await import("node:path");
  sep = import_node_path.sep;
})();
`,
      );
    });

    test("a `var` of a body without braces and of a `for` head is declared in front of the wrapper", () => {
      expect(
        transpiler.transformSync("if (1) var a = 1; for (var b; !b; ) b = 2; function f() { return a + b }; f()"),
      ).toBe(
        `var a;
var b;
function f() {
  return a + b;
}
(() => {
  if (1)
    a = 1;
  for (;!b; )
    b = 2;
  return {
    __proto__: null,
    value: f()
  };
})();
`,
      );
    });

    test("a function is assigned inside the wrapper when direct eval can declare a `var` there", () => {
      expect(transpiler.transformSync(`eval("var q = 1"); function readQ() { return q }; readQ()`)).toBe(
        `var readQ;
(() => {
  readQ = function() {
    return q;
  };
  eval("var q = 1");
  return {
    __proto__: null,
    value: readQ()
  };
})();
`,
      );
    });

    test("a function of a strict input is assigned inside the strict wrapper", () => {
      expect(transpiler.transformSync(`"use strict"; function strictFn() { return this }`)).toBe(
        `var strictFn;
(() => {
  "use strict";
  strictFn = function() {
    return this;
  };
})();
`,
      );
    });

    test("the declarations of a strict input persist under indirect eval", () => {
      const evaluate = (code: string) => (0, eval)(transpiler.transformSync(code));
      try {
        evaluate(`"use strict"; var replStrictVar = 1; function replStrictFn() { return this === undefined }`);
        expect(evaluate("[replStrictVar, replStrictFn()]").value).toEqual([1, true]);
      } finally {
        delete (globalThis as any).replStrictVar;
        delete (globalThis as any).replStrictFn;
      }
    });

    test.each(["", "await 0; "])("a function is one binding across vm.runInContext calls (prefix %j)", async prefix => {
      const results = await runReplSession([
        `${prefix}function g() {}; g = 3`,
        "typeof g",
        `${prefix}function first() { return second() }; function second() { return 1 }`,
        "function second() { return 2 }",
        "first()",
        "function caller() { return helper() }",
        `${prefix}var early = caller(); function helper() { return 1 }`,
        "early",
        `${prefix}var seen = typeof globalThis.late; function late() {}`,
        "seen",
        // Assigned inside the wrapper: the function reads the `var` that `eval` declares there.
        `${prefix}eval("var q = 1"); function readQ() { return q }; readQ = (inner => () => inner() + 10)(readQ)`,
        "readQ()",
        `${prefix}"use strict"; function strictFn() { return this === undefined }`,
        "strictFn()",
      ]);
      expect([results[1], results[4], results[7], results[9], results[11]]).toEqual(["number", 2, 1, "function", 11]);
      // With the prefix the string is not the first statement, so it is no directive.
      expect(results[13]).toBe(prefix === "");
    });

    // Each input declares a binding beside a function. The same text runs as a plain script in a second context, and both must answer the same.
    test.each(["", "await 0; "])(
      "an input with a function gives what its text gives as a script (prefix %j)",
      async prefix => {
        type Form = { stmt: (b: string) => string; script?: (b: string) => string; read?: (b: string) => string };
        const call = (b: string) => `${b}()`;
        const variables: Form[] = [
          { stmt: b => `var ${b} = 1` },
          { stmt: b => `var { ${b} } = { ${b}: 1 }` },
          { stmt: b => `if (1) var ${b} = 1` },
          { stmt: b => `if (0) ; else var ${b} = 1` },
          { stmt: b => `{ var ${b} = 1 }` },
          { stmt: b => `for (var ${b} = 1; ; ) break` },
          { stmt: b => `for (var ${b}; ; ) { ${b} = 1; break }` },
          { stmt: b => `for (var ${b} in { k: 1 }) ;` },
          { stmt: b => `for (var ${b} of [1]) ;` },
          { stmt: b => `while (typeof ${b} !== "number") var ${b} = 1` },
          { stmt: b => `do var ${b} = 1; while (false)` },
          { stmt: b => `try { throw 0 } catch { var ${b} = 1 }` },
          { stmt: b => `switch (1) { case 1: var ${b} = 1 }` },
          { stmt: b => `lbl: var ${b} = 1` },
          { stmt: b => `${b} = 1` },
        ];
        const functions: Form[] = [
          { stmt: b => `function ${b}() { return 1 }`, read: call },
          { stmt: b => `function* ${b}() { yield 1 }`, read: b => `[...${b}()][0]` },
        ];
        // A script rejects these beside a function of the same name, or has no `export`.
        const readOnly: Form[] = [
          { stmt: b => `let ${b} = 1` },
          { stmt: b => `export var ${b} = 1`, script: b => `var ${b} = 1` },
          { stmt: b => `export function ${b}() { return 1 }`, script: b => `function ${b}() { return 1 }`, read: call },
          {
            stmt: b => `export default function ${b}() { return 1 }`,
            script: b => `function ${b}() { return 1 }`,
            read: call,
          },
        ];
        type Relation = {
          input: (stmt: string, b: string, read: string, f: string) => string;
          next?: (b: string, f: string) => string;
          probes: (b: string, f: string) => string[];
        };
        const show = (b: string) => `typeof ${b} == "function" ? "function" : ${b}`;
        const reads: Relation[] = [
          {
            input: (stmt, b, read, f) => `${stmt}; function ${f}() { return ${read} }`,
            next: b => `${b} = () => 7`,
            probes: (b, f) => [show(b), `typeof ${f}()`, `${f}.name`],
          },
          {
            input: (stmt, b, read, f) =>
              `var t${f} = typeof ${f}; ${stmt}; var r${f} = ${f}(); function ${f}() { return ${read} }`,
            probes: (b, f) => [`t${f}`, `r${f}`, `${f}()`],
          },
          {
            input: (stmt, b, read, f) => `${stmt}; function ${f}() { ${b} = 2 }`,
            next: (b, f) => `${f}()`,
            probes: b => [show(b)],
          },
        ];
        const names: Relation[] = [
          {
            input: (stmt, b) => `function ${b}() { return "function" }; ${stmt}`,
            next: b => `function ${b}() { return "again" }`,
            probes: b => [`typeof ${b} == "function" ? String(${b}()) : ${b}`],
          },
          {
            input: (stmt, b) => `${stmt}; function ${b}() { return "function" }`,
            probes: b => [`typeof ${b} == "function" ? String(${b}()) : ${b}`],
          },
        ];

        const session = vm.createContext({});
        const script = vm.createContext({});
        const answers = async (context: object, code: string, probes: string[]) => {
          const out: string[] = [];
          for (const expr of [code, ...probes]) {
            try {
              out.push(String(await vm.runInContext(expr, context)));
            } catch (e) {
              out.push((e as Error).name);
            }
          }
          return out.slice(1);
        };
        const differ: object[] = [];
        let rows = 0;
        const run = async (form: Form, relation: Relation) => {
          const b = `b${rows}`;
          const f = `f${rows++}`;
          const read = (form.read ?? (b => b))(b);
          const steps = [
            [
              prefix + relation.input(form.stmt(b), b, read, f),
              relation.input((form.script ?? form.stmt)(b), b, read, f),
            ],
          ];
          if (relation.next) steps.push([relation.next(b, f), relation.next(b, f)]);
          const got: string[][] = [];
          const want: string[][] = [];
          for (const [input, text] of steps) {
            // The `;` keeps an input that starts with `{` from being read as an object literal.
            got.push(await answers(session, transpiler.transformSync(input + ";"), relation.probes(b, f)));
            want.push(await answers(script, text + ";", relation.probes(b, f)));
          }
          if (JSON.stringify(got) !== JSON.stringify(want)) differ.push({ input: steps[0][0], got, want });
        };
        for (const relation of reads) {
          for (const form of [...variables, ...functions, ...readOnly]) await run(form, relation);
        }
        for (const relation of names) {
          for (const form of [...variables, ...functions]) await run(form, relation);
        }
        expect(differ).toEqual([]);
        expect(rows).toBe(3 * 21 + 2 * 17);
      },
    );

    test("minify.identifiers keeps the name of a function", () => {
      const minifying = new Bun.Transpiler({ loader: "tsx", replMode: true, minify: { identifiers: true } });
      const ctx = vm.createContext({});
      vm.runInContext(minifying.transformSync("function addNumbers(first, second) { return first + second }"), ctx);
      vm.runInContext(
        minifying.transformSync(`eval("0"); function subNumbers(first, second) { return first - second }`),
        ctx,
      );
      expect(vm.runInContext("[addNumbers(5, 3), subNumbers(5, 3)]", ctx)).toEqual([8, 2]);
    });
  });

  describe("export statements", () => {
    const transpiler = new Bun.Transpiler({ loader: "tsx", replMode: true });

    test("an exported function is declared like the plain one", () => {
      const plain = transpiler.transformSync("function f() { return 1 }");
      expect(plain).toBe(`function f() {
  return 1;
}
(() => {})();
`);
      expect(transpiler.transformSync("export function f() { return 1 }")).toBe(plain);
      expect(transpiler.transformSync("export default function f() { return 1 }")).toBe(plain);
      expect(transpiler.transformSync("function f() { return 1 }; export { f as g }")).toBe(plain);
    });

    test("a default export without a name is the value of the input", () => {
      const value = (expr: string) => `(() => {
  return {
    __proto__: null,
    value: ${expr}
  };
})();
`;
      expect(transpiler.transformSync("export default 1 + 1")).toBe(value("1 + 1"));
      expect(transpiler.transformSync("export default function () {}")).toBe(value("function() {}"));
      expect(transpiler.transformSync("export default class {}")).toBe(value("class {\n    }"));
    });

    test("a re-export imports its module", () => {
      expect(transpiler.transformSync(`export * from "a"; export { b } from "b"; export * as c from "c"`)).toBe(
        `(async () => {
  await import("a");
  await import("b");
  return {
    __proto__: null,
    value: await import("c")
  };
})();
`,
      );
    });

    test("exported declarations persist across vm.runInContext calls", async () => {
      const ctx = vm.createContext({});
      for (const line of [
        "export function f() { return 1 }",
        "export default function d() { return 2 }",
        "export default class K { static n = 3 }",
        "export const c = 4; export { c as renamed }",
      ]) {
        vm.runInContext(transpiler.transformSync(line), ctx);
      }
      expect(vm.runInContext("[f(), d(), K.n, c]", ctx)).toEqual([1, 2, 3, 4]);
    });
  });

  describe("import statements", () => {
    const transpiler = new Bun.Transpiler({ loader: "tsx", replMode: true });

    test("the default beside a namespace import is declared and assigned", () => {
      expect(transpiler.transformSync(`import d, * as ns from "./m.mjs"`)).toBe(
        `var d;
var ns;
(async () => {
  ns = await import("./m.mjs");
  return {
    __proto__: null,
    value: d = ns.default
  };
})();
`,
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
