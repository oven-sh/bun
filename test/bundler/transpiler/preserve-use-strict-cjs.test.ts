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
      featureTest: "own",
      shadow: ["outer", "block", "block"],
      inFunction: "in",
      jison: "token",
      switchCase: 3,
      beforeBlock: ["undefined", true, "function"],
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

  // The transpiler removes these statements. The name is still a `var`, as it is when nothing is removed.
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

  // Main drops each of these dead statements whole. A file with no CommonJS marker runs as a module,
  // so text that is left behind must be strict.
  test.concurrent("a dead statement with a function in it does not reach the engine", async () => {
    using dir = tempDir("block-level-function", {
      "dead.js": `
if (false) { function o() { var static = 1; } }
if (false) { function eval() {} }
function behindReturn() { return 1; { function o() { var static = 1; } } }
function header(x) { if (false) { while (delete x) { function o() {} } } return 0; }
function sibling(x) { return 0; { delete x; function o() {} } }
function hiddenJump(x) { if (true) { return 0; } else { function o() {} } delete x; }
function emptiedIf(x) { if (x === function () { var static = 1; }) { if (false) { function o() {} } } return 0; }
function twoOfAName() { if (false) { function o() {} } if (false) { function o() {} } }
console.log("loaded");
`,
    });
    expect(await bunRun(path.join(String(dir), "dead.js"))).toSpawn("loaded");
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
      strictFile: "outer",
      module: "outer",
    });
  });

  test.concurrent('bun -e with "use strict" keeps the function block scoped', async () => {
    const code = `"use strict"; const { sep } = require("node:path"); function f() { return "outer"; } { function f() { return "block"; } } console.log(f(), typeof sep);`;
    expect(await bunRun(["-e", code])).toSpawn("outer string");
  });
});
