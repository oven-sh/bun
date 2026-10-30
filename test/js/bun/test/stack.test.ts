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

// JavaScriptCore binds an anonymous default export to the private name `*default*`, whose text is
// "starDefault". The name of the function is "default", as in node, whether or not `.name` was read.
describe("a frame of an anonymous default export is named default", () => {
  const modules = {
    "class.mjs": `export default class { constructor() { this.stack = new Error("class").stack; } }`,
    "subclass.mjs": `
      class Base { constructor() { this.stack = new Error("subclass").stack; } }
      export default class extends Base {}
    `,
    "arrow.mjs": `export default () => new Error("arrow").stack;`,
    "expression.mjs": `export default (function () { return new Error("expression").stack; });`,
    // A call in tail position that throws leaves no function object for its frame.
    "tail-call.mjs": `
      const notAFunction = 1;
      export default () => notAFunction();
    `,
    // A function that is really named starDefault keeps its name.
    "named-star-default.mjs": `export default function starDefault() { return new Error("starDefault").stack; }`,
    "throws.mjs": `export default class { constructor() { throw new Error("thrown by an anonymous default export"); } }`,
    "derived.mjs": `export default class extends Object { constructor() { super(); return 1; } }`,
    "uncaught.mjs": `
      import Thrower from "./throws.mjs";
      new Thrower();
    `,
    "unhandled-rejection.mjs": `
      import Thrower from "./throws.mjs";
      Promise.resolve().then(() => new Thrower());
    `,
    "main.mjs": `
      import { SourceTextModule } from "node:vm";
      import Class from "./class.mjs";
      import Subclass from "./subclass.mjs";
      import arrow from "./arrow.mjs";
      import expression from "./expression.mjs";
      import tailCall from "./tail-call.mjs";
      import starDefault from "./named-star-default.mjs";
      import Derived from "./derived.mjs";

      // The text of a SourceTextModule reaches JavaScriptCore as it is written.
      async function defaultExportOf(source) {
        const module = new SourceTextModule(source);
        await module.link(() => {});
        await module.evaluate();
        return module.namespace.default;
      }
      const declaration = await defaultExportOf('export default function () { return new Error("declaration").stack; }');
      const generator = await defaultExportOf('export default function* () { yield new Error("generator").stack; }');
      const asyncDeclaration = await defaultExportOf(
        'export default async function () { await null; return new Error("async declaration").stack; }',
      );
      const asyncGenerator = await defaultExportOf(
        'export default async function* () { await null; yield new Error("async generator").stack; }',
      );

      const frameNames = (stack, count) =>
        stack
          .split("\\n")
          .slice(1, 1 + count)
          .map(line => line.trim().replace(/^at /, "").replace(/ \\(.*$/, ""));

      const stackOfThrown = fn => {
        try {
          fn();
        } catch (error) {
          return error.stack;
        }
      };

      const messageOf = fn => {
        try {
          fn();
        } catch (error) {
          return error.message;
        }
      };

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
        class: frameNames(new Class().stack, 1),
        subclass: frameNames(new Subclass().stack, 2),
        arrow: frameNames(arrow(), 1),
        expression: frameNames(expression(), 1),
        tailCall: frameNames(stackOfThrown(tailCall), 1),
        declaration: frameNames(declaration(), 1),
        generator: frameNames(generator().next().value, 1),
        asyncDeclaration: frameNames(await asyncDeclaration(), 1),
        asyncGenerator: frameNames((await asyncGenerator().next()).value, 1),
        starDefault: frameNames(starDefault(), 1),
        callSites: [topCallSite(() => new Class().stack), topCallSite(arrow), topCallSite(declaration)],
        // The text of these two errors has the name of the class.
        messages: [messageOf(() => Class()), messageOf(() => new Derived())],
      });

      const beforeReadingName = await observe();
      const names = [Class, Subclass, arrow, expression, tailCall, declaration, generator, asyncDeclaration, asyncGenerator, starDefault].map(fn => fn.name);
      const afterReadingName = await observe();
      console.log(JSON.stringify({ beforeReadingName, names, afterReadingName }));
    `,
  };

  const expected = {
    class: ["new default"],
    subclass: ["new Base", "new default"],
    arrow: ["default"],
    expression: ["default"],
    tailCall: ["default"],
    declaration: ["default"],
    generator: ["default"],
    asyncDeclaration: ["default"],
    asyncGenerator: ["default"],
    starDefault: ["starDefault"],
    callSites: [
      ["default", true],
      ["default", false],
      ["default", false],
    ],
    messages: [
      "Cannot call a class constructor default without |new|",
      "Cannot return a non-object type in the constructor of a derived class default.",
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
    expect({ result: stdout && JSON.parse(stdout), stderr, exitCode }).toEqual({
      result: {
        beforeReadingName: expected,
        names: [...Array(9).fill("default"), "starDefault"],
        afterReadingName: expected,
      },
      stderr: "",
      exitCode: 0,
    });
  });

  // Bun's error printer names the frames of an error that nothing caught.
  test.concurrent.each([
    ["uncaught.mjs", ["at new default (file:NN:NN)", "at <dir>/uncaught.mjs"]],
    ["unhandled-rejection.mjs", ["at new default (file:NN:NN)", "at <anonymous> (file:NN:NN)"]],
  ])("frames printed for an uncaught error: %s", async (entry, frames) => {
    using dir = tempDir("export-default-frame-name", modules);
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
