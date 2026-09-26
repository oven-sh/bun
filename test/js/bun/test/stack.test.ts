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
function OldStyleError(message) {
  this.message = message;
  this.name = "OldStyleError";
  Error.captureStackTrace(this, OldStyleError);
}
require("util").inherits(OldStyleError, Error);
function thrower() {
  if (kind === "object") throw new Thing();
  if (kind === "string") throw "only a string";
  if (kind === "error") throw new Error("an error");
  if (kind === "resolve") require("./does-not-exist");
  if (kind === "build") require("./syntax-error.js");
  if (kind === "inherits") throw new OldStyleError("made the old way");
  if (kind === "domexception") throw new DOMException("a DOMException", "AbortError");
  if (kind === "proxy-error") throw new Proxy(new Error("behind a Proxy"), {});
  if (kind === "proxy-object") throw new Proxy({ why: "details the user needs" }, {});
  if (kind === "getter") throw { get $$typeof() { throw 1; } };
  throw Object.assign(new String("hostile"), { toString() { throw 1; }, [Symbol.toPrimitive]() { throw 1; } });
}
switch (entryPoint) {
  case "nextTick": process.nextTick(thrower); process.nextTick(() => console.log("the next tick ran")); break;
  case "setTimeout": setTimeout(thrower, 1); break;
  case "setImmediate": setImmediate(thrower); break;
  case "queueMicrotask": queueMicrotask(thrower); break;
}
`;
  const files = {
    "fixture.js": fixture,
    "syntax-error.js": "const ok = 1;\nconst broken = ;\n",
    "proxy-chain.js": `let value = { why: "details the user needs" };
for (let i = 0; i < 1000; i++) value = new Proxy(value, {});
setTimeout(function thrower() {
  throw value;
}, 1);
`,
  };

  // Debug builds show builtin frames unless told otherwise.
  const env = { BUN_JSC_showPrivateScriptsInStackTraces: "0" };

  // The report without the columns (a property of the transpiled module, not of the printer), the frames
  // below the throwing function (they differ per entry point) and the trailer that names the build.
  async function report(dir: string, entryPoint: string, kind: string, file = "fixture.js") {
    const { stdout, stderr, exitCode } = await bunRun([join(dir, file), entryPoint, kind], env);
    const output = stderr
      .replaceAll("\\", "/")
      .replaceAll(dir.replaceAll("\\", "/"), "<dir>")
      .split("\n")
      .filter(line => !/^\s+at (?!thrower |<dir>)/.test(line) && !line.startsWith("Bun v"))
      .join("\n")
      .replace(/:(\d+):\d+(\)?)$/gm, ":$1:<col>$2")
      .replace(/^ +\^$/gm, "^")
      .trim();
    return { stdout, output, exitCode };
  }

  // The same report from every entry point; returns that report.
  async function reportFromEveryEntryPoint(kind: string) {
    using dir = tempDir("thrown-object", files);
    const reports = await Promise.all(entryPoints.map(entryPoint => report(String(dir), entryPoint, kind)));
    const outputs = Object.fromEntries(entryPoints.map((entryPoint, i) => [entryPoint, reports[i].output]));
    expect(outputs).toEqual(Object.fromEntries(entryPoints.map(entryPoint => [entryPoint, outputs.nextTick])));
    expect(reports.map(({ exitCode }) => exitCode)).toEqual(entryPoints.map(() => 1));
    return outputs.nextTick;
  }

  // The frame of `thrower` at the fixture line that contains `source`, as a report prints it.
  const throwerFrameAt = (source: string) =>
    `at thrower (<dir>/fixture.js:${fixture.split("\n").findIndex(line => line.includes(source)) + 1}:<col>)`;
  const framesOf = (output: string) =>
    output
      .split("\n")
      .filter(line => /^\s+at /.test(line))
      .map(line => line.trim());

  test.concurrent("an object is printed between the message and the frames of the throw", async () => {
    expect(await reportFromEveryEntryPoint("object")).toMatchInlineSnapshot(`
      "7 |   this.name = "OldStyleError";
       8 |   Error.captureStackTrace(this, OldStyleError);
       9 | }
      10 | require("util").inherits(OldStyleError, Error);
      11 | function thrower() {
      12 |   if (kind === "object") throw new Thing();
      ^
      error
      Thing {
        why: "details the user needs",
      }
            at thrower (<dir>/fixture.js:12:<col>)"
    `);
  });

  test.concurrent("a BuildMessage is printed with its own file, line and excerpt", async () => {
    expect(await reportFromEveryEntryPoint("build")).toMatchInlineSnapshot(`
      "11 | function thrower() {
      12 |   if (kind === "object") throw new Thing();
      13 |   if (kind === "string") throw "only a string";
      14 |   if (kind === "error") throw new Error("an error");
      15 |   if (kind === "resolve") require("./does-not-exist");
      16 |   if (kind === "build") require("./syntax-error.js");
      ^
      BuildMessage: Unexpected ;
      2 | const broken = ;
      ^
      error: Unexpected ;
          at <dir>/syntax-error.js:2:<col>
            at thrower (<dir>/fixture.js:16:<col>)"
    `);
  });

  test.concurrent("an old-style error (util.inherits, Error.captureStackTrace) gets no object dump", async () => {
    expect(await reportFromEveryEntryPoint("inherits")).toMatchInlineSnapshot(`
      "12 |   if (kind === "object") throw new Thing();
      13 |   if (kind === "string") throw "only a string";
      14 |   if (kind === "error") throw new Error("an error");
      15 |   if (kind === "resolve") require("./does-not-exist");
      16 |   if (kind === "build") require("./syntax-error.js");
      17 |   if (kind === "inherits") throw new OldStyleError("made the old way");
      ^
      OldStyleError: made the old way
            at thrower (<dir>/fixture.js:17:<col>)"
    `);
  });

  test.concurrent("a Proxy of an Error gets no object dump, a Proxy of an object is shown", async () => {
    using dir = tempDir("thrown-object", files);
    const [proxyOfError, proxyOfObject] = await Promise.all(
      ["proxy-error", "proxy-object"].map(kind => report(String(dir), "setTimeout", kind)),
    );
    expect(proxyOfError.output).toMatchInlineSnapshot(`
      "14 |   if (kind === "error") throw new Error("an error");
      15 |   if (kind === "resolve") require("./does-not-exist");
      16 |   if (kind === "build") require("./syntax-error.js");
      17 |   if (kind === "inherits") throw new OldStyleError("made the old way");
      18 |   if (kind === "domexception") throw new DOMException("a DOMException", "AbortError");
      19 |   if (kind === "proxy-error") throw new Proxy(new Error("behind a Proxy"), {});
      ^
      error: behind a Proxy
            at thrower (<dir>/fixture.js:19:<col>)"
    `);
    expect(proxyOfObject.output).toMatchInlineSnapshot(`
      "15 |   if (kind === "resolve") require("./does-not-exist");
      16 |   if (kind === "build") require("./syntax-error.js");
      17 |   if (kind === "inherits") throw new OldStyleError("made the old way");
      18 |   if (kind === "domexception") throw new DOMException("a DOMException", "AbortError");
      19 |   if (kind === "proxy-error") throw new Proxy(new Error("behind a Proxy"), {});
      20 |   if (kind === "proxy-object") throw new Proxy({ why: "details the user needs" }, {});
      ^
      error
      {
        why: "details the user needs",
      }
            at thrower (<dir>/fixture.js:20:<col>)"
    `);
    expect([proxyOfError.exitCode, proxyOfObject.exitCode]).toEqual([1, 1]);
  });

  test.concurrent("a Proxy chain too long to classify is not shown", async () => {
    using dir = tempDir("thrown-object", files);
    const { output, exitCode } = await report(String(dir), "setTimeout", "", "proxy-chain.js");
    expect(output).toMatchInlineSnapshot(`
      "1 | let value = { why: "details the user needs" };
      2 | for (let i = 0; i < 1000; i++) value = new Proxy(value, {});
      3 | setTimeout(function thrower() {
      4 |   throw value;
      ^
      error
            at thrower (<dir>/proxy-chain.js:4:<col>)"
    `);
    expect(exitCode).toBe(1);
  });

  test.concurrent("a string, an Error, a ResolveMessage and a DOMException are still printed once", async () => {
    using dir = tempDir("thrown-object", files);
    const [string, error, resolve, domException] = await Promise.all(
      ["string", "error", "resolve", "domexception"].map(kind => report(String(dir), "setTimeout", kind)),
    );
    expect(string.output).toMatchInlineSnapshot(`
      "8 |   Error.captureStackTrace(this, OldStyleError);
       9 | }
      10 | require("util").inherits(OldStyleError, Error);
      11 | function thrower() {
      12 |   if (kind === "object") throw new Thing();
      13 |   if (kind === "string") throw "only a string";
      ^
      error: only a string
            at thrower (<dir>/fixture.js:13:<col>)"
    `);
    expect(error.output).toMatchInlineSnapshot(`
      "9 | }
      10 | require("util").inherits(OldStyleError, Error);
      11 | function thrower() {
      12 |   if (kind === "object") throw new Thing();
      13 |   if (kind === "string") throw "only a string";
      14 |   if (kind === "error") throw new Error("an error");
      ^
      error: an error
            at thrower (<dir>/fixture.js:14:<col>)"
    `);
    expect(resolve.output).toMatchInlineSnapshot(`
      "10 | require("util").inherits(OldStyleError, Error);
      11 | function thrower() {
      12 |   if (kind === "object") throw new Thing();
      13 |   if (kind === "string") throw "only a string";
      14 |   if (kind === "error") throw new Error("an error");
      15 |   if (kind === "resolve") require("./does-not-exist");
      ^
      ResolveMessage: Cannot find module './does-not-exist'
      Require stack:
      - <dir>/fixture.js
            at thrower (<dir>/fixture.js:15:<col>)"
    `);
    expect(domException.output).toMatchInlineSnapshot(`
      "13 |   if (kind === "string") throw "only a string";
      14 |   if (kind === "error") throw new Error("an error");
      15 |   if (kind === "resolve") require("./does-not-exist");
      16 |   if (kind === "build") require("./syntax-error.js");
      17 |   if (kind === "inherits") throw new OldStyleError("made the old way");
      18 |   if (kind === "domexception") throw new DOMException("a DOMException", "AbortError");
      ^
      AbortError: a DOMException
            at thrower (<dir>/fixture.js:18:<col>)"
    `);
    expect([string, error, resolve, domException].map(({ exitCode }) => exitCode)).toEqual([1, 1, 1, 1]);
  });

  test.concurrent("an object whose $$typeof getter throws keeps the frames of the throw", async () => {
    using dir = tempDir("thrown-object", files);
    const { stdout, output, exitCode } = await report(String(dir), "nextTick", "getter");
    expect(output).toMatchInlineSnapshot(`
      "16 |   if (kind === "build") require("./syntax-error.js");
      17 |   if (kind === "inherits") throw new OldStyleError("made the old way");
      18 |   if (kind === "domexception") throw new DOMException("a DOMException", "AbortError");
      19 |   if (kind === "proxy-error") throw new Proxy(new Error("behind a Proxy"), {});
      20 |   if (kind === "proxy-object") throw new Proxy({ why: "details the user needs" }, {});
      21 |   if (kind === "getter") throw { get $$typeof() { throw 1; } };
      ^
      error
            at thrower (<dir>/fixture.js:21:<col>)"
    `);
    expect(framesOf(output)).toEqual([throwerFrameAt("get $$typeof()")]);
    expect({ stdout, exitCode }).toEqual({ stdout: "the next tick ran", exitCode: 1 });
  });

  test.concurrent("an object whose toString throws keeps the frames of the throw", async () => {
    using dir = tempDir("thrown-object", files);
    const { stdout, output, exitCode } = await report(String(dir), "nextTick", "hostile");
    expect(output).toMatchInlineSnapshot(`
      "17 |   if (kind === "inherits") throw new OldStyleError("made the old way");
      18 |   if (kind === "domexception") throw new DOMException("a DOMException", "AbortError");
      19 |   if (kind === "proxy-error") throw new Proxy(new Error("behind a Proxy"), {});
      20 |   if (kind === "proxy-object") throw new Proxy({ why: "details the user needs" }, {});
      21 |   if (kind === "getter") throw { get $$typeof() { throw 1; } };
      22 |   throw Object.assign(new String("hostile"), { toString() { throw 1; }, [Symbol.toPrimitive]() { throw 1; } });
      ^
      error

            at thrower (<dir>/fixture.js:22:<col>)"
    `);
    expect(framesOf(output)).toEqual([throwerFrameAt('new String("hostile")')]);
    expect({ stdout, exitCode }).toEqual({ stdout: "the next tick ran", exitCode: 1 });
  });

  test.concurrent("bun test prints an object that a test body throws, and no dump for an old-style error", async () => {
    using dir = tempDir("thrown-object", {
      "throws.test.js": `import { test } from "bun:test";
import { inherits } from "node:util";
function OldStyleError(message) {
  this.message = message;
  this.name = "OldStyleError";
  Error.captureStackTrace(this, OldStyleError);
}
inherits(OldStyleError, Error);
test("throws an object", () => {
  throw { why: "details the user needs" };
});
test("throws an old-style error", () => {
  throw new OldStyleError("made the old way");
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
       5 |   this.name = "OldStyleError";
       6 |   Error.captureStackTrace(this, OldStyleError);
       7 | }
       8 | inherits(OldStyleError, Error);
       9 | test("throws an object", () => {
      10 |   throw { why: "details the user needs" };
      ^
      error
      {
        why: "details the user needs",
      }
          at <anonymous> (file:NN:NN)
      (fail) throws an object
       8 | inherits(OldStyleError, Error);
       9 | test("throws an object", () => {
      10 |   throw { why: "details the user needs" };
      11 | });
      12 | test("throws an old-style error", () => {
      13 |   throw new OldStyleError("made the old way");
      ^
      OldStyleError: made the old way
          at <anonymous> (file:NN:NN)
      (fail) throws an old-style error

       0 pass
       2 fail
      Ran 2 tests across 1 file."
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
