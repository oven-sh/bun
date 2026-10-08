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

test("uncaught error thrown from a data: URL module longer than a path buffer is annotated for GitHub Actions", async () => {
  // Longer than a path buffer on every platform (98302 bytes on Windows).
  const padding = 100_000;
  const dataUrlModule = 'export default function fromDataUrl() { throw new Error("boom"); }//';
  const base64 = btoa(dataUrlModule + Buffer.alloc(padding, "x").toString());

  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const source = ${JSON.stringify(dataUrlModule)} + Buffer.alloc(${padding}, "x").toString();
       const m = await import("data:text/javascript;base64," + btoa(source));
       m.default();`,
    ],
    env: { ...bunEnv, GITHUB_ACTIONS: "true" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

  const annotation = stderr.split("\n").find(line => line.startsWith("::error"));
  expect(annotation).toStartWith(`::error file=data%3Atext/javascript;base64%2C${base64},line=1,col=`);
  expect(annotation).toContain(`%0A      at fromDataUrl (data:text/javascript;base64,${base64}:1:`);
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

// JSC binds an anonymous `export default` to the private name `*default*` and shows it as "default"
// once `name` is reified. A frame must say "default" too, as node does, whether or not something
// has read `.name` yet.
describe("an anonymous export default is named 'default' in frames", () => {
  const modules = {
    "function.mjs": `export default function () { return new Error("function").stack; }`,
    "async-function.mjs": `export default async function () { return new Error("async function").stack; }`,
    "generator.mjs": `export default function* () { yield new Error("generator").stack; }`,
    "class.mjs": `export default class { constructor() { this.stack = new Error("class").stack; } }`,
    "subclass.mjs": `
      class Base { constructor() { this.stack = new Error("subclass").stack; } }
      export default class extends Base {}
    `,
    "arrow.mjs": `export default () => new Error("arrow").stack;`,
    "expression.mjs": `export default (function () { return new Error("expression").stack; });`,
    // Only the private name is mapped. A function that is named starDefault keeps its name.
    "named-star-default.mjs": `export default function starDefault() { return new Error("starDefault").stack; }`,
    "throws.mjs": `export default function () { throw new Error("thrown by an anonymous default export"); }`,
    "uncaught.mjs": `
      import thrower from "./throws.mjs";
      thrower();
    `,
    "unhandled-rejection.mjs": `
      import thrower from "./throws.mjs";
      Promise.resolve().then(() => thrower());
    `,
    "main.mjs": `
      import fn from "./function.mjs";
      import asyncFn from "./async-function.mjs";
      import generator from "./generator.mjs";
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

      const observe = async () => ({
        function: frameNames(fn(), 1),
        asyncFunction: frameNames(await asyncFn(), 1),
        generator: frameNames(generator().next().value, 1),
        class: frameNames(new Class().stack, 1),
        subclass: frameNames(new Subclass().stack, 2),
        arrow: frameNames(arrow(), 1),
        expression: frameNames(expression(), 1),
        starDefault: frameNames(starDefault(), 1),
        callSites: [topCallSite(fn), topCallSite(() => new Class().stack), topCallSite(arrow)],
      });

      const beforeReadingName = await observe();
      const names = [fn, asyncFn, generator, Class, Subclass, arrow, expression, starDefault].map(value => value.name);
      const afterReadingName = await observe();
      console.log(JSON.stringify({ beforeReadingName, names, afterReadingName }));
    `,
  };

  const expected = {
    function: ["default"],
    asyncFunction: ["default"],
    generator: ["default"],
    class: ["new default"],
    subclass: ["new Base", "new default"],
    arrow: ["default"],
    expression: ["default"],
    starDefault: ["starDefault"],
    callSites: [
      ["default", false],
      ["default", true],
      ["default", false],
    ],
  };

  test.concurrent("error.stack and CallSite#getFunctionName", async () => {
    using dir = tempDir("export-default-frame-name", modules);
    await using proc = Bun.spawn({
      cmd: [bunExe(), "main.mjs"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout && JSON.parse(stdout), stderr, exitCode }).toEqual({
      stdout: {
        beforeReadingName: expected,
        names: ["default", "default", "default", "default", "default", "default", "default", "starDefault"],
        afterReadingName: expected,
      },
      stderr: "",
      exitCode: 0,
    });
  });

  // The printer of an uncaught error names its frames through its own lookup, not through error.stack.
  test.concurrent.each(["uncaught.mjs", "unhandled-rejection.mjs"])(
    "the frames printed for an uncaught error: %s",
    async entry => {
      using dir = tempDir("export-default-frame-name", modules);
      await using proc = Bun.spawn({
        cmd: [bunExe(), entry],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      const firstFrame = normalizeBunSnapshot(stderr, dir)
        .split("\n")
        .map(line => line.trim())
        .find(line => line.startsWith("at "));
      expect({ stdout, firstFrame, exitCode }).toEqual({
        stdout: "",
        firstFrame: "at default (file:NN:NN)",
        exitCode: 1,
      });
    },
  );
});
