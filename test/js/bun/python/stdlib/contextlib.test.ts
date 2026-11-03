// Translated from CPython 3.15's Lib/test/test_contextlib.py: of ContextManagerTestCase and TestExitStack the tests named below,
// ClosingTestCase, NullcontextTestCase, FileContextTestCase, TestRedirectStdout, TestRedirectStderr, TestSuppress and TestChdir
// (but for the docstrings and exception groups).
// Not translated: TestAbstractContextManager, LockContextTestCase, TestContextDecorator, and what is about tracebacks, chained
// exceptions and references.
//
// `with manager as value: body` is with_(manager, value => body). The generators that @contextmanager decorates there are
// generators of JavaScript here.
import { kwargs } from "bun:python";
import { describe, expect, test } from "bun:test";
import {
  Exception,
  LookupError,
  RuntimeError,
  StopIteration,
  SyntaxError as PySyntaxError,
  TypeError as PyTypeError,
  ValueError,
  ZeroDivisionError,
  getattr,
  len,
  object,
  open,
  pow,
  print,
  str,
} from "python:builtins";
import {
  ExitStack,
  chdir,
  closing,
  contextmanager,
  nullcontext,
  redirect_stderr,
  redirect_stdout,
  suppress,
} from "python:contextlib";
import io from "python:io";
import { getitem, truediv } from "python:operator";
import os from "python:os";
import sys from "python:sys";
import tempfile from "python:tempfile";
import { makeClass, raises, t, with_ } from "./helpers";

describe("ContextManagerTestCase", () => {
  test("test_contextmanager_plain", () => {
    const state: number[] = [];
    const woohoo = contextmanager(function* () {
      state.push(1);
      yield 42;
      state.push(999);
    });
    with_(woohoo(), x => {
      expect(state).toEqual([1]);
      expect(x).toBe(42);
      state.push(x);
    });
    expect(state).toEqual([1, 42, 999]);
  });

  test("test_contextmanager_finally", () => {
    const state: number[] = [];
    const woohoo = contextmanager(function* () {
      state.push(1);
      try {
        yield 42;
      } finally {
        state.push(999);
      }
    });
    expect(() =>
      with_(woohoo(), x => {
        expect(state).toEqual([1]);
        expect(x).toBe(42);
        state.push(x);
        throw new ZeroDivisionError();
      }),
    ).toThrow(ZeroDivisionError);
    expect(state).toEqual([1, 42, 999]);
  });

  test("test_contextmanager_no_reraise", () => {
    const whee = contextmanager(function* () {
      yield;
    });
    const ctx = whee();
    ctx.__enter__();
    // Calling __exit__ should not result in an exception
    expect(ctx.__exit__(PyTypeError, PyTypeError("foo"), undefined)).toBe(false);
  });

  test("test_contextmanager_trap_yield_after_throw", () => {
    const whoo = contextmanager(function* () {
      try {
        yield;
      } catch {
        yield;
      }
    });
    const ctx = whoo();
    ctx.__enter__();
    expect(() => ctx.__exit__(PyTypeError, PyTypeError("foo"), undefined)).toThrow(RuntimeError);
  });

  test("test_contextmanager_trap_no_yield", () => {
    const whoo = contextmanager(function* () {
      if (false) yield;
    });
    const ctx = whoo();
    expect(() => ctx.__enter__()).toThrow(RuntimeError);
  });

  test("test_contextmanager_trap_second_yield", () => {
    const whoo = contextmanager(function* () {
      yield;
      yield;
    });
    const ctx = whoo();
    ctx.__enter__();
    expect(() => ctx.__exit__(undefined, undefined, undefined)).toThrow(RuntimeError);
  });

  test("test_contextmanager_non_normalised", () => {
    const whoo = contextmanager(function* () {
      try {
        yield;
      } catch (error) {
        if (error instanceof RuntimeError) throw new PySyntaxError();
        throw error;
      }
    });

    const ctx = whoo();
    ctx.__enter__();
    expect(() => ctx.__exit__(RuntimeError, undefined, undefined)).toThrow(PySyntaxError);
  });

  test("test_contextmanager_except", () => {
    const state: number[] = [];
    const woohoo = contextmanager(function* () {
      state.push(1);
      try {
        yield 42;
      } catch (e: any) {
        if (!(e instanceof ZeroDivisionError)) throw e;
        state.push(e.args[0]);
        expect(state).toEqual([1, 42, 999]);
      }
    });
    with_(woohoo(), x => {
      expect(state).toEqual([1]);
      expect(x).toBe(42);
      state.push(x);
      throw new ZeroDivisionError(999);
    });
    expect(state).toEqual([1, 42, 999]);
  });

  test("test_contextmanager_except_stopiter", () => {
    const woohoo = contextmanager(function* () {
      yield;
    });

    class StopIterationSubclass extends StopIteration {}

    for (const stop_exc of [StopIteration("spam"), StopIterationSubclass("spam")]) {
      expect(
        raises(Exception, () =>
          with_(woohoo(), () => {
            throw stop_exc;
          }),
        ),
      ).toBe(stop_exc);
    }
  });

  test("test_keywords", () => {
    // Ensure no keyword arguments are inhibited
    // Keyword arguments reach a function of JavaScript as an object, the last argument.
    const woohoo = contextmanager(function* ({ self, func, args, kwds }: any) {
      yield t(self, func, args, kwds);
    });
    with_(woohoo(kwargs({ self: 11, func: 22, args: 33, kwds: 44 })), target => {
      expect(target).toEqual(t(11, 22, 33, 44));
    });
  });
});

describe("ClosingTestCase", () => {
  const state: number[] = [];
  class C extends object {
    close() {
      state.push(1);
    }
  }

  test("test_closing", () => {
    state.length = 0;
    const x = C();
    expect(state).toEqual([]);
    with_(closing(x), y => {
      expect(x).toBe(y);
    });
    expect(state).toEqual([1]);
  });

  test("test_closing_error", () => {
    state.length = 0;
    const x = C();
    expect(state).toEqual([]);
    expect(() =>
      with_(closing(x), y => {
        expect(x).toBe(y);
        truediv(1, 0);
      }),
    ).toThrow(ZeroDivisionError);
    expect(state).toEqual([1]);
  });

  test("an object of JavaScript that has close()", () => {
    let closed = 0;
    const x = {
      close() {
        closed++;
      },
    };
    with_(closing(x), y => expect(y).toBe(x));
    expect(closed).toBe(1);
  });
});

describe("NullcontextTestCase", () => {
  test("test_nullcontext", () => {
    class C extends object {}
    const c = C();
    with_(nullcontext(c), c_in => {
      expect(c_in).toBe(c);
    });
    const ofJavaScript = {};
    expect(with_(nullcontext(ofJavaScript), value => value)).toBe(ofJavaScript);
  });
});

describe("FileContextTestCase", () => {
  test("testWithOpen", () => {
    const tfn = tempfile.mktemp();
    try {
      let f: any;
      with_(open(tfn, "w", kwargs({ encoding: "utf-8" })), file => {
        f = file;
        expect(f.closed).toBe(false);
        f.write("Booh\n");
      });
      expect(f.closed).toBe(true);
      expect(() =>
        with_(open(tfn, "r", kwargs({ encoding: "utf-8" })), file => {
          f = file;
          expect(f.closed).toBe(false);
          expect(f.read()).toBe("Booh\n");
          truediv(1, 0);
        }),
      ).toThrow(ZeroDivisionError);
      expect(f.closed).toBe(true);
    } finally {
      os.unlink(tfn);
    }
  });
});

describe("TestExitStack", () => {
  const callbackAt = (stack: any, index: number) => getitem(getitem(stack._exit_callbacks, index), 1);

  test("test_no_resources", () => {
    with_(ExitStack(), () => {});
  });

  test("test_callback", () => {
    // There: pairs of a tuple of arguments and a dict of keywords, which is what `def _exit(*args, **kwds)` gets. A function of
    // JavaScript gets the keywords as an object after the arguments.
    const expected: [any[], Record<string, number> | undefined][] = [
      [[], undefined],
      [[1], undefined],
      [[1, 2], undefined],
      [[], { example: 1 }],
      [[1], { example: 1 }],
      [[1, 2], { example: 1 }],
      [[1, 2], { self: 3, callback: 4 }],
    ];
    let result: any[][] = [];
    const _exit = (...args: any[]) => {
      result.push(args);
    };
    with_(ExitStack(), stack => {
      for (const [args, kwds] of expected.toReversed()) {
        const f = kwds ? stack.callback(_exit, ...args, kwargs(kwds)) : stack.callback(_exit, ...args);
        expect(f).toBe(_exit);
      }
      for (const wrapper of stack._exit_callbacks) {
        expect(wrapper[1].__wrapped__).toBe(_exit);
        expect(wrapper[1].__name__).not.toBe(_exit.name);
        expect(wrapper[1].__doc__).toBeUndefined();
      }
    });
    expect(result).toEqual(expected.map(([args, kwds]) => (kwds ? [...args, kwds] : args)));

    result = [];
    with_(ExitStack(), stack => {
      expect(() => stack.callback(kwargs({ arg: 1 }))).toThrow(PyTypeError);
      expect(() => ExitStack.callback(kwargs({ arg: 2 }))).toThrow(PyTypeError);
      expect(() => stack.callback(kwargs({ callback: _exit, arg: 3 }))).toThrow(PyTypeError);
    });
    expect(result).toEqual([]);
  });

  test("test_push", () => {
    const exc_raised = ZeroDivisionError;
    const _expect_exc = (exc_type: any) => {
      expect(exc_type).toBe(exc_raised);
    };
    const _suppress_exc = () => true;
    const _expect_ok = (exc_type: any, exc: any, exc_tb: any) => {
      expect(exc_type).toBeUndefined();
      expect(exc).toBeUndefined();
      expect(exc_tb).toBeUndefined();
    };
    class ExitCM extends object {
      __init__(check_exc: any) {
        this.check_exc = check_exc;
      }
      __enter__() {
        throw new Error("Should not be called!");
      }
      __exit__(...exc_details: any[]) {
        this.check_exc(...exc_details);
      }
    }
    with_(ExitStack(), stack => {
      stack.push(_expect_ok);
      expect(callbackAt(stack, -1)).toBe(_expect_ok);
      let cm = ExitCM(_expect_ok);
      stack.push(cm);
      expect(callbackAt(stack, -1).__self__).toBe(cm);
      stack.push(_suppress_exc);
      expect(callbackAt(stack, -1)).toBe(_suppress_exc);
      cm = ExitCM(_expect_exc);
      stack.push(cm);
      expect(callbackAt(stack, -1).__self__).toBe(cm);
      stack.push(_expect_exc);
      expect(callbackAt(stack, -1)).toBe(_expect_exc);
      stack.push(_expect_exc);
      expect(callbackAt(stack, -1)).toBe(_expect_exc);
      truediv(1, 0);
    });
  });

  test("test_enter_context", () => {
    const result: number[] = [];
    class TestCM extends object {
      __enter__() {
        result.push(1);
      }
      __exit__() {
        result.push(3);
      }
    }

    const cm = TestCM();
    with_(ExitStack(), stack => {
      // Registered first => cleaned up last
      const _exit = stack.callback(() => {
        result.push(4);
      });
      expect(_exit).toBeDefined();
      stack.enter_context(cm);
      expect(callbackAt(stack, -1).__self__).toBe(cm);
      result.push(2);
    });
    expect(result).toEqual([1, 2, 3, 4]);
  });

  test("test_close", () => {
    const result: number[] = [];
    with_(ExitStack(), stack => {
      const _exit = stack.callback(() => {
        result.push(1);
      });
      expect(_exit).toBeDefined();
      stack.close();
      result.push(2);
    });
    expect(result).toEqual([1, 2]);
  });

  test("test_pop_all", () => {
    const result: number[] = [];
    let new_stack: any;
    with_(ExitStack(), stack => {
      const _exit = stack.callback(() => {
        result.push(3);
      });
      expect(_exit).toBeDefined();
      new_stack = stack.pop_all();
      result.push(1);
    });
    result.push(2);
    new_stack.close();
    expect(result).toEqual([1, 2, 3]);
  });

  test("test_exit_raise", () => {
    expect(() =>
      with_(ExitStack(), stack => {
        stack.push(() => false);
        truediv(1, 0);
      }),
    ).toThrow(ZeroDivisionError);
  });

  test("test_exit_suppress", () => {
    with_(ExitStack(), stack => {
      stack.push(() => true);
      truediv(1, 0);
    });
  });
});

describe.each([
  ["TestRedirectStdout", redirect_stdout, "stdout"],
  ["TestRedirectStderr", redirect_stderr, "stderr"],
])("%s", (_, redirect_stream, orig_stream) => {
  test("test_no_redirect_in_init", () => {
    const orig_stdout = getattr(sys, orig_stream);
    redirect_stream(undefined);
    expect(getattr(sys, orig_stream)).toBe(orig_stdout);
  });

  test("test_redirect_to_string_io", () => {
    const f = io.StringIO();
    const msg = "Consider an API like help(), which prints directly to stdout";
    const orig_stdout = sys[orig_stream];
    with_(redirect_stream(f), () => {
      print(msg, kwargs({ file: sys[orig_stream] }));
    });
    expect(sys[orig_stream]).toBe(orig_stdout);
    const s = f.getvalue().trim();
    expect(s).toBe(msg);
  });

  test("test_enter_result_is_target", () => {
    const f = io.StringIO();
    with_(redirect_stream(f), enter_result => {
      expect(enter_result).toBe(f);
    });
  });

  test("test_cm_is_reusable", () => {
    const f = io.StringIO();
    const write_to_f = redirect_stream(f);
    const orig_stdout = sys[orig_stream];
    with_(write_to_f, () => {
      print("Hello", kwargs({ end: " ", file: sys[orig_stream] }));
    });
    with_(write_to_f, () => {
      print("World!", kwargs({ file: sys[orig_stream] }));
    });
    expect(sys[orig_stream]).toBe(orig_stdout);
    expect(f.getvalue()).toBe("Hello World!\n");
  });

  test("test_cm_is_reentrant", () => {
    const f = io.StringIO();
    const write_to_f = redirect_stream(f);
    const orig_stdout = sys[orig_stream];
    with_(write_to_f, () => {
      print("Hello", kwargs({ end: " ", file: sys[orig_stream] }));
      with_(write_to_f, () => {
        print("World!", kwargs({ file: sys[orig_stream] }));
      });
    });
    expect(sys[orig_stream]).toBe(orig_stdout);
    expect(f.getvalue()).toBe("Hello World!\n");
  });

  test("an object of JavaScript that has write()", () => {
    const written: string[] = [];
    with_(redirect_stream({ write: (text: string) => written.push(text) }), () => {
      print("Hello", "World!", kwargs({ file: sys[orig_stream] }));
    });
    expect(written.join("")).toBe("Hello World!\n");
  });
});

describe("TestSuppress", () => {
  test("test_no_result_from_enter", () => {
    with_(suppress(ValueError), enter_result => {
      expect(enter_result).toBeUndefined();
    });
  });

  test("test_no_exception", () => {
    with_(suppress(ValueError), () => {
      expect(pow(2, 5)).toBe(32);
    });
  });

  test("test_exact_exception", () => {
    with_(suppress(PyTypeError), () => {
      len(5);
    });
  });

  test("test_exception_hierarchy", () => {
    with_(suppress(LookupError), () => {
      getitem("Hello", 50);
    });
  });

  test("test_other_exception", () => {
    expect(() =>
      with_(suppress(PyTypeError), () => {
        truediv(1, 0);
      }),
    ).toThrow(ZeroDivisionError);
  });

  test("test_no_args", () => {
    expect(() =>
      with_(suppress(), () => {
        truediv(1, 0);
      }),
    ).toThrow(ZeroDivisionError);
  });

  test("test_multiple_exception_args", () => {
    with_(suppress(ZeroDivisionError, PyTypeError), () => {
      truediv(1, 0);
    });
    with_(suppress(ZeroDivisionError, PyTypeError), () => {
      len(5);
    });
  });

  test("test_cm_is_reentrant", () => {
    const ignore_exceptions = suppress(Exception);
    with_(ignore_exceptions, () => {});
    with_(ignore_exceptions, () => {
      len(5);
    });
    let outer_continued = false;
    with_(ignore_exceptions, () => {
      // Check nested usage
      with_(ignore_exceptions, () => {
        len(5);
      });
      outer_continued = true;
      truediv(1, 0);
    });
    expect(outer_continued).toBe(true);
  });

  test("what JavaScript throws is an Exception, and none of the others", () => {
    with_(suppress(Exception), () => {
      throw new RangeError("of JavaScript");
    });
    const error = new TypeError("of JavaScript");
    expect(() =>
      with_(suppress(PyTypeError, ValueError), () => {
        throw error;
      }),
    ).toThrow(error);
  });
});

describe("TestChdir", () => {
  const target1 = os.path.realpath(import.meta.dir);
  const target2 = os.path.dirname(target1);

  test("test_simple", () => {
    const old_cwd = os.getcwd();
    expect(old_cwd).not.toBe(target1);

    with_(chdir(target1), () => {
      expect(os.getcwd()).toBe(target1);
      expect(process.cwd()).toBe(target1);
    });
    expect(os.getcwd()).toBe(old_cwd);
    expect(process.cwd()).toBe(old_cwd);
  });

  test("test_reentrant", () => {
    const old_cwd = os.getcwd();
    expect([target1, target2]).not.toContain(old_cwd);
    const [chdir1, chdir2] = [chdir(target1), chdir(target2)];

    with_(chdir1, () => {
      expect(os.getcwd()).toBe(target1);
      with_(chdir2, () => {
        expect(os.getcwd()).toBe(target2);
        with_(chdir1, () => {
          expect(os.getcwd()).toBe(target1);
        });
        expect(os.getcwd()).toBe(target2);
      });
      expect(os.getcwd()).toBe(target1);
    });
    expect(os.getcwd()).toBe(old_cwd);
  });

  test("test_exception", () => {
    const old_cwd = os.getcwd();
    expect(old_cwd).not.toBe(target1);

    const re = raises(RuntimeError, () =>
      with_(chdir(target1), () => {
        expect(os.getcwd()).toBe(target1);
        throw new RuntimeError("boom");
      }),
    );
    expect(str(re)).toBe("boom");
    expect(os.getcwd()).toBe(old_cwd);
  });
});
