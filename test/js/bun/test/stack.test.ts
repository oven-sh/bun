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

describe("own properties of a printed error are right-aligned to the longest name that is printed", () => {
  const message = "own property width";

  // A printed error looks like: (source preview), the `name: message` line, one
  // ` name: value` line per own property (right-aligned), a blank line, then the
  // stack frames. Returns the property lines. Trailing commas are dropped so
  // these tests only pin the alignment.
  function propertyLines(output: string): string[] {
    const lines = output.split("\n");
    const start = lines.findIndex(line => line.endsWith(`: ${message}`));
    if (start === -1) throw new Error(`message line not found in:\n${output}`);
    const block: string[] = [];
    for (const line of lines.slice(start + 1)) {
      if (line === "" || line.trimStart().startsWith("at ")) break;
      block.push(line.replace(/,$/, ""));
    }
    return block;
  }

  function expectPropertyLines(err: Error, expected: string[]) {
    expect(propertyLines(Bun.inspect(err))).toEqual(expected);
    expect(propertyLines(Bun.stripANSI(Bun.inspect(err, { colors: true })))).toEqual(expected);
  }

  function define(err: Error, name: string, descriptor: PropertyDescriptor): Error {
    Object.defineProperty(err, name, descriptor);
    return err;
  }

  class CodedError extends Error {}
  Object.defineProperty(CodedError.prototype, "code", { value: "E_X" });

  test.each<[string, () => Error, string[]]>([
    [
      "two printed properties",
      () => Object.assign(new Error(message), { id: 1, status: 500 }),
      ["     id: 1", " status: 500"],
    ],
    [
      "names longer than 10 characters do not widen the column further",
      () => Object.assign(new Error(message), { a: 1, averyveryverylongname: 2 }),
      ["          a: 1", " averyveryverylongname: 2"],
    ],
    [
      "an Error-valued property is printed after the stack trace, not in the block",
      () => Object.assign(new Error(message), { a: 1, someCause: new Error("inner") }),
      [" a: 1"],
    ],
    [
      "an Error-valued property with a name longer than 10 characters",
      () => Object.assign(new Error(message), { a: 1, averyveryverylongname: new Error("inner") }),
      [" a: 1"],
    ],
    [
      "an enumerable accessor is not printed",
      () => define(Object.assign(new Error(message), { a: 1 }), "longAccessor", { get: () => 1, enumerable: true }),
      [" a: 1"],
    ],
    [
      "an own enumerable name is shown on the message line",
      () => Object.assign(new Error(message), { name: "MyError", id: 1 }),
      [" id: 1"],
    ],
    [
      "an own enumerable message is shown on the message line",
      () => Object.assign(define(new Error(message), "message", { value: message, enumerable: true }), { id: 1 }),
      [" id: 1"],
    ],
    [
      "an own enumerable stack is shown as the stack trace",
      () => {
        const err = new Error(message);
        return Object.assign(define(err, "stack", { value: err.stack, enumerable: true }), { id: 1 });
      },
      [" id: 1"],
    ],
    [
      "an own string code is printed as the last line",
      () => Object.assign(new Error(message), { id: 1, code: "E_X" }),
      ["   id: 1", ' code: "E_X"'],
    ],
    [
      "a string code inherited from the prototype is printed as the last line",
      () => Object.assign(new CodedError(message), { id: 1 }),
      ["   id: 1", ' code: "E_X"'],
    ],
    [
      "a non-enumerable own string code is printed as the last line",
      () => Object.assign(define(new Error(message), "code", { value: "E_X" }), { id: 1 }),
      ["   id: 1", ' code: "E_X"'],
    ],
    [
      "a string code and an Error-valued property",
      () => Object.assign(new Error(message), { abc: 1, someCause: new Error("inner"), code: "E_X" }),
      ["  abc: 1", ' code: "E_X"'],
    ],
  ])("%s", (_, makeError, expected) => {
    expectPropertyLines(makeError(), expected);
  });

  test("an Error-valued property is still printed after the stack trace", () => {
    const output = Bun.inspect(Object.assign(new Error(message), { a: 1, someCause: new Error("inner marker") }));
    expect(output.indexOf("inner marker")).toBeGreaterThan(output.indexOf(" a: 1"));
  });

  test("inside a nested error, Error-valued properties are printed in the block and count toward the width", () => {
    const inner = Object.assign(new Error("inner"), { a: 1, someCause: new Error("deep") });
    const lines = Bun.inspect(new Error(message, { cause: inner })).split("\n");
    const colon = (name: string) => {
      const line = lines.find(line => line.trimStart().startsWith(`${name}:`));
      if (line === undefined) throw new Error(`${name} line not found in:\n${lines.join("\n")}`);
      return line.indexOf(":");
    };
    expect(colon("a")).toBe(colon("someCause"));
  });

  test("uncaught error", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const err = new Error(${JSON.stringify(message)});
         err.name = "MyError";
         err.id = 7;
         err.someCause = new Error("inner marker");
         throw err;`,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(propertyLines(stderr)).toEqual([" id: 7"]);
    expect(stderr.indexOf("inner marker")).toBeGreaterThan(stderr.indexOf(" id: 7"));
    expect({ stdout, exitCode }).toEqual({ stdout: "", exitCode: 1 });
  });
});
