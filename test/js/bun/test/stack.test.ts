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
        originalColumn: 22,
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

// The runtime transpiler used to rewrite `new Error(x)` into `Error(x)`. A construct expression is
// never a tail call, but in strict mode a call in return position is one, and JSC implements proper
// tail calls, so the function that created the error vanished from the error's own stack.
describe("a function that returns a freshly constructed Error appears in its stack", () => {
  const fixture = /* js */ `
    class AppError extends Error {}
    function returnsNew() { return new Error("a"); }
    function returnsLocal() { const err = new TypeError("b"); return err; }
    const returnsFromArrow = () => new RangeError("c");
    function returnsAggregate() { return new AggregateError([], "d"); }
    function returnsBranch(flag) { return flag ? new ReferenceError("e") : new URIError("f"); }
    function returnsSubclass() { return new AppError("g"); }

    const results = [];
    for (const make of [returnsNew, returnsLocal, returnsFromArrow, returnsAggregate, returnsBranch, returnsSubclass]) {
      const error = make(true);
      const firstFrame = error.stack.split("\\n").find(line => /^\\s+at /.test(line));
      results.push({ error: error.constructor.name, createdIn: firstFrame.trim().split(" ")[1] });
    }
    console.log(JSON.stringify(results));
  `;

  const expected = [
    { error: "Error", createdIn: "returnsNew" },
    { error: "TypeError", createdIn: "returnsLocal" },
    { error: "RangeError", createdIn: "returnsFromArrow" },
    { error: "AggregateError", createdIn: "returnsAggregate" },
    { error: "ReferenceError", createdIn: "returnsBranch" },
    { error: "AppError", createdIn: "returnsSubclass" },
  ];

  test.concurrent.each([
    ["ES module", "fixture.mjs", fixture],
    ["strict-mode CommonJS", "fixture.cjs", `"use strict";\n${fixture}`],
    ["sloppy-mode CommonJS", "fixture.cjs", fixture],
  ])("%s", async (_, filename, source) => {
    using dir = tempDir("stack-new-error", { [filename]: source });
    await using proc = Bun.spawn({
      cmd: [bunExe(), filename],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual(expected);
    expect(exitCode).toBe(0);
  });
});
