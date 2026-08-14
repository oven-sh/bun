import { $ } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, bunRun, normalizeBunSnapshot, tempDir } from "harness";
import { join } from "node:path";

test("name property is used for function calls in Error.stack", () => {
  function WRONG() {
    return new Error().stack;
  }
  expect(WRONG()).not.toContain("at RIGHT");
  expect(WRONG()).toContain("at WRONG");
  Object.defineProperty(WRONG, "name", { value: "RIGHT" });
  expect(WRONG()).not.toContain("at WRONG");
  expect(WRONG()).toContain("at RIGHT");
});

test("name property is used for function calls in Bun.inspect", () => {
  // ** whitespace **
  // ** whitespace **
  // ** whitespace **
  // ** whitespace **
  // ** whitespace **
  // ** whitespace **
  function WRONG() {
    try {
      throw new Error();
    } catch (e) {
      return Bun.inspect(e);
    }
  }
  // ** whitespace **
  // ** whitespace **
  // ** whitespace **
  // ** whitespace **
  // ** whitespace **
  // ** whitespace **
  expect(WRONG()).not.toContain("at RIGHT");
  expect(WRONG()).toContain("at WRONG");
  Object.defineProperty(WRONG, "name", { value: "RIGHT" });
  expect(WRONG()).not.toContain("at WRONG");
  expect(WRONG()).toContain("at RIGHT");
});

test.todo("name property is used for function calls in Bun.inspect with bound object", () => {
  // ** whitespace **
  // ** whitespace **
  // ** whitespace **
  // ** whitespace **
  // ** whitespace **
  // ** whitespace **
  let WRONG = function WRONG() {
    try {
      throw new Error();
    } catch (e) {
      return Bun.inspect(e);
    }
  };
  WRONG = WRONG.bind({});
  // ** whitespace **
  // ** whitespace **
  // ** whitespace **
  // ** whitespace **
  // ** whitespace **
  // ** whitespace **
  expect(WRONG()).not.toContain("at RIGHT");
  expect(WRONG()).toContain("at WRONG");
  Object.defineProperty(WRONG, "name", { value: "RIGHT", writable: true, configurable: true });
  console.log(WRONG());
  expect(WRONG()).not.toContain("at WRONG");
  expect(WRONG()).toContain("at RIGHT");
});

test("err.line and err.column are set", async () => {
  expect(await bunRun(join(import.meta.dir, "err-stack-fixture.js"))).toSpawn(
    JSON.stringify(
      {
        line: 3,
        column: 17,
        originalLine: 1,
        originalColumn: 18,
      },
      null,
      2,
    ),
  );
});

test("throwing inside an error suppresses the error and prints the stack", async () => {
  $.throws(false);
  $.env(bunEnv);
  const result = await $`${bunExe()} run ${join(import.meta.dir, "err-custom-fixture.js")}`;

  const { stderr, exitCode } = result;

  expect(stderr.toString().trim().split("\n").slice(0, -1).join("\n").trim()).toMatchInlineSnapshot(`
"error: My custom error message
{
  message: "My custom error message",
  name: [Getter],
  line: 42,
  sourceURL: "http://example.com/test.js",
}
      at http://example.com/test.js:42"
`);
  expect(exitCode).toBe(1);
});

test("throwing inside an error suppresses the error and continues printing properties on the object", async () => {
  $.throws(false);
  $.env(bunEnv);
  const result = await $`${bunExe()} run ${join(import.meta.dir, "err-fd-fixture.js")}`;

  const { stderr, exitCode } = result;

  expect(stderr.toString().trim()).toStartWith(`ENOENT: no such file or directory, open 'this-file-path-is-bad'
    path: "this-file-path-is-bad",
 syscall: "open",
   errno: ${process.binding("uv").UV_ENOENT},
    code: "ENOENT"
`);
  expect(exitCode).toBe(1);
});

test("Async functions frame should be included in stack trace", async () => {
  async function foo() {
    return await bar();
  }
  async function bar() {
    return await baz();
  }
  async function baz() {
    await 1;
    return await qux();
  }
  async function qux() {
    return new Error("error from qux");
  }

  const error = await foo();

  console.log(error.stack);

  expect(normalizeBunSnapshot(error.stack!)).toMatchInlineSnapshot(`
    "Error: error from qux
        at qux (file:NN:NN)
        at baz (file:NN:NN)
        at async bar (file:NN:NN)
        at async foo (file:NN:NN)
        at async <anonymous> (file:NN:NN)"
  `);
});

// JSC skips a function it has already seen (a nested function while the enclosing code is reparsed on first
// call, or anything when the same source is parsed twice) by resuming the lexer after the function's last
// token. For an arrow function with an expression body that token is the body's last token; when it is a
// template literal with line breaks inside it, the lexer used to resume on the line the token started on, so
// everything after the arrow function was reported that many lines too early, including the recorded start
// line of every function declared afterwards. The transpiler prints "\n" inside a string literal as a template
// literal with a real line break, so `s => s + "\n"` is enough to trigger it in Bun.
describe.concurrent("stack positions after an arrow function whose body ends in a multi-line template literal", () => {
  async function run(dir: string, file: string, env: Record<string, string> = {}) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), file],
      env: { ...bunEnv, ...env },
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    return stdout;
  }

  // One source line per array element, so the expected line numbers below can be read off the indices.
  const fixture = (vmModule: string) =>
    [
      /*  1 */ vmModule,
      /*  2 */ "const lineOf = (error) => +error.stack.match(/^\\s+at .*:(\\d+):\\d+\\)?$/m)[1];",
      /*  3 */ "const results = {};",
      /*  4 */ 'const newline = (s) => s + "\\n";',
      /*  5 */ "results.afterStringArrow = lineOf(new Error());",
      // Declared right after the arrow function: its recorded start line is what the positions inside it are
      // computed from. (Skipping any block-bodied function in between would have resynchronized the line.)
      /*  6 */ "function declaredAfterwards() {",
      /*  7 */ "  results.inFunctionDeclaredAfterwards = lineOf(new Error());",
      /*  8 */ "}",
      /*  9 */ "declaredAfterwards();",
      /* 10 */ "const template = () => `a",
      /* 11 */ "b`;",
      /* 12 */ "results.afterTemplateArrow = lineOf(new Error());",
      /* 13 */ "function containing() {",
      /* 14 */ '  const inner = (s) => s + "\\n";',
      /* 15 */ "  results.inFunction = lineOf(new Error());",
      /* 16 */ "}",
      /* 17 */ "containing();",
      // The method's start line is recorded while the class body is parsed, right after the field's arrow
      // function; the start line of the arrow function in handlers is recorded while that field initializer is
      // parsed on its own when the instance is created, again right after an arrow function. (The bodies are on
      // their own lines because a one-line drift inside a construct the printer spreads over several lines
      // would map back to the same source line.)
      /* 18 */ "class K {",
      /* 19 */ '  newline = (s) => s + "\\n";',
      /* 20 */ "  fail() {",
      /* 21 */ "    return lineOf(new Error());",
      /* 22 */ "  }",
      /* 23 */ "  handlers = {",
      /* 24 */ '    newline: (s) => s + "\\n",',
      /* 25 */ "    fail: () => {",
      /* 26 */ "      return lineOf(new Error());",
      /* 27 */ "    },",
      /* 28 */ "  };",
      /* 29 */ "}",
      /* 30 */ "const k = new K();",
      /* 31 */ "results.inMethodAfterFieldArrow = k.fail();",
      /* 32 */ "results.inArrowAfterFieldInitializerArrow = k.handlers.fail();",
      // The Function constructor puts the body on line 3 of "function anonymous(lineOf\n) {\n...", and
      // vm.Script gets the source as is; neither goes through the transpiler.
      /* 33 */ 'results.inFunctionConstructor = new Function("lineOf", "const f = () => `a\\nb`;\\nreturn lineOf(new Error());")(lineOf);',
      /* 34 */ 'results.inVmScript = lineOf(new vm.Script("const g = () => `a\\nb`;\\nnew Error();", { filename: "script.js" }).runInThisContext());',
      /* 35 */ "console.log(JSON.stringify(results));",
    ].join("\n");

  const expected = {
    afterStringArrow: 5,
    inFunctionDeclaredAfterwards: 7,
    afterTemplateArrow: 12,
    inFunction: 15,
    inMethodAfterFieldArrow: 21,
    inArrowAfterFieldInitializerArrow: 26,
    inFunctionConstructor: 5,
    inVmScript: 3,
  };

  test("CommonJS module", async () => {
    using dir = tempDir("stack-after-multiline-arrow", { "fixture.cjs": fixture('const vm = require("node:vm");') });
    expect(JSON.parse(await run(String(dir), "fixture.cjs"))).toEqual(expected);
  });

  test("ES module", async () => {
    using dir = tempDir("stack-after-multiline-arrow", { "fixture.mjs": fixture('import vm from "node:vm";') });
    expect(JSON.parse(await run(String(dir), "fixture.mjs"))).toEqual(expected);
  });

  test("TypeScript enum with a line break in a member name", async () => {
    // The source contains no arrow function, but the enum is lowered to one, (E) => E[E[name] = 1] = name, where
    // name is printed as a template literal containing the line break, so the body ends in one.
    using dir = tempDir("stack-after-multiline-arrow", {
      "fixture.ts": [
        /* 1 */ "enum E {",
        /* 2 */ '  "a\\nb" = 1,',
        /* 3 */ "}",
        /* 4 */ "const afterEnum = new Error();",
        /* 5 */ "console.log(JSON.stringify({ afterEnum: +afterEnum.stack.match(/^\\s+at .*:(\\d+):\\d+\\)?$/m)[1], members: Object.keys(E) }));",
      ].join("\n"),
    });
    expect(JSON.parse(await run(String(dir), "fixture.ts"))).toEqual({ afterEnum: 4, members: ["1", "a\nb"] });
  });

  // The tests above pin absolute positions for a handful of shapes. This one covers the whole class of bug
  // without expected values: with BUN_JSC_useSourceProviderCache=false every function is parsed again instead
  // of being skipped, so whatever positions that run reports, the default run has to report the same ones, for
  // every kind of line-spanning token in every shape in which a function can follow the arrow function.
  test("positions are the same with JSC's SourceProviderCache disabled", async () => {
    const tokens = {
      "template": "`x\ny`",
      "template with CRLF": "`x\r\ny`",
      "template with LS": "`x\u2028y`",
      "template with an escaped line break": "`x\\\ny`",
      "template tail": "`${0}\ny`",
      "tagged template": "String.raw`x\ny`",
      "string with a line continuation": "'x\\\ny'",
      "single-line template": "`xy`",
    };
    // TOKEN is the arrow function body; `result` receives the Error created somewhere after the arrow function.
    const shapes = {
      "next statement": "var f = (a) => TOKEN;\nresult = new Error();",
      "same line": "var f = (a) => TOKEN; result = new Error();",
      "automatic semicolon insertion": "var f = (a) => TOKEN\nresult = new Error()",
      "call argument": "[].map((a) => TOKEN);\nresult = new Error();",
      "nested arrow functions": "var f = (a) => (b) => TOKEN;\nresult = new Error();",
      "async arrow function": "var f = async (a) => TOKEN;\nresult = new Error();",
      "function declared after it": "var f = (a) => TOKEN;\nfunction g() { result = new Error(); }\ng();",
      "async function declared after it": "var f = (a) => TOKEN;\nasync function g() { result = new Error(); }\ng();",
      "method after a field": "class C {\n  a = () => TOKEN;\n  m() { result = new Error(); }\n}\nnew C().m();",
      "static block after a field": "class C {\n  a = () => TOKEN;\n  static { result = new Error(); }\n}",
      "field initializer": "class C {\n  a = [() => TOKEN, () => { result = new Error(); }];\n}\nnew C().a[1]();",
      "static field initializer":
        "class C {\n  static a = [() => TOKEN, () => { result = new Error(); }];\n}\nC.a[1]();",
      "parameter default value": "function g(a = () => TOKEN) { result = new Error(); }\ng();",
      "arrow function parameter default value": "var g = (a = () => TOKEN) => { result = new Error(); };\ng();",
      "assignment pattern default value": "var a;\n[a = () => TOKEN] = [];\nresult = new Error();",
      "declaration pattern default value": "var [a = () => TOKEN] = [];\nresult = new Error();",
    };
    const corpus = [
      "globalThis.result = null;",
      `const tokens = ${JSON.stringify(tokens)};`,
      `const shapes = ${JSON.stringify(shapes)};`,
      "const lines = [];",
      "function record(name, run) {",
      "  result = null;",
      "  run();",
      "  lines.push(`${name}: ${result.line}:${result.column}`);",
      "}",
      "for (const [tokenName, token] of Object.entries(tokens)) {",
      "  for (const [shapeName, shape] of Object.entries(shapes)) {",
      '    const body = shape.replaceAll("TOKEN", token);',
      "    const name = `${shapeName}, ${tokenName}`;",
      "    record(`${name}, eval`, () => eval(body));",
      '    record(`${name}, function`, () => eval("(function () {\\n" + body + "\\n})")());',
      '    record(`${name}, function starting on the same line`, () => eval("(function () { " + body + "\\n})")());',
      "    record(`${name}, new Function`, () => new Function(body)());",
      "  }",
      "}",
      'console.log(lines.join("\\n"));',
    ].join("\n");
    using dir = tempDir("stack-after-multiline-arrow", { "corpus.js": corpus });

    const [withCache, withoutCache] = await Promise.all([
      run(String(dir), "corpus.js"),
      run(String(dir), "corpus.js", { BUN_JSC_useSourceProviderCache: "false" }),
    ]);
    const positions = withCache.trimEnd().split("\n");
    expect(positions).toHaveLength(Object.keys(tokens).length * Object.keys(shapes).length * 4);
    expect(positions).toEqual(withoutCache.trimEnd().split("\n"));
  });
});
