import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";

// A sloppy direct eval in a parameter expression (a default value, or a key or a default inside a pattern) declares its
// vars and functions in the environment of the called function (FunctionDeclarationInstantiation, step 20).
// JavaScriptCore declared them in the code around the function: in the enclosing function, in the CommonJS module
// wrapper, or on the global object.
//
// This file is a module, which is strict mode code. So the programs here run through an indirect eval, `new Function`,
// `node:vm`, or a CommonJS file. All of those are sloppy mode code.

// Runs `source` as sloppy global code and returns its completion value. The program must leave no global behind.
function sloppy(source: string): unknown {
  const before = new Set(Object.getOwnPropertyNames(globalThis));
  try {
    return (0, eval)(source);
  } finally {
    const added = Object.getOwnPropertyNames(globalThis).filter(name => !before.has(name));
    for (const name of added) delete (globalThis as any)[name];
    expect(added).toEqual([]);
  }
}

describe("a sloppy direct eval in a parameter expression declares its var in the called function", () => {
  test("the global object does not get the var", () => {
    const rows = {
      "arrow function": `var evalParamArrow = (p = eval("var evalParamQ1 = 1")) => 0; evalParamArrow(); typeof evalParamQ1`,
      "function": `function evalParamFunction(p = eval("var evalParamQ2 = 1")) { return 0 } evalParamFunction(); typeof evalParamQ2`,
      "method": `({ m(p = eval("var evalParamQ3 = 1")) {} }).m(); typeof evalParamQ3`,
      "arrow function body (an eval that was always right)": `var evalBodyArrow = () => { eval("var evalParamQ4 = 1") }; evalBodyArrow(); typeof evalParamQ4`,
    };
    const results: Record<string, unknown> = {};
    for (const [name, source] of Object.entries(rows)) results[name] = vm.runInThisContext(source);
    const leaked = ["evalParamQ1", "evalParamQ2", "evalParamQ3", "evalParamQ4"].filter(name => name in globalThis);
    for (const name of leaked) Reflect.deleteProperty(globalThis, name);
    expect({ results, leaked }).toEqual({
      results: {
        "arrow function": "undefined",
        "function": "undefined",
        "method": "undefined",
        "arrow function body (an eval that was always right)": "undefined",
      },
      leaked: [],
    });
  });

  test.each([
    ["function expression", `(function (PARAMETERS) { return VALUE; })()`],
    ["named function expression", `(function named(PARAMETERS) { return VALUE; })()`],
    ["arrow function", `((PARAMETERS) => VALUE)()`],
    ["method", `({ method(PARAMETERS) { return VALUE; } }).method()`],
    ["generator", `(function* (PARAMETERS) { yield VALUE; })().next().value`],
    ["new Function", "new Function(`PARAMETERS`, `return VALUE;`)()"],
  ])("the function sees the var, the code around it does not: %s", (_, kind) => {
    // The body reads the var, and so do a closure and an eval of the body.
    const value = `[typeof x, (() => typeof x)(), eval("typeof x")]`;
    for (const parameters of [
      `p = eval("var x = 1")`,
      `o, p = eval("var x = 1")`,
      `{ a = eval("var x = 1") } = {}`,
      `[a = eval("var x = 1")] = []`,
      `{ [eval("var x = 1; 'key'")]: a } = {}`,
      `...[a = eval("var x = 1")]`,
      `{} = eval("var x = 1; ({})")`,
    ]) {
      expect(sloppy(kind.replace("PARAMETERS", parameters).replace("VALUE", value))).toEqual([
        "number",
        "number",
        "number",
      ]);
    }
    // A function declaration of the eval code stays inside as well.
    expect(sloppy(kind.replace("PARAMETERS", `p = eval("function x() {}")`).replace("VALUE", "typeof x"))).toBe(
      "function",
    );
  });

  test("async functions", () => {
    const results = sloppy(`(function () {
      var results = {};
      (async function (p = eval("var x = 1")) { results.withoutAwait = typeof x; })();
      (async function (p = eval("var x = 1")) { results.withAwait = typeof x; await 0; })();
      (async (p = eval("var x = 1")) => { results.arrow = typeof x; await 0; })();
      (async function* (p = eval("var x = 1")) { results.generator = typeof x; yield 0; })().next();
      results.around = eval("typeof x");
      return results;
    })()`);
    expect(results).toEqual({
      withoutAwait: "number",
      withAwait: "number",
      arrow: "number",
      generator: "number",
      around: "undefined",
    });
  });

  test("every call has its own var, and it can be deleted", () => {
    expect(
      sloppy(
        `(function () { function f(declare, p = declare && eval("var x = 1")) { return typeof x; } return [f(true), f(false)]; })()`,
      ),
    ).toEqual(["number", "undefined"]);
    expect(
      sloppy(
        `(function () { var g = (p = eval("var x"), read = () => typeof x) => { var before = read(); x = 9; return before; }; return [g(), g()]; })()`,
      ),
    ).toEqual(["undefined", "undefined"]);
    expect(
      sloppy(`(function (p = eval("var x = 1"), read = () => typeof x) { return [delete x, read()]; })()`),
    ).toEqual([true, "undefined"]);
  });

  test("closures of the parameters see the var, and the body's own declaration is another one", () => {
    expect(sloppy(`(function (a = () => typeof x, b = eval("var x = 1")) { return a(); })()`)).toBe("number");
    expect(sloppy(`(function (a = eval("var x = 1"), b = () => x) { var x = 2; return [b(), x]; })()`)).toEqual([1, 2]);
    expect(sloppy(`((a = eval("var x = 1"), b = () => x) => { let x = 2; return [b(), x]; })()`)).toEqual([1, 2]);
  });

  test("the code around the function keeps its own bindings", () => {
    const around = (declaration: string, callee: string) =>
      sloppy(`(function () { ${declaration}; var f = ${callee}; return [f(), x]; })()`);
    const functionCallee = `function (a = eval("var x = 'inner'"), b = () => x) { return b(); }`;
    const arrowCallee = `(a = eval("var x = 'inner'"), b = () => x) => b()`;
    expect(around(`var x = "outer"`, functionCallee)).toEqual(["inner", "outer"]);
    expect(around(`var x = "outer"`, arrowCallee)).toEqual(["inner", "outer"]);
    // A `let` around the function was a false "duplicate variable" SyntaxError. So was the name of the function.
    expect(around(`let x = "outer"`, functionCallee)).toEqual(["inner", "outer"]);
    expect(around(`const x = "outer"`, arrowCallee)).toEqual(["inner", "outer"]);
    expect(sloppy(`(function named(a = eval("var named = 1")) { return named; })()`)).toBe(1);
    // An arrow function has no `arguments`: the var is its own, not the arguments object of the function around it.
    expect(
      sloppy(
        `(function () { return [((a = eval("var arguments = 'param'")) => arguments)(), arguments.length]; })(1, 2)`,
      ),
    ).toEqual(["param", 2]);
  });

  test("a parameter of the same name is still a SyntaxError", () => {
    expect(() => sloppy(`(function (a = eval("var b = 1"), b) {})()`)).toThrow(SyntaxError);
    expect(() => sloppy(`((a = eval("var b = 1"), b) => 0)()`)).toThrow(SyntaxError);
    // A function has its own `arguments` next to its parameters.
    expect(() => sloppy(`(function (a = eval("var arguments = 1")) {})()`)).toThrow(SyntaxError);
  });

  test("a node:vm sandbox does not get the var", () => {
    const sandbox: Record<string, unknown> = {};
    vm.runInNewContext(`function f(p = eval("var leaked = 1; function leakedFunction() {}")) {} f();`, sandbox);
    expect(Object.keys(sandbox)).toEqual(["f"]);
  });

  test("a global const keeps its value", () => {
    // The value went to the `const` of the script when a function was between it and the called function.
    const result = vm.runInNewContext(
      `const state = "global";
       (function () { function f(p = eval("var state = 'inner'"), read = () => state) { return read(); } return [f(), state]; })() + "," + state`,
    );
    expect(result).toBe("inner,global,global");
  });

  test("input that went through the REPL transform", async () => {
    const transpiler = new Bun.Transpiler({ loader: "tsx", replMode: true });
    const context = vm.createContext({});
    const results: unknown[] = [];
    for (const line of [`let x = 1; function f(p = eval("var x = 2")) { return x }; [f(), x]`, `x`, `f()`]) {
      const result = await vm.runInContext(transpiler.transformSync(line), context);
      results.push(result?.value ?? result);
    }
    expect(results).toEqual([[2, 1], 1, 2]);
  });

  const commonJS = `
    var state = "module state";
    function callee(p = eval("var state = 'from the eval'; var module = 1; var exports = 2; var seen = typeof require")) {
      return [state, module, exports, seen];
    }
    console.log(JSON.stringify({ callee: callee(), state, module: typeof module, exports: typeof exports, seen: typeof seen }));
  `;
  const commonJSOutput = {
    callee: ["from the eval", 1, 2, "function"],
    state: "module state",
    module: "object",
    exports: "object",
    seen: "undefined",
  };

  test.concurrent("the bindings of a CommonJS module are not overwritten", async () => {
    using dir = tempDir("direct-eval-parameter", { "module.cjs": commonJS });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "module.cjs"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual(commonJSOutput);
    expect(exitCode).toBe(0);
  });

  test.concurrent("the same module from the bytecode cache", async () => {
    using dir = tempDir("direct-eval-parameter-bytecode", { "module.cjs": commonJS });
    await using build = Bun.spawn({
      cmd: [bunExe(), "build", "--target=bun", "--format=cjs", "--bytecode", "--outdir=out", "module.cjs"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, buildStderr, buildExitCode] = await Promise.all([build.stdout.text(), build.stderr.text(), build.exited]);
    expect(buildStderr).toBe("");
    expect(readdirSync(join(String(dir), "out")).sort()).toEqual(["module.js", "module.js.jsc"]);
    expect(buildExitCode).toBe(0);

    await using proc = Bun.spawn({
      cmd: [bunExe(), "out/module.js"],
      env: { ...bunEnv, BUN_JSC_verboseDiskCache: "1" },
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    // The module ran from the cache, not from its source.
    expect(stderr).toStartWith("[Disk Cache] Cache hit for sourceCode");
    expect(JSON.parse(stdout)).toEqual(commonJSOutput);
    expect(exitCode).toBe(0);
  });
});
