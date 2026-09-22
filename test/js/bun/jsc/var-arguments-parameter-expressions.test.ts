import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// When the parameters of a function have expressions, the vars of the body are in an environment of their own, below the
// one that holds the parameters and `arguments` (FunctionDeclarationInstantiation, step 28). A `var arguments` in the body
// starts as the arguments object. A store to it does not change the `arguments` that the parameter expressions read.
// JavaScriptCore kept one binding, so `var arguments = 7` in the body also changed what a closure in the parameters read.
//
// `var arguments` is a SyntaxError in strict mode, and this file is a module. So the functions here come from an indirect
// eval, from `new Function`, and from a CommonJS file. All three are sloppy mode code.

function show(value: unknown): unknown {
  if (typeof value === "function") return "function";
  if (Array.isArray(value)) return value.map(show);
  if (Object.prototype.toString.call(value) === "[object Arguments]")
    return `arguments(${(value as IArguments).length})`;
  if (value && typeof value === "object")
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, show(entry)]));
  return value;
}

const sloppy = (source: string) => (0, eval)(`(${source})`);

describe("a `var arguments` in the body of a function with parameter expressions", () => {
  test.each([
    ["an initializer", "function (a = () => arguments) { var arguments = 7; return [a(), arguments]; }"],
    ["a later store", "function (a = () => arguments) { var arguments; arguments = 7; return [a(), arguments]; }"],
    [
      "a store before the declaration",
      "function (a = () => arguments) { arguments = 7; var arguments; return [a(), arguments]; }",
    ],
    ["a for-of head", "function (a = () => arguments) { for (var arguments of [7]); return [a(), arguments]; }"],
    ["a pattern", "function (a = () => arguments) { var { arguments } = { arguments: 7 }; return [a(), arguments]; }"],
    ["a nested block", "function (a = () => arguments) { { var arguments = 7; } return [a(), arguments]; }"],
    [
      "an eval in the parameters",
      "function (a = eval('() => arguments')) { var arguments = 7; return [a(), arguments]; }",
    ],
    [
      "a default value in a pattern",
      "function ({ a = () => arguments } = {}) { var arguments = 7; return [a(), arguments]; }",
    ],
  ])("keeps the arguments object for the parameters: %s", (_, source) => {
    expect(show(sloppy(source)(undefined, 1, 1, 1))).toEqual(["arguments(4)", 7]);
  });

  test("every kind of function that has its own arguments object", () => {
    const results = sloppy(`function () {
      var results = {};
      var object = {
        method(a = () => arguments) { var arguments = 7; return [a(), arguments]; },
        set setter(a = () => arguments) { var arguments = 7; results.setter = [a(), arguments]; },
        async asyncMethod(a = () => arguments) { var arguments = 7; results.asyncMethod = [a(), arguments]; await 0; },
        *generatorMethod(a = () => arguments) { var arguments = 7; yield [a(), arguments]; },
      };
      function Constructor(a = () => arguments) { var arguments = 7; results.construct = [a(), arguments]; }
      async function asyncFunctionWithoutAwait(a = () => arguments) { var arguments = 7; results.asyncFunctionWithoutAwait = [a(), arguments]; }
      results.method = object.method(undefined, 1);
      object.setter = undefined;
      object.asyncMethod(undefined, 1);
      results.generatorMethod = object.generatorMethod(undefined, 1).next().value;
      new Constructor(undefined, 1);
      asyncFunctionWithoutAwait(undefined, 1);
      return results;
    }`)();
    expect(show(results)).toEqual({
      method: ["arguments(2)", 7],
      setter: ["arguments(1)", 7],
      asyncMethod: ["arguments(2)", 7],
      generatorMethod: ["arguments(2)", 7],
      construct: ["arguments(2)", 7],
      asyncFunctionWithoutAwait: ["arguments(2)", 7],
    });
  });

  test("new Function", () => {
    const fn = new Function("a = () => arguments.length", "var arguments = 7; return [a(), arguments];");
    expect(fn(undefined, 1, 1, 1)).toEqual([4, 7]);
  });

  test("the var starts as the value that the parameters left in `arguments`", () => {
    const neverAssigned = sloppy(
      "function (a = () => arguments) { var arguments; return [a(), arguments, a() === arguments]; }",
    );
    expect(show(neverAssigned(undefined, 1))).toEqual(["arguments(2)", "arguments(2)", true]);

    const storedInTheParameters = sloppy(
      "function (a = () => arguments, b = (arguments = 9)) { var arguments; return [a(), arguments]; }",
    );
    expect(storedInTheParameters()).toEqual([9, 9]);

    const storedByAClosureLater = sloppy(
      "function (a = () => arguments, b = () => { arguments = 9; }) { var arguments = 7; b(); return [a(), arguments]; }",
    );
    expect(storedByAClosureLater()).toEqual([9, 7]);
  });

  test("a function named `arguments` in a block replaces the var, not the arguments object of the parameters", () => {
    const fn = sloppy(
      "function (a = () => arguments) { var before = arguments; { function arguments() {} } return [a(), before, arguments]; }",
    );
    expect(show(fn(undefined, 1))).toEqual(["arguments(2)", "arguments(2)", "function"]);

    // The var exists before the block runs, as in V8. A store before the block does not reach the parameters.
    const storeFirst = sloppy(
      "function (a = () => arguments) { arguments = 5; { function arguments() {} } return [a(), arguments]; }",
    );
    expect(show(storeFirst(undefined, 1))).toEqual(["arguments(2)", "function"]);
  });

  test("a direct eval in the body that declares the name again finds the body's var", () => {
    const fn = sloppy(
      "function (a = () => arguments) { var arguments; eval('var arguments = 9'); return [a(), arguments]; }",
    );
    expect(show(fn(undefined, 1))).toEqual(["arguments(2)", 9]);
  });

  test("a parameter named `arguments` that a pattern or a rest parameter binds", () => {
    const pattern = sloppy(
      "function ({ arguments }, a = () => arguments) { var arguments = 7; return [a(), arguments]; }",
    );
    expect(pattern({ arguments: 5 })).toEqual([5, 7]);

    const rest = sloppy("function (a = () => arguments, ...arguments) { var arguments = 7; return [a(), arguments]; }");
    expect(rest(undefined, 1, 2)).toEqual([[1, 2], 7]);
  });

  test("without parameter expressions the var is the binding that holds the arguments object", () => {
    expect(show(sloppy("function (a) { var arguments; return arguments; }")(1, 2))).toBe("arguments(2)");
    expect(show(sloppy("function (...rest) { var arguments; return arguments; }")(1, 2))).toBe("arguments(2)");
    expect(sloppy("function (a) { var arguments = 7; return arguments; }")(1, 2)).toBe(7);
  });

  test("without a `var arguments` the body stores to the binding of the parameters", () => {
    expect(sloppy("function (a = () => arguments) { arguments = 7; return [a(), arguments]; }")()).toEqual([7, 7]);
  });

  test("a CommonJS file", async () => {
    using dir = tempDir("var-arguments-parameter-expressions", {
      "var-arguments-fixture.cjs": `
        function withInitializer(a = () => arguments.length) { var arguments = 7; return a(); }
        function withoutInitializer(a = () => arguments.length) { var arguments; return a(); }
        function lexical(a = () => arguments.length) { let arguments = 7; return a(); }
        function both(a = () => arguments.length) { var arguments = 7; return [a(), arguments]; }
        console.log(JSON.stringify([withInitializer(undefined, 1, 1, 1), withoutInitializer(undefined, 1, 1, 1), lexical(undefined, 1, 1, 1), both(undefined, 1, 1, 1)]));
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "var-arguments-fixture.cjs"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("[4,4,4,[4,7]]\n");
    expect(exitCode).toBe(0);
  });
});
