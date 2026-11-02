// An error that nobody catches is printed with the frames of the `throw` that let it go when it leaves a callback of a timer,
// process.nextTick, queueMicrotask or a listener. They are the frames of the first `throw`, whatever `finally` blocks and `using`
// declarations it passes, and the frames of the call where a built-in function throws an error that it was given. What the
// disposer of a `using` declaration throws is thrown again at the end of the function around the declaration. Its own
// `stack` stays the frames of the place that made it, and that is also what is printed for a rejected promise, for a module's
// top level and for a Worker.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";
import { built, spawned } from "./harness/commands";
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
function makeByFailing() {
  try {
    null.missing;
  } catch (error) {
    return error;
  }
}
function throwAgainAtOnce(value) {
  try {
    throw value;
  } catch (error) {
    throw error;
  }
}
function throwAgainWhatCalleeThrew(value) {
  try {
    throwGiven(value);
  } catch (error) {
    throw error;
  }
}
function throwAgainWhatWasThrownAgain(value) {
  try {
    throwAgainWhatCalleeThrew(value);
  } catch (error) {
    throw error;
  }
}
function throwAgainTwice(value) {
  try {
    try {
      throwGiven(value);
    } catch (inner) {
      throw inner;
    }
  } catch (outer) {
    throw outer;
  }
}
function returnWhatWasThrownAgain(value) {
  try {
    throwAgainWhatCalleeThrew(value);
  } catch (error) {
    return error;
  }
}
function throwAgainBelowFinally(value) {
  try {
    throwAgainWhatCalleeThrew(value);
  } finally {
    console.log("finally");
  }
}
function throwInTry(value) {
  try {
    throw value;
  } finally {
    console.log("finally");
  }
}
function throwOneOfTwo(value, first) {
  try {
    if (first) throw value;
    console.log("second");
    throw value;
  } finally {
    console.log("finally");
  }
}
function callInTry(callee, value) {
  try {
    callee(value);
  } finally {
    console.log("finally");
  }
}
function callInTwoTries(callee, value) {
  try {
    callInTry(callee, value);
  } finally {
    console.log("outer finally");
  }
}
function throwAgainInTry(value) {
  try {
    try {
      throwGiven(value);
    } catch (error) {
      console.log("caught", error.message);
      throw error;
    }
  } finally {
    console.log("finally");
  }
}
function swallow(value) {
  try {
    throwGiven(value);
  } finally {
    return 1;
  }
}
function throwAndCatchOthers() {
  try {
    callInTry(throwGiven, new Error("other"));
  } catch {}
  try {
    JSON.parse("{");
  } catch {}
  try {
    [1].forEach(function each() { callInTry(throwGiven, new Error("third")); });
  } catch {}
  swallow(new Error("fourth"));
}
function callInBusyTry(value) {
  try {
    throwGiven(value);
  } finally {
    throwAndCatchOthers();
  }
}
function callInLoop(value) {
  for (const turn of new Set([0, 1, 2])) {
    try {
      if (turn === 0) continue;
      if (turn === 2) throwGiven(value);
    } finally {
      console.log("finally", turn);
    }
  }
}
function callBesideResource(value) {
  using resource = { [Symbol.dispose]() { console.log("disposed"); } };
  throwGiven(value);
}
function throwBesideResource(value) {
  using resource = { [Symbol.dispose]() { console.log("disposed"); } };
  throw value;
}
function leaveResourceThatThrows() {
  using resource = { [Symbol.dispose]() { throw new Error("from the disposer"); } };
  console.log("left");
}
function leaveTwoResourcesOfWhichOneThrows(value) {
  using first = { [Symbol.dispose]() { console.log("disposed"); } };
  using second = { [Symbol.dispose]() { throwGiven(value); } };
  return value.message.length;
}
function throwBesideResourceThatThrows(value) {
  using resource = { [Symbol.dispose]() { throw new Error("from the disposer"); } };
  throw value;
}
function callBesideResourceThatThrows(value) {
  let count = 0;
  {
    using resource = { [Symbol.dispose]() { throw new Error("from the disposer"); } };
    count += value.message.length;
    throwGiven(value);
  }
  return count + value.message.length;
}
async function throwBesideAsyncResourceThatThrows(value) {
  await using resource = { async [Symbol.asyncDispose]() { throw new Error("from the disposer"); } };
  throw value;
}
function check(signal) {
  signal.throwIfAborted();
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
  "thrown again in a catch that does nothing else": () => setTimeout(function onTimer() { throwAgainAtOnce(make()); }, 1),
  "thrown by a callee and again in a catch that does nothing else": () =>
    setTimeout(function onTimer() { throwAgainWhatCalleeThrew(make()); }, 1),
  "thrown again by a callee and again by its caller, in catches that do nothing else": () =>
    setTimeout(function onTimer() { throwAgainWhatWasThrownAgain(make()); }, 1),
  "thrown again twice in one function, in catches that do nothing else": () =>
    setTimeout(function onTimer() { throwAgainTwice(make()); }, 1),
  "thrown again by a callee, caught and returned by its caller, thrown by another": () =>
    setTimeout(function onTimer() { throwGiven(returnWhatWasThrownAgain(make())); }, 1),
  "thrown again by a callee in a catch that does nothing else, through a finally": () =>
    setTimeout(function onTimer() { throwAgainBelowFinally(make()); }, 1),
  "caught and returned by one function, thrown by another": () =>
    setTimeout(function onTimer() { throwGiven(makeByFailing()); }, 1),
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
  "thrown in a try with a finally": () => setTimeout(function onTimer() { throwInTry(make()); }, 1),
  "the first of two throws in a try with a finally": () => setTimeout(function onTimer() { throwOneOfTwo(make(), true); }, 1),
  "the second of two throws in a try with a finally": () => setTimeout(function onTimer() { throwOneOfTwo(make(), false); }, 1),
  "thrown by a callee through a finally": () => setTimeout(function onTimer() { callInTry(throwGiven, make()); }, 1),
  "thrown where it is made, through a finally": () => setTimeout(function onTimer() { callInTry(throwNew); }, 1),
  "thrown through two finally blocks": () => setTimeout(function onTimer() { callInTwoTries(throwThroughCallee, make()); }, 1),
  "thrown again in a catch below a finally": () => setTimeout(function onTimer() { throwAgainInTry(make()); }, 1),
  "thrown through a finally that throws and catches": () => setTimeout(function onTimer() { callInBusyTry(make()); }, 1),
  "thrown through a finally in a loop over an iterator": () => setTimeout(function onTimer() { callInLoop(make()); }, 1),
  "thrown by a callee beside a using declaration": () => setTimeout(function onTimer() { callBesideResource(make()); }, 1),
  "thrown beside a using declaration": () => setTimeout(function onTimer() { throwBesideResource(make()); }, 1),
  "thrown by the disposer of a using declaration": () => setTimeout(function onTimer() { leaveResourceThatThrows(); }, 1),
  "thrown by a callee of the disposer of the second of two using declarations": () =>
    setTimeout(function onTimer() { leaveTwoResourcesOfWhichOneThrows(make()); }, 1),
  "thrown beside a using declaration whose disposer throws": () =>
    setTimeout(function onTimer() { throwBesideResourceThatThrows(make()); }, 1),
  "thrown by a callee in a block with a using declaration whose disposer throws": () =>
    setTimeout(function onTimer() { callBesideResourceThatThrows(make()); }, 1),
  "the stacks of what a using declaration whose disposer throws lets go": () =>
    setTimeout(function onTimer() {
      try {
        callBesideResourceThatThrows(make());
      } catch (error) {
        console.log(error.stack);
        console.log(error.error.stack);
      }
    }, 1),
  "the stack of what an await using declaration whose disposer throws lets go": () =>
    setTimeout(async function onTimer() {
      try {
        await throwBesideAsyncResourceThatThrows(make());
      } catch (error) {
        console.log(error.stack);
      }
    }, 1),
  "an object through a finally": () => setTimeout(function onTimer() { callInTry(throwGiven, { a: 1 }); }, 1),
  "an error of a built-in function through a finally": () => setTimeout(function onTimer() { callInTry(JSON.parse, "{"); }, 1),
  "thrown by a built-in function that was given it": () =>
    setTimeout(function onTimer() {
      const controller = new AbortController();
      controller.abort(make());
      check(controller.signal);
    }, 1),
  "thrown by a built-in function that was given it, through a finally": () =>
    setTimeout(function onTimer() {
      const controller = new AbortController();
      controller.abort(make());
      callInTry(check, controller.signal);
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
  "a listener of an EventTarget below a catch": () => {
    const target = new EventTarget();
    target.addEventListener("asked", function onAsked() { throwGiven(madeEarly); });
    setTimeout(function onTimer() {
      try {
        target.dispatchEvent(new Event("asked"));
      } catch {
        console.log("caught");
      }
    }, 1);
  },
  "a listener of an AbortSignal below a catch": () => {
    const controller = new AbortController();
    controller.signal.addEventListener("abort", function onAbort() { callInTry(throwGiven, madeEarly); });
    setTimeout(function onTimer() {
      try {
        controller.abort();
      } catch {
        console.log("caught");
      }
    }, 1);
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
// A position without a file lies in the text of a built-in function, which is no part of the program: the name of that frame is compared.
const shown = (run: { stdout: string; stderr: string; exitCode: number }) => ({
  lines: `${run.stdout}\n${run.stderr}`
    .split("\n")
    .filter(line => !/^\s*\d+ \| |^\s*\^\s*$|^Bun v|^\s*$|\(node:|\(native/.test(line))
    .map(line =>
      line
        .trim()
        .replace(/\(?[^ (]*[\\/]([a-z]+\.js:)/, "$1")
        .replace(/\)$/, "")
        .replace(/ \(\d+:\d+$/, ""),
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
    expect(framesOf("thrown by a callee and again in a catch that does nothing else")).toEqual([
      "throwAgainWhatCalleeThrew",
      "onTimer",
    ]);
    expect(framesOf("caught and returned by one function, thrown by another")).toEqual(["throwGiven", "onTimer"]);
    expect(framesOf("thrown again by a callee and again by its caller, in catches that do nothing else")).toEqual([
      "throwAgainWhatWasThrownAgain",
      "onTimer",
    ]);
    expect(framesOf("thrown again by a callee in a catch that does nothing else, through a finally")).toEqual([
      "throwAgainWhatCalleeThrew",
      "throwAgainBelowFinally",
      "onTimer",
    ]);
    expect(framesOf("thrown in a try with a finally")).toEqual(["throwInTry", "onTimer"]);
    expect(framesOf("thrown through two finally blocks")).toEqual([
      "throwGiven",
      "throwThroughCallee",
      "callInTry",
      "callInTwoTries",
      "onTimer",
    ]);
    expect(framesOf("thrown by a callee beside a using declaration")).toEqual([
      "throwGiven",
      "callBesideResource",
      "onTimer",
    ]);
    expect(framesOf("thrown by the disposer of a using declaration")).toEqual(["leaveResourceThatThrows", "onTimer"]);
    expect(framesOf("thrown by a built-in function that was given it")).toEqual(["check", "onTimer"]);
    expect(framesOf("a listener of an EventTarget below a catch")).toEqual(["throwGiven", "onAsked", "onTimer"]);
    expect(framesOf("caught by the program")).toEqual(["make", "onTimer"]);
  }, 240_000);
});
