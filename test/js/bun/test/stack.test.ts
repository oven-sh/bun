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

// JSC compiles the constructor of a class that declares none from a fixed source string, so these
// frames used to render as "new X (unknown:1:17)". Like V8, they should point at the `class` keyword.
describe("frames of a class without an explicit constructor", () => {
  test.concurrent("error.stack, error.sourceURL and error.line point at the class", async () => {
    using dir = tempDir("default-ctor-stack", {
      // Every position below is asserted on, so the lines are laid out deliberately. `// @bun` makes
      // bun load the file as-is: these are JSC's own positions, with no source map involved.
      "fixture.js": `// @bun
class Thrower { constructor() { this.err = new Error("T"); } }
export class Derived extends Thrower {}
export class Fields { err = new Error("F"); }
function later() {
    class Later extends Thrower {}
    return new Later().err;
}
function sameLine() { class SameLine extends Thrower {} return new SameLine().err; }
const Anon = class extends Thrower {};
class Nullary extends null {}
let nullary;
try { new Nullary(); } catch (e) { nullary = e; }
const norm = s => String(s).replaceAll(import.meta.path, "<fixture>");
const frame = (err, name) => norm(err.stack.split("\\n").map(l => l.trim()).find(l => l.startsWith("at new " + name + " ")));
console.log(JSON.stringify({
  derived: frame(new Derived().err, "Derived"),
  fields: frame(new Fields().err, "Fields"),
  later: frame(later(), "Later"),
  sameLine: frame(sameLine(), "SameLine"),
  anon: frame(new Anon().err, "Anon"),
  nullary: { sourceURL: norm(nullary.sourceURL), line: nullary.line, column: nullary.column },
}));
`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "fixture.js"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      // The `class` keyword, not `export`, like V8.
      derived: "at new Derived (<fixture>:3:8)",
      // A base class: its default constructor is what runs the field initializer.
      fields: "at new Fields (<fixture>:4:8)",
      later: "at new Later (<fixture>:6:5)",
      // On the first line of a function body, JSC's own column for the class counts from the
      // function rather than from the line (it would give 9:6).
      sameLine: "at new SameLine (<fixture>:9:23)",
      anon: "at new Anon (<fixture>:10:14)",
      // The default constructor of `Nullary` is the top frame: `super()` is what throws.
      nullary: { sourceURL: "<fixture>", line: 11, column: 1 },
    });
    expect(exitCode).toBe(0);
  });

  test.concurrent("the class position is source mapped back to the original file", async () => {
    using dir = tempDir("default-ctor-stack-sourcemap", {
      // The interface and the type alias are removed by the transpiler, so the positions JSC reports
      // differ from the ones in this file.
      "fixture.ts": `interface Shape {
  width: number;
}
class Thrower {
  err: Error;
  constructor() {
    this.err = new Error("T");
  }
}
export class Derived extends Thrower {}
function later(): Error {
  type Unused = Shape;
  class Later extends Thrower {}
  return new Later().err;
}
const norm = (s: string | undefined) => String(s).replaceAll(import.meta.path, "<fixture>");
const frame = (err: Error, name: string) =>
  norm(err.stack!.split("\\n").map(l => l.trim()).find(l => l.startsWith("at new " + name + " ")));
console.log(JSON.stringify({ derived: frame(new Derived().err, "Derived"), later: frame(later(), "Later") }));
`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "fixture.ts"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      derived: "at new Derived (<fixture>:10:8)",
      later: "at new Later (<fixture>:13:3)",
    });
    expect(exitCode).toBe(0);
  });

  test.concurrent("an uncaught error thrown by the default constructor is printed at the class", async () => {
    using dir = tempDir("default-ctor-stack-uncaught", {
      "fixture.js": "class Nullary extends null {}\nnew Nullary();\n",
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "fixture.js"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toBe("");
    expect(stderr).toContain("1 | class Nullary extends null {}\n    ^\n");
    expect(stderr).toMatch(/^\s+at new Nullary \(.*fixture\.js:1:1\)/m);
    expect(exitCode).toBe(1);
  });
});
