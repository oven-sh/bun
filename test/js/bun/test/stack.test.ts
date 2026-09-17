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

// A callback that native code runs (a tick, a timer, a microtask, a test body) hands what it throws to the
// printer inside a JSC::Exception. The name-and-message line says nothing about a thrown object, so the
// object is printed as well, above the frames of the throw.
describe("a value thrown from a callback that native code runs", () => {
  const entryPoints = ["nextTick", "setTimeout", "setImmediate", "queueMicrotask"];

  const fixture = `const [, , entryPoint, kind] = process.argv;
class Thing {
  why = "details the user needs";
}
function thrower() {
  if (kind === "object") throw new Thing();
  if (kind === "string") throw "only a string";
  if (kind === "error") throw new Error("an error");
  if (kind === "resolve") require("./does-not-exist");
  throw Object.assign(new String("hostile"), { toString() { throw 1; }, [Symbol.toPrimitive]() { throw 1; } });
}
switch (entryPoint) {
  case "nextTick": process.nextTick(thrower); process.nextTick(() => console.log("the next tick ran")); break;
  case "setTimeout": setTimeout(thrower, 1); break;
  case "setImmediate": setImmediate(thrower); break;
  case "queueMicrotask": queueMicrotask(thrower); break;
}
`;

  // Debug builds show builtin frames unless told otherwise.
  const env = { BUN_JSC_showPrivateScriptsInStackTraces: "0" };

  // The report without the columns (a property of the transpiled module, not of the printer), the frames
  // below the throwing function (they differ per entry point) and the trailer that names the build.
  async function report(dir: string, entryPoint: string, kind: string) {
    const { stdout, stderr, exitCode } = await bunRun([join(dir, "fixture.js"), entryPoint, kind], env);
    const output = stderr
      .replaceAll(dir, "<dir>")
      .replaceAll("\\", "/")
      .split("\n")
      .filter(line => !/^\s+at (?!thrower )/.test(line) && !line.startsWith("Bun v"))
      .join("\n")
      .replace(/:(\d+):\d+\)$/gm, ":$1:<col>)")
      .replace(/^ +\^$/gm, "^")
      .trim();
    return { stdout, output, exitCode };
  }

  test.concurrent("an object is printed between the message and the frames of the throw", async () => {
    using dir = tempDir("thrown-object", { "fixture.js": fixture });
    const reports = await Promise.all(entryPoints.map(entryPoint => report(String(dir), entryPoint, "object")));
    const outputs = Object.fromEntries(entryPoints.map((entryPoint, i) => [entryPoint, reports[i].output]));
    expect(outputs).toEqual(Object.fromEntries(entryPoints.map(entryPoint => [entryPoint, outputs.nextTick])));
    expect(outputs.nextTick).toMatchInlineSnapshot(`
      "1 | const [, , entryPoint, kind] = process.argv;
      2 | class Thing {
      3 |   why = "details the user needs";
      4 | }
      5 | function thrower() {
      6 |   if (kind === "object") throw new Thing();
      ^
      error
      Thing {
        why: "details the user needs",
      }
            at thrower (<dir>/fixture.js:6:<col>)"
    `);
    expect(reports.map(({ exitCode }) => exitCode)).toEqual(entryPoints.map(() => 1));
  });

  test.concurrent("a string, an Error and a ResolveMessage are still printed once", async () => {
    using dir = tempDir("thrown-object", { "fixture.js": fixture });
    const [string, error, resolve] = await Promise.all(
      ["string", "error", "resolve"].map(kind => report(String(dir), "setTimeout", kind)),
    );
    expect(string.output).toMatchInlineSnapshot(`
      "2 | class Thing {
      3 |   why = "details the user needs";
      4 | }
      5 | function thrower() {
      6 |   if (kind === "object") throw new Thing();
      7 |   if (kind === "string") throw "only a string";
      ^
      error: only a string
            at thrower (<dir>/fixture.js:7:<col>)"
    `);
    expect(error.output).toMatchInlineSnapshot(`
      "3 |   why = "details the user needs";
      4 | }
      5 | function thrower() {
      6 |   if (kind === "object") throw new Thing();
      7 |   if (kind === "string") throw "only a string";
      8 |   if (kind === "error") throw new Error("an error");
      ^
      error: an error
            at thrower (<dir>/fixture.js:8:<col>)"
    `);
    expect(resolve.output).toMatchInlineSnapshot(`
      "4 | }
      5 | function thrower() {
      6 |   if (kind === "object") throw new Thing();
      7 |   if (kind === "string") throw "only a string";
      8 |   if (kind === "error") throw new Error("an error");
      9 |   if (kind === "resolve") require("./does-not-exist");
      ^
      ResolveMessage: Cannot find module './does-not-exist'
      Require stack:
      - <dir>/fixture.js
            at thrower (<dir>/fixture.js:9:<col>)"
    `);
  });

  test.concurrent("an object that throws while it is printed does not stop the ticks after it", async () => {
    using dir = tempDir("thrown-object", { "fixture.js": fixture });
    const { stdout, output, exitCode } = await report(String(dir), "nextTick", "hostile");
    expect(output).toMatch(/^error$/m);
    expect({ stdout, exitCode }).toEqual({ stdout: "the next tick ran", exitCode: 1 });
  });

  test.concurrent("bun test prints an object that a test body throws", async () => {
    using dir = tempDir("thrown-object", {
      "throws.test.js": `import { test } from "bun:test";
test("throws an object", () => {
  throw { why: "details the user needs" };
});
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
    expect(normalizeBunSnapshot(stderr, String(dir)).replace(/^ +\^$/gm, "^")).toMatchInlineSnapshot(`
      "throws.test.js:
      1 | import { test } from "bun:test";
      2 | test("throws an object", () => {
      3 |   throw { why: "details the user needs" };
      ^
      error
      {
        why: "details the user needs",
      }
          at <anonymous> (file:NN:NN)
      (fail) throws an object

       0 pass
       1 fail
      Ran 1 test across 1 file."
    `);
    expect(exitCode).toBe(1);
  });
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
