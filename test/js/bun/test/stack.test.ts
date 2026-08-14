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

// Class fields are evaluated by a function JSC synthesizes per class (one for the instance fields, one for the
// static fields and blocks). It shows up in stack traces under the names V8 uses for it. Before, JSC hid it, so an
// error created while a field was initialized reported the constructor's position instead of the field's (debug
// builds, which show JSC's hidden frames, rendered it as `<anonymous>`).
describe("class field initializer frames", () => {
  type ErrorWithPosition = Error & { line: number; sourceURL: string };
  const firstLines = (error: Error, count: number) =>
    normalizeBunSnapshot(error.stack!.split("\n").slice(0, count).join("\n"));

  test("instance field", () => {
    class WithField {
      field = new Error("from a field");
    }
    expect(firstLines(new WithField().field, 3)).toMatchInlineSnapshot(`
      "Error: from a field
          at <instance_members_initializer> (file:NN:NN)
          at new WithField (file:NN:NN)"
    `);
  });

  test("instance field of a class with a constructor", () => {
    class WithConstructor {
      field = new Error("from a field");
      constructor() {
        Object.freeze(this);
      }
    }
    expect(firstLines(new WithConstructor().field, 3)).toMatchInlineSnapshot(`
      "Error: from a field
          at <instance_members_initializer> (file:NN:NN)
          at new WithConstructor (file:NN:NN)"
    `);
  });

  test("instance field of a derived class", () => {
    class Base {}
    class Derived extends Base {
      field = new Error("from a field");
    }
    expect(firstLines(new Derived().field, 3)).toMatchInlineSnapshot(`
      "Error: from a field
          at <instance_members_initializer> (file:NN:NN)
          at new Derived (file:NN:NN)"
    `);
  });

  test("function called by an instance field", () => {
    let captured: Error;
    function createError() {
      captured = new Error("from a function a field calls");
    }
    class WithField {
      field = createError();
    }
    new WithField();
    expect(firstLines(captured!, 4)).toMatchInlineSnapshot(`
      "Error: from a function a field calls
          at createError (file:NN:NN)
          at <instance_members_initializer> (file:NN:NN)
          at new WithField (file:NN:NN)"
    `);
  });

  test("static field", () => {
    class WithStaticField {
      static field = new Error("from a static field");
    }
    expect(firstLines(WithStaticField.field, 2)).toMatchInlineSnapshot(`
      "Error: from a static field
          at <static_initializer> (file:NN:NN)"
    `);
  });

  test("static block", () => {
    let captured: Error;
    class WithStaticBlock {
      static {
        captured = new Error("from a static block");
      }
    }
    expect(firstLines(captured!, 3)).toMatchInlineSnapshot(`
      "Error: from a static block
          at <anonymous> (file:NN:NN)
          at <static_initializer> (file:NN:NN)"
    `);
  });

  test("field whose definition throws", () => {
    class ReturningSealedObject {
      constructor() {
        return Object.preventExtensions({});
      }
    }
    class WithField extends ReturningSealedObject {
      field = 1;
    }
    let thrown!: Error;
    try {
      new WithField();
    } catch (error) {
      thrown = error as Error;
    }
    expect(firstLines(thrown, 3)).toMatchInlineSnapshot(`
      "TypeError: Attempting to define property on object that is not extensible.
          at <instance_members_initializer> (file:NN:NN)
          at new WithField (file:NN:NN)"
    `);
  });

  test("a function created by a field does not run inside the initializer", () => {
    let captured: Error;
    class WithArrowField {
      handler = () => {
        captured = new Error("from an arrow function a field created");
      };
    }
    new WithArrowField().handler();
    expect(captured!.stack).toContain("at handler (");
    expect(captured!.stack).not.toContain("<instance_members_initializer>");
  });

  test("err.line and err.sourceURL point at the field", () => {
    class WithField {
      field = new Error("from a field") as ErrorWithPosition;
    }
    const reference = new Error("created two lines below the field") as ErrorWithPosition;
    const { line, sourceURL } = new WithField().field;
    expect({ line, sourceURL }).toEqual({ line: reference.line - 2, sourceURL: reference.sourceURL });
  });

  test.concurrent(
    "err.line and err.column inside field initializers are the engine's positions in the file",
    async () => {
      // `// @bun` keeps the transpiler out of it, so these are the engine's own positions. The `new Error()` columns
      // are compared with the one reported for `reference`, which is outside of any class, so the test does not depend
      // on where inside a `new Error()` expression the engine puts the position; a definition that throws is reported
      // at the field's name. `outer` has its class on its own first line, where positions used to be measured from
      // the start of the function instead of the start of the line.
      const lines = [
        "// @bun",
        "let inArrow, notDefinable;",
        'function outer() { class E { fn = () => { inArrow = new Error("in an arrow function created by a field"); }; } new E().fn(); }',
        "outer();",
        'const reference = new Error("reference");',
        'class F { field = new Error("in a field"); }',
        "const inField = new F().field;",
        "class Sealed { constructor() { return Object.preventExtensions({}); } }",
        "class G extends Sealed { notDefinableField = 1; }",
        "try { new G(); } catch (e) { notDefinable = e; }",
        "console.log(JSON.stringify([inArrow, reference, inField, notDefinable].map(e => [e.line, e.column])));",
      ];
      using dir = tempDir("field-initializer-positions", { "positions.js": lines.join("\n") + "\n" });
      await using proc = Bun.spawn({
        cmd: [bunExe(), "positions.js"],
        env: bunEnv,
        cwd: String(dir),
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      const [inArrow, reference, inField, notDefinable] = JSON.parse(stdout) as [number, number][];
      expect(reference[0]).toBe(5);
      const newErrorColumn = (lineNumber: number) =>
        lines[lineNumber - 1].indexOf("new Error(") - lines[4].indexOf("new Error(") + reference[1];
      expect({ inArrow, inField, notDefinable }).toEqual({
        inArrow: [3, newErrorColumn(3)],
        inField: [6, newErrorColumn(6)],
        notDefinable: [9, lines[8].indexOf("notDefinableField") + 1],
      });
      expect(exitCode).toBe(0);
    },
  );

  test.concurrent("the uncaught error printer shows the initializer frame with the field's line", async () => {
    using dir = tempDir("field-initializer-uncaught", {
      "app.js": [
        "import { loadConfig } from './config.js';",
        "",
        "class Service {",
        "  config = loadConfig();",
        "}",
        "",
        "new Service();",
        "",
      ].join("\n"),
      "config.js": ["export function loadConfig() {", '  throw new Error("no config");', "}", ""].join("\n"),
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "app.js"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
    });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    const frames = stderr.split(/\r?\n/).filter(line => /^\s+at /.test(line));
    expect(frames.slice(0, 3).map(frame => frame.replace(/^\s+at /, "").replace(/:\d+\)$/, ")"))).toEqual([
      expect.stringMatching(/^loadConfig \(.*config\.js:2\)$/),
      expect.stringMatching(/^<instance_members_initializer> \(.*app\.js:4\)$/),
      expect.stringMatching(/^new Service \(/),
    ]);
    expect(exitCode).toBe(1);
  });
});
