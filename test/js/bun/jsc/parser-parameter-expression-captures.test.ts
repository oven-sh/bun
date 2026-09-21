import { beforeEach, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// https://github.com/oven-sh/bun/issues/43569
//
// A parameter expression is evaluated outside of the environment of the function body's declarations. So a name in it
// that the body declares again is the variable from around the function. With one more function between that function
// and the one that declares the variable, JavaScriptCore's parser did not tell the declaring function that the variable
// is captured. The parameter expression then found no binding: it threw a ReferenceError, or it read or wrote a global
// or an import of the same name.

// What a parameter expression reads when it finds no binding. One of the tests writes it when the bug is there.
beforeEach(() => {
  (globalThis as any).local = "global";
});

describe("a parameter expression that uses a name the function body declares again", () => {
  // These functions go through Bun's transpiler. It inlines a `let` or `const` that holds a constant and removes the
  // declaration, which hides the bug. So the bodies here declare the name with `var` or as a function.
  test("arrow function in the body of an arrow function", () => {
    function f() {
      let local = 10;
      return () =>
        (b = local) => {
          var local = 7;
          return [b, local];
        };
    }
    expect(f()()()).toEqual([10, 7]);
  });

  test("function expression, method and constructor in the body of another function", () => {
    function f() {
      let local = 10;
      return {
        functionExpression: (() =>
          function (b = local) {
            var local = 7;
            return [b, local];
          })()(),
        method: (() => ({
          m(b = local) {
            var local = 7;
            return [b, local];
          },
        }))().m(),
        construct: (() =>
          new (class {
            b: unknown;
            constructor(b = local) {
              function local() {}
              this.b = [b, typeof local];
            }
          })().b)(),
      };
    }
    expect(f()).toEqual({
      functionExpression: [10, 7],
      method: [10, 7],
      construct: [10, "function"],
    });
  });

  test("a closure, a pattern and a later parameter in the parameters", () => {
    function f() {
      let local = 10;
      return (
        () =>
        (g = () => local, { p = local } = {}, [q = local] = [], r = () => s, s = local) => {
          var local = 7;
          return [g(), p, q, r(), local];
        }
      )()();
    }
    expect(f()).toEqual([10, 10, 10, 10, 7]);
  });

  test("an assignment writes the variable of the enclosing function", () => {
    function f() {
      let local = 1;
      const result = (
        () =>
        (b = (local = 10)) => {
          var local = 7;
          return [b, local];
        }
      )()();
      return [local, result];
    }
    expect(f()).toEqual([10, [10, 7]]);
    expect((globalThis as any).local).toBe("global");
  });

  test("a call in the temporal dead zone of the variable throws", () => {
    function f() {
      const g = (
        () =>
        (b = local) => {
          var local = 7;
          return [b, local];
        }
      )();
      let error: unknown;
      try {
        g();
      } catch (e) {
        error = e;
      }
      let local = 10;
      return [error, g()];
    }
    const [error, result] = f();
    expect(error).toBeInstanceOf(ReferenceError);
    expect(result).toEqual([10, 7]);
  });

  test("three functions in between, and a class field initializer in between", () => {
    function f() {
      let local = 10;
      const deep = (
        () =>
        () =>
        () =>
        (b = local) => {
          var local = 7;
          return [b, local];
        }
      )()()()();
      const field = (() =>
        new (class {
          field = (b = local) => {
            var local = 7;
            return [b, local];
          };
        })().field())();
      return [deep, field];
    }
    expect(f()).toEqual([
      [10, 7],
      [10, 7],
    ]);
  });

  // Text that goes to JavaScriptCore as it is.
  test.each([
    ["eval", (source: string) => (0, eval)(source)],
    ["new Function", (source: string) => new Function(`return ${source}`)()],
  ])("in text given to %s", (_, evaluate) => {
    const sources = [
      "(function () { let local = 10; return (() => (b = local) => { var local = 7; return b; })()(); })()",
      "(function () { const local = 10; return (function () { return (b = local) => { let local = 7; return b; }; })()(); })()",
      "(function () { var local = 10; return (() => function (b = local) { var local = 7; return b; })()(); })()",
      "(function (local) { return (() => ({ m(b = () => local) { const local = 7; return b(); } }).m)()(); })(10)",
      "(function () { try { throw 10; } catch (local) { return (() => (b = local) => { var local = 7; return b; })()(); } })()",
      "(function () { let local = 10; return ((a = (b = local) => { var local = 7; return b; }) => { var local = 8; return a(); })(); })()",
      // Nothing in between, no declaration in the body, and a generator: these always worked.
      "(function () { let local = 10; return ((b = local) => { var local = 7; return b; })(); })()",
      "(function () { let local = 10; return (() => (b = local) => { return b; })()(); })()",
      "(function () { let local = 10; return (() => function* (b = local) { var local = 7; yield b; })()().next().value; })()",
    ];
    expect(sources.map(source => [source, evaluate(source)])).toEqual(sources.map(source => [source, 10]));
  });

  test("does not read an import of the same name", async () => {
    using dir = tempDir("parameter-expression-captures", {
      "names.mjs": `export let shadowed = "imported";\n`,
      "main.mjs": `
        import { shadowed } from "./names.mjs";
        globalThis.moduleVariable = "global";
        let moduleVariable = 10;
        function enclosing() {
          let shadowed = 10;
          return () => (b = shadowed) => { var shadowed = 7; return b; };
        }
        console.log(JSON.stringify([
          enclosing()()(),
          (() => (b = moduleVariable) => { var moduleVariable = 7; return b; })()(),
          (() => (b = shadowed) => { var shadowed = 7; return b; })()(),
        ]));
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "main.mjs"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe(`[10,10,"imported"]\n`);
    expect(exitCode).toBe(0);
  });
});
