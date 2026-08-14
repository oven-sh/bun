import { $ } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, bunRun, normalizeBunSnapshot } from "harness";
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

describe("own properties of a printed error are comma-separated, with no comma after the last one", () => {
  // An error prints as: message line, one line per own property, a blank line,
  // then the stack frames. Returns the lines between the message line and the
  // first stack frame.
  function linesBetweenMessageAndStack(output: string, messageLine: string): string[] {
    const lines = output.split("\n");
    const message = lines.indexOf(messageLine);
    if (message === -1) throw new Error(`${JSON.stringify(messageLine)} not found in:\n${output}`);
    const firstFrame = lines.findIndex((line, i) => i > message && line.trimStart().startsWith("at "));
    if (firstFrame === -1) throw new Error(`no stack frame after ${JSON.stringify(messageLine)} in:\n${output}`);
    return lines.slice(message + 1, firstFrame);
  }

  function expectPropertyLines(err: Error, expected: string[]) {
    expect(linesBetweenMessageAndStack(Bun.inspect(err), "error: own properties")).toEqual(expected);
    expect(
      linesBetweenMessageAndStack(Bun.stripANSI(Bun.inspect(err, { colors: true })), "error: own properties"),
    ).toEqual(expected);
  }

  test.each([
    ["one property", { rethrow: true }, [" rethrow: true", ""]],
    ["two properties", { extra: 42, rethrow: true }, ["   extra: 42,", " rethrow: true", ""]],
    [
      "a property and a string code (code is always printed last)",
      { code: "E_X", extra: 42 },
      [" extra: 42,", '  code: "E_X"', ""],
    ],
    ["only a string code", { code: "E_X" }, [' code: "E_X"', ""]],
    ["a non-string code", { code: 42 }, [" code: 42", ""]],
    ["no properties", {}, []],
    // Error-valued properties are not part of the list: they are printed in full after the stack trace.
    [
      "a property followed by an Error-valued property",
      { status: 500, cause: new Error("inner") },
      [" status: 500", ""],
    ],
    ["only an Error-valued property", { cause: new Error("inner") }, []],
  ])("%s", (_, properties, expected) => {
    expectPropertyLines(Object.assign(new Error("own properties"), properties), expected);
  });

  test("a property followed by an enumerable accessor (accessors are not printed)", () => {
    const err = Object.assign(new Error("own properties"), { a: 1 });
    Object.defineProperty(err, "b", { get: () => "not printed", enumerable: true });
    expectPropertyLines(err, [" a: 1", ""]);
  });

  test("uncaught error", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", `const err = new Error("uncaught"); err.extra = 42; err.rethrow = true; throw err;`],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(linesBetweenMessageAndStack(stderr, "error: uncaught")).toEqual(["   extra: 42,", " rethrow: true", ""]);
    expect({ stdout, exitCode }).toEqual({ stdout: "", exitCode: 1 });
  });
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
