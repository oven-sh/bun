import { describe, expect, test } from "bun:test";
import { once } from "events";
import { bunEnv, bunExe, tempDir } from "harness";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";

// https://github.com/oven-sh/bun/issues/23473
describe("a Worker's 'error' event describes", () => {
  // A worker whose source starts with this also posts what the 'error' event on its own global scope says.
  const reportInside = `self.addEventListener("error", ({ message, filename, lineno, colno }) => postMessage({ message, filename, lineno, colno }));\n`;
  const blobURL = (source: string) => URL.createObjectURL(new Blob([source], { type: "text/javascript" }));

  // What the 'error' event on the Worker object says, and everything the worker posted before it closed.
  async function errorEvents(url: string | URL) {
    const worker = new Worker(url);
    const posted: any[] = [];
    worker.onmessage = event => posted.push(event.data);
    const { promise, resolve, reject } = Promise.withResolvers<ErrorEvent>();
    worker.addEventListener("error", resolve, { once: true });
    const closed = once(worker, "close");
    closed.then(() => reject(new Error("the worker closed without an 'error' event")));
    const { message, filename, lineno, colno, error } = await promise;
    await closed;
    return { parent: { message, filename, lineno, colno }, error, posted };
  }

  test("a thrown Error by its message and where the script made it", async () => {
    const url = blobURL(reportInside + `\nthrow new TypeError("Hello, world!")`);
    const described = { message: "TypeError: Hello, world!", filename: url, lineno: 3, colno: 11 };
    expect(await errorEvents(url)).toEqual({ parent: described, error: null, posted: [described] });
  });

  // Each source is preceded by the line of `reportInside`. A column is JavaScriptCore's:
  // of the callee for a `new`, of the end of the thrown expression for a `throw`.
  test.each([
    [
      "an Error by its innermost frame",
      `function outer() { inner(); }\nfunction inner() {\n  throw new Error("deep");\n}\nouter();`,
      "Error: deep",
      4,
      13,
    ],
    ["an unhandled rejection", `Promise.reject(new RangeError("rejected"));`, "RangeError: rejected", 2, 20],
    ["an Error with no message", `throw new Error();`, "Error", 2, 11],
    [
      "an Error of a class that names itself",
      `class NamedError extends Error { name = "NamedError" }\nthrow new NamedError("custom");`,
      "NamedError: custom",
      3,
      11,
    ],
    ["what reportError() was given", `reportError(new Error("reported"));`, "Error: reported", 2, 17],
    [
      "an Error by where a timer threw it",
      `setTimeout(() => {\n  throw new Error("later");\n}, 1);`,
      "Error: later",
      3,
      26,
    ],
    [
      "an Error made earlier by where a timer threw it",
      `const early = new Error("made early");\nsetTimeout(() => {\n  throw early;\n}, 1);`,
      "Error: made early",
      4,
      9,
    ],
    ["a number by where a timer threw it", `setTimeout(() => {\n  throw 5;\n}, 1);`, "5", 3, 9],
    [
      "an Error by where an event listener threw it",
      `const target = new EventTarget();\ntarget.addEventListener("x", () => {\n  throw new Error("in listener");\n});\nsetTimeout(() => target.dispatchEvent(new Event("x")), 1);`,
      "Error: in listener",
      4,
      32,
    ],
    [
      "a number by where an event listener threw it",
      `const target = new EventTarget();\ntarget.addEventListener("x", () => {\n  throw 5;\n});\nsetTimeout(() => target.dispatchEvent(new Event("x")), 1);`,
      "5",
      4,
      9,
    ],
    [
      "an Error that a builtin threw by the script's call",
      `[].reduce((a, b) => a + b);`,
      "TypeError: reduce of empty array with no initial value",
      2,
      4,
    ],
    [
      "that Error the same once its stack was read",
      `try {\n  [].reduce((a, b) => a + b);\n} catch (error) {\n  void error.stack;\n  throw error;\n}`,
      "TypeError: reduce of empty array with no initial value",
      3,
      6,
    ],
    [
      "an Error of a class with no constructor by the script's `new`",
      `class Quiet extends Error {}\nthrow new Quiet("sub");`,
      "Error: sub",
      3,
      11,
    ],
    [
      "an EventEmitter 'error' nobody listens for by the script's emit()",
      `const { EventEmitter } = require("node:events");\nconst emitter = new EventEmitter();\nsetTimeout(() => emitter.emit("error", "str"), 1);`,
      "Error: Unhandled error. ('str')",
      4,
      26,
    ],
    [
      "an Error without calling the script's Error.prepareStackTrace",
      `Error.prepareStackTrace = () => { postMessage("prepareStackTrace ran"); return "custom"; };\nthrow new Error("prepared");`,
      "Error: prepared",
      3,
      11,
    ],
    // A value with no stack, thrown where no JSC::Exception is left to say from where.
    ["a number thrown at the top level by its value alone", `throw 5;`, "5", 0, 0],
    ["a DOMException", `throw new DOMException("dom msg", "AbortError");`, "AbortError: dom msg", 0, 0],
    ["a Symbol", `throw Symbol("sym");`, "Symbol(sym)", 0, 0],
    ["an object as a string", `throw { a: 1 };`, "[object Object]", 0, 0],
    [
      "an object by its toString()",
      `throw { toString() { return "described by toString"; } };`,
      "described by toString",
      0,
      0,
    ],
    ["an object whose toString() throws", `throw { toString() { throw new Error("no"); } };`, "[object Object]", 0, 0],
  ])("%s", async (_, source, message, lineno, colno) => {
    const url = blobURL(reportInside + source);
    const described = { message, filename: lineno ? url : "", lineno, colno };
    expect(await errorEvents(url)).toEqual({ parent: described, error: null, posted: [described] });
  });

  test("an Error without running its getters or its toString()", async () => {
    const url = blobURL(`
      const calls = { prepareStackTrace: 0, message: 0, toString: 0 };
      Error.prepareStackTrace = () => { calls.prepareStackTrace++; return "custom"; };
      class Loud extends Error {
        get message() { calls.message++; return "from a getter"; }
        toString() { calls.toString++; return "from toString()"; }
      }
      self.addEventListener("error", event => postMessage({ calls, message: event.message }));
      throw new Loud();`);
    const { parent, posted } = await errorEvents(url);
    expect({ message: parent.message, posted }).toEqual({
      message: "Error",
      posted: [{ calls: { prepareStackTrace: 0, message: 0, toString: 0 }, message: "Error" }],
    });
  });

  test("the module that threw by its URL and its line before transpiling", async () => {
    using dir = tempDir("worker-error-event", {
      "worker.ts": `import { thrower, url } from "./thrower.ts";\n${reportInside}postMessage(url);\nthrower();\n`,
      "thrower.ts": `interface Unused { a: number }\ntype AlsoUnused = string | number;\nexport const url: string = import.meta.url;\nexport function thrower(): never {\n  throw new RangeError("from thrower.ts");\n}\n`,
    });
    const { parent, posted } = await errorEvents(pathToFileURL(path.join(String(dir), "worker.ts")));
    const [url, inside] = posted;
    const described = { message: "RangeError: from thrower.ts", filename: url, lineno: 5, colno: 13 };
    expect({ parent, inside }).toEqual({ parent: described, inside: described });
    expect(fileURLToPath(url)).toBe(path.join(String(dir), "thrower.ts"));
  });

  test("a CommonJS entry's throw by the entry's URL", async () => {
    using dir = tempDir("worker-error-event", {
      "worker.cjs": `const { pathToFileURL } = require("node:url");\n${reportInside}postMessage(pathToFileURL(__filename).href);\nthrow new TypeError("from a CommonJS entry");\n`,
    });
    const { parent, posted } = await errorEvents(pathToFileURL(path.join(String(dir), "worker.cjs")));
    const [url, inside] = posted;
    const described = { message: "TypeError: from a CommonJS entry", filename: url, lineno: 4, colno: 11 };
    expect({ parent, inside }).toEqual({ parent: described, inside: described });
  });

  test("a data: URL worker's throw by that URL", async () => {
    const url = "data:text/javascript,throw new Error('from a data URL')";
    const described = { message: "Error: from a data URL", filename: url, lineno: 1, colno: 11 };
    expect(await errorEvents(url)).toEqual({ parent: described, error: null, posted: [] });
  });

  test.each([
    ["a syntax error in the entry", `const y = ;\n`, "SyntaxError: Unexpected ;", 1, 11],
    [
      "every diagnostic of an entry with several",
      `let a = 1;\nlet a = 2;\nlet b = 1;\nlet b = 2;\n`,
      `"a" has already been declared\n"b" has already been declared`,
      2,
      5,
    ],
  ])("%s by where the parser stopped", async (_, source, message, lineno, colno) => {
    using dir = tempDir("worker-error-event", { "entry.js": source });
    const entry = path.join(String(dir), "entry.js");
    const { parent, posted } = await errorEvents(pathToFileURL(entry));
    expect({ ...parent, filename: fileURLToPath(parent.filename), posted }).toEqual({
      message,
      filename: entry,
      lineno,
      colno,
      posted: [],
    });
  });

  test("a value whose console rendering throws, to a listener in the worker that reads event.error", async () => {
    // The Error the rendering threw reached that listener as event.error, as a JSC::Exception:
    // touching it ended the process.
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const source = \`
          self.addEventListener("error", event => postMessage({ message: event.message, error: String(event.error) }));
          throw { [Symbol.for("nodejs.util.inspect.custom")]() { throw new Error("the rendering threw"); } };\`;
        const worker = new Worker(URL.createObjectURL(new Blob([source], { type: "text/javascript" })));
        worker.onmessage = event => console.log("inside", JSON.stringify(event.data));
        worker.onerror = event => console.log("parent", JSON.stringify(event.message));
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({
      stdout: `inside {"message":"[object Object]","error":"[object Object]"}\nparent "[object Object]"\n`,
      stderr: "",
      exitCode: 0,
    });
  });

  test("nothing when describing the value ends the worker", async () => {
    const worker = new Worker(blobURL(`throw { toString() { process.exit(7); } };`));
    const errors: string[] = [];
    worker.addEventListener("error", event => errors.push(event.message));
    const [{ code }] = await once(worker, "close");
    expect({ errors, code }).toEqual({ errors: [], code: 7 });
  });
});
