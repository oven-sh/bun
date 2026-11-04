// Exceptions that cross between the languages: what their stacks and tracebacks show, what is printed when nobody catches them.
import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { readFileSync } from "node:fs";
import { bunEnv, bunExe, isASAN, isDebug, tempDir } from "harness";
import { join } from "node:path";
import { inspect } from "node:util";
import { kwargs, with as with_ } from "bun:python";
import { len, str, tuple } from "python:builtins";
import re from "python:re";
import warnings from "python:warnings";
import { calls, middle, throughPython, thrower } from "./fixtures/stacks-helpers";
import { call, catch as catch_, chain, context, deprecated, format, frames, group, raiser } from "./fixtures/stacks.py";

// These builds take seconds to start Python.
if (isDebug || isASAN) setDefaultTimeout(60_000);

const fixtures = join(import.meta.dir, "fixtures");
const clean = (text: string) =>
  text
    .replaceAll(fixtures, "<dir>")
    .replaceAll(import.meta.dir, "<tests>")
    .trimEnd();
/** The line of the call of this function, and so many further down. */
const lineHere = (offset = 0) => Number(new Error().stack!.split("\n")[2].split(":").at(-2)) + offset;
const lineOfBody = lineHere(3);
function thrownBy(body: () => unknown): any {
  try {
    body();
  } catch (error) {
    return error;
  }
}

describe("caught", () => {
  test("an Error of JavaScript that has gone through Python has the frames of both in its stack", () => {
    const lines = clean(thrownBy(throughPython).stack).split("\n");
    expect(lines.slice(0, 4)).toEqual([
      "RangeError: from JavaScript",
      "    at thrower (<dir>/stacks-helpers.ts:7:13)",
      "    at call (<dir>/stacks.py:8:12)",
      "    at throughPython (<dir>/stacks-helpers.ts:11:3)",
    ]);
  });

  // (`() => call(middle)` is a tail call: that function has made way for call().)
  test("an exception of Python's has its traceback for a stack, with the calls of both in it", () => {
    const error = thrownBy(() => call(middle));
    expect(clean(error.stack)).toBe(`Traceback (most recent call last):
  File "<tests>/stacks.test.ts", line ${lineOfBody}, in thrownBy
    body();
  File "<dir>/stacks.py", line 8, in call
    return function(*args)
  File "<dir>/stacks-helpers.ts", line 16, in middle
    call(raiser, "deep");
  File "<dir>/stacks.py", line 8, in call
    return function(*args)
  File "<dir>/stacks.py", line 5, in raiser
    raise ValueError(message)
ValueError: deep`);
    expect(frames(error)).toEqual([
      `stacks.test.ts:${lineOfBody} thrownBy`,
      "stacks.py:8 call",
      "stacks-helpers.ts:16 middle",
      "stacks.py:8 call",
      "stacks.py:5 raiser",
    ]);
  });

  test("what Python sees of a call of a function of JavaScript", () => {
    const entry = thrownBy(() => call(middle)).__traceback__.tb_next.tb_next;
    const frame = entry.tb_frame;
    expect([entry.tb_lineno, entry.tb_lasti, frame.f_lineno, frame.f_code.co_name, frame.f_code.co_qualname]).toEqual([
      16,
      -1,
      16,
      "middle",
      "middle",
    ]);
    expect(frame.f_code.co_filename).toBe(join(fixtures, "stacks-helpers.ts"));
    expect(entry.tb_frame).toBe(frame);
    expect(len(frame.f_locals)).toBe(0);
    expect(frame.f_globals.get("__file__")).toBe(join(fixtures, "stacks-helpers.ts"));
  });

  test("`finally`, and what works like it, is not a second call", () => {
    function cleansUp() {
      try {
        raiser("x");
      } finally {
        void 0;
      }
    }
    function* generator() {
      yield 1;
    }
    function loops() {
      for (const _ of generator()) raiser("x");
    }
    function throwsAgain() {
      try {
        raiser("x");
      } catch (error) {
        throw error;
      }
    }
    const names = (body: () => void) => Array.from(frames(thrownBy(body)), (each: string) => each.split(" ")[1]);
    expect(names(cleansUp)).toEqual(["thrownBy", "cleansUp", "raiser"]);
    expect(names(loops)).toEqual(["thrownBy", "loops", "raiser"]);
    // As with `raise error` in Python.
    expect(names(throwsAgain)).toEqual(["thrownBy", "throwsAgain", "throwsAgain", "raiser"]);
  });

  test("in code that has been optimized", () => {
    function innermost(fails: boolean) {
      if (fails) raiser("x");
      return 1;
    }
    function between(fails: boolean) {
      const result = innermost(fails);
      return result + 1;
    }
    function outermost(fails: boolean) {
      let sum = 0;
      for (let i = 0; i < 10; i++) sum += between(fails);
      return sum;
    }
    for (let i = 0; i < 20_000; i++) outermost(false);
    expect(Array.from(frames(thrownBy(() => void outermost(true))), (each: string) => each.split(" ")[1])).toEqual([
      "thrownBy",
      "<anonymous>",
      "outermost",
      "between",
      "innermost",
      "raiser",
    ]);
  });

  test("an async function is in it where it awaits", async () => {
    async function fails() {
      await Promise.resolve();
      raiser("x");
    }
    async function awaits() {
      await fails();
    }
    const error = await awaits().then(
      () => undefined,
      error => error,
    );
    expect(Array.from(frames(error), (each: string) => each.split(" ")[1])).toEqual(["awaits", "fails", "raiser"]);
  });

  test("what Python makes of an Error of JavaScript", () => {
    expect(clean(format(() => call(thrower)))).toBe(`Traceback (most recent call last):
  File "<dir>/stacks.py", line 18, in format
    function()
    ~~~~~~~~^^
  File "<dir>/stacks.py", line 8, in call
    return function(*args)
  File "<dir>/stacks-helpers.ts", line 7, in thrower
    throw new RangeError("from JavaScript");
_js.JSError: RangeError: from JavaScript`);
    // This one was not made within the call that Python makes: where it has been before that, nobody knows.
    const error = new RangeError("from JavaScript");
    const caught = catch_(() => { throw error; }); // prettier-ignore
    expect([caught.constructor.name, String(caught), frames(caught)]).toEqual([
      "JSError",
      "JSError: RangeError: from JavaScript",
      ["stacks.py:12 catch"],
    ]);
    expect(caught.value).toBe(error);
    // It has one, however often it is caught.
    expect(catch_(() => { throw error; })).toBe(caught); // prettier-ignore
  });

  test("with functions of JavaScript between those of Python", () => {
    function between() {
      call(thrower);
    }
    expect(Array.from(frames(catch_(() => void call(between))), (each: string) => each.split(" ")[1])).toEqual([
      "catch",
      "<anonymous>",
      "call",
      "between",
      "call",
      "thrower",
    ]);
  });

  test("as the cause of an exception of Python's", () => {
    const line = lineHere(1);
    expect(clean(thrownBy(() => void chain(thrower)).stack)).toBe(`Traceback (most recent call last):
  File "<dir>/stacks.py", line 24, in chain
    function()
  File "<dir>/stacks-helpers.ts", line 7, in thrower
    throw new RangeError("from JavaScript");
_js.JSError: RangeError: from JavaScript

The above exception was the direct cause of the following exception:

Traceback (most recent call last):
  File "<tests>/stacks.test.ts", line ${lineOfBody}, in thrownBy
    body();
  File "<tests>/stacks.test.ts", line ${line}, in <anonymous>
    expect(clean(thrownBy(() => void chain(thrower)).stack)).toBe(\`Traceback (most recent call last):
  File "<dir>/stacks.py", line 26, in chain
    raise RuntimeError("outer") from exception
RuntimeError: outer`);
  });

  test("raise ... from is the cause", () => {
    const error = thrownBy(() => chain(() => raiser("inner")));
    expect([error.name, error.cause.name, error.cause.message]).toEqual(["RuntimeError", "ValueError", "inner"]);
    expect(error.__cause__).toBe(error.cause);
    expect(clean(Bun.inspect(error))).toBe(`Traceback (most recent call last):
  File "<dir>/stacks.py", line 24, in chain
    function()
  File "<dir>/stacks.py", line 5, in raiser
    raise ValueError(message)
ValueError: inner

The above exception was the direct cause of the following exception:

Traceback (most recent call last):
  File "<tests>/stacks.test.ts", line ${lineOfBody}, in thrownBy
    body();
  File "<dir>/stacks.py", line 26, in chain
    raise RuntimeError("outer") from exception
RuntimeError: outer`);
  });

  test("the context is not", () => {
    const error = thrownBy(() => context(() => raiser("inner")));
    expect([error.name, error.cause, error.__context__.message]).toEqual(["KeyError", undefined, "inner"]);
    expect(Bun.inspect(error)).toContain("During handling of the above exception, another exception occurred:");
  });

  // Not a literal: Bun.inspect() shows the source around where an Error was made.
  const message = ["the", "cause"].join(" ");
  test("an exception of Python's as the cause of an Error", () => {
    const error = new Error("outer", { cause: catch_(() => raiser(message)) });
    expect(inspect(error)).toContain(`ValueError: ${message}`);
    expect(Bun.inspect(new Error("outer", { cause: new RangeError(message) }))).toContain(`RangeError: ${message}`);
  });
  test("is shown by Bun.inspect(), with its traceback", () => {
    const error = new Error("outer", { cause: catch_(() => raiser(message)) });
    expect(clean(Bun.inspect(error))).toEndWith(`
Traceback (most recent call last):
  File "<dir>/stacks.py", line 12, in catch
    function()
  File "<dir>/stacks.py", line 5, in raiser
    raise ValueError(message)
ValueError: ${message}`);
  });

  test("an exception group", () => {
    const error = thrownBy(group);
    expect([error.name, error.message, str(error)]).toEqual([
      "ExceptionGroup",
      "several",
      "several (2 sub-exceptions)",
    ]);
    expect(Array.from(error.exceptions, (each: any) => `${each.name}: ${each.message}`)).toEqual([
      "ValueError: a",
      "TypeError: b",
    ]);
    expect(error).toBeInstanceOf(Error);
    // It is nothing like an AggregateError.
    expect(error).not.toBeInstanceOf(AggregateError);
    expect(error.errors).toBeUndefined();
  });

  test("Error.captureStackTrace() takes an exception of Python's", () => {
    const exception = catch_(() => raiser("x"));
    Error.captureStackTrace(exception);
    expect(exception.stack).toBeString();
    expect(exception.message).toBe("x");
  });
});

describe("warnings", () => {
  const lineOfRecordedBody = lineHere(4);
  const recorded = (body: () => void) =>
    with_(warnings.catch_warnings(kwargs({ record: true })), (log: any) => {
      warnings.simplefilter("always");
      body();
      return Array.from(log, (each: any) => `${clean(each.filename)}:${each.lineno}`);
    });
  const here = (line: number) => [`<tests>/stacks.test.ts:${line}`];

  test("warn() called by JavaScript: the warning is about that line", () => {
    const line = lineHere(1);
    const log = recorded(() => void warnings.warn("x"));
    expect(log).toEqual(here(line));
  });

  test("a call of a function of JavaScript is a level of the stack", () => {
    const line = lineHere(2);
    function caller() {
      deprecated();
    }
    expect(recorded(caller)).toEqual(here(line));
    expect(recorded(() => void call(deprecated))).toEqual(["<dir>/stacks.py:8"]);
    expect(recorded(() => void warnings.warn("x", kwargs({ stacklevel: 2 })))).toEqual(here(lineOfRecordedBody));
  });

  // (recorded() has made way for with(): a tail call.)
  test("what the host has in Python to run the body of with() is no level", () => {
    const line = lineHere(1);
    const log = recorded(() => void warnings.warn("x", kwargs({ stacklevel: 3 })));
    expect(log).toEqual(here(line));
  });

  test("skip_file_prefixes goes for files of JavaScript", () => {
    function caller() {
      deprecated(kwargs({ skip_file_prefixes: tuple([import.meta.path]) }));
    }
    expect(recorded(() => void call(caller))).toEqual(["<dir>/stacks.py:8"]);
  });

  const shownTo = (module: string, body: () => void) =>
    with_(warnings.catch_warnings(kwargs({ record: true })), (log: any) => {
      warnings.simplefilter("ignore");
      warnings.filterwarnings("default", kwargs({ module }));
      body();
      return len(log);
    });

  test("the module is named after the file, and a place is warned about once", () => {
    const shown = shownTo(re.escape(join(fixtures, "stacks-helpers.ts")), () => {
      for (let i = 0; i < 3; i++) calls(deprecated);
      call(deprecated);
    });
    expect(shown).toBe(1);
  });

  test("the file that the program began with is __main__", () => {
    function caller() {
      deprecated();
    }
    expect(Bun.main).toBe(import.meta.path);
    expect(shownTo("__main__", caller)).toBe(1);
    expect(shownTo(re.escape(import.meta.path), caller)).toBe(0);
    expect(shownTo("__main__", () => void calls(deprecated))).toBe(0);
  });
});

async function run(main: string, files: Record<string, string>) {
  using dir = tempDir("python-stacks", { "module.py": readFileSync(join(fixtures, "stacks.py"), "utf8"), ...files });
  await using proc = Bun.spawn({
    cmd: [bunExe(), main],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const clean = (text: string) =>
    text
      .replaceAll(String(dir), "<dir>")
      .replace(/\n*Bun v\S+ \(.*\)\n$/, "\n")
      .trimEnd();
  return { stdout: clean(stdout), stderr: clean(stderr), exitCode };
}

describe.concurrent("a DeprecationWarning, as Python starts", () => {
  const helper = `
import { deprecated } from "./module.py";
export function old() {
  deprecated();
  return "no tail call";
}`;

  test("is shown if it is about the file that a program in TypeScript began with", async () => {
    const { stdout, stderr, exitCode } = await run("main.ts", {
      "main.ts": `
import { deprecated } from "./module.py";
import { old } from "./helper";
old();
deprecated();
console.log("done");`,
      "helper.ts": helper,
    });
    expect({ stdout, stderr }).toEqual({
      stdout: "done",
      stderr: `<dir>/main.ts:5: DeprecationWarning: old
  deprecated();`,
    });
    expect(exitCode).toBe(0);
  });

  test("in a worker that is the file of the worker", async () => {
    const { stdout, stderr, exitCode } = await run("main.ts", {
      "main.ts": `
const worker = new Worker(new URL("./worker.ts", import.meta.url).href);
await new Promise(resolve => worker.addEventListener("close", resolve));
console.log("done");`,
      "worker.ts": `
import { deprecated } from "./module.py";
import { old } from "./helper";
old();
deprecated();`,
      "helper.ts": helper,
    });
    expect({ stdout, stderr }).toEqual({
      stdout: "done",
      stderr: `<dir>/worker.ts:5: DeprecationWarning: old
  deprecated();`,
    });
    expect(exitCode).toBe(0);
  });

  test("in a program in Python no file of TypeScript is", async () => {
    const { stdout, stderr, exitCode } = await run("main.py", {
      "main.py": `
from helper import old
from module import deprecated
old()
deprecated()
print("done")`,
      "helper.ts": helper,
    });
    expect({ stdout, stderr }).toEqual({
      stdout: "done",
      stderr: `<dir>/main.py:5: DeprecationWarning: old
  deprecated()`,
    });
    expect(exitCode).toBe(0);
  });
});

describe.concurrent("not caught", () => {
  test("Python's, in a program in TypeScript", async () => {
    const { stdout, stderr, exitCode } = await run("main.ts", {
      "main.ts": `
import { call, raiser } from "./module.py";
call(raiser, "nobody catches this");`,
    });
    expect({ stdout, stderr }).toEqual({
      stdout: "",
      stderr: `Traceback (most recent call last):
  File "<dir>/main.ts", line 3, in <module>
    call(raiser, "nobody catches this");
  File "<dir>/module.py", line 8, in call
    return function(*args)
  File "<dir>/module.py", line 5, in raiser
    raise ValueError(message)
ValueError: nobody catches this`,
    });
    expect(exitCode).toBe(1);
  });

  test("JavaScript's, in a program in Python", async () => {
    const { stdout, stderr, exitCode } = await run("main.py", {
      "main.py": `
from helper import thrower
def f():
    thrower()
f()`,
      "helper.ts": `export function thrower() { throw new RangeError("nobody catches this"); }`,
    });
    expect({ stdout, stderr }).toEqual({
      stdout: "",
      stderr: `Traceback (most recent call last):
  File "<dir>/main.py", line 5, in <module>
    f()
    ~^^
  File "<dir>/main.py", line 4, in f
    thrower()
    ~~~~~~~^^
  File "<dir>/helper.ts", line 1, in thrower
    export function thrower() { throw new RangeError("nobody catches this"); }
_js.JSError: RangeError: nobody catches this`,
    });
    expect(exitCode).toBe(1);
  });

  test("a coroutine whose promise nobody handles", async () => {
    const { stdout, stderr, exitCode } = await run("main.ts", {
      "main.ts": `
import { dict, exec } from "python:builtins";
const globals = dict();
exec("async def fails():\\n    raise ValueError('rejected')", globals);
globals.fails();`,
    });
    expect({ stdout, stderr }).toEqual({
      stdout: "",
      stderr: `Traceback (most recent call last):
  File "<string>", line 2, in fails
ValueError: rejected`,
    });
    expect(exitCode).toBe(1);
  });

  test("a promise that is rejected, awaited by Python", async () => {
    const { stdout, stderr, exitCode } = await run("main.py", {
      "main.py": `
import js
async def main():
    await js.Promise.reject(js.Error.new("rejected"))
await main()`,
    });
    expect({ stdout, stderr }).toEqual({
      stdout: "",
      stderr: `Traceback (most recent call last):
  File "<dir>/main.py", line 5, in <module>
    await main()
  File "<dir>/main.py", line 4, in main
    await js.Promise.reject(js.Error.new("rejected"))
_js.JSError: Error: rejected`,
    });
    expect(exitCode).toBe(1);
  });

  test("process.on('uncaughtException') and 'unhandledRejection' get the exception", async () => {
    const { stdout, stderr, exitCode } = await run("main.ts", {
      "main.ts": `
import { catch as catch_, raiser } from "./module.py";
process.on("uncaughtException", (error: any, origin) => console.log("exception:", error.name, error.message, origin, error instanceof Error));
process.on("unhandledRejection", (error: any) => console.log("rejection:", error.name, error.message));
Promise.reject(catch_(() => raiser("rejected")));
setTimeout(() => raiser("in a timer"), 1);`,
    });
    expect({ stdout, stderr }).toEqual({
      stdout: "rejection: ValueError rejected\nexception: ValueError in a timer uncaughtException true",
      stderr: "",
    });
    expect(exitCode).toBe(0);
  });

  test("sys.excepthook gets an Error of JavaScript as a JSError", async () => {
    const { stdout, stderr, exitCode } = await run("main.py", {
      "main.py": `
import sys, js
def hook(type, value, traceback):
    print("hook:", type.__name__, value, value.value.name)
sys.excepthook = hook
js.eval("(function () { throw new TypeError('of JavaScript') })")()`,
    });
    expect({ stdout, stderr }).toEqual({ stdout: "hook: JSTypeError TypeError: of JavaScript TypeError", stderr: "" });
    expect(exitCode).toBe(1);
  });

  test("SystemExit thrown by JavaScript ends the program with its status", async () => {
    const { stdout, stderr, exitCode } = await run("main.ts", {
      "main.ts": `
import { SystemExit } from "python:builtins";
setTimeout(() => { throw new SystemExit(7); }, 1);`,
    });
    expect({ stdout, stderr }).toEqual({ stdout: "", stderr: "" });
    expect(exitCode).toBe(7);
  });

  const inTimer = () =>
    run("main.py", {
      "main.py": `
import js
def inner():
    raise ValueError("in a timer")
def callback():
    inner()
js.setTimeout(callback, 1)`,
    });
  let ranInTimer: ReturnType<typeof inTimer>;

  test("in a callback that the event loop calls: the message and the status", async () => {
    const { stdout, stderr, exitCode } = await (ranInTimer ??= inTimer());
    expect(stdout).toBe("");
    expect(stderr).toEndWith("ValueError: in a timer");
    expect(exitCode).toBe(1);
  });

  test("in a callback that the event loop calls: the traceback", async () => {
    const { stderr } = await (ranInTimer ??= inTimer());
    expect(stderr).toBe(`Traceback (most recent call last):
  File "<dir>/main.py", line 6, in callback
    inner()
    ~~~~~^^
  File "<dir>/main.py", line 4, in inner
    raise ValueError("in a timer")
ValueError: in a timer`);
  });

  test("in a callback: causes, notes and groups are printed as Python prints them", async () => {
    const { stdout, stderr, exitCode } = await run("main.py", {
      "main.py": `
import js
def callback():
    try:
        raise KeyError("first")
    except KeyError as error:
        group = ExceptionGroup("several", [ValueError("a"), TypeError("b")])
        group.add_note("a note")
        raise group from error
js.queueMicrotask(callback)`,
    });
    expect({ stdout, stderr }).toEqual({
      stdout: "",
      stderr: `Traceback (most recent call last):
  File "<dir>/main.py", line 5, in callback
    raise KeyError("first")
KeyError: 'first'

The above exception was the direct cause of the following exception:

  + Exception Group Traceback (most recent call last):
  |   File "<dir>/main.py", line 9, in callback
  |     raise group from error
  | ExceptionGroup: several (2 sub-exceptions)
  | a note
  +-+---------------- 1 ----------------
    | ValueError: a
    +---------------- 2 ----------------
    | TypeError: b
    +------------------------------------`,
    });
    expect(exitCode).toBe(1);
  });

  test("sys.excepthook is told of what a callback raises, in a program in either language", async () => {
    const hook = `
import sys
def hook(type, value, traceback):
    print("hook:", type.__name__, value, traceback.tb_frame.f_code.co_name)
sys.excepthook = hook
def fails():
    raise ValueError("in a timer")`;
    const [python, typescript] = await Promise.all([
      run("main.py", { "main.py": `${hook}\nimport js\njs.setTimeout(fails, 1)` }),
      run("main.ts", { "hook.py": hook, "main.ts": `import { fails } from "./hook.py";\nsetTimeout(fails, 1);` }),
    ]);
    for (const { stdout, stderr, exitCode } of [python, typescript]) {
      expect({ stdout, stderr }).toEqual({ stdout: "hook: ValueError in a timer fails", stderr: "" });
      expect(exitCode).toBe(1);
    }
  });

  test("an Error whose cause is Python's", async () => {
    const { stdout, stderr, exitCode } = await run("main.ts", {
      "main.ts": `
import { catch as catch_, raiser } from "./module.py";
throw new Error("outer", { cause: catch_(() => raiser("the cause")) });`,
    });
    expect(stdout).toBe("");
    expect(stderr).toContain("error: outer\n");
    expect(stderr).toEndWith(`
Traceback (most recent call last):
  File "<dir>/module.py", line 12, in catch
    function()
  File "<dir>/module.py", line 5, in raiser
    raise ValueError(message)
ValueError: the cause`);
    expect(exitCode).toBe(1);
  });
});
