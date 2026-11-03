// What one language throws and the other catches.
import { expect } from "bun:test";
import { lines, program, script } from "./helpers";

const group = program();

const lib = `
export class AppError extends Error { constructor(m, code) { super(m); this.name = "AppError"; this.code = code; } }
export function thrower(kind) {
  if (kind === "app") throw new AppError("app failed", "E_APP");
  if (kind === "type") null.x;
  if (kind === "string") throw "just a string";
  if (kind === "object") throw { reason: 42 };
  if (kind === "aggregate") throw new AggregateError([new Error("one"), new RangeError("two")], "many");
  if (kind === "cause") throw new Error("outer", { cause: new TypeError("inner") });
  if (kind === "undefined") throw undefined;
  if (kind === "overflow") (function deep(n) { deep(n + 1); })(0);
}
// A call in tail position leaves no frame.
function keep() {}
export function through(f, ...a) { return f(...a); }
export function level1(f) { const result = level2(f); keep(result); return result; }
function level2(f) { const result = f(); keep(result); return result; }
export function caught(f) { try { f(); } catch (e) { return e; } }
export function describe(f) {
  try { f(); } catch (e) {
    return [e instanceof Error, e.name, e.message, String(e), Object.keys(e), typeof e.stack, e.constructor.name];
  }
}
`;

const setup = `
import js, traceback
from _js import JSError
from lib import AppError, thrower, through, level1, caught, describe
def catch(kind):
    try:
        thrower(kind)
    except JSError as e:
        return e
class MyError(Exception):
    def __init__(self, message, extra):
        super().__init__(message)
        self.extra = extra
def boom(): raise MyError("py failed", [1, 2])
`;

group("Python catches what JavaScript throws", { setup, files: { "lib.js": lib } }, [
  [
    "[str(catch(k)) for k in ('app', 'string', 'object', 'aggregate', 'cause', 'undefined')]",
    "['AppError: app failed', 'just a string', '[object Object]', 'AggregateError: many', 'Error: outer', 'undefined']",
  ],
  ["str(catch('type'))", `"TypeError: null is not an object (evaluating 'null.x')"`],
  [
    "[type(catch(k).value).__name__ for k in ('app', 'string', 'object', 'undefined')], catch('object').value.reason, catch('string').value",
    "(['JSObject', 'str', 'JSObject', 'NoneType'], 42, 'just a string')",
  ],
  [
    "e = catch('app')\ntype(e).__mro__[1].__name__, repr(e), e.args, isinstance(e.value, AppError), isinstance(e.value, js.Error), e.value.code, e.value.name, e.value.message",
    "('Exception', \"JSError('AppError: app failed')\", ('AppError: app failed',), True, True, 'E_APP', 'AppError', 'app failed')",
  ],
  ["catch('app').value.stack.split('\\n')[1].strip().split(' (')[0]", "'at thrower'"],
  [
    "[x.message for x in catch('aggregate').value.errors], catch('cause').value.cause.message",
    "(['one', 'two'], 'inner')",
  ],
  ["type(catch('cause').__cause__).__name__", "'JSError'", "the cause of an Error is not the __cause__ of the JSError"],
  ["thrower('overflow')", "!RecursionError: maximum recursion depth exceeded"],
  [
    "def inner(): thrower('app')\ndef outer(): inner()\ntry:\n    outer()\nexcept JSError as e:\n    names = [f.name for f in traceback.extract_tb(e.__traceback__)]\nnames",
    "['<module>', 'outer', 'inner']",
  ],
  [
    "try:\n    thrower('app')\nexcept Exception as e:\n    first = e.value\ntry:\n    thrower('app')\nexcept Exception as e:\n    second = e.value\nfirst is second",
    "False",
  ],
  // The same object comes out that went in.
  [
    "error = js.Error('kept')\ndef rethrow(): js.eval('e => { throw e; }')(error)\ntry:\n    rethrow()\nexcept JSError as e:\n    same = e.value is error\nsame",
    "True",
  ],
  ["catch('app').code, catch('app').message", "('E_APP', 'app failed')", "what the Error has is on e.value only"],
  [
    "try:\n    thrower('app')\nexcept AppError as e:\n    r = 'caught by its class'\nr",
    "'caught by its class'",
    "TypeError: a class of JavaScript cannot stand in an except clause",
  ],
  ["isinstance(catch('type'), TypeError)", "False"],
]);

group("Python raises for JavaScript", { setup, files: { "lib.js": lib } }, [
  ["describe(boom)", "[True, 'MyError', 'py failed', 'MyError: py failed', ['extra'], 'string', 'MyError']"],
  ["e = caught(boom)\ntype(e).__name__, e.extra, e.args", "('MyError', [1, 2], ('py failed',))"],
  ["error = MyError('same', 0)\ndef raiser(): raise error\ncaught(raiser) is error", "True"],
  [
    "try:\n    level1(boom)\nexcept MyError as e:\n    r = e.extra, [f.name for f in traceback.extract_tb(e.__traceback__)]\nr",
    "([1, 2], ['<module>', 'boom'])",
  ],
  [
    "[describe(f)[1:4] for f in (lambda: {}['missing'], lambda: 1 / 0, lambda: [].pop(), lambda: int('x'))]",
    `[['KeyError', "'missing'", "KeyError: 'missing'"], ['ZeroDivisionError', 'division by zero', 'ZeroDivisionError: division by zero'], ['IndexError', 'pop from empty list', 'IndexError: pop from empty list'], ['ValueError', "invalid literal for int() with base 10: 'x'", "ValueError: invalid literal for int() with base 10: 'x'"]]`,
  ],
  ["js.eval('f => { try { return f(); } finally { globalThis.cleaned = true; } }')(boom)", "!MyError: py failed"],
  ["js.cleaned", "True"],
  [
    "try:\n    js.eval(\"f => { try { f(); } catch (e) { throw new Error('wrapped', { cause: e }); } }\")(boom)\nexcept JSError as e:\n    r = str(e), type(e.value.cause).__name__\nr",
    "('Error: wrapped', 'MyError')",
  ],
  [
    "def chained():\n    try:\n        1 / 0\n    except ZeroDivisionError as z:\n        raise ValueError('second') from z\njs.eval('f => { try { f(); } catch (e) { return [e.cause.name, e.cause.message]; } }')(chained)",
    "['ZeroDivisionError', 'division by zero']",
  ],
  [
    "def group(): raise ExceptionGroup('g', [ValueError('a'), TypeError('b')])\njs.eval('f => { try { f(); } catch (e) { return [e.name, e.exceptions.length, e.exceptions[0].message]; } }')(group)",
    "['ExceptionGroup', 2, 'a']",
  ],
  [
    "js.eval('f => { try { f(); } catch (e) { return [e.errors?.length, e instanceof AggregateError]; } }')(group)",
    "[2, True]",
    "an ExceptionGroup is no AggregateError",
  ],
  ["def interrupt(): raise KeyboardInterrupt()\nthrough(interrupt)", "!KeyboardInterrupt: "],
  [
    "js.eval('(f, E) => { try { f(); } catch (e) { return [e instanceof E, e instanceof TypeError]; } }')(lambda: len(5), TypeError)",
    "[True, False]",
  ],
  [
    "js.Error.isError(ValueError('x'))",
    "True",
    "Error.isError() says no, and so do the functions of Node that ask as it does",
  ],
  ["js.eval('e => Object.prototype.toString.call(e)')(ValueError('x'))", "'[object Error]'", "[object ValueError]"],
  // An error of JavaScript, raised by Python.
  [
    "raise js.Error('raised in Python')\n0",
    "!JSError: Error: raised in Python",
    "TypeError: exceptions must derive from BaseException",
  ],
  [
    "def raiser(): raise JSError(AppError('from Python', 'E_PY'))\ne = caught(raiser)\ne.constructor.name, e.code",
    "('AppError', 'E_PY')",
    "JSError(error) does not stand for the error: JavaScript catches the JSError",
  ],
  [
    "import _js\ndef raiser(): raise _js.exception_for(AppError('from Python', 'E_PY'))\ne = caught(raiser)\ne.constructor.name, e.code",
    "('AppError', 'E_PY')",
  ],
  ["js.Promise.reject(AppError('rejected', 'E_R')).catch(lambda e: e.code) is not None", "True"],
]);

script(
  "the stack of an Error has the frames of both languages",
  {
    "lib.js": `
      function keep() {} // A call in tail position leaves no frame.
      export function outerJS(f) { const result = innerJS(f); keep(result); return result; }
      function innerJS(f) { const result = f(); keep(result); return result; }
      export function fail() { throw new Error("deep"); }
    `,
    "main.py": `
from lib import outerJS, fail
def python_inner(): fail()
def python_outer(): outerJS(python_inner)
try:
    python_outer()
except Exception as e:
    names = [line.strip().split(" (")[0] for line in e.value.stack.split("\\n")]
    # A debug build also shows the frame of a bound function, which is what \`from lib import fail\` gives.
    for name, previous in zip(names, [None] + names):
        if name != previous: print(name)
`,
  },
  ({ stdout, stderr, exitCode, dir }) => {
    expect(stderr).toBe("");
    expect(stdout).toBe(
      lines("Error: deep", "at fail", "at python_inner", "at innerJS", "at outerJS", "at python_outer", "at <module>"),
    );
    expect(exitCode).toBe(0);
  },
);

script(
  "an Error that nothing catches ends the program with a traceback",
  {
    "lib.js": `export function fail() { throw new RangeError("out of range"); }`,
    "main.py": `
from lib import fail
print("before")
def f(): fail()
f()
print("not reached")
`,
  },
  ({ stdout, stderr, exitCode }) => {
    expect(stdout).toBe(lines("before"));
    expect(stderr.replace(/File ".*\//g, 'File "')).toBe(
      lines(
        "Traceback (most recent call last):",
        '  File "main.py", line 5, in <module>',
        "    f()",
        "    ~^^",
        '  File "main.py", line 4, in f',
        "    def f(): fail()",
        "             ~~~~^^",
        "_js.JSError: RangeError: out of range",
      ),
    );
    expect(exitCode).toBe(1);
  },
);

// The frames of JavaScript between those of Python are left out of a traceback.
script(
  "a traceback has the frames of both languages",
  {
    "lib.js": `function keep() {} export function viaJS(f) { const result = f(); keep(result); return result; }`,
    "main.py": `
import traceback
from lib import viaJS
def boom(): raise ValueError("x")
try:
    viaJS(boom)
except ValueError as e:
    print([f.name for f in traceback.extract_tb(e.__traceback__)])
`,
  },
  ({ stdout }) => {
    expect(stdout).toBe(lines("['<module>', 'viaJS', 'boom']"));
  },
  "failing",
);
