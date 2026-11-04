# CPython's test suite under Bun

`Lib/test` of CPython 3.15, unchanged, run by `python3 -m test` where `python3` is Bun. It is not part of Bun's CI: a run takes
about ten minutes on a large machine, needs a checkout of CPython (the tests are not in the executable), and a tenth of what CPython passes does not
pass yet. It is how progress is measured, and where most bugs are found.

    score.py [--bun build/release/bun] [--lib vendor/cpython/Lib] [-j N] [test_x ...]

runs each test module (724 of them in 3.15.2) in a process of its own and writes `score.md` and `score.json`: totals, the tests that kill the
interpreter or hang, failures grouped by cause, what changed since the last run. See the top of the file. Use a release build:
a debug build takes seconds to start Python.

- `score.md`, `score.json`: the last full run that somebody thought worth keeping.
- `oracle.json`: what CPython itself passes in the same harness (`score.py --oracle`): the 100% of the scoreboard. See "The percentage".
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

`_ctypes_test` is the one that does the whole job. The real one is an extension module that `test_ctypes` loads a second time, as a plain shared
library, through its `__file__`: 25 of the 61 files of `test_ctypes` need it. `shims/_ctypes_test/build.sh <CPython's sources>` builds
`Modules/_ctypes/_ctypes_test.c` against `src/Python.h`, a stand-in of some 90 lines that needs no C API, into `_ctypes_test_library.so` next to the shim (which is
not kept in the repository); `_ctypes_test.py` has that path for its `__file__` and the few functions that the module has for Python. Until the library is built the
shim raises `ImportError`, and the tests are skipped as without it. It works under CPython too, and a CPython installed without its test modules is
given it (`SHIMS_FOR_ORACLE`): `test_ctypes` then runs 624 tests there instead of 327.

`shims/_impl_detail` is of another kind: `score.py --impl-detail` puts it on the path of every module, and the tests marked
`@cpython_only` are run instead of skipped. Of the 838 such tests that CPython passes, 502 pass here, 228 then skip themselves for want
of a C helper, 108 fail (reference counts, sizes, bytecode, which objects are the same object). The scoreboard does not count them.

They are no part of Bun. `score.py` puts a shim on `PYTHONPATH` for the test modules listed in its `SHIMS` and for no others
(`test.support` and many tests do something sensible when a helper is missing), and, `_ctypes_test` aside, never for CPython. By hand:

    PYTHONPATH=shims/_testmultiphase BUN_PYTHON_STDLIB=vendor/cpython/Lib python3 -m test -v test_import

## The percentage

The percentage is the share of the tests that pass under CPython that also pass here, matched by name. A test that passes here and that CPython skips or fails there
does not count: it cannot make up for a failure elsewhere.

A run writes the names of the tests that passed to a file beside its results (`oracle.names.json`, `score.names.json`: 2 MB each, not kept in the repository). What is kept has, for each module, a digest of
its names and how many of the reference's tests were among them (`"matched"`, with the digest of the reference's names). So the kept files give the same figure without the names; to match a new run by name,
run `score.py --oracle` first, which takes three minutes and is to be done on the same machine anyway. Where the names of either side are missing and the digests do not agree, a module counts for no more than CPython passes in it.

So the CPython of `--oracle` has to be complete. One that was built without the headers of OpenSSL, gdbm, readline, ncurses or libuuid, or without `_decimal`, skips
some 1,200 tests (`test_ssl`, the halves of `test_decimal`, `test_shelve`, `test_uuid`, `test_dbm`, the TLS tests of `test_asyncio`, `test_imaplib`, `test_poplib`, `test_ftplib`),
and they are then asked of nobody. At the end of `make`, "The necessary bits to build these optional modules were not found" should name `_tkinter` at most.

## Other implementations

The harness measures any implementation of Python that can run `python -m test`:

    score.py --oracle --lib cpython-3.11/Lib --oracle-python cpython-3.11/bin/python3 --oracle-file oracle-3.11.json
    score.py --engine --python pypy3 --lib cpython-3.11/Lib --oracle-file oracle-3.11.json --tag pypy311

- `--lib` is the `Lib` of the release of CPython that the engine says it implements (`sys.version`, to the micro version: its library is a copy of that release's). Only `Lib/test` is used,
  unchanged, in the place of the engine's own copy, which every project edits: skips, expected failures, guards for details of the implementation.
- The rest of the library is the engine's. `--engine` makes a directory of links to it, with CPython's `test` among them, and puts it at the front of `sys.path`: `test.support`
  takes the directory above itself for the library, and finds the packages of tests from there that up to 3.11 are elsewhere in it (`ctypes.test`, `distutils.tests`, `lib2to3.tests`, `unittest.test`).
  Those four are therefore the engine's copies.
- The reference is that release of CPython, built on the same machine, complete, run by the same harness with the same limits.
- An engine is given a stand-in of `shims/` only for a module that it cannot import itself; `--no-shims` gives none, to Bun either.
- `--path DIR` is for what an engine needs to get the driver started at all. GraalPy cannot import the `test.support` of 3.13, which imports `_opcode` at the top, and `regrtest` asks for
  `faulthandler.register`, `gc.garbage` and a list in every module's `__path__`: `--path shims/_other_engines/_opcode --path shims/_other_engines/driver`.
- `--slow-is-final`, with a longer `--timeout` and `--idle`, is for an engine that takes seconds to start: a module of tests that start children is then slow, not stuck.

What such a figure does not say: the versions differ, so the tests differ; unchanged tests punish an engine for having no module of the name of a C accelerator (without `_datetime` or `_json` none of
`test_datetime` or `test_json` can even be loaded, though the Python halves would pass); tests marked `cpython_only` are skipped by everybody else and count for nobody; and a share of tests is not a share of programs.
