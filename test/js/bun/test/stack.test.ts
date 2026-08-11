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

// A test body that throws synchronously and an uncaught exception thrown from a
// callback both reach the error printer wrapped in the JSC exception that unwound
// the stack, whereas a rejection arrives as the Error itself. Both forms have to
// print the same details.
describe("errors printed from an uncaught exception", () => {
  const throwErrorWithDetails = /* js */ `
    const err = new Error("outer failure", { cause: new Error("inner cause") });
    err.code = "ERR_FIXTURE";
    err.detail = 42;
    throw err;
  `;

  test.concurrent("bun test prints the properties and cause of a synchronously thrown error", async () => {
    using dir = tempDir("sync-throw-details", {
      "my.test.js": `import { test } from "bun:test";\ntest("sync throw", () => {${throwErrorWithDetails}});\n`,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "my.test.js"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "ignore",
      stderr: "pipe",
    });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    expect(normalizeBunSnapshot(stderr, String(dir))).toMatchInlineSnapshot(`
      "my.test.js:
      1 | import { test } from "bun:test";
      2 | test("sync throw", () => {
      3 |     const err = new Error("outer failure", { cause: new Error("inner cause") });
      4 |     err.code = "ERR_FIXTURE";
      5 |     err.detail = 42;
      6 |     throw err;
                    ^
      error: outer failure
       detail: 42,
         code: "ERR_FIXTURE"
          at <anonymous> (file:NN:NN)

      1 | import { test } from "bun:test";
      2 | test("sync throw", () => {
      3 |     const err = new Error("outer failure", { cause: new Error("inner cause") });
                                                                  ^
      error: inner cause
          at <anonymous> (file:NN:NN)
      (fail) sync throw

       0 pass
       1 fail
      Ran 1 test across 1 file."
    `);
    expect(exitCode).toBe(1);
  });

  test.concurrent("an uncaught exception thrown from a callback prints the properties and cause", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", `setTimeout(() => {${throwErrorWithDetails}});`],
      env: bunEnv,
      stdout: "ignore",
      stderr: "pipe",
    });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    expect(normalizeBunSnapshot(stderr)).toMatchInlineSnapshot(`
      "1 | setTimeout(() => {
      2 |     const err = new Error("outer failure", { cause: new Error("inner cause") });
      3 |     err.code = "ERR_FIXTURE";
      4 |     err.detail = 42;
      5 |     throw err;
                    ^
      error: outer failure
       detail: 42,
         code: "ERR_FIXTURE"
          at <anonymous> (file:NN:NN)

      1 | setTimeout(() => {
      2 |     const err = new Error("outer failure", { cause: new Error("inner cause") });
                                                                  ^
      error: inner cause
          at <anonymous> (file:NN:NN)

      Bun v<bun-version>"
    `);
    expect(exitCode).toBe(1);
  });

  test.concurrent("a synchronously thrown resolve error is still printed once", async () => {
    using dir = tempDir("sync-throw-resolve-message", {
      "my.test.js": `import { test } from "bun:test";\ntest("sync require", () => {\n  require("./does-not-exist");\n});\n`,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "my.test.js"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "ignore",
      stderr: "pipe",
    });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    // Debug builds add an internal `require` frame, which also moves the divot.
    const withoutStackFrames = stderr
      .split("\n")
      .filter(line => !/^\s*(at |\^\s*$)/.test(line))
      .join("\n");
    expect(normalizeBunSnapshot(withoutStackFrames, String(dir))).toMatchInlineSnapshot(`
      "my.test.js:
      1 | import { test } from "bun:test";
      2 | test("sync require", () => {
      ResolveMessage: Cannot find module './does-not-exist'
      Require stack:
      - <dir>/my.test.js
      (fail) sync require

       0 pass
       1 fail
      Ran 1 test across 1 file."
    `);
    expect(exitCode).toBe(1);
  });
});
