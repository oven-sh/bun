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

test("error.stack is formatted lazily with live frames when a GC runs between creation and the first read", async () => {
  // Every error here is created inside a function object that is unreachable by the time
  // Bun.gc runs: the module's top-level callee before its first await, an IIFE, a .then
  // callback, an async function prologue, and Error.captureStackTrace inside an IIFE.
  // JSC used to hold the captured frames weakly and pre-render a frames-only string from the
  // GC end phase once one of them died. That string had no message and skipped
  // Error.prepareStackTrace.
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const tla = new Error("tla message");
       await 0;

       let iife;
       (function dies() { iife = new RangeError("iife message"); })();

       let then;
       await Promise.resolve().then(() => { then = new Error("then message"); });

       async function prologue() { const e = new TypeError("prologue message"); await 0; return e; }
       const asyncErr = await prologue();

       let captured;
       (function capturer() { captured = new Error("captured message"); Error.captureStackTrace(captured); })();

       let pst;
       (function pstFn() { pst = new Error("pst message"); })();

       // Collect from a fresh microtask so no stale stack slot keeps a callee alive.
       await 0;
       Bun.gc(true);

       const util = require("node:util");
       const head = s => s.split("\\n")[0];
       const results = {
         tla: head(tla.stack),
         iife: head(iife.stack),
         iifeFrame: iife.stack.split("\\n")[1].trim().split(" (")[0],
         then: head(then.stack),
         prologue: head(asyncErr.stack),
         prologueFrame: asyncErr.stack.split("\\n")[1].trim().split(" (")[0],
         captured: head(captured.stack),
         capturedFrame: captured.stack.split("\\n")[1].trim().split(" (")[0],
         inspect: head(util.inspect(iife)),
       };
       Error.prepareStackTrace = (err, callSites) =>
         "PST " + err.name + ": " + err.message + " | " + callSites.length + ":" + callSites[0].getFunctionName();
       results.pst = head(pst.stack);
       console.log(JSON.stringify(results));`,
    ],
    env: bunEnv,
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(JSON.parse(stdout)).toEqual({
    tla: "Error: tla message",
    iife: "RangeError: iife message",
    iifeFrame: "at dies",
    then: "Error: then message",
    prologue: "TypeError: prologue message",
    prologueFrame: "at prologue",
    captured: "Error: captured message",
    capturedFrame: "at capturer",
    inspect: "RangeError: iife message",
    pst: "PST Error: pst message | 2:pstFn",
  });
  expect(exitCode).toBe(0);
});
