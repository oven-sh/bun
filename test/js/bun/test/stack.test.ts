import { $ } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, bunRun, normalizeBunSnapshot, tempDir } from "harness";
import { join } from "node:path";
import vm from "node:vm";

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

// When JSC's parser rejects a source it records that source's URL and line on the
// SyntaxError, and .stack renders them as a synthetic "at <parse> (url:line)" frame.
// Every other SyntaxError has no such location and must format like node's: the
// header followed by the real frames.
describe("SyntaxError .stack", () => {
  test("new SyntaxError() has no <parse> frame", () => {
    const err = new SyntaxError("user made");
    expect(normalizeBunSnapshot(err.stack!)).toMatchInlineSnapshot(`
      "SyntaxError: user made
          at <anonymous> (file:NN:NN)"
    `);
  });

  const caught = (fn: () => unknown) => {
    try {
      fn();
    } catch (e) {
      return e as Error;
    }
    throw new Error("expected fn to throw");
  };

  test.each([
    ["SyntaxError() called without new", () => SyntaxError("user made")],
    ["a SyntaxError subclass", () => new (class MySyntaxError extends SyntaxError {})("user made")],
    ["JSON.parse()", () => caught(() => JSON.parse("{"))],
    ["new RegExp()", () => caught(() => new RegExp("[a-0]"))],
  ])("%s has no <parse> frame", (_, make) => {
    const stack = make().stack!;
    expect(stack).not.toContain("<parse>");
    // The real frames are still there; the outermost one is this test callback.
    expect(stack.split("\n").at(-1)).toMatch(/^    at .*stack\.test\.ts:\d+:\d+\)?$/);
  });

  test("Error.captureStackTrace() on a SyntaxError adds no <parse> frame", () => {
    const err = new SyntaxError("captured");
    Error.captureStackTrace(err);
    expect(normalizeBunSnapshot(err.stack!)).toMatchInlineSnapshot(`
      "SyntaxError: captured
          at <anonymous> (file:NN:NN)"
    `);
  });

  test("a SyntaxError with no frames at all is just the header", () => {
    const err = new SyntaxError("no frames");
    // Math.max is not on the stack, so every frame is dropped.
    Error.captureStackTrace(err, Math.max);
    expect(err.stack).toBe("SyntaxError: no frames");
  });

  test("Bun.inspect() of a SyntaxError whose .stack was already read shows the real frame", () => {
    const err = new SyntaxError("inspected");
    // Once .stack is materialized the printer works from the string instead of the frames.
    void err.stack;
    const printed = Bun.inspect(err);
    expect(printed).toContain("SyntaxError: inspected");
    expect(printed).not.toContain("<parse>");
    expect(printed).toMatch(/stack\.test\.ts:\d+:\d+/);
  });

  test("an uncaught SyntaxError whose .stack was already read still reports where it was created", async () => {
    using dir = tempDir("syntax-error-stack", {
      "index.js": ['const err = new SyntaxError("boom");', "void err.stack;", "throw err;", ""].join("\n"),
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout).toBe("");
    expect(stderr).toContain("SyntaxError: boom");
    expect(stderr).not.toContain("<parse>");
    expect(stderr).toMatch(/index\.js:1:\d+/);
    expect(exitCode).toBe(1);
  });

  test("a parser SyntaxError keeps its <parse> frame", () => {
    const err = caught(() => new vm.Script("\n\n/[a-0]/", { filename: "my-script.js" }));
    expect(err.stack!.split("\n")).toContain("    at <parse> (my-script.js:3)");
  });

  test("a parser SyntaxError in a source without a URL has no <parse> frame", () => {
    // There is no file to point at, so an "at <parse> (:1)" line would only be noise.
    // Not new Function("{") or eval: those materialize .stack from inside JSC's own parse-error
    // path, which never checks for an exception from the stack hook, so they abort under
    // BUN_JSC_validateExceptionChecks (see #30823). node:vm's path checks.
    const stack = caught(() => vm.compileFunction("{")).stack!;
    expect(stack).not.toContain("<parse>");
    expect(stack.split("\n").at(-1)).toMatch(/^    at .*stack\.test\.ts:\d+:\d+\)?$/);

    // The same source with a URL keeps the frame.
    const named = caught(() => vm.compileFunction("{", [], { filename: "named.js" })).stack!;
    expect(named.split("\n")).toContain("    at <parse> (named.js:1)");
  });

  test("a parser SyntaxError from importing a module keeps its <parse> frame", async () => {
    // Bun's transpiler accepts these modules; JSC's parser rejects the regex. A top-level
    // await import() fails while no JS frame is on the stack, so the errors only get frames
    // (and a .stack) from Error.captureStackTrace.
    const badModule = ["module.exports = 1;", '"".match(/[a-0]/);', ""].join("\n");
    using dir = tempDir("parse-error-import", {
      "bad-a.cjs": badModule,
      "bad-b.cjs": badModule,
      "index.mjs": `
        let a, b;
        try {
          await import("./bad-a.cjs");
        } catch (e) {
          a = e;
        }
        try {
          await import("./bad-b.cjs");
        } catch (e) {
          b = e;
        }
        // Math.max is not on the stack, so no frames are captured for a.
        Error.captureStackTrace(a, Math.max);
        Error.captureStackTrace(b);
        console.log(JSON.stringify([a.stack, b.stack]));
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.mjs"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    const [noFrames, withFrames] = JSON.parse(stdout) as [string, string];
    expect(noFrames.split("\n")).toEqual([
      expect.stringMatching(/^SyntaxError: /),
      expect.stringMatching(/^    at <parse> \(.*bad-a\.cjs:\d+\)$/),
    ]);
    expect(withFrames.split("\n").slice(0, 3)).toEqual([
      expect.stringMatching(/^SyntaxError: /),
      expect.stringMatching(/^    at <parse> \(.*bad-b\.cjs:\d+\)$/),
      expect.stringMatching(/^    at .*index\.mjs:\d+:\d+\)?$/),
    ]);
    expect(exitCode).toBe(0);
  });
});
