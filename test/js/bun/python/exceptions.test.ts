// The exception being handled, when what handles it is a `catch` of JavaScript.
import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { isASAN, isDebug } from "harness";
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
import sys

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

describe("where the frame of the catch is gone", () => {
  test("behind an await nothing is being handled", async () => {
    const seen: string[] = [];
    try {
      py.fail();
    } catch {
      seen.push(String(handled()));
      await 1;
      seen.push(String(handled()));
    }
    expect(seen).toEqual(["ValueError: first", "undefined"]);
  });

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
