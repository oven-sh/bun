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
    "(['JSObject', 'str', 'JSPlainObject', 'NoneType'], 42, 'just a string')",
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
  // new Error(message, { cause }) is `raise ... from cause`.
  [
    "e = catch('cause')\ntype(e.__cause__).__name__, e.__cause__.value is e.value.cause, e.__suppress_context__, catch('app').__cause__",
    "('JSTypeError', True, True, None)",
  ],
  [
    "k = KeyError('k')\ntry:\n    js.eval('c => { throw new Error(\"outer\", { cause: c }); }')(k)\nexcept JSError as e:\n    r = e.__cause__ is k\nr",
    "True",
  ],
  [
    'def cause_of(source):\n    try:\n        js.eval(source)\n    except JSError as e:\n        return e.__cause__ is e if e.__cause__ else e.__cause__\ncause_of(\'const a = new Error("a"); a.cause = a; throw a\'), cause_of(\'throw new Error("a", { cause: "text" })\'), cause_of(\'throw new Error("a", { cause: { reason: 1 } })\')',
    "(True, None, None)",
  ],
  ["thrower('overflow')", "!RecursionError: maximum recursion depth exceeded"],
  [
    "def inner(): thrower('app')\ndef outer(): inner()\ntry:\n    outer()\nexcept JSError as e:\n    names = [f.name for f in traceback.extract_tb(e.__traceback__)]\nnames",
    "['<module>', 'outer', 'inner', 'thrower']",
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
  // What the exception has not is asked of what was thrown.
  ["catch('app').code, catch('app').message", "('E_APP', 'app failed')"],
  [
    "e = catch('cause')\ne.cause.message, e.name, e.stack == e.value.stack, [x.message for x in catch('aggregate').errors], catch('object').reason",
    "('inner', 'Error', True, ['one', 'two'], 42)",
  ],
  [
    "e = catch('app')\ne.args, hasattr(e, 'nothing'), hasattr(e, 'keys'), hasattr(catch('string'), 'length'), getattr(e, 'errno', None)",
    "(('AppError: app failed',), False, False, False, None)",
  ],
  ["catch('app').nothing", "!AttributeError: '_js.JSError' object has no attribute 'nothing'"],
  ["e = catch('app')\ne.code = 'mine'\ne.code, e.value.code", "('mine', 'E_APP')"],
  ["try:\n    thrower('app')\nexcept AppError as e:\n    r = 'caught by its class'\nr", "'caught by its class'"],
  // A TypeError of JavaScript is a TypeError, and no other error is anything but a JSError.
  [
    "e = catch('type')\n[c.__name__ for c in type(e).__mro__], type(e).__module__, isinstance(e.value, js.TypeError)",
    "(['JSTypeError', 'JSError', 'TypeError', 'Exception', 'BaseException', 'object'], '_js', True)",
  ],
  [
    "try:\n    thrower('type')\nexcept TypeError as e:\n    r = str(e)\nr",
    `"TypeError: null is not an object (evaluating 'null.x')"`,
  ],
  [
    "def caught_as(source):\n    try:\n        js.eval(source)\n    except TypeError:\n        return 'TypeError'\n    except JSError:\n        return 'JSError'\n[caught_as(s) for s in ('undefined()', 'throw new (class extends TypeError {})', 'throw Object.create(TypeError.prototype)', 'BigInt(1) + 1', 'new Array(-1)', 'nothing', 'throw \"TypeError: said so\"')]",
    "['TypeError', 'TypeError', 'TypeError', 'TypeError', 'JSError', 'JSError', 'JSError']",
  ],
  [
    "from node import fs\ntry:\n    fs.readFileSync(None)\nexcept TypeError as e:\n    r = e.code\nr",
    "'ERR_INVALID_ARG_TYPE'",
  ],
  [
    "js.eval('f => { try { f(); } catch (e) { return [e.constructor === TypeError, e.message]; } }')(lambda: thrower('type'))",
    `[True, "null is not an object (evaluating 'null.x')"]`,
  ],
]);

group("Python raises for JavaScript", { setup, files: { "lib.js": lib } }, [
  ["describe(boom)", "[True, 'MyError', 'py failed', 'MyError: py failed', ['extra'], 'string', 'MyError']"],
  ["e = caught(boom)\ntype(e).__name__, e.extra, e.args", "('MyError', [1, 2], ('py failed',))"],
  ["error = MyError('same', 0)\ndef raiser(): raise error\ncaught(raiser) is error", "True"],
  [
    "try:\n    level1(boom)\nexcept MyError as e:\n    r = e.extra, [f.name for f in traceback.extract_tb(e.__traceback__)]\nr",
    "([1, 2], ['<module>', 'level1', 'level2', 'boom'])",
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
    "[True, True]",
  ],
  [
    "class Mine(TypeError): pass\nclass Both(ValueError, TypeError): pass\n[js.eval('e => [e instanceof TypeError, e instanceof Error, e instanceof RangeError]')(e) for e in (Mine(), Both(), ValueError(), BaseException())]",
    "[[True, True, False], [True, True, False], [False, True, False], [False, True, False]]",
  ],
  [
    "class Other(Exception): pass\nis_type_error = js.eval('e => e instanceof TypeError')\ne = Other()\nseen = [is_type_error(e)]\ne.__class__ = Mine\nseen.append(is_type_error(e))\nseen",
    "[False, True]",
  ],
  [
    "describe(lambda: len(5))[1:4] + describe(lambda: len(5))[6:]",
    `['TypeError', "object of type 'int' has no len()", "TypeError: object of type 'int' has no len()", 'TypeError']`,
  ],
  [
    "js.Error.isError(ValueError('x'))",
    "True",
    "Error.isError() says no, and so do the functions of Node that ask as it does",
  ],
  ["js.eval('e => Object.prototype.toString.call(e)')(ValueError('x'))", "'[object Error]'", "[object ValueError]"],
  // An error of JavaScript, raised by Python.
  ["raise js.Error('raised in Python')\n0", "!JSError: Error: raised in Python"],
  [
    "def raises(what, *cause):\n    try:\n        if cause: raise what from cause[0]\n        raise what\n    except BaseException as e:\n        return type(e).__name__, str(e), type(e.__cause__).__name__, getattr(e, 'value', None) is what\nerror = AppError('mine', 'E')\nraises(error), raises(js.TypeError('t')), raises(js.RangeError)[:3]",
    "(('JSError', 'AppError: mine', 'NoneType', True), ('JSTypeError', 'TypeError: t', 'NoneType', True), ('JSError', 'RangeError', 'NoneType'))",
  ],
  [
    "raises(ValueError('v'), js.Error('c'))[:3], raises(ValueError('v'), js.RangeError)[:3], raises(js.Error('x'), KeyError('k'))[:3]",
    "(('ValueError', 'v', 'JSError'), ('ValueError', 'v', 'JSError'), ('JSError', 'Error: x', 'KeyError'))",
  ],
  // Only an Error, or a class of them.
  [
    "[raises(x)[:2] for x in (js.Object(), js.Map, js.Map(), js.parseInt, js.eval('() => 1'))] == [('TypeError', 'exceptions must derive from BaseException')] * 5, raises(ValueError(), js.Object())[:2]",
    "(True, ('TypeError', 'exception causes must derive from BaseException'))",
  ],
  [
    "def raiser(): raise AppError('from Python', 'E_PY')\ne = caught(raiser)\ne.constructor.name, e.code, list(describe(raiser))[:4]",
    "('AppError', 'E_PY', [True, 'AppError', 'from Python', 'AppError: from Python'])",
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

group(
  "a class of JavaScript in an except clause",
  {
    setup:
      setup +
      `
import contextlib, threading
js.eval("globalThis.Mine = class Mine extends RangeError {}; globalThis.Old = function Old() {}; Old.prototype = Object.create(Error.prototype); globalThis.Thing = class Thing {}")
def caught_by(source, *classes):
    try:
        js.eval(source)
    except classes as e:
        return "caught"
    except Exception as e:
        return "missed"
try:
    js.eval("throw new RangeError('r')")
except js.Error as e:
    kept = e
`,
    files: { "lib.js": lib },
  },
  [
    [
      "[caught_by('throw new RangeError(1)', *c) for c in ((js.RangeError,), (js.Error,), (js.SyntaxError,), (ValueError, js.SyntaxError, js.RangeError), (js.RangeError.bind(None),))]",
      "['caught', 'caught', 'missed', 'caught', 'caught']",
    ],
    [
      "[caught_by('throw new Mine(1)', c) for c in (js.Mine, js.RangeError, js.Error, js.TypeError)], caught_by('throw new Old()', js.Old), caught_by('throw new Old()', js.Error)",
      "(['caught', 'caught', 'caught', 'missed'], 'caught', 'caught')",
    ],
    // JavaScript can throw anything.
    [
      "caught_by('throw new Thing()', js.Thing), caught_by('throw new Thing()', js.Error), caught_by('throw new Thing()', js.Object), caught_by('throw 1', js.Error), caught_by('throw new Map()', js.Map)",
      "('caught', 'missed', 'caught', 'missed', 'caught')",
    ],
    // It goes by the prototypes and runs no code.
    [
      "caught_by('throw new RangeError(1)', js.eval('(class { static [Symbol.hasInstance]() { return true; } })'))",
      "'missed'",
    ],
    // What is no class is refused, as ever.
    [
      "def refused(x):\n    try:\n        return caught_by('throw 1', x)\n    except TypeError as e:\n        return str(e)\n{refused(x) for x in (js.parseInt, js.eval('() => 1'), js.eval('(function f() {})'), js.Object(), js.Number, js.Math, 1)}",
      "{'catching classes that do not inherit from BaseException is not allowed'}",
    ],
    // It catches what JavaScript threw, and nothing of Python's, though to JavaScript that is an Error too.
    [
      "def python(error, cls):\n    try:\n        raise error\n    except cls:\n        return 'caught'\n    except BaseException:\n        return 'missed'\npython(ValueError(), js.Error), python(TypeError(), js.TypeError), python(KeyboardInterrupt(), js.Error), isinstance(ValueError(), js.Error)",
      "('missed', 'missed', 'missed', True)",
    ],
    [
      "isinstance(kept, js.RangeError), isinstance(kept, js.Error), isinstance(kept, js.TypeError), isinstance(kept, (ValueError, js.RangeError)), isinstance(catch('string'), js.Error), isinstance(catch('app'), AppError)",
      "(True, True, False, True, False, True)",
    ],
    [
      "g = ExceptionGroup('g', [kept, ValueError('v')])\nnames = lambda g: [type(e).__name__ for e in g.exceptions]\n[names(x) for x in g.split(js.RangeError)], names(g.subgroup((js.RangeError, KeyError))), g.subgroup(js.SyntaxError), names(g.subgroup(js.eval('e => true')))",
      "([['JSError'], ['ValueError']], ['JSError'], None, ['JSError', 'ValueError'])",
    ],
    [
      "out = []\ntry:\n    raise g\nexcept* js.RangeError as eg:\n    out.append(('js', names(eg)))\nexcept* ValueError as eg:\n    out.append(('py', names(eg)))\nout",
      "[('js', ['JSError']), ('py', ['ValueError'])]",
    ],
    [
      "out = []\ndef work():\n    try:\n        raise kept\n    except js.SyntaxError:\n        out.append('syntax')\n    except js.RangeError:\n        out.append('range')\nt = threading.Thread(target=work)\nt.start()\nt.join()\nout",
      "['range']",
    ],
    // The class of the exception says nothing of the class of what was thrown.
    [
      "with contextlib.suppress(js.RangeError):\n    raise kept\n0",
      "0",
      "JSError: RangeError: r: what asks issubclass(type(e), cls) is told no",
    ],
  ],
);

group(
  "an error of the system is an OSError",
  {
    setup:
      setup +
      `
import errno, os, tempfile
import node.fs as fs
directory = tempfile.mkdtemp()
missing = os.path.join(directory, "missing")
def system(f, *a):
    try:
        f(*a)
    except OSError as e:
        return e
def thrown(source):
    try:
        js.eval(source)
    except Exception as e:
        return type(e).__name__
`,
    teardown: "os.rmdir(directory)",
    files: { "lib.js": lib },
  },
  [
    [
      "e = system(fs.readFileSync, missing)\n[c.__name__ for c in type(e).__mro__[:4]], type(e).__module__, e.errno == errno.ENOENT, e.strerror, e.filename == missing, e.filename2, e.args, str(e).replace(directory, 'DIR'), repr(e)",
      `(['JSFileNotFoundError', 'JSError', 'FileNotFoundError', 'OSError'], '_js', True, 'No such file or directory', True, None, (2, 'No such file or directory'), "[Errno 2] No such file or directory: 'DIR/missing'", "JSFileNotFoundError(2, 'No such file or directory')")`,
    ],
    // What Node says is still there.
    [
      "e.code, e.syscall, e.path == missing, e.value.errno, e.message.replace(directory, 'DIR'), isinstance(e, JSError), isinstance(e, js.Error)",
      `('ENOENT', 'open', True, -2, "ENOENT: no such file or directory, open 'DIR/missing'", True, True)`,
    ],
    [
      "[type(system(*c)).__name__ for c in ((fs.readFileSync, directory), (fs.readdirSync, __file__), (fs.mkdirSync, directory))]",
      "['JSIsADirectoryError', 'JSNotADirectoryError', 'JSFileExistsError']",
    ],
    [
      "e = system(fs.renameSync, missing, missing + '2')\ntype(e).__name__, e.filename == missing, e.filename2 == missing + '2', e.args",
      "('JSFileNotFoundError', True, True, (2, 'No such file or directory'))",
    ],
    [
      "e = system(fs.readFileSync, directory)\ne.errno == errno.EISDIR, e.filename, e.args, str(e)",
      "(True, None, (21, 'Is a directory'), '[Errno 21] Is a directory')",
    ],
    [
      "try:\n    await fs.promises.readFile(missing)\nexcept FileNotFoundError as e:\n    r = type(e).__name__, e.errno\nr",
      "('JSFileNotFoundError', 2)",
    ],
    // It is told by `errno`, a number, and `code`, the name of an error number, of an Error.
    [
      'thrown(\'throw Object.assign(new Error(1), { errno: -13, code: "EACCES", path: "/p" })\'), thrown(\'throw Object.assign(new RangeError(1), { errno: 110, code: "ETIMEDOUT" })\'), thrown(\'throw Object.assign(new Error(1), { errno: -39, code: "ENOTEMPTY" })\')',
      "('JSPermissionError', 'JSTimeoutError', 'JSOSError')",
    ],
    [
      "[thrown('throw ' + s) for s in ('Object.assign(new Error(1), { code: \"ENOENT\" })', 'Object.assign(new Error(1), { errno: -3008, code: \"ENOTFOUND\" })', '({ errno: -2, code: \"ENOENT\" })', 'Object.defineProperty(new Error(1), \"errno\", { get() { throw 1; } })', 'Object.assign(new Error(1), { errno: \"2\", code: \"ENOENT\" })')]",
      "['JSError', 'JSError', 'JSError', 'JSError', 'JSError']",
    ],
    // JavaScript gets back what it threw.
    [
      "e = system(fs.readFileSync, missing)\ndef again(): raise e\ncaught(again) is e.value, system(again) is e",
      "(True, True)",
    ],
    // And an OSError of Python's answers what code written for Node asks.
    [
      "show = js.eval('e => [e.code, e.errno, e.path, e.dest, e.syscall, e.name]')\nlist(show(caught(lambda: open(missing)))) == ['ENOENT', 2, missing, None, None, 'FileNotFoundError'], list(show(caught(lambda: os.rename(missing, missing + '2'))))[2:4] == [missing, missing + '2'], list(show(OSError('plain'))), list(show(OSError(10 ** 6, 'x')))[:2]",
      "(True, True, [None, None, None, None, None, 'OSError'], [None, 1000000])",
    ],
  ],
);

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
        '  File "lib.js", line 1, in fail',
        '    export function fail() { throw new RangeError("out of range"); }',
        "_js.JSError: RangeError: out of range",
      ),
    );
    expect(exitCode).toBe(1);
  },
);

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
);
