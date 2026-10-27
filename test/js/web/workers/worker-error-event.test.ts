import { describe, expect, test } from "bun:test";
import { once } from "events";
import { bunEnv, bunExe, isASAN, isDebug, tempDir } from "harness";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";

// A worker whose source starts with this line also posts what the 'error' event on its own global scope says.
const reportInside = `self.addEventListener("error", ({ filename, lineno, colno }) => postMessage({ filename, lineno, colno }));\n`;
const blobURL = (source: string) => URL.createObjectURL(new Blob([source], { type: "text/javascript" }));

// What the 'error' event on the Worker object says, and everything the worker posted before it closed.
async function errorEvents(url: string | URL, post?: unknown) {
  const worker = new Worker(url);
  const posted: any[] = [];
  worker.onmessage = event => posted.push(event.data);
  const { promise, resolve, reject } = Promise.withResolvers<ErrorEvent>();
  worker.addEventListener("error", resolve, { once: true });
  const closed = once(worker, "close");
  closed.then(() => reject(new Error("the worker closed without an 'error' event")));
  if (post !== undefined) worker.postMessage(post);
  const { message, filename, lineno, colno, error } = await promise;
  await closed;
  return { parent: { filename, lineno, colno }, message, error, posted };
}

// https://github.com/oven-sh/bun/issues/23473
describe.concurrent("a Worker's 'error' event says where the error is from", () => {
  test("an Error thrown at the top level: where the script made it", async () => {
    const url = blobURL(reportInside + `\nthrow new TypeError("Hello, world!")`);
    const where = { filename: url, lineno: 3, colno: 11 };
    const { parent, message, error, posted } = await errorEvents(url);
    expect({ parent, error, posted }).toEqual({ parent: where, error: null, posted: [where] });
    expect(message).toContain("TypeError: Hello, world!");
  });

  // Each source comes after the line of `reportInside`. The column is the one `stack` gives that frame.
  test.each([
    [
      "an Error: its innermost frame",
      `function outer() { inner(); }\nfunction inner() {\n  throw new Error("deep");\n}\nouter();`,
      4,
      13,
    ],
    ["an unhandled rejection: where the Error was made", `Promise.reject(new RangeError("rejected"));`, 2, 20],
    ["reportError(): where the Error was made", `reportError(new Error("reported"));`, 2, 17],
    [
      "an Error of a class with no constructor: the script's `new`",
      `class Quiet extends Error {}\nthrow new Quiet("sub");`,
      3,
      11,
    ],
    ["an Error a timer threw: the throw", `setTimeout(() => {\n  throw new Error("later");\n}, 1);`, 3, 26],
    [
      "an Error made earlier that a timer threw: the throw",
      `const early = new Error("made early");\nsetTimeout(() => {\n  throw early;\n}, 1);`,
      4,
      9,
    ],
    ["a number a timer threw: the throw", `setTimeout(() => {\n  throw 5;\n}, 1);`, 3, 9],
    [
      "an Error an event listener threw: the throw",
      `const target = new EventTarget();\ntarget.addEventListener("x", () => {\n  throw new Error("in listener");\n});\nsetTimeout(() => target.dispatchEvent(new Event("x")), 1);`,
      4,
      32,
    ],
    [
      "a number an event listener threw: the throw",
      `const target = new EventTarget();\ntarget.addEventListener("x", () => {\n  throw 5;\n});\nsetTimeout(() => target.dispatchEvent(new Event("x")), 1);`,
      4,
      9,
    ],
    ["an Error a microtask threw: the throw", `queueMicrotask(() => {\n  throw new Error("micro");\n});`, 3, 26],
    [
      "an Error a builtin threw under a timer: the script's call",
      `setTimeout(() => {\n  [].reduce((a, b) => a + b);\n}, 1);`,
      3,
      6,
    ],
    [
      "an Error a module built into Bun threw under a timer: the script's call",
      `const WebSocket = require("ws");\nsetTimeout(() => {\n  new WebSocket("not a url");\n}, 1);`,
      4,
      7,
    ],
    [
      "an EventEmitter 'error' nobody listens for, emitted under a timer: the script's emit()",
      `const { EventEmitter } = require("node:events");\nconst emitter = new EventEmitter();\nsetTimeout(() => emitter.emit("error", "str"), 1);`,
      4,
      26,
    ],
    [
      "an object that is not a native Error, thrown by a timer: the throw",
      `function LegacyError() { Error.captureStackTrace(this, LegacyError); }\nsetTimeout(() => {\n  throw new LegacyError();\n}, 1);`,
      4,
      13,
    ],
    [
      "an Error without calling the script's Error.prepareStackTrace",
      `Error.prepareStackTrace = () => { postMessage("prepareStackTrace ran"); return "custom"; };\nthrow new Error("prepared");`,
      3,
      11,
    ],
    [
      "an Error whose stack was read: the same as before",
      `const early = new Error("made early");\nvoid early.stack;\nthrow early;`,
      2,
      19,
    ],
    [
      "an Error a collection took the frames of: the same as before",
      `const early = (() => new Error("made early"))();\nawait new Promise(resolve => setImmediate(resolve));\nBun.gc(true);\nthrow early;`,
      2,
      44,
    ],
    [
      "an Error out of structuredClone(): where the first one was made",
      `throw structuredClone(new Error("cloned"));`,
      2,
      27,
    ],
    ["a DOMException that native code threw: the script's call", `structuredClone(() => {});`, 2, 1],
    [
      "a DOMException that native code threw in an async function: the script's call",
      `(async () => {\n  await 1;\n  structuredClone(() => {});\n})();`,
      4,
      3,
    ],
    [
      "a call in tail position that a host function failed: the first frame of the script still on the stack",
      `function parse(text) {\n  return JSON.parse(text);\n}\nparse("{");`,
      5,
      1,
    ],
  ])("%s", async (_, source, lineno, colno) => {
    const url = blobURL(reportInside + source);
    const where = { filename: url, lineno, colno };
    const { parent, error, posted } = await errorEvents(url);
    expect({ parent, error, posted }).toEqual({ parent: where, error: null, posted: [where] });
  });

  // An Error whose first frame with a position is inside JavaScriptCore or Bun says nothing, before
  // and after its stack is read: that frame is the one its `line` and `column` name. The script's
  // call is the goal.
  test.each([
    ["an Error a builtin threw at the top level", `[].reduce((a, b) => a + b);`],
    [
      "that Error once its stack was read",
      `try {\n  [].reduce((a, b) => a + b);\n} catch (error) {\n  void error.stack;\n  throw error;\n}`,
    ],
    ["an Error a module built into Bun threw at the top level", `new (require("ws"))("not a url");`],
    [
      "that Error once its stack was read",
      `try {\n  new (require("ws"))("not a url");\n} catch (error) {\n  void error.stack;\n  throw error;\n}`,
    ],
  ])("no place inside the runtime for %s", async (_, source) => {
    const url = blobURL(reportInside + source);
    const nowhere = { filename: "", lineno: 0, colno: 0 };
    const { parent, error, posted } = await errorEvents(url);
    expect({ parent, error, posted }).toEqual({ parent: nowhere, error: null, posted: [nowhere] });
  });

  // These report "", 0, 0. Only a native Error and a DOMException that native code made carry a
  // position of their own, and no JSC::Exception comes with the value of an entry that failed.
  test.todo.each([
    ["a number thrown at the top level", `throw 5;`, 2],
    ["a DOMException the script made, thrown at the top level", `throw new DOMException("dom msg", "AbortError");`, 2],
    [
      "an object that is not a native Error, thrown at the top level",
      `function LegacyError() { Error.captureStackTrace(this, LegacyError); }\nthrow new LegacyError();`,
      3,
    ],
    [
      "an Error whose stack was read under the script's Error.prepareStackTrace",
      `Error.prepareStackTrace = () => "custom";\nconst early = new Error("made early");\nvoid early.stack;\nthrow early;`,
      3,
    ],
  ])("%s: its line", async (_, source, lineno) => {
    const url = blobURL(reportInside + source);
    const { parent, posted } = await errorEvents(url);
    expect({ parent: { ...parent, colno: 0 }, inside: { ...posted[0], colno: 0 } }).toEqual({
      parent: { filename: url, lineno, colno: 0 },
      inside: { filename: url, lineno, colno: 0 },
    });
  });

  // workers/support/ErrorEvent.js of the web platform tests, unchanged. Worker_ErrorEvent_filename.htm,
  // Worker_ErrorEvent_lineno.htm and Worker_ErrorEvent_message.htm post to it and read the Worker's event.
  const wptErrorEvent = `onmessage = function(evt)
{
    throw(new Error(evt.data));
}

onerror = function(message, location, line, col)
{
    postMessage( {"message": message, "filename": location, "lineno": line, "colno": col} );
    return false; // "not handled" so the error propagates up to the Worker object
}
`;

  test("an Error the worker's onmessage threw: the throw, as the web platform tests expect", async () => {
    using dir = tempDir("worker-error-event", { "ErrorEvent.js": wptErrorEvent });
    const url = pathToFileURL(path.join(String(dir), "ErrorEvent.js")).href;
    const { parent, message } = await errorEvents(url, "Error Message");
    expect({ filename: parent.filename, lineno: parent.lineno }).toEqual({ filename: url, lineno: 3 });
    expect(message).toContain("Error Message");
  });

  // WorkerGlobalScope_ErrorEvent_filename.htm, _lineno.htm, _colno.htm and _message.htm read what that
  // file's onerror posts. The worker's onerror is called with the event alone, not with these four.
  test.todo("the worker's onerror gets the message, the filename, the line and the column", async () => {
    using dir = tempDir("worker-error-event", { "ErrorEvent.js": wptErrorEvent });
    const url = pathToFileURL(path.join(String(dir), "ErrorEvent.js")).href;
    const { posted } = await errorEvents(url, "Error Message");
    expect(posted).toEqual([
      { message: expect.stringContaining("Error Message"), filename: url, lineno: 3, colno: expect.any(Number) },
    ]);
  });

  test.each([
    ["a number the worker's onmessage threw: the throw", `self.onmessage = () => {\n  throw 5;\n};`, 3, 9],
    [
      "an Error the worker's async onmessage rejected with: where it was made",
      `self.onmessage = async () => {\n  await 1;\n  throw new Error("async");\n};`,
      4,
      13,
    ],
  ])("%s", async (_, source, lineno, colno) => {
    const url = blobURL(reportInside + source);
    const where = { filename: url, lineno, colno };
    const { parent, error, posted } = await errorEvents(url, "go");
    expect({ parent, error, posted }).toEqual({ parent: where, error: null, posted: [where] });
  });

  test("the module that threw: its URL and its line before transpiling", async () => {
    using dir = tempDir("worker-error-event", {
      "worker.ts": `import { thrower, url } from "./thrower.ts";\n${reportInside}postMessage(url);\nthrower();\n`,
      "thrower.ts": `interface Unused { a: number }\ntype AlsoUnused = string | number;\nexport const url: string = import.meta.url;\nexport function thrower(): never {\n  throw new RangeError("from thrower.ts");\n}\n`,
    });
    const { parent, posted } = await errorEvents(pathToFileURL(path.join(String(dir), "worker.ts")));
    const [url, inside] = posted;
    const where = { filename: url, lineno: 5, colno: 13 };
    expect({ parent, inside }).toEqual({ parent: where, inside: where });
    expect(fileURLToPath(url)).toBe(path.join(String(dir), "thrower.ts"));
  });

  test("an entry named with a query and a fragment: the URL the module has", async () => {
    using dir = tempDir("worker-error-event", {
      "worker.mjs": `${reportInside}postMessage(import.meta.url);\nthrow new TypeError("from the entry");\n`,
    });
    const entry = pathToFileURL(path.join(String(dir), "worker.mjs")).href;
    const { parent, posted } = await errorEvents(entry + "?v=1#frag");
    const where = { filename: entry, lineno: 3, colno: 11 };
    expect({ parent, posted }).toEqual({ parent: where, posted: [entry, where] });
  });

  test("a CommonJS entry's throw: the entry's URL", async () => {
    using dir = tempDir("worker-error-event", {
      "worker.cjs": `const { pathToFileURL } = require("node:url");\n${reportInside}postMessage(pathToFileURL(__filename).href);\nthrow new TypeError("from a CommonJS entry");\n`,
    });
    const { parent, posted } = await errorEvents(pathToFileURL(path.join(String(dir), "worker.cjs")));
    const [url, inside] = posted;
    const where = { filename: url, lineno: 4, colno: 11 };
    expect({ parent, inside }).toEqual({ parent: where, inside: where });
  });

  test("a module that does not parse, required under a timer: the script's require()", async () => {
    using dir = tempDir("worker-error-event", {
      "worker.cjs": `${reportInside}function load() {\n  return require("./broken.cjs");\n}\nsetTimeout(load, 1);\n`,
      "broken.cjs": `const y = ;\n`,
    });
    const url = pathToFileURL(path.join(String(dir), "worker.cjs")).href;
    const where = { filename: url, lineno: 3, colno: 3 };
    const { parent, error, posted } = await errorEvents(url);
    expect({ parent, error, posted }).toEqual({ parent: where, error: null, posted: [where] });
  });

  test("a data: URL worker's throw: that URL", async () => {
    const url = "data:text/javascript,throw new Error('from a data URL')";
    const { parent, error, posted } = await errorEvents(url);
    expect({ parent, error, posted }).toEqual({
      parent: { filename: url, lineno: 1, colno: 11 },
      error: null,
      posted: [],
    });
  });

  test("a SyntaxError that only JavaScriptCore's parser finds: the line in the source, and no column", async () => {
    using dir = tempDir("worker-error-event", { "entry.ts": `type Unused = string;\n\n"".match(/[a-0]/);\n` });
    const entry = path.join(String(dir), "entry.ts");
    const { parent, message } = await errorEvents(pathToFileURL(entry));
    expect({ ...parent, filename: fileURLToPath(parent.filename) }).toEqual({ filename: entry, lineno: 3, colno: 0 });
    expect(message).toContain("SyntaxError");
  });

  test("a value whose console rendering throws: still that value, to a listener in the worker", async () => {
    // What the rendering threw reached that listener as event.error, as a JSC::Exception: touching
    // it ended the process.
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const source = \`
          const thrown = { [Symbol.for("nodejs.util.inspect.custom")]() { throw new Error("the rendering threw"); } };
          self.addEventListener("error", event => postMessage([event.error === thrown, String(event.error)]));
          throw thrown;\`;
        const worker = new Worker(URL.createObjectURL(new Blob([source], { type: "text/javascript" })));
        worker.onmessage = event => console.log("inside", ...event.data);
        worker.onerror = event => console.log("parent", event.error);
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({
      stdout: `inside true [object Object]\nparent null\n`,
      stderr: "",
      exitCode: 0,
    });
  });
});

// One at a time: each builds an executable. That copies the runtime, which takes most of a test's time
// on a debug or sanitizer build.
describe("a Worker's 'error' event in a compiled executable", () => {
  // As in `stack`: a frame of an executable is in the bundle, unless a source map names its source.
  test.skipIf(isDebug || isASAN).each([
    ["with a source map: the source and its line", "inline" as const, "thrower.ts", 4],
    ["without a source map: the bundle", "none" as const, "worker.js", undefined],
  ])("%s", async (_, sourcemap, file, line) => {
    using dir = tempDir("worker-error-event-compile", {
      "main.ts": `const worker = new Worker(new URL("./worker.ts", import.meta.url).href);\nworker.onerror = ({ filename, lineno }) => console.log(JSON.stringify({ filename, lineno }));\n`,
      "worker.ts": `import { thrower } from "./lib/thrower.ts";\nthrower();\n`,
      "lib/thrower.ts": `interface Unused { a: number }\ntype AlsoUnused = string | number;\nexport function thrower(): never {\n  throw new RangeError("from thrower.ts");\n}\n`,
    });
    const result = await Bun.build({
      entrypoints: [path.join(String(dir), "main.ts"), path.join(String(dir), "worker.ts")],
      compile: { outfile: path.join(String(dir), "app") },
      sourcemap,
    });
    expect(result.success).toBe(true);
    const executable = result.outputs.find(output => output.kind === "entry-point")!.path;
    await using proc = Bun.spawn({ cmd: [executable], env: bunEnv, cwd: String(dir), stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
    const { filename, lineno } = JSON.parse(stdout);
    expect(filename).toEndWith(file);
    if (line === undefined) expect(lineno).toBeGreaterThan(0);
    else expect(lineno).toBe(line);
  });
});
