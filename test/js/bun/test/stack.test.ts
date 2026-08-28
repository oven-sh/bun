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

test.concurrent(
  "error.stack is formatted lazily with live frames when a GC runs between creation and the first read",
  async () => {
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
  },
);

test.concurrent("frames stored into an old error are kept alive across an eden collection", async () => {
  // Two full collections promote the errors before any frame is stored into them. The frames
  // stored afterwards are young and belong to function objects that die at once, so only the
  // write barrier fired by the store keeps them marked through the next eden collection. A
  // missed barrier trips a debug assertion in ErrorInstance::reconcileWeakReferencesAtGCEnd.
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const { fullGC, edenGC } = require("bun:jsc");
       const captured = new Error("captured message");
       const dest = new Error("dest message");
       fullGC();
       fullGC();

       (function capturer() { Error.captureStackTrace(captured); })();
       let src;
       (function srcFn() { src = new Error("src message"); })();
       (function appender() { Error.appendStackTrace(src, dest); })();

       await 0;
       edenGC();
       edenGC();

       const head = s => s.split("\\n")[0];
       const frames = s => s.split("\\n").slice(1).map(l => l.trim().split(" (")[0]).map(f => f.includes(":") ? "at <top>" : f);
       console.log(JSON.stringify({
         captured: head(captured.stack),
         capturedFrames: frames(captured.stack),
         dest: head(dest.stack),
         destFrames: frames(dest.stack),
       }));`,
    ],
    env: bunEnv,
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(JSON.parse(stdout)).toEqual({
    captured: "Error: captured message",
    capturedFrames: ["at capturer", "at <top>"],
    dest: "Error: dest message",
    destFrames: ["at <top>", "at srcFn", "at <top>"],
  });
  expect(exitCode).toBe(0);
});

// An error keeps its captured frames alive until the first .stack read, as in V8. JSC used to hold
// them weakly: once a frame's callee died, the GC rendered the stack string itself, where
// Error.prepareStackTrace cannot run. A GC between the throw and the first read must not be observable.
describe.concurrent("Error.prepareStackTrace when a GC runs before the first .stack read", () => {
  async function runScript(script: string, args: string[] = []) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script, ...args],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { result: stdout && JSON.parse(stdout), stderr, exitCode };
  }

  test("the formatter runs and receives the call sites", async () => {
    // Each error's frames hold a callee that is garbage right after the call: the per-call closure
    // of an async function body, and a `new Function` callee. Error.captureStackTrace goes through
    // Bun's lazy .stack getter over the same frames.
    const script = `
      const callSites = {};
      Error.prepareStackTrace = (error, sites) => {
        callSites[error.message] = sites.map(site => site.getFunctionName());
        return "custom:" + error.message;
      };
      async function boom() {
        throw new Error("async");
      }
      const fromAsync = await boom().catch(error => error);
      const fromNewFunction = new Function("return new Error('new-function')")();
      const fromCaptureStackTrace = new Function(
        "const error = new Error('capture'); Error.captureStackTrace(error); return error;",
      )();
      if (process.argv[1] === "gc") Bun.gc(true);
      const stacks = {
        async: fromAsync.stack,
        newFunction: fromNewFunction.stack,
        captureStackTrace: fromCaptureStackTrace.stack,
      };
      console.log(JSON.stringify({ stacks, callSites }));`;

    const [withoutGC, withGC] = await Promise.all([runScript(script), runScript(script, ["gc"])]);
    expect(withoutGC).toEqual({
      result: {
        stacks: { async: "custom:async", newFunction: "custom:new-function", captureStackTrace: "custom:capture" },
        callSites: {
          "async": expect.arrayContaining(["boom"]),
          "new-function": expect.arrayContaining(["anonymous"]),
          "capture": expect.arrayContaining(["anonymous"]),
        },
      },
      stderr: "",
      exitCode: 0,
    });
    // The GC must not be observable.
    expect(withGC).toEqual(withoutGC);
  });

  test("a live error keeps its frames' callee alive until the first .stack read", async () => {
    // Like V8: the frames are released when .stack is materialized. Whether a released callee is
    // collected by a given GC is not asserted (it depends on the build), only that an unread error
    // still holds it, and that the formatter in place at the first read is the one that runs.
    const script = `
      Error.prepareStackTrace = (error, sites) => "custom:" + error.message;
      function make(message) {
        const callee = new Function("return new Error(" + JSON.stringify(message) + ")");
        return { error: callee(), callee: new WeakRef(callee) };
      }
      const unread = make("unread");
      const read = make("read");
      const readStack = read.error.stack;
      Bun.gc(true);
      const unreadCalleeAlive = unread.callee.deref() !== undefined;
      const unreadStack = unread.error.stack;
      Error.prepareStackTrace = undefined;
      const afterReset = make("after-reset");
      Bun.gc(true);
      const afterResetFormatter = afterReset.error.stack.startsWith("custom:") ? "user" : "default";
      console.log(JSON.stringify({ unreadCalleeAlive, readStack, unreadStack, afterResetFormatter }));`;

    expect(await runScript(script)).toEqual({
      result: {
        unreadCalleeAlive: true,
        readStack: "custom:read",
        unreadStack: "custom:unread",
        afterResetFormatter: "default",
      },
      stderr: "",
      exitCode: 0,
    });
  });

  test("another realm on the same VM resetting its own formatter does not affect this one", async () => {
    // A ShadowRealm gets its own global object on the same VM, with its own Error.prepareStackTrace.
    const script = `
      Error.prepareStackTrace = (error, sites) => "custom:" + error.message;
      const realm = new ShadowRealm();
      realm.evaluate("Error.prepareStackTrace = (error, sites) => 'shadow:' + error.message; Error.prepareStackTrace = undefined; 0");
      const error = new Function("return new Error('main')")();
      Bun.gc(true);
      console.log(JSON.stringify({ stack: error.stack }));`;

    expect(await runScript(script)).toEqual({ result: { stack: "custom:main" }, stderr: "", exitCode: 0 });
  });
});
