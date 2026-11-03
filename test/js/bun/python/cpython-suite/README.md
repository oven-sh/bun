# CPython's test suite under Bun

`Lib/test` of CPython 3.15, unchanged, run by `python3 -m test` where `python3` is Bun. It is not part of Bun's CI: a run takes
about ten minutes on a large machine, needs a checkout of CPython (the tests are not in the executable), and a fifth of the tests fail. It is
how progress is measured, and where most bugs are found.

    score.py [--bun build/release/bun] [--lib vendor/cpython/Lib] [-j N] [test_x ...]

runs each of the 666 test modules in a process of its own and writes `score.md` and `score.json`: totals, the tests that kill the
interpreter or hang, failures grouped by cause, what changed since the last run. See the top of the file. Use a release build:
a debug build takes seconds to start Python.

- `score.md`, `score.json`: the last full run that somebody thought worth keeping.
- `oracle.json`: what CPython itself passes in the same harness (`score.py --oracle`): the 100% of the scoreboard.
- `deficit.py` prints where the tests are that CPython passes and Bun does not, by root cause; `deficit.md` is what it printed.
- `TRIAGE.md`: written by hand. Every way found so far to kill the interpreter or to make it hang.
- `logs/`: what each module printed that did not simply pass. Not kept in the repository.
- `shims/`: see below.

A module is a file of tests. The files of `test_importlib/resources` are the exception: none of them can be imported alone, under CPython
either, so they count as one module that is picked out of a run of `test_importlib` (`TOGETHER` in `score.py`).

What counts is the test (a method). One of which only subtests fail counts as failed; `regrtest`'s XML has no word for it, so that is
read from what the run printed.

One module by hand, with Bun under the name `python3` (a symbolic link to the executable does):

    BUN_PYTHON_STDLIB=vendor/cpython/Lib python3 -m test -v test_x

## Stand-ins for helper modules written in C

CPython's tests have helper modules that are extension modules (`_testcapi`, `_testinternalcapi`, `_testlimitedcapi`,
`_testmultiphase`, ...). There are none here, and a test that needs one skips itself. But some test files import one at the top,
or in the body of a class, for the sake of a few tests, and then none of their tests can run: `test_importlib/util.py` imports
`_testmultiphase`, so all of `test_importlib`, `test_import`, `test_runpy`, `test_pkgutil`, `test_compileall` were skipped, some 1,450
tests of which a few dozen have to do with extension modules; likewise `test_bytes`, `test_class`, `test_with` and `test_traceback`.

`shims/NAME/NAME.py` is a module of that name, written in Python, that is there to be imported. Whatever is asked of it raises
`unittest.SkipTest`, so a test that needs the real thing is skipped as before. The exceptions are a few functions of the C
API that do what a program can do as well (`PySequence_GetItem` and the like), which are written out. `_testmultiphase` is
different: it puts `None` in `sys.modules` in its own place, so the one import in `test_importlib/util.py` goes through and every
later one fails as if there were no such module, which is what the tests of extension modules look at to skip themselves.
One test looks at nothing and is left out by name (`IGNORED` in `score.py`).

`_interpreters` (with `_interpqueues` beside it) is there for `test_concurrent_futures`, whose `util.py` names
`concurrent.futures.InterpreterPoolExecutor` in the body of a class: without it none of the tests of thread pools and process pools
could be imported, some 380 tests. There are no subinterpreters: the stand-in knows of the main interpreter and refuses to make
another, so the tests of interpreter pools fail. Three tests start a child with `-I`, which does not see the stand-in, and are left out by name.

`shims/_impl_detail` is of another kind: `score.py --impl-detail` puts it on the path of every module, and the tests marked
`@cpython_only` are run instead of skipped. Of the 838 such tests that CPython passes, 502 pass here, 228 then skip themselves for want
of a C helper, 108 fail (reference counts, sizes, bytecode, which objects are the same object). The scoreboard does not count them.

They are no part of Bun. `score.py` puts a shim on `PYTHONPATH` for the test modules listed in its `SHIMS` and for no others
(`test.support` and many tests do something sensible when a helper is missing), and never for CPython. By hand:

    PYTHONPATH=shims/_testmultiphase BUN_PYTHON_STDLIB=vendor/cpython/Lib python3 -m test -v test_import
