# CPython's test suite under Bun

`Lib/test` of CPython 3.15, unchanged, run by `python3 -m test` where `python3` is Bun. It is not part of Bun's CI: a run takes
about ten minutes on a large machine, needs a checkout of CPython (the tests are not in the executable), and a fifth of the tests fail. It is
how progress is measured, and where most bugs are found.

    score.py [--bun build/release/bun] [--lib vendor/cpython/Lib] [-j N] [test_x ...]

runs each of the 676 test modules in a process of its own and writes `score.md` and `score.json`: totals, the tests that kill the
interpreter or hang, failures grouped by cause, what changed since the last run. See the top of the file. Use a release build:
a debug build takes seconds to start Python.

- `score.md`, `score.json`: the last full run that somebody thought worth keeping.
- `oracle.json`: what CPython itself passes in the same harness (`score.py --oracle`): the 100% of the scoreboard.
- `deficit.py` prints where the tests are that CPython passes and Bun does not, by root cause; `deficit.md` is what it printed.
- `TRIAGE.md`: written by hand. Every way found so far to kill the interpreter or to make it hang.
- `logs/`: what each module printed that did not simply pass. Not kept in the repository.
- `shims/`: see below.

One module by hand, with Bun under the name `python3` (a symbolic link to the executable does):

    BUN_PYTHON_STDLIB=vendor/cpython/Lib python3 -m test -v test_x

## Stand-ins for helper modules written in C

CPython's tests have helper modules that are extension modules (`_testcapi`, `_testinternalcapi`, `_testlimitedcapi`,
`_testmultiphase`, ...). There are none here, and a test that needs one skips itself. But some test files import one at the top,
or in the body of a class, for the sake of a few tests, and then none of their tests can run: `test_importlib/util.py` imports
`_testmultiphase`, so all of `test_importlib`, `test_import`, `test_runpy`, `test_pkgutil`, `test_compileall` were skipped, some 1,450
tests of which a few dozen have to do with extension modules; likewise `test_bytes`, `test_class` and `test_with`.

`shims/NAME/NAME.py` is a module of that name, written in Python, that is there to be imported. Whatever is asked of it raises
`unittest.SkipTest`, so a test that needs the real thing is skipped as before. The exceptions are a few functions of the C
API that do what a program can do as well (`PySequence_GetItem` and the like), which are written out.

They are no part of Bun. `score.py` puts a shim on `PYTHONPATH` for the test modules listed in its `SHIMS` and for no others
(`test.support` and many tests do something sensible when a helper is missing), and never for CPython. By hand:

    PYTHONPATH=shims/_testmultiphase BUN_PYTHON_STDLIB=vendor/cpython/Lib python3 -m test -v test_import
