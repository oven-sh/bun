# CPython's test suite, translated to TypeScript by a program

`../stdlib` has tests of Python's standard library that were translated to TypeScript by hand, a file at a time. This directory has
the program that does it to all of `Lib/test`, some 32,000 test methods, and the scoreboard that runs the result. The library is
tested in its own language elsewhere (`../cpython-suite`). What these tests are for is the boundary: every value, call, exception,
class and iterator in them crosses from JavaScript to Python or back.

Nothing that is generated is kept here. `Lib/test` is not in the executable, so all of this needs a checkout of CPython (the build
has one in `vendor/cpython`).

| File            | What                                                                                                    |
| --------------- | ------------------------------------------------------------------------------------------------------- |
| `translate.py`  | Python to TypeScript, on `ast`. Runs under `bun` as `python3`, or under CPython.                        |
| `support.ts`    | What the generated code calls: everything in it that is not syntax of JavaScript is `$.name`.           |
| `support.py`    | What JavaScript has no way to say, and the runner of one test, which also runs the originals.           |
| `run.py`        | The scoreboard: translates, runs both, compares, writes `score.md` and `score.json`.                    |
| `score.md`      | The head of the score of the last run that was kept (`--save`).                                         |
| `suite.test.ts` | The test of all this that runs with the other tests: `fixture/test_sample.py`, translated and compared. |

```sh
python3 translate.py Lib/test/test_bisect.py test.test_bisect out/test_bisect.test.ts   # one file; copy support.* beside it
python3 run.py --lib vendor/cpython/Lib --bun build/release/bun --out /tmp/suite -j 10  # everything: some 10 minutes
python3 run.py --lib ... --bun ... --out /tmp/suite test_json test_re                   # some files
python3 run.py --lib ... --bun ... --out /tmp/suite --summarize --top 50                # the score of that run again
python3 run.py --lib ... --bun ... --out /tmp/other --compare /tmp/suite                # what passes in /tmp/suite and not in /tmp/other
```

The results of the originals are kept in the scratch directory; `--rebaseline` runs them again, as a new build calls for.

## What a translation is

```python
class TestInsort:                                     TestInsort = $.class_("TestInsort", "TestInsort", $n, [], {}, $ns1 => {
    def test_vsBuiltinSort(self, n=500):                $.setitem($ns1, "test_vsBuiltinSort", $.def($.fn({ name: ..., pos: ["self", "n"], defaults: [500] }, (self, n) => {
        for insorted in (list(), UserList()):             for (insorted of $.iter($.t($b.list(), UserList()))) {
            for i in range(n):                              for (i of $.iter($b.range(n))) {
                digit = choice("0123456789")                  digit = choice("0123456789");
                if digit in "02468":                          if ($.in_(digit, "02468")) {
                    f = self.module.insort_left                 f = $.attr(self.module, "insort_left");
                ...
            self.assertEqual(sorted(insorted), insorted)    self.assertEqual($b.sorted(insorted), insorted);
```

- **Test cases are classes of Python's**, made from JavaScript, that derive from the real `unittest.TestCase`: the order of base
  classes, mixins, bases that come from modules written in Python, `skipIf`, `subTest`, `assertRaises`, `addCleanup` are `unittest`'s
  own. Their methods are functions of JavaScript. `$.finish()` finds the test cases as `unittest`'s loader does and makes a
  `describe()` of each and a `test()` of each method, which runs it with `TestCase.run()`. Only methods that are written in the file
  count: what a class inherits from a module in Python has not been translated.
- **`def` and `lambda` are arrow functions**, with `self` as the first parameter. A generator function is an arrow function that
  returns the generator of an inner `function*`. A function that takes keywords, `*args` or defaults other than `None` is made by
  `$.fn(signature, implementation)`, which sorts out the arguments as Python does. (A default parameter of JavaScript's will not do:
  it also replaces a `None` that was passed.)
- **`async def`** makes a coroutine object (`Coroutine` in `support.py`, with `send`, `throw` and `close`) around a generator of
  JavaScript's, and `await x` is `yield*` of what `x.__await__()` gives: the tests drive coroutines by hand and run them on loops of
  their own, which a promise cannot be made to do. In a file that has `async def`, calls are made so that a coroutine of Python's
  comes back as itself and not as a promise.
- **Variables** are declared at the top of the function that binds them, as Python has it. The names a class body binds are items of the
  namespace that `__prepare__` gave (`Enum` counts on it). `super()` and `__class__` go by a real `__classcell__`.
- **Operators, attributes, items, truth and iteration** of values whose type is not known go through `support.ts`, which uses what
  JavaScript has where that is the same thing (a property of an object of Python's that is no mapping, an index of a list or tuple) and
  `operator`, `getattr()`, `iter()` where it is not (`[1] + [2]`, `"a".upper`, `d.get`, `x[-1]`, `for k in d`).
- **`with`** is `with()` of `bun:python` and an arrow function where nothing in the body leaves it (`return`, `break`, `yield`, `await`).
  Elsewhere it is what PEP 343 says it is, written out with `try`, `catch` and `finally`. **`try`** is `try`; an `except` clause is an `if` in the `catch`. What is not an exception of Python's is
  caught by no clause: the original raises nothing else, so it is a mistake of the translation or of the runtime, and is to show.
- **Ints** that are constants are computed by the translator (`2**64` is `18446744073709551616n`); all other arithmetic is Python's.
- **The module** is a module object in `sys.modules` under the name of the original, with the names of the translated file, for
  `pickle`, `repr()` and `sys.modules[__name__]`. The variables of the file are variables of JavaScript, and the module object is told
  of them when the file has been loaded, when a function binds one with `global`, and whenever somebody asks: `globals()` is the
  namespace of the module, brought up to date. A name that no statement binds is looked up there (`globals()[name] = ...`, `exec()`),
  and test cases that got there that way are found. What is written into that namespace under the name of a variable does not
  reach the variable: `mock.patch()` of a global of the test's own module has no effect on the translation.
- **`locals()`** in a function is a dict made for the occasion, as in Python, in which what is not bound yet is `None`; in the body of a
  class it is the namespace. `eval()` and `exec()` without namespaces get these two. `vars()` and `dir()` without arguments go by them. The functions of Python that wrap the methods are made as if they were written in the
  original file, because much in Python goes by the frame of the caller (the module of a new class, the file of a warning), and code in
  JavaScript has no frame.
- **Files that tests are inherited from** (`list_tests.py`, `pickletester.py`, `test_asyncio/utils.py`) are translated too. A translation
  imports them as modules of JavaScript, and they are in `sys.modules` for whoever asks there.

## The same tests, closer to JavaScript

By default a translation keeps to what is known to work, so that a failure says something. Each of these gives up one such caution. The
difference from the default run (`--compare`) is the list of what stands between the feature and the way Python's own tests use it.

| Switch                                 | What changes                                                                                  |
| -------------------------------------- | --------------------------------------------------------------------------------------------- |
| `STDLIB_SUITE_RAW_METHODS=1`           | Methods are the arrow functions themselves, not functions of Python that call them.           |
| `STDLIB_SUITE_NATIVE=1`                | The operators of JavaScript wherever an operand is an object of Python's.                     |
| `STDLIB_SUITE_NATIVE_LEFT=0` with that | ...but not with a string or an array on the left.                                             |
| `--native-classes`                     | `class X extends Base` where the class statement has one base and nothing that JS cannot say. |
| `--inline-with`                        | `with` is always written out.                                                                 |
| `--native-async`                       | `async def` is an async function, `await` is `await`.                                         |

## What is left out

A test method that has something in it that cannot be translated faithfully is left out and counted, with the reason, in the `.json`
that is written beside each translation: what asks for a frame (`sys._getframe()`, `inspect.currentframe()`), `match`, `except*`, type
parameters, t-strings. A helper that is left out becomes a function that throws
`Untranslated`; a test that runs into it counts as left out at run time, not as failed.

JavaScript runs on one thread. A test that has another thread run a function of its own cannot work, which shows when it runs: it
is interrupted and counted apart.

## The score

Each original is run under the same `bun`, as `python3`, by the same runner. A test that fails both ways says nothing about the
boundary and is set apart. A test that kills the process or does not end is noted, and the file is run again for the rest.
Failures whose cause is known (the table `CAUSES` in `run.py`) are counted by cause. The others are put together by message, most
frequent first. Each is either a mistake of the translator or a difference between the languages.
