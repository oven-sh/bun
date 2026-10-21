import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import Module from "node:module";
import vm from "node:vm";

// A shorthand property of an object assignment pattern (`{ v }` in `for ({ v } of list)` or in
// `({ w = 1, v } = object)`) assigns to the variable `v`. JavaScriptCore's parser recorded `v` as a variable that the
// function uses only when it had a default value. For the others it relied on its parse of the same text as an
// object literal, which does not run for the head of a for-in or for-of statement and stops at the first default
// value. A function whose only mention of the variable was such a target did not capture it: the assignment wrote a
// global variable in sloppy code and threw a ReferenceError in strict code.

describe.concurrent("a shorthand target of an object assignment pattern is the variable of the enclosing scope", () => {
  // Each text assigns to the variable `v` and mentions it nowhere else. `u` and `w` are other targets.
  const assignments: [string, (v: string) => string, unknown][] = [
    ["for-of head", v => `for ({ ${v} } of [{ ${v}: "new" }]) ;`, "new"],
    ["for-of head with two targets", v => `for ({ u, ${v} } of [{ ${v}: "new" }]) ;`, "new"],
    ["for-of head after a default value", v => `for ({ w = 1, ${v} } of [{ ${v}: "new" }]) ;`, "new"],
    ["for-of head in an array pattern", v => `for ([{ ${v} }] of [[{ ${v}: "new" }]]) ;`, "new"],
    ["for-of head under a key", v => `for ({ k: { ${v} } } of [{ k: { ${v}: "new" } }]) ;`, "new"],
    ["for-of head in a rest element", v => `for ([...[{ ${v} }]] of [[{ ${v}: "new" }]]) ;`, "new"],
    ["for-in head", v => `for ({ ${v} } in { key: 0 }) ;`, undefined],
    ["assignment after a default value", v => `({ w = 1, ${v} } = { ${v}: "new" });`, "new"],
    ["assignment after a default value and another target", v => `({ w = 1, u, ${v} } = { ${v}: "new" });`, "new"],
    ["assignment after a default value in an array pattern", v => `[{ w = 1, ${v} }] = [{ ${v}: "new" }];`, "new"],
    ["assignment after a default value under a key", v => `({ k: { w = 1, ${v} } } = { k: { ${v}: "new" } });`, "new"],
    [
      "assignment after a default value in an object before it",
      v => `({ k: { w = 1 }, ${v} } = { k: { }, ${v}: "new" });`,
      "new",
    ],
    [
      "assignment after a default value in an array element before it",
      v => `[{ w = 1 }, { ${v} }] = [{ }, { ${v}: "new" }];`,
      "new",
    ],
    [
      "assignment after a second __proto__ key",
      v => `({ __proto__: u, __proto__: w, ${v} } = { ${v}: "new" });`,
      "new",
    ],
    [
      "assignment after a default value in the init of a for statement",
      v => `for ({ w = 1, ${v} } = { ${v}: "new" }; ;) break;`,
      "new",
    ],
  ];
  // Each text runs the body in a function of its own.
  const closures: [string, (body: string) => string][] = [
    ["an arrow function", body => `(() => { ${body} })();`],
    ["a function expression", body => `(function () { ${body} })();`],
    ["a method", body => `({ method() { ${body} } }).method();`],
    ["a getter", body => `({ get getter() { ${body} return 0; } }).getter;`],
    ["a generator", body => `(function* () { ${body} })().next();`],
    ["an async arrow function", body => `(async () => { ${body} })();`],
    ["a class static block", body => `class C { static { ${body} } }`],
    ["an arrow function in an arrow function", body => `(() => () => { ${body} })()();`],
  ];
  // Each text declares the variable `v` with the value "init", runs `use` and returns the variable.
  const declarations: [string, (v: string, use: string) => string][] = [
    ["let", (v, use) => `let ${v} = "init"; ${use} return ${v};`],
    ["var", (v, use) => `var ${v} = "init"; ${use} return ${v};`],
    ["a let in a block", (v, use) => `{ let ${v} = "init"; ${use} return ${v}; }`],
    ["a parameter", (v, use) => `return (function (${v}) { ${use} return ${v}; })("init");`],
    ["a parameter with a default value", (v, use) => `return (function (${v} = "init") { ${use} return ${v}; })();`],
    ["a catch parameter", (v, use) => `try { throw "init"; } catch (${v}) { ${use} return ${v}; }`],
  ];

  // `new Function` keeps Bun's transpiler away from the text. Every run has a variable name of its own, so a global
  // variable that one run leaves behind is not found by the next one.
  let count = 0;
  function run(strict: boolean, declaration: (typeof declarations)[number][1], use: (v: string) => string) {
    const name = `shorthandTarget${count++}`;
    let value: unknown;
    try {
      value = new Function(`${strict ? `"use strict"; ` : ""}let u, w; ${declaration(name, use(name))}`)();
    } catch (error) {
      value = error;
    }
    return { value, global: name in globalThis };
  }

  test.each(assignments)("%s", (_, assignment, expected) => {
    const cases = [false, true].flatMap(strict => closures.map(([name, closure]) => ({ strict, name, closure })));
    expect(
      cases.map(({ strict, name, closure }) => ({
        closure: name,
        strict,
        ...run(strict, declarations[0][1], v => closure(assignment(v))),
      })),
    ).toEqual(cases.map(({ strict, name }) => ({ closure: name, strict, value: expected, global: false })));
  });

  test.each(declarations.slice(1))("a target declared by %s", (_, declaration) => {
    const cases = [false, true].flatMap(strict =>
      [assignments[0], assignments[7]].map(([name, assignment]) => ({ strict, name, assignment })),
    );
    expect(
      cases.map(({ strict, name, assignment }) => ({
        assignment: name,
        strict,
        ...run(strict, declaration, v => closures[0][1](assignment(v))),
      })),
    ).toEqual(cases.map(({ strict, name }) => ({ assignment: name, strict, value: "new", global: false })));
  });

  // The initializer of a field is code of the class scope, not a function of its own. Only an expression can be one.
  const fieldInitializers: [string, (body: string) => string][] = [
    ["an instance field initializer", body => `class C { field = ${body} } new C;`],
    ["a static field initializer", body => `class C { static field = ${body} }`],
  ];
  test.each(fieldInitializers)("an assignment in %s", (_, fieldInitializer) => {
    const cases = [false, true].flatMap(strict =>
      assignments.slice(7, 14).map(([name, assignment]) => ({ strict, name, assignment })),
    );
    expect(
      cases.map(({ strict, name, assignment }) => ({
        assignment: name,
        strict,
        ...run(strict, declarations[0][1], v => fieldInitializer(assignment(v))),
      })),
    ).toEqual(cases.map(({ strict, name }) => ({ assignment: name, strict, value: "new", global: false })));
  });

  // Without the record, the assignment went to the first scope further out that held the name. That is a wrong
  // value with no error, in strict code too.
  test("a captured variable of the same name further out is not the target", () => {
    const underCapturedVariable = new Function(`
      let shadowed = "outer";
      const read = () => shadowed;
      function inner() {
        let shadowed = "inner";
        (() => { for ({ shadowed } of [{ shadowed: "new" }]) ; })();
        return shadowed;
      }
      return inner() + "/" + read();
    `);
    const underCapturedParameterInStrictCode = new Function(
      "shadowedParameter",
      `"use strict";
      const read = () => shadowedParameter;
      function inner(shadowedParameter) {
        let w;
        (() => { ({ w = 1, shadowedParameter } = { shadowedParameter: "new" }); })();
        return shadowedParameter;
      }
      return inner("inner") + "/" + read();
    `,
    );
    expect([underCapturedVariable(), underCapturedParameterInStrictCode("outer")]).toEqual(["new/outer", "new/outer"]);
  });

  test("an assignment in a parameter default value", () => {
    const result = run(false, declarations[0][1], v => `((p = ({ w = 1, ${v} } = { ${v}: "new" })) => p)();`);
    expect(result).toEqual({ value: "new", global: false });
  });

  test("the head of a for-await-of statement", async () => {
    const value = await new Function(
      `return (async () => { let awaited = "init"; await (async () => { for await ({ awaited } of [{ awaited: "new" }]) ; })(); return awaited; })();`,
    )();
    expect({ value, global: "awaited" in globalThis }).toEqual({ value: "new", global: false });
  });

  // JavaScriptCore drops a catch parameter that the block does not use, so here no function is in between.
  test("a catch parameter with no other mention", () => {
    new Function(`try { throw "init"; } catch (caught) { for ({ caught } of [{ caught: "new" }]) ; }`)();
    expect("caught" in globalThis).toBe(false);
    expect(
      new Function(
        `"use strict"; let w; try { throw "init"; } catch (caughtInStrictCode) { ({ w = 1, caughtInStrictCode } = { caughtInStrictCode: "new" }); } return "done";`,
      )(),
    ).toBe("done");
  });

  test("what the variable is decides what the assignment does", () => {
    const constant = new Function(
      `const constant = "init"; (() => { for ({ constant } of [{ constant: "new" }]) ; })();`,
    );
    expect(constant).toThrow(TypeError);
    const uninitialized = new Function(
      `(() => { for ({ uninitialized } of [{ uninitialized: "new" }]) ; })(); let uninitialized;`,
    );
    expect(uninitialized).toThrow(ReferenceError);
    const className = new Function(
      `class Named { static assign() { (() => { for ({ Named } of [{ Named: "new" }]) ; })(); } } Named.assign();`,
    );
    expect(className).toThrow(TypeError);
    const classNameInFieldInitializer = new Function(`let w; class Named { static field = ({ w = 1, Named } = { }); }`);
    expect(classNameInFieldInitializer).toThrow(TypeError);
    const ownName = new Function(
      `return (function ownName() { (() => { for ({ ownName } of [{ ownName: "new" }]) ; })(); return typeof ownName; })();`,
    );
    expect(ownName()).toBe("function");
    expect(["constant", "uninitialized", "Named", "ownName"].filter(name => name in globalThis)).toEqual([]);
  });

  // Bun's own parser rejects `arguments` and `eval` as such targets, so these texts reach the engine only as strings.
  test("`arguments` as the target is the arguments object of the function", () => {
    const own = [
      `for ({ arguments } of [{ arguments: "new" }]) ;`,
      `for ({ arguments = "new" } of [{ }]) ;`,
      `let w; ({ w = 1, arguments } = { arguments: "new" });`,
    ];
    for (const source of own) new Function(source)("old");
    const fromArrowFunction = [
      `(() => { for ({ arguments } of [{ arguments: "new" }]) ; })(); return arguments;`,
      `let w; (() => { ({ w = 1, arguments } = { arguments: "new" }); })(); return arguments;`,
    ];
    expect({
      values: fromArrowFunction.map(source => new Function(source)("old")),
      global: "arguments" in globalThis,
    }).toEqual({ values: ["new", "new"], global: false });
  });

  test("a parameter named `eval` as the target is not the global function", () => {
    const globalEval = globalThis.eval;
    try {
      new Function("eval", `(() => { for ({ eval } of [{ eval: "new" }]) ; })();`)("init");
      expect(globalThis.eval).toBe(globalEval);
    } finally {
      globalThis.eval = globalEval;
    }
  });

  test("strict code still rejects `arguments` and `eval` as the target", () => {
    for (const name of ["arguments", "eval"]) {
      expect(() => (0, eval)(`(function () { "use strict"; for ({ ${name} } of [{ }]) ; })`)).toThrow(SyntaxError);
      expect(() => (0, eval)(`(function () { "use strict"; let w; ({ w = 1, ${name} } = { }); })`)).toThrow(
        SyntaxError,
      );
    }
  });

  test("an object literal in the same place is no pattern", () => {
    const forOfHead = new Function(
      `let a = "a", b = "b"; const log = []; (() => { for ({ a, b, set x(value) { log.push(a + b + value); } }.x of [1, 2]) ; })(); return a + "/" + b + "/" + log;`,
    );
    const arrayPattern = new Function(
      `let a = "a", b = "b"; const log = []; (() => { [{ a, b, set c(value) { log.push(a + b + value); } }.c] = [1]; })(); return a + "/" + b + "/" + log;`,
    );
    expect([forOfHead(), arrayPattern()]).toEqual(["a/b/ab1,ab2", "a/b/ab1"]);
  });

  // None of these passes its text through Bun's transpiler.
  const expression = (v: string) =>
    `(function () { let ${v} = "init"; (() => { for ({ ${v} } of [{ ${v}: "new" }]) ; })(); return ${v}; })()`;
  const AsyncFunction = async function () {}.constructor as FunctionConstructor;
  const GeneratorFunction = function* () {}.constructor as FunctionConstructor;
  const entryPoints: [string, (v: string) => unknown][] = [
    ["a direct eval", v => eval(expression(v))],
    ["an indirect eval", v => (0, eval)(expression(v))],
    ["the Function constructor", v => new Function(`return ${expression(v)};`)()],
    ["the AsyncFunction constructor", v => new AsyncFunction(`return ${expression(v)};`)()],
    ["the GeneratorFunction constructor", v => new GeneratorFunction(`yield ${expression(v)};`)().next().value],
    ["vm.runInThisContext", v => vm.runInThisContext(expression(v))],
    ["vm.Script", v => new vm.Script(expression(v)).runInThisContext()],
    ["vm.compileFunction", v => vm.compileFunction(`return ${expression(v)};`)()],
    [
      "Module.prototype._compile",
      v => {
        const module = new Module(import.meta.path) as Module & { _compile(source: string, filename: string): void };
        module._compile(`module.exports = ${expression(v)};`, import.meta.path);
        return module.exports;
      },
    ],
  ];
  test.each(entryPoints)("in the text of %s", async (_, evaluate) => {
    const name = `shorthandTarget${count++}`;
    expect({ value: await evaluate(name), global: name in globalThis }).toEqual({ value: "new", global: false });
  });

  test("in the text of vm.runInNewContext and vm.runInContext", () => {
    const sandbox = {};
    const context = vm.createContext({});
    expect({
      runInNewContext: vm.runInNewContext(expression("target"), sandbox),
      runInContext: vm.runInContext(expression("target"), context),
      sandbox: Object.keys(sandbox),
      context: Object.keys(context),
    }).toEqual({ runInNewContext: "new", runInContext: "new", sandbox: [], context: [] });
  });

  test("in the text of a ShadowRealm", () => {
    const realm = new ShadowRealm();
    expect({
      value: realm.evaluate(expression("target")),
      global: realm.evaluate(`"target" in globalThis`),
    }).toEqual({ value: "new", global: false });
  });

  test("in the text of a vm.SourceTextModule, for a variable of the module", async () => {
    const module = new vm.SourceTextModule(
      `let target = "init"; (() => { for ({ target } of [{ target: "new" }]) ; })(); export default target;`,
    );
    await module.link(() => {
      throw new Error("the module has no imports");
    });
    await module.evaluate();
    expect((module.namespace as { default: unknown }).default).toBe("new");
  });

  // The text that reaches the engine from a file is what Bun's printer writes. The printer writes a property whose
  // key and value have the same name as a shorthand property, so the long form in a file is the same case.
  const body = `
    function forOfHead() {
      var i = "old";
      var f = function () { for ({ i } of [{ i: "new" }]) ; };
      f();
      return i;
    }
    function longForm() {
      var j = "old";
      var f = function () { for ({ j: j } of [{ j: "new" }]) ; };
      f();
      return j;
    }
    function forInHead() {
      var length = "old";
      var f = function () { for ({ length } in { abc: 0 }) ; };
      f();
      return length;
    }
    function nestedHead() {
      var n = "old";
      var f = () => { for ([{ n }] of [[{ n: "new" }]]) ; };
      f();
      return n;
    }
    async function forAwaitHead() {
      var awaited = "old";
      var f = async function () { for await ({ awaited } of [{ awaited: "new" }]) ; };
      await f();
      return awaited;
    }
    let width, height;
    function setOptions(options) { ({ width = 100, height } = options); }
    setOptions({ height: 5 });
    const afterDefaultValue = [width, height];
    forAwaitHead().then(forAwait => {
      console.log(JSON.stringify({
        forOfHead: forOfHead(),
        longForm: longForm(),
        forInHead: forInHead(),
        nestedHead: nestedHead(),
        forAwaitHead: forAwait,
        afterDefaultValue,
        globals: ["i", "j", "length", "n", "awaited", "height"].filter(name => name in globalThis),
      }));
    });
  `;
  const expected = `{"forOfHead":"new","longForm":"new","forInHead":3,"nestedHead":"new","forAwaitHead":"new","afterDefaultValue":[100,5],"globals":[]}`;
  // A file that starts with the `// @bun` line is a bundle that Bun wrote: it goes to the engine as it is. This is
  // what `bun build` writes for a module that it wraps in a function.
  const bundle = `// @bun
var ids, id, label, a, b;
var init = () => {
  ids = [];
  for ({ id, label } of [{ id: 1, label: "x" }, { id: 2, label: "y" }])
    ids.push(id);
  ({ a = 1, b } = { b: 2 });
};
init();
console.log(JSON.stringify({ ids, label, a, b }));
`;
  const files: [string, string[], Record<string, string>, string][] = [
    ["a CommonJS file", ["file.cjs"], { "file.cjs": body }, expected],
    ["an ES module", ["file.mjs"], { "file.mjs": body }, expected],
    ["a TypeScript file", ["file.ts"], { "file.ts": body }, expected],
    [
      "a file with the `// @bun` line",
      ["bundle.mjs"],
      { "bundle.mjs": bundle },
      `{"ids":[1,2],"label":"y","a":1,"b":2}`,
    ],
    [
      "the text of `bun -e`",
      ["-e", `let target = "init"; (() => { for ({ target } of [{ target: "new" }]) ; })(); console.log(target);`],
      {},
      "new",
    ],
  ];
  test.each(files)("in %s", async (_, args, contents, stdout) => {
    using dir = tempDir("shorthand-assignment-target", contents);
    await using proc = Bun.spawn({ cmd: [bunExe(), ...args], env: bunEnv, cwd: String(dir), stderr: "pipe" });
    const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: out.trim(), stderr: err, exitCode }).toEqual({ stdout, stderr: "", exitCode: 0 });
  });
});
