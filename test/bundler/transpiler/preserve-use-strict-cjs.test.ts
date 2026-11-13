import { describe, expect, test } from "bun:test";
import { bunRun, tempDir } from "harness";
import path from "path";

test.concurrent(`"use strict'; preserves strict mode in CJS`, async () => {
  expect(await bunRun(path.join(import.meta.dir, "strict-mode-fixture.ts"))).toSpawn();
});

test.concurrent(`sloppy mode by default in CJS`, async () => {
  expect(await bunRun(path.join(import.meta.dir, "sloppy-mode-fixture.ts"))).toSpawn();
});

describe("block-level function declarations in CommonJS", () => {
  // What node prints for dead.cjs below.
  const deadCode = {
    branch: "undefined",
    constant: "undefined",
    elseBranch: "undefined",
    behindReturn: "undefined",
    behindBreak: "undefined",
    nested: "undefined",
    two: "undefinedundefined",
    directEval: "undefined",
    assign: "undefined",
    shadow: "undefined",
    functionLevel: "kept",
    letOfFunction: "let",
    parameter: "parameter",
    arguments: "[object Arguments]",
    strict: "outer",
  };

  // Annex B: in sloppy code the name is also a `var` of the enclosing function,
  // assigned when the declaration is evaluated. Every expected value is what node prints.
  test.concurrent("sloppy code sees the function after its block", async () => {
    using dir = tempDir("block-level-function", {
      "sloppy.cjs": `
const attempt = fn => {
  try {
    return fn();
  } catch (e) {
    return e.name;
  }
};
const out = {};

{ function topLevelBlock() { return 9; } }
out.topLevelBlock = attempt(() => topLevelBlock());

if (true) { function ifBlock() { return 2; } }
out.ifBlock = attempt(() => ifBlock());

if (true) function ifBody() { return 1; }
out.ifBody = typeof ifBody;

try { function tryBlock() { return 5; } } catch {}
out.tryBlock = attempt(() => tryBlock());

label: function labelled() { return 6; }
out.labelled = attempt(() => labelled());

// A function behind a label is a declaration of the statement list around the label.
out.labelThenPlain = attempt(function () {
  lf: function f() { return "labelled"; }
  return f();
  function f() { return "plain"; }
});

out.labelAfterVar = attempt(function () {
  var f = "V";
  lf: function f() { return "labelled"; }
  return typeof f === "function" ? f() : f;
});

out.labelAfterAssignment = attempt(function () {
  f = "A";
  lf: function f() { return "labelled"; }
  return typeof f === "function" ? "function" : f;
});

if (typeof featureTest !== "function") { function featureTest() { return "own"; } }
out.featureTest = typeof featureTest === "function" ? featureTest() : "fallback";

// https://github.com/oven-sh/bun/issues/23633
function outer() { return "outer"; }
out.shadow = [outer()];
{
  function outer() { return "block"; }
  out.shadow.push(outer());
}
out.shadow.push(outer());

out.inFunction = attempt(function () {
  { function inner() { return "in"; } }
  return inner();
});

// The parser template that jison emits (https://github.com/oven-sh/bun/issues/25737).
out.jison = attempt(function parse() {
  _token_stack: function lex() { return "token"; }
  return lex();
});

out.switchCase = attempt(() =>
  (function (x) {
    switch (x) {
      case 1: function s() { return 3; }
      case 2: return s();
    }
  })(2),
);

out.beforeBlock = attempt(function () {
  const seen = [typeof f, f === undefined];
  { function f() {} }
  seen.push(typeof f);
  return seen;
});

out.neverEntered = attempt(function () {
  if (false) { function f() {} }
  return String(f);
});

out.leftBeforeDeclaration = attempt(function () {
  exit: { break exit; function f() {} }
  return typeof f;
});

out.callBeforeDeclaration = attempt(function () {
  { var r = f(); function f() { return 7; } }
  return r;
});

out.assignBeforeDeclaration = attempt(function () {
  { f = 1; function f() {} }
  return typeof f;
});

out.assignBeforeDeclarationWithEval = attempt(function () {
  { f = 1; function f() {} eval(""); }
  return typeof f;
});

out.twoBlocks = attempt(function () {
  const seen = [];
  { function f() { return 1; } }
  seen.push(f());
  { function f() { return 2; } }
  seen.push(f());
  return seen;
});

out.loop = attempt(function () {
  const seen = [];
  for (var i = 0; i < 2; i++) { function f() {} seen.push(f); }
  return [f === seen[1], seen[0] === seen[1]];
});

out.outerLet = attempt(function () {
  let f = 1;
  { function f() {} }
  return typeof f;
});

out.parameter = attempt(() =>
  (function (f) {
    { function f() {} }
    return typeof f;
  })(1),
);

out.catchParameter = attempt(function () {
  try { throw 1; } catch (f) { { function f() {} } }
  return typeof f;
});

// A lexical binding of an enclosing block takes the var away, also when
// the transpiler inlines or drops that binding.
out.constOfEnclosingBlock = attempt(function () {
  var t = "outer";
  return (function () {
    {
      const t = 5;
      globalThis.sink = t;
      { function t() {} }
    }
    return typeof t;
  })();
});

out.letOfEnclosingBlock = attempt(function () {
  var f = "outer";
  return (function (x) {
    var seen;
    {
      let f = x();
      seen = f;
      { function f() {} }
    }
    return typeof f;
  })(() => 1);
});

out.letOfDeadBlock = attempt(function () {
  var f = "outer";
  return (function () {
    if (false) {
      let f = 1;
      { function f() {} }
    }
    return typeof f;
  })();
});

// The parameters have a scope of their own: the closure of a default never sees the var.
out.defaultParameterClosure = attempt(function (read = () => typeof f) {
  const seen = [read(), typeof f];
  { function f() {} }
  seen.push(read(), typeof f);
  return seen;
});

out.nameOfTheFunctionAround = attempt(function f() {
  const seen = [typeof f, f === arguments.callee];
  { function f() {} }
  seen.push(f === arguments.callee);
  return seen;
});

out.withObject = attempt(function () {
  const o = { f: "prop" };
  with (o) { { function f() {} } }
  return [typeof f, typeof o.f];
});

out.arrowFunction = attempt(() => {
  const before = typeof f;
  { function f() {} }
  return [before, typeof f];
});

out.source = attempt(function () {
  { function named(a, b) { return a + b; } }
  return [named.name, named.toString().split(" ").join("").startsWith("functionnamed(a,b)")];
});

console.log(JSON.stringify(out));
module.exports = out;
`,
    });
    const result = await bunRun(path.join(String(dir), "sloppy.cjs"));
    expect(result).toSpawn();
    expect(JSON.parse(result.stdout)).toEqual({
      topLevelBlock: 9,
      ifBlock: 2,
      ifBody: "function",
      tryBlock: 5,
      labelled: 6,
      labelThenPlain: "plain",
      labelAfterVar: "V",
      labelAfterAssignment: "A",
      featureTest: "own",
      shadow: ["outer", "block", "block"],
      inFunction: "in",
      jison: "token",
      switchCase: 3,
      beforeBlock: ["undefined", true, "function"],
      neverEntered: "undefined",
      leftBeforeDeclaration: "undefined",
      callBeforeDeclaration: 7,
      assignBeforeDeclaration: "number",
      assignBeforeDeclarationWithEval: "number",
      twoBlocks: [1, 2],
      loop: [true, false],
      outerLet: "number",
      parameter: "number",
      catchParameter: "function",
      constOfEnclosingBlock: "string",
      letOfEnclosingBlock: "string",
      letOfDeadBlock: "string",
      defaultParameterClosure: ["undefined", "undefined", "undefined", "function"],
      nameOfTheFunctionAround: ["undefined", false, false],
      withObject: ["function", "string"],
      arrowFunction: ["undefined", "function"],
      source: ["named", true],
    });
  });

  // The inner function gets no `var`: the function of the enclosing block has the name.
  // test262 annexB/language/function-code/block-decl-nested-blocks-with-fun-decl.js. V8 in Node 20 and later returns 2.
  test.concurrent("a same-name function in a nested block stays in its block", async () => {
    using dir = tempDir("block-level-function", {
      "nested.cjs": `
function g() {
  {
    function f() { return 1; }
    { function f() { return 2; } }
  }
  return f();
}
console.log(g());
module.exports = g;
`,
    });
    expect(await bunRun(path.join(String(dir), "nested.cjs"))).toSpawn("1");
  });

  // The name `arguments` keeps the `let`, as on main and in compiled code. An ordinary name beside it does not.
  // With the declaration, JavaScriptCore reads `undefined` for `arguments` before the block in a generator
  // and in an async function that has an `await`. After the block Node has the function (ECMA-262 since ES2018).
  test.concurrent("a function named arguments stays in its block", async () => {
    using dir = tempDir("block-level-function", {
      "arguments.cjs": `
const tag = value => Object.prototype.toString.call(value);
const out = {};

out.plain = (function () {
  const seen = [tag(arguments)];
  { seen.push(typeof arguments); function arguments() {} function other() {} }
  seen.push(tag(arguments), typeof other);
  return seen;
})();

out.generator = (function* () {
  const a = arguments;
  { function arguments() {} function other() {} }
  return [tag(a), typeof other];
})().next().value;

out.generatorMethod = ({
  *m() { const a = arguments; { function arguments() {} function other() {} } return [tag(a), typeof other]; },
}).m().next().value;

(async () => {
  out.asyncGenerator = (await (async function* () {
    const a = arguments;
    { function arguments() {} function other() {} }
    yield [tag(a), typeof other];
  })().next()).value;

  out.asyncWithAwait = await (async function () {
    const a = arguments;
    await 0;
    { function arguments() {} function other() {} }
    return [tag(a), typeof other];
  })();

  out.asyncMethodWithAwait = await ({
    async m() { const a = arguments; await 0; { function arguments() {} function other() {} } return [tag(a), typeof other]; },
  }).m();

  console.log(JSON.stringify(out));
})();
`,
    });
    const result = await bunRun(path.join(String(dir), "arguments.cjs"));
    expect(result).toSpawn();
    expect(JSON.parse(result.stdout)).toEqual({
      plain: ["[object Arguments]", "function", "[object Arguments]", "function"],
      generator: ["[object Arguments]", "function"],
      generatorMethod: ["[object Arguments]", "function"],
      asyncGenerator: ["[object Arguments]", "function"],
      asyncWithAwait: ["[object Arguments]", "function"],
      asyncMethodWithAwait: ["[object Arguments]", "function"],
    });
  });

  // Code that never runs still gives the name its `var`. The answer does not depend on dead code elimination.
  test.concurrent("dead code keeps the var, with and without dead code elimination", async () => {
    using dir = tempDir("block-level-function", {
      "dead.cjs": `
const attempt = fn => {
  try {
    return fn();
  } catch (e) {
    return e.name;
  }
};
const out = {};

out.branch = attempt(function () {
  if (false) { function f() {} }
  return String(f);
});

out.constant = attempt(function () {
  const DEV = false;
  if (DEV) { function f() {} }
  return String(f);
});

out.elseBranch = attempt(function () {
  if (true) {} else { function f() {} }
  return String(f);
});

out.behindReturn = attempt(function () {
  return String(f);
  { function f() {} }
});

out.behindBreak = attempt(function () {
  for (;;) {
    break;
    { function f() {} }
  }
  return String(f);
});

out.nested = attempt(function () {
  if (false) { try { function f() {} } finally {} }
  return String(f);
});

out.two = attempt(function () {
  if (false) { function f() {} }
  if (false) { function f() {} function g() {} }
  return String(f) + String(g);
});

out.directEval = attempt(function () {
  if (false) { function f() {} eval(""); }
  return String(f);
});

out.assign = attempt(function () {
  (function () {
    if (false) { function deadBlockFunctionLeak() {} }
    deadBlockFunctionLeak = 1;
  })();
  return typeof globalThis.deadBlockFunctionLeak;
});

// As in node, the name hides a binding of an outer function.
out.shadow = attempt(function () {
  function f() { return "outer"; }
  return (function () {
    if (false) { function f() {} }
    return String(f);
  })();
});

out.functionLevel = attempt(function () {
  function f() { return "kept"; }
  if (false) { function f() {} }
  return f();
});

out.letOfFunction = attempt(function () {
  if (false) { function f() {} }
  let f = "let";
  return f;
});

out.parameter = attempt(function (f) {
  if (false) { function f() {} }
  return f;
}.bind(null, "parameter"));

out.arguments = attempt(function () {
  if (false) { function arguments() {} }
  return Object.prototype.toString.call(arguments);
});

out.strict = attempt(function () {
  "use strict";
  function f() { return "outer"; }
  return (function () {
    if (false) { function f() {} }
    return f();
  })();
});

module.exports = JSON.stringify(out);
if (require.main === module) console.log(module.exports);
`,
    });
    const file = path.join(String(dir), "dead.cjs");
    // `bun -p` turns dead code elimination off.
    const [run, print] = await Promise.all([bunRun(file), bunRun(["-p", `require(${JSON.stringify(file)})`])]);
    expect(run).toSpawn();
    expect(print).toSpawn();
    expect({ run: JSON.parse(run.stdout), print: JSON.parse(print.stdout) }).toEqual({
      run: deadCode,
      print: deadCode,
    });
  });

  // A module with no import or export is parsed as sloppy code and runs as strict code.
  // The engine keeps the function in its block there, and a file with no CommonJS marker runs the same way.
  test.concurrent("a module with no import or export keeps the function in its block", async () => {
    const source = `
const attempt = fn => {
  try {
    return fn();
  } catch (e) {
    return e.name;
  }
};
const out = {};

out.strict = (function () { return this === undefined; })();

{ function z() {} }
out.afterBlock = typeof z;

out.switchCase = attempt(() =>
  (function (x) {
    switch (x) {
      case 1: function s() { return 3; }
      case 2: return s();
    }
  })(2),
);

out.source = attempt(function () {
  {
    function named(a, b) { return a + b; }
    return [named.name, named.toString().split(" ").join("").startsWith("functionnamed(a,b)")];
  }
});

console.log(JSON.stringify(out));
`;
    using dir = tempDir("block-level-function", { "module.mjs": source, "no-marker.js": source });
    const [module, noMarker] = await Promise.all([
      bunRun(path.join(String(dir), "module.mjs")),
      bunRun(path.join(String(dir), "no-marker.js")),
    ]);
    expect(module).toSpawn();
    expect(noMarker).toSpawn();
    // What node prints for module.mjs.
    const expected = { strict: true, afterBlock: "undefined", switchCase: 3, source: ["named", true] };
    expect({ module: JSON.parse(module.stdout), noMarker: JSON.parse(noMarker.stdout) }).toEqual({
      module: expected,
      noMarker: expected,
    });
  });

  test.concurrent("also through require(), import() and a .js file", async () => {
    const lib = (value: string) => `{ function z() { return "${value}"; } }\nmodule.exports = z();\n`;
    using dir = tempDir("block-level-function", {
      "entry.cjs": `
const out = { require: require("./required.cjs"), js: require("./plain.js") };
import("./imported.cjs").then(imported => {
  out.import = imported.default;
  console.log(JSON.stringify(out));
});
`,
      "required.cjs": lib("require"),
      "plain.js": lib("js"),
      "imported.cjs": lib("import"),
    });
    const result = await bunRun(path.join(String(dir), "entry.cjs"));
    expect(result).toSpawn();
    expect(JSON.parse(result.stdout)).toEqual({ require: "require", js: "js", import: "import" });
  });

  test.concurrent("also in bun -e", async () => {
    const code = `const { sep } = require("node:path"); { function z() { return typeof sep; } } console.log(z());`;
    expect(await bunRun(["-e", code])).toSpawn("string");
  });

  test.concurrent("bun build --no-bundle prints the declaration", async () => {
    const source = "{\n  function z() {\n    return 9;\n  }\n}\nmodule.exports = z();";
    using dir = tempDir("block-level-function", { "lib.cjs": source });
    expect(await bunRun(["build", "--no-bundle", path.join(String(dir), "lib.cjs")])).toSpawn(source);
  });

  // A "use strict" that is not printed leaves these as sloppy text, so the
  // engine cannot be trusted with them: the function must stay block scoped.
  test.concurrent("strict code keeps the function block scoped", async () => {
    const body = `
  function f() { return "outer"; }
  { function f() { return "block"; } }
  return f();`;
    using dir = tempDir("block-level-function", {
      "entry.cjs": `
const out = {};
out.strictFunction = (function () {
  "use strict";${body}
})();
out.nestedInStrictFunction = (function () {
  "use strict";
  return (function () {${body}
  })();
})();
out.classMethod = new (class {
  method() {${body}
  }
})().method();
out.switchCaseInStrictFunction = (function () {
  "use strict";
  function f() { return "outer"; }
  switch (1) { case 1: function f() { return "case"; } }
  return f();
})();
out.strictFile = require("./strict-file.cjs");
import("./module.mjs").then(module => {
  out.module = module.default;
  console.log(JSON.stringify(out));
});
`,
      "strict-file.cjs": `"use strict";
module.exports = (function () {${body}
})();
`,
      "module.mjs": `export default (function () {${body}
})();
`,
    });
    const result = await bunRun(path.join(String(dir), "entry.cjs"));
    expect(result).toSpawn();
    expect(JSON.parse(result.stdout)).toEqual({
      strictFunction: "outer",
      nestedInStrictFunction: "outer",
      classMethod: "outer",
      switchCaseInStrictFunction: "outer",
      strictFile: "outer",
      module: "outer",
    });
  });

  test.concurrent('bun -e with "use strict" keeps the function block scoped', async () => {
    const code = `"use strict"; const { sep } = require("node:path"); function f() { return "outer"; } { function f() { return "block"; } } console.log(f(), typeof sep);`;
    expect(await bunRun(["-e", code])).toSpawn("outer string");
  });

  // Right in node, wrong here. A row fails when its cause is fixed, and then it moves to the tables above.
  describe("known differences from node", () => {
    const node = {
      // Right on main.
      twoOfANameWithEval: "2",
      // Wrong on main too: the name `arguments` keeps the `let` of main.
      argumentsAfterBlock: "[object Function]",
      argumentsInArrow: "function",
      argumentsBesideFunction: "block",
    };
    let rows: Promise<Record<string, string>> | undefined;
    const run = () =>
      (rows ??= (async () => {
        using dir = tempDir("block-level-function", {
          "known.cjs": `
const attempt = fn => {
  try {
    return String(fn());
  } catch (e) {
    return e.name;
  }
};
const out = {};

// The parser drops the first of two functions with one name. The second one never runs here.
out.twoOfANameWithEval = attempt(function () {
  exit: {
    function f() { return 1; }
    eval("");
    break exit;
    function f() { return 2; }
  }
  return typeof f === "function" ? f() : typeof f;
});

out.argumentsAfterBlock = attempt(function () {
  { function arguments() {} }
  return Object.prototype.toString.call(arguments);
});

// An arrow function has no arguments object, so the name is an ordinary var there.
out.argumentsInArrow = attempt(function () {
  return (() => {
    { function arguments() {} }
    return typeof arguments;
  })();
});

out.argumentsBesideFunction = attempt(function () {
  function arguments() { return "top"; }
  { function arguments() { return "block"; } }
  return arguments();
});

console.log(JSON.stringify(out));
`,
        });
        const result = await bunRun(path.join(String(dir), "known.cjs"));
        expect(result).toSpawn();
        return JSON.parse(result.stdout);
      })());

    test("the fixture runs", async () => {
      expect(Object.keys(await run())).toEqual(Object.keys(node));
    });

    for (const [name, expected] of Object.entries(node)) {
      test.failing(name, async () => {
        expect((await run())[name]).toBe(expected);
      });
    }

    // A file with no CommonJS marker runs as a module, and the dead declaration is still printed.
    // https://github.com/oven-sh/bun/issues/44802
    for (const [what, dead] of [
      ["sloppy-only text", "function o() { var static = 1; }"],
      ["a sloppy-only name", "function yield() {}"],
    ]) {
      test.failing(`a dead function with ${what} in a file that runs as a module`, async () => {
        using dir = tempDir("block-level-function", {
          "dead.js": `if (false) { ${dead} }\nconsole.log("loaded");\n`,
        });
        expect(await bunRun(path.join(String(dir), "dead.js"))).toSpawn("loaded");
      });
    }
  });
});
