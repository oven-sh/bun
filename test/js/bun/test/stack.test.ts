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

// JSC binds an anonymous `export default` to the internal `*default*` identifier and only maps it
// to the observable name "default" when the `name` property is reified. Frame names must say
// "default" too (as node does), whether or not something has read `.name` yet.
describe("anonymous export default is named 'default'", () => {
  const modules = {
    "class.mjs": `export default class { constructor() { this.stack = new Error("class").stack; } }`,
    "subclass.mjs": `
      class Base { constructor() { this.stack = new Error("subclass").stack; } }
      export default class extends Base {}
    `,
    "arrow.mjs": `export default () => new Error("arrow").stack;`,
    "expression.mjs": `export default (function () { return new Error("expression").stack; });`,
    // A function really called starDefault keeps its name; only the internal binding is renamed.
    "named-star-default.mjs": `export default function starDefault() { return new Error("starDefault").stack; }`,
    "throws.mjs": `export default class { constructor() { throw new Error("thrown by an anonymous default export"); } }`,
    "uncaught.mjs": `
      import Thrower from "./throws.mjs";
      new Thrower();
    `,
    "unhandled-rejection.mjs": `
      import Thrower from "./throws.mjs";
      Promise.resolve().then(() => new Thrower());
    `,
    "main.mjs": `
      import Class from "./class.mjs";
      import Subclass from "./subclass.mjs";
      import arrow from "./arrow.mjs";
      import expression from "./expression.mjs";
      import starDefault from "./named-star-default.mjs";

      const frameNames = (stack, count) =>
        stack
          .split("\\n")
          .slice(1, 1 + count)
          .map(line => line.trim().replace(/^at /, "").replace(/ \\(.*$/, ""));

      const topCallSite = getStack => {
        const previous = Error.prepareStackTrace;
        Error.prepareStackTrace = (_, callSites) => [callSites[0].getFunctionName(), callSites[0].isConstructor()];
        try {
          return getStack();
        } finally {
          Error.prepareStackTrace = previous;
        }
      };

      const observe = () => ({
        class: frameNames(new Class().stack, 1),
        subclass: frameNames(new Subclass().stack, 2),
        arrow: frameNames(arrow(), 1),
        expression: frameNames(expression(), 1),
        starDefault: frameNames(starDefault(), 1),
        callSites: [topCallSite(() => new Class().stack), topCallSite(arrow)],
      });

      const beforeReadingName = observe();
      const names = [Class.name, Subclass.name, arrow.name, expression.name, starDefault.name];
      const afterReadingName = observe();
      console.log(JSON.stringify({ beforeReadingName, names, afterReadingName }));
    `,
  };

  const expected = {
    class: ["new default"],
    subclass: ["new Base", "new default"],
    arrow: ["default"],
    expression: ["default"],
    starDefault: ["starDefault"],
    callSites: [
      ["default", true],
      ["default", false],
    ],
  };

  test.concurrent("error.stack and CallSite#getFunctionName", async () => {
    using dir = tempDir("export-default-name", modules);
    await using proc = Bun.spawn({
      cmd: [bunExe(), "main.mjs"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ result: JSON.parse(stdout), stderr, exitCode }).toEqual({
      result: {
        beforeReadingName: expected,
        names: ["default", "default", "default", "default", "starDefault"],
        afterReadingName: expected,
      },
      stderr: "",
      exitCode: 0,
    });
  });

  // Bun's own error printer names frames through a separate, GC-safe lookup from error.stack.
  test.concurrent.each([
    ["uncaught.mjs", ["at new default (file:NN:NN)", "at <dir>/uncaught.mjs"]],
    ["unhandled-rejection.mjs", ["at new default (file:NN:NN)", "at <anonymous> (file:NN:NN)"]],
  ])("frames printed for an uncaught error: %s", async (entry, frames) => {
    using dir = tempDir("export-default-name", modules);
    await using proc = Bun.spawn({
      cmd: [bunExe(), entry],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const printedFrames = normalizeBunSnapshot(stderr, String(dir))
      .split("\n")
      .map(line => line.trim().replace(/:\d+:\d+$/, ""))
      .filter(line => line.startsWith("at "));
    expect({ stdout, printedFrames, exitCode }).toEqual({ stdout: "", printedFrames: frames, exitCode: 1 });
  });
});
