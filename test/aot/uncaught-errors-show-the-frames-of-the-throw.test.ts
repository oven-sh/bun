// An error that nobody catches is printed with the frames of the `throw` that let it go when it leaves a callback of a timer,
// process.nextTick, queueMicrotask or a listener. Its own `stack` stays the frames of the place that made it, and that is also
// what is printed for a rejected promise, for a module's top level and for a Worker.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";
import { built, spawned } from "./run-programs";
import { describe, test } from "./supported";

const main = `
const { EventEmitter } = require("node:events");

function make() {
  const made = new Error("deep");
  return made;
}
function throwNew() {
  throw new Error("deep");
}
function throwGiven(value) {
  throw value;
}
function throwThroughCallee(value) {
  throwGiven(value);
}
function throwAgain() {
  try {
    throwNew();
  } catch (error) {
    console.log("caught", error.message);
    throw error;
  }
}
class Failure extends Error {
  constructor(message) {
    super(message, { cause: make() });
  }
}
const madeEarly = make();

const forms = {
  "thrown where it is made": () => setTimeout(function onTimer() { throwNew(); }, 1),
  "thrown where it is made, on one line": () => setTimeout(function onTimer() { throw new Error("deep"); }, 1),
  "thrown by another function": () => setTimeout(function onTimer() { throwGiven(new Error("deep")); }, 1),
  "thrown by a callee of a callee": () => setTimeout(function onTimer() { throwThroughCallee(make()); }, 1),
  "thrown again in a catch": () => setTimeout(function onTimer() { throwAgain(); }, 1),
  "thrown in a later turn": () => setTimeout(function onTimer() { throwGiven(madeEarly); }, 1),
  "thrown behind a read of its stack": () =>
    setTimeout(function onTimer() {
      const error = make();
      console.log(error.stack);
      throwGiven(error);
    }, 1),
  "thrown in the body of a loop over an iterator": () =>
    setTimeout(function onTimer() {
      for (const value of new Set([make()])) throwGiven(value);
    }, 1),
  "thrown with a message made at run time": () =>
    setTimeout(function onTimer() { throw new RangeError("deep " + process.argv.length); }, 1),
  "thrown below a built-in function": () =>
    setTimeout(function onTimer() {
      const error = make();
      [1].forEach(function each() { throwGiven(error); });
    }, 1),
  "an error of a subclass with a cause": () => setTimeout(function onTimer() { throwGiven(new Failure("deep")); }, 1),
  "an object": () => setTimeout(function onTimer() { throwGiven({ a: 1 }); }, 1),
  "a string": () => setTimeout(function onTimer() { throwGiven("text"); }, 1),
  "setImmediate": () => setImmediate(function onImmediate() { throwGiven(make()); }),
  "process.nextTick": () => process.nextTick(function onTick() { throwGiven(make()); }),
  "queueMicrotask": () => queueMicrotask(function onMicrotask() { throwGiven(make()); }),
  "a listener of an EventEmitter": () => {
    const emitter = new EventEmitter();
    emitter.on("asked", function onAsked() { throwGiven(make()); });
    setTimeout(function onTimer() { emitter.emit("asked"); }, 1);
  },
  "a listener of an EventTarget": () => {
    const target = new EventTarget();
    target.addEventListener("asked", function onAsked() { throwGiven(make()); });
    setTimeout(function onTimer() { target.dispatchEvent(new Event("asked")); }, 1);
  },
  "a promise that nobody handles": () => Promise.resolve().then(function onFulfilled() { throwGiven(make()); }),
  "an async function that nobody awaits": () =>
    (async function waits() {
      await 1;
      throwGiven(make());
    })(),
  "the top level": () => throwGiven(make()),
  "heard by the process": () => {
    process.on("uncaughtException", error => console.log("heard", error.stack));
    setTimeout(function onTimer() { throwGiven(make()); }, 1);
  },
  "caught by the program": () =>
    setTimeout(function onTimer() {
      try {
        throwThroughCallee(make());
      } catch (error) {
        console.log(error.stack);
      }
    }, 1),
  "the top level of a Worker": () => startWorker("top"),
  "a timer of a Worker": () => startWorker("timer"),
};
function startWorker(form) {
  const worker = new Worker(new URL("./worker.js", import.meta.url).href, { argv: [form] });
  worker.addEventListener("error", event => console.log(event.message));
}
forms[process.argv[2]]();
`;

const worker = `
function make() {
  const made = new Error("deep in a worker");
  return made;
}
function throwGiven(value) {
  throw value;
}
if (process.argv[2] === "top") throwGiven(make());
else setTimeout(function onTimer() { throwGiven(make()); }, 1);
`;

const forms = [...main.matchAll(/^  "([^"]+)": /gm)].map(match => match[1]);

// The frames and what the program itself prints. An executable holds no source text to print an excerpt of, and names its files otherwise.
const shown = (run: { stdout: string; stderr: string; exitCode: number }) => ({
  lines: `${run.stdout}\n${run.stderr}`
    .split("\n")
    .filter(line => !/^\s*\d+ \| |^\s*\^\s*$|^Bun v|^\s*$|\(node:|\(native/.test(line))
    .map(line =>
      line
        .trim()
        .replace(/\(?[^ (]*[\\/]([a-z]+\.js:)/, "$1")
        .replace(/\)$/, ""),
    ),
  exitCode: run.exitCode,
});

describe("an error that nobody catches", () => {
  test("shows the frames that plain Bun shows", async () => {
    using dir = tempDir("uncaught-errors-show-the-frames-of-the-throw", { "main.js": main, "worker.js": worker });
    const folder = String(dir);
    built(
      await spawned(
        [bunExe(), "build", "--compile", "--aot", "main.js", "worker.js", "--outfile", "program"],
        folder,
        bunEnv,
      ),
    );
    const program = join(folder, isWindows ? "program.exe" : "program");
    const runs = await Promise.all(
      forms.map(async form => ({
        form,
        plain: shown(await spawned([bunExe(), "run", "main.js", form], folder, bunEnv)),
        compiled: shown(await spawned([program, form], folder, bunEnv)),
      })),
    );
    expect(runs.map(({ form, compiled }) => ({ form, ...compiled }))).toEqual(
      runs.map(({ form, plain }) => ({ form, ...plain })),
    );
    const framesOf = (form: string) =>
      runs
        .find(run => run.form === form)!
        .compiled.lines.filter(line => line.startsWith("at "))
        .map(line => line.split(" ")[1]);
    expect(framesOf("thrown by a callee of a callee")).toEqual(["throwGiven", "throwThroughCallee", "onTimer"]);
    expect(framesOf("thrown again in a catch")).toEqual(["throwAgain", "onTimer"]);
    expect(framesOf("caught by the program")).toEqual(["make", "onTimer"]);
  }, 240_000);
});
