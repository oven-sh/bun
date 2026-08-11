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

// V8 reports a frame that is sitting at `new X(...)` at the `new` keyword. JSC's own position
// is the end of `X`. Bun.inspect and Error.prepareStackTrace CallSites already move it back to
// `new`; error.stack has to agree with them (and with Node).
describe("error.stack column of a frame at `new X(...)` is the `new` keyword", () => {
  // Keep this flush left: the expected line:column values below are positions in this source
  // (the leading newline is dropped, so `class Thrower` is line 1).
  const fixture = `
class Thrower {
  constructor() {
    throw new Error("thrown by Thrower");
  }
}
class MyError extends Error {}
class Captures {
  constructor(target) {
    Error.captureStackTrace(target);
  }
}
function customError() {
  throw new MyError("custom");
}
function globalConstructor() {
  return new Map(1);
}
function userConstructor() {
  return new Thrower(1);
}
function spreadArguments(args) {
  return new Map(...args);
}
function localBinding() {
  const Ctor = Thrower;
  return new Ctor(1);
}
function splitAcrossLines() {
  return new
    Map(1);
}
function viaCaptureStackTrace() {
  const target = {};
  new Captures(target);
  return target.stack;
}

// "fixture.js:LINE:COLUMN" of the frame for the function called \`name\`.
function frame(stack, name) {
  const line = stack.split("\\n").find(line => line.includes("at " + name + " ("));
  return line?.match(/fixture\\.js:\\d+:\\d+/)?.[0] ?? stack;
}
function caught(fn, ...args) {
  try {
    fn(...args);
  } catch (e) {
    return e;
  }
  throw new Error(fn.name + " did not throw");
}

const custom = caught(customError);
console.log(
  JSON.stringify({
    customError: frame(custom.stack, "customError"),
    customErrorLineColumn: [custom.line, custom.column],
    globalConstructor: frame(caught(globalConstructor).stack, "globalConstructor"),
    userConstructor: frame(caught(userConstructor).stack, "userConstructor"),
    spreadArguments: frame(caught(spreadArguments, [1]).stack, "spreadArguments"),
    localBinding: frame(caught(localBinding).stack, "localBinding"),
    splitAcrossLines: frame(caught(splitAcrossLines).stack, "splitAcrossLines"),
    viaCaptureStackTrace: frame(viaCaptureStackTrace(), "viaCaptureStackTrace"),
  }),
);
`;

  test.concurrent("in a transpiled file", async () => {
    using dir = tempDir("stack-new-column", { "fixture.js": fixture.slice(1) });
    const result = await bunRun(join(String(dir), "fixture.js"));
    expect(result).toSpawn();
    expect(JSON.parse(result.stdout)).toEqual({
      customError: "fixture.js:13:9",
      customErrorLineColumn: [13, 9],
      globalConstructor: "fixture.js:16:10",
      userConstructor: "fixture.js:19:10",
      spreadArguments: "fixture.js:22:10",
      localBinding: "fixture.js:26:10",
      splitAcrossLines: "fixture.js:29:10",
      viaCaptureStackTrace: "fixture.js:34:3",
    });
  });

  // eval'd code is not transpiled, so `new` and its callee can really be on different lines and
  // the position has to be recounted from the source text, which is 16-bit when the evaluated
  // string is not latin1. The same position feeds error.stack, Bun.inspect and CallSites.
  test.concurrent("in eval'd code with `new` on an earlier line than the callee", async () => {
    const script = `
const sources = {
  latin1: "// latin1\\nfunction construct() {\\n  return new\\n    Map(1);\\n}\\nconstruct();\\n",
  utf16: "// \\u4e2d\\u6587\\nfunction construct() {\\n  return new\\n    Map(1);\\n}\\nconstruct();\\n",
  // \`new\` on the first line of the source, and a line break right after the callee.
  firstLine: "function construct() { return new\\n  Map\\n  (1); }\\nconstruct();\\n",
};
const results = {};
for (const [name, source] of Object.entries(sources)) {
  const caught = () => {
    try {
      (0, eval)(source);
    } catch (e) {
      return e;
    }
  };
  const lineColumn = text => text.match(/at construct \\(.*:(\\d+):(\\d+)\\)/).slice(1).join(":");

  const stack = lineColumn(caught().stack);
  const inspect = lineColumn(Bun.inspect(caught()));

  const error = caught();
  Error.prepareStackTrace = (_, callSites) => callSites;
  const callSite = error.stack.find(callSite => callSite.getFunctionName() === "construct");
  Error.prepareStackTrace = undefined;

  results[name] = { stack, inspect, callSiteLine: callSite.getLineNumber() };
}
console.log(JSON.stringify(results));
`;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      latin1: { stack: "3:10", inspect: "3:10", callSiteLine: 3 },
      utf16: { stack: "3:10", inspect: "3:10", callSiteLine: 3 },
      firstLine: { stack: "1:31", inspect: "1:31", callSiteLine: 1 },
    });
    expect(exitCode).toBe(0);
  });
});
