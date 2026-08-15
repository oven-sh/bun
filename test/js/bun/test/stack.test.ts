import { $ } from "bun";
import { expect, test } from "bun:test";
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

// JSC holds an error's captured frames weakly. When a GC runs before .stack is first read and one
// of the frames has died, the stack is rendered to a string inside the GC instead of on first
// access. The header line must come out the same either way.
test("error.stack header keeps name and message when the frames are rendered during GC", async () => {
  class MyError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "MyError";
    }
  }
  class ProtoNamed extends Error {}
  ProtoNamed.prototype.name = "ProtoNamed";

  // Runs `create` inside a function that nothing references once it has returned, so the deadFrame
  // frame recorded in each error is dead by the time the GC below runs.
  const inDeadFrame = <T>(create: () => T): T =>
    new Function("create", "return function deadFrame() { return create(); }")(create)();
  const errors: Record<string, Error> = {
    typeError: inDeadFrame(() => new TypeError("path argument is required to res.sendFile")),
    noMessage: inDeadFrame(() => new RangeError()),
    nameSetInConstructor: inDeadFrame(() => new MyError("custom subclass")),
    nameOnPrototype: inDeadFrame(() => new ProtoNamed("from the prototype")),
    nameReassigned: inDeadFrame(() => Object.assign(new Error("renamed"), { name: "Renamed" })),
    messageReassigned: inDeadFrame(() =>
      Object.assign(new Error("original"), { message: "changed before first read" }),
    ),
    emptyName: inDeadFrame(() => Object.assign(new Error("only the message"), { name: "" })),
    numberMessage: inDeadFrame(() => Object.assign(new Error("original"), { message: 404 })),
    bigintMessage: inDeadFrame(() => Object.assign(new Error("original"), { message: 10n })),
    objectName: inDeadFrame(() => Object.assign(new Error("object name"), { name: {} })),
    thrownAndCaught: inDeadFrame(() => {
      try {
        throw new SyntaxError("thrown and caught");
      } catch (e) {
        return e as Error;
      }
    }),
    thrownByTheEngine: inDeadFrame(() => {
      try {
        (null as any).property;
      } catch (e) {
        return e as Error;
      }
    }),
    captureStackTrace: inDeadFrame(() => {
      const e = new TypeError("captured");
      Error.captureStackTrace(e);
      return e;
    }),
  };

  // Not waiting for anything: yielding once resumes this function on a fresh stack, so nothing the
  // calls above left behind can keep a deadFrame alive through the collection.
  await Bun.sleep(0);
  Bun.gc(true);

  const headers: Record<string, string> = {};
  for (const [label, error] of Object.entries(errors)) {
    const [header, ...frames] = error.stack!.split("\n");
    headers[label] = header;
    // A dead frame in the trace is what makes the GC render it, so its presence proves this stack
    // took that path.
    expect(frames, label).toEqual(expect.arrayContaining([expect.stringMatching(/^    at deadFrame \(/)]));
  }
  expect(headers).toEqual({
    typeError: "TypeError: path argument is required to res.sendFile",
    noMessage: "RangeError",
    nameSetInConstructor: "MyError: custom subclass",
    nameOnPrototype: "ProtoNamed: from the prototype",
    nameReassigned: "Renamed: renamed",
    messageReassigned: "Error: changed before first read",
    emptyName: "only the message",
    numberMessage: "Error: 404",
    bigintMessage: "Error: 10",
    objectName: "Error: object name",
    thrownAndCaught: "SyntaxError: thrown and caught",
    thrownByTheEngine: `TypeError: ${errors.thrownByTheEngine.message}`,
    captureStackTrace: "TypeError: captured",
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
