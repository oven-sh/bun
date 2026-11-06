// The exception being handled, when what handles it is a `catch` of JavaScript.
import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, tempDir } from "harness";
import { KeyError, LookupError, ValueError, dict, exec, isinstance, list, repr } from "python:builtins";
import gc from "python:gc";
import io from "python:io";
import logging from "python:logging";
import sys from "python:sys";
import traceback from "python:traceback";
import weakref from "python:weakref";

// These builds take seconds to start Python.
if (isDebug || isASAN) setDefaultTimeout(60_000);

const py: any = dict();
exec(
  `
import sys, weakref

def fail(message="first"):
    raise ValueError(message)

def fail_again():
    raise KeyError("second")

def again():
    raise

def handled():
    return sys.exception()

def around(call):
    try:
        raise LookupError("outer")
    except LookupError:
        return [sys.exception(), call(), sys.exception()]

def generator(call):
    try:
        raise LookupError("of the generator")
    except LookupError:
        yield call()
        yield sys.exception()
    yield sys.exception()

def catches_in_turn():
    try:
        raise KeyError("deeper")
    except KeyError:
        inside = sys.exception()
    return [inside, sys.exception()]

class Thing:
    pass

things = []

def fail_with_thing():
    thing = Thing()
    things.append(weakref.ref(thing))
    raise ValueError(thing)
`,
  py,
);
const handled = () => py.handled();
const shown = (values: Iterable<unknown>) => [...values].map(value => String(repr(value)));

describe("in a catch", () => {
  test("what was caught is being handled, and afterwards it is not", () => {
    expect(sys.exception()).toBeUndefined();
    try {
      py.fail();
      expect.unreachable();
    } catch (error) {
      expect(sys.exception()).toBe(error);
      expect(handled()).toBe(error);
      expect(traceback.format_exc().trim().split("\n").at(-1)).toBe("ValueError: first");
    }
    expect(sys.exception()).toBeUndefined();
  });

  test("raise without an exception raises it again", () => {
    try {
      py.fail();
    } catch (error) {
      expect(() => py.again()).toThrow(error as Error);
    }
    expect(() => py.again()).toThrow("No active exception to reraise");
  });

  test("what is raised or thrown there remembers it", () => {
    try {
      py.fail();
    } catch (first) {
      try {
        py.fail_again();
      } catch (second: any) {
        expect(second.__context__).toBe(first);
      }
      try {
        throw new KeyError("thrown");
      } catch (second: any) {
        expect(second.__context__).toBe(first);
      }
      // It has a context already.
      const old = new KeyError("old");
      old.__context__ = new LookupError("its own");
      try {
        throw old;
      } catch (second: any) {
        expect(String(second.__context__)).toBe("LookupError: its own");
      }
    }
    try {
      throw new KeyError("thrown");
    } catch (error: any) {
      expect(error.__context__).toBeUndefined();
    }
  });

  test("logging.exception() has something to log", () => {
    const stream = io.StringIO();
    const logger = logging.getLogger("in a catch");
    const handler = logging.StreamHandler(stream);
    logger.addHandler(handler);
    logger.propagate = false;
    try {
      py.fail("logged");
    } catch {
      logger.exception("it failed");
    }
    logger.removeHandler(handler);
    const lines = stream.getvalue().trim().split("\n");
    expect(lines[0]).toBe("it failed");
    expect(lines[1]).toBe("Traceback (most recent call last):");
    expect(lines.at(-1)).toBe("ValueError: logged");
  });

  test("a catch in a catch, and then the outer one again", () => {
    try {
      py.fail();
    } catch (first) {
      try {
        py.fail_again();
      } catch (second) {
        expect(handled()).toBe(second);
      }
      expect(handled()).toBe(first);
      try {
        py.fail_again();
      } catch (third) {
        expect(handled()).toBe(third);
      } finally {
        expect(handled()).toBe(first);
      }
      expect(handled()).toBe(first);
    }
    expect(handled()).toBeUndefined();
  });

  test("however it is left", () => {
    const seen: string[] = [];
    for (let i = 0; i < 4; i++) {
      try {
        py.fail(i);
      } catch {
        seen.push(String(handled()));
        if (i === 1) continue;
        if (i === 3) break;
      }
      seen.push(String(handled()));
    }
    seen.push(String(handled()));
    expect(seen).toEqual([
      "ValueError: 0",
      "undefined",
      "ValueError: 1",
      "ValueError: 2",
      "undefined",
      "ValueError: 3",
      "undefined",
    ]);

    function returns() {
      try {
        py.fail();
      } catch {
        return;
      }
    }
    returns();
    expect(handled()).toBeUndefined();

    function throws() {
      try {
        py.fail();
      } catch {
        throw new Error("another");
      }
    }
    try {
      throws();
    } catch (error) {
      expect(handled().value).toBe(error);
    }
    expect(handled()).toBeUndefined();
  });

  test("the same catch again and again, whether somebody asks or not", () => {
    // In a loop.
    const seen: string[] = [];
    for (let i = 0; i < 12; i++) {
      try {
        if (i % 2) py.fail(i);
        else throw new RangeError(String(i));
      } catch {
        if (i % 4 >= 2) seen.push(String(repr(handled())));
      }
      if (i % 3 === 2) seen.push(String(handled()));
    }
    expect(seen).toEqual([
      "JSError('RangeError: 2')",
      "undefined",
      "ValueError(3)",
      "undefined",
      "JSError('RangeError: 6')",
      "ValueError(7)",
      "undefined",
      "JSError('RangeError: 10')",
      "ValueError(11)",
      "undefined",
    ]);

    // In a function that is called again and again: its frame is where the last one was.
    function catches(i: number, asks: boolean) {
      try {
        py.fail(i);
      } catch {
        return asks ? String(handled()) : "not asked";
      }
    }
    const results: unknown[] = [];
    for (let i = 0; i < 8; i++) results.push(catches(i, i === 3 || i >= 6));
    expect(results).toEqual([
      "not asked",
      "not asked",
      "not asked",
      "ValueError: 3",
      "not asked",
      "not asked",
      "ValueError: 6",
      "ValueError: 7",
    ]);
    expect(handled()).toBeUndefined();

    // From a catch, and then no longer from a catch.
    function calls(i: number, inCatch: boolean) {
      if (!inCatch) return [catches(i, false), catches(i + 1, true), String(handled())];
      try {
        py.fail("outer");
      } catch {
        return [catches(i, false), catches(i + 1, false), String(handled()), catches(i + 2, true), String(handled())];
      }
    }
    expect(calls(0, true)).toEqual(["not asked", "not asked", "ValueError: outer", "ValueError: 2", "ValueError: outer"]);
    expect(calls(10, false)).toEqual(["not asked", "ValueError: 11", "undefined"]);
    expect(calls(20, true)).toEqual(["not asked", "not asked", "ValueError: outer", "ValueError: 22", "ValueError: outer"]);
    catches(30, false);
    expect(calls(40, false)).toEqual(["not asked", "ValueError: 41", "undefined"]);

    // Under handlers of Python's, which have their exceptions back.
    catches(50, false);
    expect(shown(py.around(() => [catches(51, false), catches(52, true), catches(53, false)].join()))).toEqual([
      "LookupError('outer')",
      "'not asked,ValueError: 52,not asked'",
      "LookupError('outer')",
    ]);
    expect(shown(py.generator(() => [catches(54, false), catches(55, false), catches(56, true)].join()))).toEqual([
      "'not asked,not asked,ValueError: 56'",
      "LookupError('of the generator')",
      "None",
    ]);
    expect(handled()).toBeUndefined();
  });

  test("a finally is not a catch", () => {
    let inFinally, inFinallyAfterCatch;
    try {
      try {
        py.fail();
      } finally {
        inFinally = handled();
      }
    } catch {}
    try {
      py.fail();
    } catch {
    } finally {
      inFinallyAfterCatch = handled();
    }
    expect([inFinally, inFinallyAfterCatch]).toEqual([undefined, undefined]);
  });

  test("an error of JavaScript is what Python would catch in its place", () => {
    try {
      (null as any).property;
    } catch (error) {
      expect(String(repr(handled()))).toStartWith('JSTypeError("TypeError: ');
      expect(handled().value).toBe(error);
      expect(handled()).toBe(handled());
    }
    try {
      throw 1;
    } catch {
      expect(String(repr(handled()))).toBe("JSError('1')");
    }
    // To make that exception asks the object for its message.
    const asks = {
      toString() {
        try {
          py.fail("while asked");
        } catch {
          return String(handled());
        }
      },
    };
    try {
      throw asks;
    } catch {
      expect(String(handled())).toBe("JSError: ValueError: while asked");
      expect(handled().value).toBe(asks);
    }
    expect(handled()).toBeUndefined();
  });
});

describe("between handlers of Python", () => {
  function catches() {
    let inside;
    try {
      py.fail("inner");
    } catch {
      inside = handled();
    }
    return inside;
  }

  test("an except around the catch has its exception back", () => {
    expect(shown(py.around(catches))).toEqual(["LookupError('outer')", "ValueError('inner')", "LookupError('outer')"]);
    expect(handled()).toBeUndefined();
  });

  test("an except under the catch gives way to it again", () => {
    try {
      py.fail();
    } catch (error) {
      const [inside, after] = py.catches_in_turn();
      expect(isinstance(inside, KeyError)).toBe(true);
      expect(after).toBe(error);
      expect(handled()).toBe(error);
    }
  });

  test("a generator has what it handles to itself", () => {
    expect(shown(py.generator(catches))).toEqual(["ValueError('inner')", "LookupError('of the generator')", "None"]);
    const generator = py.generator(handled);
    try {
      py.fail();
    } catch (error) {
      // Its own comes first, and where it handles nothing, that of whoever resumed it.
      expect(shown(list(generator))).toEqual([
        "LookupError('of the generator')",
        "LookupError('of the generator')",
        "ValueError('first')",
      ]);
      expect(handled()).toBe(error);
    }
  });
});

describe("in an async function of JavaScript", () => {
  test("behind an await it is still being handled, and in between it is not", async () => {
    const seen: unknown[] = [];
    try {
      py.fail();
    } catch (error) {
      seen.push(handled() === error);
      await 1;
      seen.push(handled() === error);
      await Promise.resolve().then(() => seen.push(handled()));
      seen.push(handled() === error);
      expect(traceback.format_exc().trim().split("\n").at(-1)).toBe("ValueError: first");
      try {
        py.fail_again();
      } catch (second: any) {
        expect(second.__context__).toBe(error);
        await 1;
        seen.push(handled() === second);
      }
      seen.push(handled() === error);
    }
    seen.push(handled());
    await 1;
    seen.push(handled());
    expect(seen).toEqual([true, true, undefined, true, true, true, undefined, undefined]);
  });

  test("each async function has its own", async () => {
    const seen: string[] = [];
    async function one(name: string, turns: number) {
      try {
        py.fail(name);
      } catch {
        for (let i = 0; i < turns; i++) {
          await 1;
          seen.push(`${name}: ${handled()}`);
        }
      }
      await 1;
      seen.push(`${name} afterwards: ${handled()}`);
    }
    await Promise.all([one("a", 2), one("b", 3), one("c", 1)]);
    expect(seen.sort()).toEqual([
      "a afterwards: undefined",
      "a: ValueError: a",
      "a: ValueError: a",
      "b afterwards: undefined",
      "b: ValueError: b",
      "b: ValueError: b",
      "b: ValueError: b",
      "c afterwards: undefined",
      "c: ValueError: c",
    ]);
    expect(handled()).toBeUndefined();
  });

  async function* catches(name: string) {
    yield String(handled());
    try {
      py.fail(name);
    } catch {
      yield String(handled());
      try {
        py.fail_again();
      } catch {
        await 1;
        yield String(handled());
      }
      yield String(handled());
    }
    yield String(handled());
  }
  const all = (name: string) => [
    "undefined",
    `ValueError: ${name}`,
    "KeyError: 'second'",
    `ValueError: ${name}`,
    "undefined",
  ];

  test("an async generator that yields in a catch", async () => {
    expect(await Array.fromAsync(catches("a"))).toEqual(all("a"));
    const seen: string[] = [];
    for await (const inside of catches("b")) seen.push(inside, String(handled()));
    expect(seen).toEqual(all("b").flatMap(inside => [inside, "undefined"]));
  });

  test("async generators with the same code, in turn", async () => {
    const a = catches("a");
    const b = catches("b");
    const seen: [unknown[], unknown[]] = [[], []];
    await b.next();
    for (let i = 0; i < 5; i++) {
      seen[0].push((await a.next()).value);
      seen[1].push((await b.next()).value);
    }
    expect(seen).toEqual([all("a"), [...all("b").slice(1), undefined]]);
  });

  test("resumed where something else is being handled", async () => {
    const log: string[] = [];
    async function* steps() {
      try {
        py.fail("inner");
      } catch {
        for (let i = 0; i < 2; i++) {
          yield;
          log.push(String(handled()));
        }
      }
      yield;
      log.push(String(handled()));
    }
    const generator = steps();
    await generator.next();
    // next() resumes it there and then.
    let pending: Promise<unknown>;
    const next = () => {
      pending = generator.next();
      return log.at(-1);
    };
    expect(shown(py.around(next))).toEqual(["LookupError('outer')", "'ValueError: inner'", "LookupError('outer')"]);
    await pending!;
    expect(shown(py.generator(next))).toEqual(["'ValueError: inner'", "LookupError('of the generator')", "None"]);
    await pending!;
    try {
      py.fail("of the caller");
    } catch (error) {
      // It handles nothing any more: what its caller handles.
      expect(next()).toBe("ValueError: of the caller");
      expect(handled()).toBe(error);
    }
  });

  test("the first to ask is a generator of Python's that it called", async () => {
    try {
      py.fail();
    } catch {
      await 1;
      expect(shown(py.generator(handled))).toEqual([
        "LookupError('of the generator')",
        "LookupError('of the generator')",
        "ValueError('first')",
      ]);
      expect(String(handled())).toBe("ValueError: first");
    }
    expect(handled()).toBeUndefined();
  });

  test("what was caught lives as long as the function can go on", async () => {
    // Nothing but the exception has the thing, and nothing in the code of the generator has the exception.
    async function* holds() {
      try {
        py.fail_with_thing();
      } catch {
        yield;
        yield isinstance(handled().args[0], py.Thing);
        yield;
      }
    }
    async function suspended() {
      const generator = holds();
      await generator.next();
      handled();
      return [generator, py.things.pop()] as const;
    }
    // What this gets hold of is gone with its frame.
    const isAlive = (reference: () => unknown) => reference() !== undefined;

    const [generator, reference] = await suspended();
    gc.collect();
    expect(isAlive(reference)).toBe(true);
    expect((await generator.next()).value).toBe(true);
    handled();
    gc.collect();
    expect(isAlive(reference)).toBe(true);
    // It is over, though somebody still has it.
    await generator.return(undefined);
    gc.collect();
    expect(isAlive(reference)).toBe(false);

    // Nobody has these. The collector takes every word of the stack for a reference, and the frames that run the jobs have words that they no
    // longer use or have never written (where the frame through which the engine is entered would save registers if something were thrown):
    // what an earlier frame left there keeps one or two alive.
    const others: (() => unknown)[] = [];
    for (let i = 0; i < 8; i++) others.push(await (async () => (await suspended())[1])());
    gc.collect();
    expect(others.filter(isAlive).length).toBeLessThan(4);
  });

  test("in every tier", async () => {
    async function once(i: number) {
      try {
        py.fail(i);
      } catch (error) {
        await 1;
        if (handled() !== error) throw new Error(`${i}: ${handled()}`);
      }
      if (handled() !== undefined) throw new Error(`${i}, afterwards: ${handled()}`);
    }
    const count = isDebug ? 1_000 : 50_000;
    for (let i = 0; i < count; i++) await once(i);
  });
});

describe("in a generator of JavaScript that is not async", () => {
  function* catches() {
    try {
      py.fail();
    } catch {
      yield String(handled());
      yield String(handled());
      try {
        py.fail_again();
      } catch {
        yield String(handled());
        yield String(handled());
      }
      yield String(handled());
    }
    yield String(handled());
  }
  const all = ["ValueError: first", "undefined", "KeyError: 'second'", "undefined", "undefined", "undefined"];

  test("a catch is over at the first yield, whether somebody asks meanwhile or not", () => {
    expect([...catches()]).toEqual(all);
    const seen: string[] = [];
    for (const inside of catches()) seen.push(inside, String(handled()));
    expect(seen).toEqual(all.flatMap(inside => [inside, "undefined"]));
  });

  test("in every tier", () => {
    function* forever() {
      for (let i = 0; ; i++) {
        try {
          py.fail(i);
        } catch (error) {
          yield handled() === error;
          yield handled() === undefined;
        }
        yield handled() === undefined;
      }
    }
    const count = isDebug ? 3_000 : 300_000;
    const generator = forever();
    function drive() {
      for (let i = 0; i < count; i++) {
        if (generator.next().value !== true) throw new Error(`${i}`);
        if (i % 7 === 0 && handled() !== undefined) throw new Error(`${i}, outside`);
      }
    }
    drive();
  });
});

describe("where the frame of the catch is gone", () => {
  test("a call in tail position comes after the catch", () => {
    function tail() {
      "use strict";
      try {
        py.fail();
      } catch {
        return handled();
      }
    }
    expect(tail()).toBeUndefined();
  });

  test("a call in tail position further down leaves the catch alone, in every tier", () => {
    function asks() {
      const result = handled();
      return result;
    }
    function calls() {
      "use strict";
      return asks();
    }
    function* generator() {
      for (;;) yield handled();
    }
    // An optimizing compiler makes all of these part of the loop, and next() calls the body of the generator in tail position.
    function many(count: number) {
      const asking = generator();
      for (let i = 0; i < count; i++) {
        try {
          py.fail(i);
        } catch (error) {
          if (calls() !== error) throw new Error(`${i}: ${calls()}`);
          if (asking.next().value !== error) throw new Error(`${i}, in a generator`);
          if (handled() !== error) throw new Error(`${i}, afterwards: ${handled()}`);
        }
      }
    }
    many(isDebug ? 3_000 : 200_000);
  });
});

test("in every tier, with the function made part of its caller or not", () => {
  function once(i: number) {
    try {
      py.fail(i);
    } catch (error) {
      if (handled() !== error) throw new Error(`${i}: ${handled()}`);
      try {
        py.fail_again();
      } catch (second) {
        if (handled() !== second) throw new Error(`${i}, nested: ${handled()}`);
      }
      if (handled() !== error) throw new Error(`${i}, after the nested one: ${handled()}`);
    }
    if (handled() !== undefined) throw new Error(`${i}, afterwards: ${handled()}`);
  }
  function many(count: number) {
    for (let i = 0; i < count; i++) once(i);
  }
  many(isDebug ? 3_000 : 200_000);
});

test("what was caught can be collected once the catch is over", () => {
  function caught() {
    const thing = py.Thing();
    try {
      const error = new ValueError(thing);
      throw error;
    } catch {
      handled();
    }
    return weakref.ref(thing);
  }
  const reference = caught();
  gc.collect();
  expect(reference()).toBeUndefined();
});

test("in code whose bytecode was optimized", async () => {
  const script = `
    import sys from "python:sys";
    import { ValueError, repr } from "python:builtins";
    const seen = [];
    const show = () => seen.push(String(repr(sys.exception())));
    function f(n) {
      let unused = n + 1;
      try {
        if (n) throw new ValueError("outer");
      } catch (outer) {
        show();
        try {
          throw new ValueError("inner");
        } catch {
          show();
        } finally {
          unused = 0;
        }
        show();
      }
      show();
    }
    f(1);
    console.log(seen.join(" "));
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: { ...bunEnv, BUN_JSC_useBytecodeOptimizer: "1" },
    stdout: "pipe",
    stderr: "inherit",
  });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  expect(stdout.trim()).toBe("ValueError('outer') ValueError('inner') ValueError('outer') None");
  expect(exitCode).toBe(0);
});

// An `except` that does not name what it catches. Whoever gets hold of the exception all the same finds its traceback complete.
describe("an exception that its handler does not look at", () => {
  const code: any = dict();
  exec(
    `
import sys

def where(e):
    rows = []
    tb = e.__traceback__
    while tb is not None:
        code = tb.tb_frame.f_code
        rows.append(code.co_name + ":" + ("js" if code.co_filename.endswith(".ts") else str(tb.tb_lineno - code.co_firstlineno)))
        tb = tb.tb_next
    return " ".join(rows)

def catches(call):
    try:
        raise KeyError("k")
    except KeyError:
        return call()

def catches_what_c_raises(call):
    try:
        {}["k"]
    except KeyError:
        return call()

def raises():
    raise KeyError("k")

def catches_what_it_called(function, call):
    try:
        function()
    except KeyError:
        return call()

def catches_and_goes_on(call, kept):
    for i in range(3):
        try:
            raise KeyError(i)
        except KeyError:
            if i == 1:
                kept.append(call())
    return sys.exception()

def raises_again(call):
    try:
        raise KeyError("again")
    except ValueError:
        pass
    except KeyError:
        call()
        raise
`,
    code,
  );
  const ask = () => sys.exception();

  test("asked for by JavaScript in the handler, and looked at there and later", () => {
    for (const catches of [code.catches, code.catches_what_c_raises]) {
      const name = String(catches.__name__);
      expect(String(catches(() => code.where(sys.exception())))).toBe(`${name}:2`);
      const kept = catches(ask);
      expect(String(code.where(kept))).toBe(`${name}:2`);
      expect(kept.__traceback__).toBe(kept.__traceback__);
      expect(String(kept.__traceback__.tb_frame.f_code.co_name)).toBe(name);
      // Nobody asks.
      expect(catches(() => 1)).toBe(1);
      expect(sys.exception()).toBeUndefined();
    }
    const kept: any = list();
    expect(code.catches_and_goes_on(ask, kept)).toBeUndefined();
    expect(shown(kept)).toEqual(["KeyError(1)"]);
    expect(String(code.where(kept[0]))).toBe("catches_and_goes_on:3");
  });

  test("through a function of JavaScript on its way", () => {
    const results: unknown[] = [];
    function through() {
      // (Not in tail position.)
      results.push(code.raises());
    }
    const kept = code.catches_what_it_called(through, ask);
    expect(String(code.where(kept))).toBe("catches_what_it_called:2 through:js raises:1");
    expect(String(code.where(code.catches_what_it_called(code.raises, ask)))).toBe("catches_what_it_called:2 raises:1");
    expect(code.catches_what_it_called(through, () => 2)).toBe(2);
  });

  test("caught by JavaScript", () => {
    let caught: any;
    try {
      code.raises();
    } catch (error) {
      caught = error;
    }
    expect(String(code.where(caught))).toBe("<anonymous>:js raises:1");
    for (const call of [() => 1, ask]) {
      try {
        code.raises_again(call);
        expect.unreachable();
      } catch (error) {
        expect(String(code.where(error))).toBe("<anonymous>:js raises_again:2");
        expect(sys.exception()).toBe(error);
      }
    }
    expect(sys.exception()).toBeUndefined();
  });

  test("a worker that is terminated in such handlers, several deep", async () => {
    using dir = tempDir("python-terminated-in-a-handler", {
      "worker.ts": `
        import { dict, exec } from "python:builtins";
        const globals = dict();
        globals.tell = () => postMessage("in the handlers");
        exec(\`
def down(depth):
    try:
        raise KeyError(depth)
    except KeyError:
        if depth:
            down(depth - 1)
        else:
            tell()
            while True:
                pass
\`, globals);
        globals.down(5);
      `,
      "main.ts": `
        const worker = new Worker(new URL("./worker.ts", import.meta.url).href);
        await new Promise(resolve => { worker.onmessage = resolve; });
        const closed = new Promise(resolve => worker.addEventListener("close", resolve));
        worker.terminate();
        await closed;
        console.log("terminated");
      `,
    });
    await using proc = Bun.spawn({ cmd: [bunExe(), "main.ts"], env: bunEnv, cwd: String(dir), stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("terminated\n");
    expect(exitCode).toBe(0);
  });

  test("what JavaScript throws in the handler remembers it", () => {
    let context: any;
    try {
      code.catches(() => {
        throw new ValueError("thrown in the handler");
      });
    } catch (error: any) {
      context = error.__context__;
    }
    expect(String(repr(context))).toBe("KeyError('k')");
    expect(String(code.where(context))).toBe("catches:2");
  });
});

test("what Python has caught is not reported in place of another error", async () => {
  using dir = tempDir("python-caught", {
    "main.ts": `
      const { exec, dict } = require("python:builtins");
      const py = dict();
      exec(\`
class Attributes:
    def __getattr__(self, name): raise AttributeError(name)
def catches():
    try: raise KeyError("caught by except")
    except KeyError: pass
    return hasattr(Attributes(), "caught by hasattr")
\`, py);
      process.on("uncaughtException", error => console.log(String(error)));
      const target = new EventTarget();
      target.addEventListener("x", { handleEvent: 1 } as any);
      py.get("catches")();
      // The host has a value to report, not an exception that was thrown, and asks the engine for the last one.
      target.dispatchEvent(new Event("x"));
    `,
  });
  await using proc = Bun.spawn({ cmd: [bunExe(), "main.ts"], env: bunEnv, cwd: String(dir), stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout).toBe("TypeError: 'handleEvent' property of event listener should be callable\n");
  expect(exitCode).toBe(0);
});
