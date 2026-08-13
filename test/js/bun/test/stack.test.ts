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

describe("uncaught error printer", () => {
  // A callback invoked from native code (timers, the microtask queue, process
  // lifecycle events) hands an error that escapes it to the printer wrapped in
  // a JSC::Exception. The printer must still print the Error itself: the stack
  // captured where it was constructed, its own properties and its cause, so
  // the output is the same as when the same error escapes synchronously.
  const exceptionEntryPoints = ["setTimeout", "setImmediate", "queueMicrotask", "beforeExit", "exit"];
  // nextTick callbacks run from JS, which reports the bare thrown value.
  const entryPoints = [...exceptionEntryPoints, "nextTick"];

  const fixture = `const [, , entryPoint, kind] = process.argv;
function make(message, options) {
  const err = new Error(message, options);
  err.code = "E_FIXTURE";
  return err;
}
function thrower() {
  const err =
    kind === "aggregate"
      ? new AggregateError([make("first"), make("second")], "two errors")
      : make("printed from the error itself", kind === "error" ? { cause: make("the cause") } : undefined);
  if (kind === "materialized") console.log(err.stack);
  throw err;
}
function throwString() {
  throw "not an error instance";
}
const callback = kind === "string" ? throwString : thrower;
switch (entryPoint) {
  case "sync": callback(); break;
  case "nextTick": process.nextTick(callback); break;
  case "setTimeout": setTimeout(callback, 1); break;
  case "setImmediate": setImmediate(callback); break;
  case "queueMicrotask": queueMicrotask(callback); break;
  case "beforeExit": process.on("beforeExit", callback); break;
  case "exit": process.on("exit", callback); break;
}
`;

  // Debug builds show builtin frames unless told otherwise.
  const env = { BUN_JSC_showPrivateScriptsInStackTraces: "0" };

  async function run(dir: string, entryPoint: string, kind: string) {
    const { stdout, stderr, exitCode } = await bunRun([join(dir, "fixture.js"), entryPoint, kind], env);
    const normalize = (text: string) => text.replaceAll(dir, "<dir>").replaceAll("\\", "/");
    return { stdout: normalize(stdout), stderr: normalize(stderr), exitCode };
  }

  // Keeps exactly the part of the output that is derived from the thrown
  // error. The entry points legitimately differ in the frames below `thrower`
  // (the synchronous variant has a top-level frame, the others were called
  // from native code), and the trailer names the build.
  function errorOwnedOutput({ stderr, exitCode }: { stderr: string; exitCode: number }) {
    const output = stderr
      .split("\n")
      .filter(line => !/^\s+at (?!make |thrower )/.test(line) && !line.startsWith("Bun v"))
      .join("\n")
      .trim();
    return { exitCode, output };
  }

  // Columns inside the transpiled module are not the subject here; the lines
  // (which source line the caret and the frames point at) are.
  const withoutColumns = (output: string) =>
    output.replace(/:(\d+):\d+(\)?)$/gm, ":$1:<col>$2").replace(/^ +\^$/gm, "^");

  const frameLines = (text: string) =>
    text
      .split("\n")
      .filter(line => /^\s+at /.test(line))
      .map(line => line.trim());

  async function compareWithSynchronousThrow(kind: string) {
    using dir = tempDir("uncaught-print", { "fixture.js": fixture });
    const [sync, ...results] = await Promise.all(
      ["sync", ...entryPoints].map(entryPoint => run(String(dir), entryPoint, kind)),
    );
    const expected = errorOwnedOutput(sync);
    expect(Object.fromEntries(entryPoints.map((entryPoint, i) => [entryPoint, errorOwnedOutput(results[i])]))).toEqual(
      Object.fromEntries(entryPoints.map(entryPoint => [entryPoint, expected])),
    );
    return { ...expected, results };
  }

  test.concurrent("an Error escaping a native entry point prints like a synchronous throw", async () => {
    const { exitCode, output } = await compareWithSynchronousThrow("error");
    expect(withoutColumns(output)).toMatchInlineSnapshot(`
      "1 | const [, , entryPoint, kind] = process.argv;
      2 | function make(message, options) {
      3 |   const err = new Error(message, options);
      ^
      error: printed from the error itself
       code: "E_FIXTURE"

            at make (<dir>/fixture.js:3:<col>)
            at thrower (<dir>/fixture.js:11:<col>)

      1 | const [, , entryPoint, kind] = process.argv;
      2 | function make(message, options) {
      3 |   const err = new Error(message, options);
      ^
      error: the cause
       code: "E_FIXTURE"

            at make (<dir>/fixture.js:3:<col>)
            at thrower (<dir>/fixture.js:11:<col>)"
    `);
    expect(exitCode).toBe(1);
  });

  test.concurrent(
    "an AggregateError escaping a native entry point prints each of its errors like a synchronous throw",
    async () => {
      const { exitCode, output } = await compareWithSynchronousThrow("aggregate");
      expect(output).toContain("error: first\n");
      expect(output).toContain("error: second\n");
      expect(exitCode).toBe(1);
    },
  );

  test.concurrent(
    "an Error whose .stack was already read is printed where error.stack says it was created",
    async () => {
      const { exitCode, results } = await compareWithSynchronousThrow("materialized");
      for (const { stdout, stderr } of results) {
        const [stackTop] = frameLines(stdout);
        expect(stackTop).toStartWith("at make (<dir>/fixture.js:3:");
        expect(frameLines(stderr)[0]).toBe(stackTop);
      }
      expect(exitCode).toBe(1);
    },
  );

  // `bun test` reports what a test body throws through the same printer.
  test.concurrent("bun test prints an error thrown by a test from the error itself", async () => {
    using dir = tempDir("uncaught-print", {
      "throws.test.js": `import { test } from "bun:test";
function makeAndThrow() {
  const err = new Error("outer", { cause: new Error("inner") });
  err.code = "E_OUTER";
  throw err;
}
test("throws", makeAndThrow);
`,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "throws.test.js"],
      cwd: String(dir),
      env: { ...bunEnv, ...env },
      stdout: "ignore",
      stderr: "pipe",
    });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    expect(frameLines(stderr)).toEqual([
      expect.stringMatching(/^at makeAndThrow \(.*throws\.test\.js:3:\d+\)$/),
      expect.stringMatching(/^at makeAndThrow \(.*throws\.test\.js:3:\d+\)$/),
    ]);
    expect(withoutColumns(normalizeBunSnapshot(stderr))).toMatchInlineSnapshot(`
      "throws.test.js:
      1 | import { test } from "bun:test";
      2 | function makeAndThrow() {
      3 |   const err = new Error("outer", { cause: new Error("inner") });
      ^
      error: outer
       code: "E_OUTER"
          at makeAndThrow (file:NN:NN)

      1 | import { test } from "bun:test";
      2 | function makeAndThrow() {
      3 |   const err = new Error("outer", { cause: new Error("inner") });
      ^
      error: inner
          at makeAndThrow (file:NN:NN)
      (fail) throws

       0 pass
       1 fail
      Ran 1 test across 1 file."
    `);
    expect(exitCode).toBe(1);
  });

  test.concurrent(
    "a thrown value that is not an Error is still printed with the frames of the throw site",
    async () => {
      using dir = tempDir("uncaught-print", { "fixture.js": fixture });
      const results = await Promise.all(exceptionEntryPoints.map(entryPoint => run(String(dir), entryPoint, "string")));
      for (const { stderr, exitCode } of results) {
        expect(stderr).toContain("error: not an error instance\n");
        expect(stderr).toMatch(/^\s+at throwString \(<dir>\/fixture\.js:16:\d+\)$/m);
        expect(exitCode).toBe(1);
      }
    },
  );
});
