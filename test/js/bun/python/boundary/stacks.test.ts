// Exceptions that cross between the languages: what their stacks and tracebacks show, what is printed when nobody catches them.
import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { readFileSync } from "node:fs";
import { bunEnv, bunExe, isASAN, isDebug, tempDir } from "harness";
import { join } from "node:path";
import { inspect } from "node:util";
import { str } from "python:builtins";
import { middle, throughPython, thrower } from "./fixtures/stacks-helpers";
import { call, catch as catch_, chain, context, format, frames, group, raiser } from "./fixtures/stacks.py";

// These builds take seconds to start Python.
if (isDebug || isASAN) setDefaultTimeout(60_000);

const fixtures = join(import.meta.dir, "fixtures");
const clean = (text: string) => text.replaceAll(fixtures, "<dir>").trimEnd();
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

  test("an exception of Python's has its traceback for a stack", () => {
    const error = thrownBy(() => call(middle));
    expect(clean(error.stack)).toBe(`Traceback (most recent call last):
  File "<dir>/stacks.py", line 8, in call
    return function(*args)
  File "<dir>/stacks.py", line 8, in call
    return function(*args)
  File "<dir>/stacks.py", line 5, in raiser
    raise ValueError(message)
ValueError: deep`);
    expect(frames(error)).toEqual(["stacks.py:8 call", "stacks.py:8 call", "stacks.py:5 raiser"]);
  });

  // The traceback has the frames of Python alone.
  test.failing("and the frames of JavaScript are in it", () => {
    expect(thrownBy(() => call(middle)).stack).toContain("middle");
  });

  test("what Python makes of an Error of JavaScript", () => {
    expect(clean(format(() => call(thrower)))).toBe(`Traceback (most recent call last):
  File "<dir>/stacks.py", line 18, in format
    function()
    ~~~~~~~~^^
  File "<dir>/stacks.py", line 8, in call
    return function(*args)
_js.JSError: RangeError: from JavaScript`);
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

  // Where in JavaScript it was thrown is in the stack of the value.
  test.failing("and the traceback says where it was thrown", () => {
    expect(format(() => call(thrower))).toContain("stacks-helpers.ts");
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
  // Bun.inspect(), and so console.log(), leave out a cause that is Python's.
  test.failing("is shown by Bun.inspect()", () => {
    const error = new Error("outer", { cause: catch_(() => raiser(message)) });
    expect(Bun.inspect(error)).toContain(`ValueError: ${message}`);
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
    expect({ stdout, stderr }).toEqual({ stdout: "hook: JSError TypeError: of JavaScript TypeError", stderr: "" });
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

  // With nothing on the stack to catch it, the frames it leaves are not written down.
  test.failing("in a callback that the event loop calls: the traceback", async () => {
    const { stderr } = await (ranInTimer ??= inTimer());
    expect(stderr).toBe(`Traceback (most recent call last):
  File "<dir>/main.py", line 6, in callback
    inner()
  File "<dir>/main.py", line 4, in inner
    raise ValueError("in a timer")
ValueError: in a timer`);
  });
});
