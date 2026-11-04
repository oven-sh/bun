# How much of CPython's test suite other implementations of Python pass

Measured on 4 November 2026, all on one machine (32 cores, shared and heavily loaded), all with `score.py` (see README.md, "Other implementations"):
`Lib/test` of the release of CPython that the engine says it implements, **unchanged**, one process per test module, a test that kills the interpreter or hangs is left out and the module run again.
100% is what that release of CPython, built complete on the same machine, passes in the same harness; tests are matched by name.

## Measured here

| engine | Python | tests and reference | reference passes | of those pass | share | really fail (failed + errors) | kills it / hangs |
|---|---|---|---|---|---|---|---|
| **Bun** (this branch, release build) | 3.15.2 | CPython 3.15.2, 724 modules | 46,643 | 42,302 | **90.7%** (86.2% without the stand-ins of `shims/`) | 225 + 407 | 0 / 0 |
| **PyPy** 7.3.23 | 3.11.15 | CPython 3.11.15, 546 modules | 38,315 | 33,593 | **87.7%** (stand-ins make no difference) | 370 + 229 | 1 / 9 |
| **GraalPy** 25.3.4.1, from Maven on OpenJDK 25, without the Graal compiler | 3.13.14 | CPython 3.13.14, 625 modules | 41,497 | 32,064 | **77.3%** (0 without four stand-ins for the driver, see below) | 1,462 + 1,135 | 2 / 57 |
| **MicroPython** 1.22.1 (Ubuntu's package) | "3.4" | | | 0 | cannot be measured this way: `import unittest` and `import test.support` are syntax errors to it. It is a subset by design. | | |

Not measured: **RustPython** (main, 0.6.1, declares 3.15: it would have run on exactly our tests and reference): it has to be built from source, and 45 of its 512 crates, eleven of them needed by
its core, could not be had on this machine. **Jython** (2.7 only) and **IronPython** (3.4): their language level is older than `regrtest --junit-xml`. **Brython**, **Skulpt**: run in a browser, no `python -m test`.
**Pyodide** is CPython itself compiled to WebAssembly, not another implementation.

### Where the missing tests are

| | Bun | PyPy | GraalPy |
|---|---|---|---|
| tests that CPython passes and the engine does not | 4,341 | 4,722 | 9,433 |
| the test skipped itself (marked `cpython_only`, or needs a module or feature that is not there) | 2,563 | 2,125 | 4,987 |
| the whole module skipped itself | 1,047 | 562 | 482 |
| the module could not be loaded | 145 | 1,376 | 447 |
| failed or raised | 586 | 579 | 2,546 |
| skipped or not reached, in a module with a crash or a hang | 0 | 80 | 971 |
| biggest | no `fork` in `multiprocessing` 611, no subinterpreters 606, `_decimal` 350, C helpers of the tests 382, CPython's bytecode 375, `_remote_debugging` 237, tracebacks 210, `dbm.gnu`/`dbm.ndbm` 235, tracing 172 | `test_datetime` 960 and `test_json` 159 (cannot be loaded without `_datetime`, `_json`), the C halves of `test_asyncio` 797, `_decimal` 338, tracebacks 187, subinterpreters 180, `test_socket` 121, `test_array` 120, `test_compile` 119, `test_dis` 104 | `test_asyncio` 1,296, `test_typing` 486, `test_sys_settrace` 426, `test_socket` 386, `multiprocessing` with forkserver and fork 569, `_decimal` 341, `test_ordered_dict` 251, `test_io` 238, tracebacks 228, `test_compile` 174, `test_shelve` 168 |

## What the projects publish

These are the projects' own numbers, on their own copies of the tests, on their own machines. The two rows "by name" are our arithmetic on their data.

| project | figure | of what | date, source |
|---|---|---|---|
| RustPython | 44,712 passed, 22 failed or errors, 241 expected failures, 4,788 skipped | its copy of `Lib/test` (of the 832 `test_*.py` of 3.15.2: 556 identical, 208 edited, 68 absent; 283 `expectedFailure` and 73 `skip` marks "TODO: RUSTPYTHON") | 3 Nov 2026, [data of its results page](https://github.com/RustPython/rustpython.github.io/blob/master/_data/regrtests_results.json) |
| RustPython, by name | **89.0%**: 41,502 of the 46,643 tests of our 3.15.2 reference are "passed" in that file (2,130 skipped, 230 expected failures, 18 failed, 2,763 not in it: `test_sqlite3`, `test_ctypes`, `test_shelve`, `test_decimal`, ...) | | our arithmetic |
| GraalPy | "the CPython tests run on every commit and pass ~85%" | not defined further | [README](https://github.com/oracle/graalpython), read 4 Nov 2026 |
| GraalPy | 40,578 tests tagged as passing, 38,601 of them on linux-x86_64, in 376 files | "we only run tests that we know should pass": its CI runs the tagged tests of its copy of `Lib/test` (161 of 1,064 files edited) | master of 3 Nov 2026, [unittest_tags](https://github.com/oracle/graalpython/tree/master/graalpython/com.oracle.graal.python.test/src/tests/unittest_tags), [CONTRIBUTING](https://github.com/oracle/graalpython/blob/master/docs/contributor/CONTRIBUTING.md) |
| GraalPy, by name | **81.6%**: 33,855 of the 41,497 tests of our 3.13.14 reference are tagged for linux-x86_64 | | our arithmetic |
| GraalPy | of the 600 most depended-on PyPI packages 93% install; "over 65% of all tests of all packages combined" pass | packages, not CPython's suite | README |
| PyPy | "about 250 failing stdlib tests, with thousands passing" on 3.11; 3.10 "still has around 100" | its copy, `lib-python/3` (151 of 854 files edited, 214 more guards for implementation details than CPython's copy) | January 2025, [blog](https://pypy.org/posts/2025/01/towards-pypy311-an-update.html); [how PyPy is tested](https://pypy.org/posts/2022/04/how-is-pypy-tested.html) |
| Pyodide | "a large part of the CPython test suite passes except for tests skipped in `src/tests/python_tests.yaml` or via patches" (some 35 modules marked as failing, some 125 tests or patterns skipped, of some 670 modules) | CPython on WebAssembly | [docs](https://pyodide.org/en/stable/usage/wasm-constraints.html), [list](https://github.com/pyodide/pyodide/blob/main/src/tests/python_tests.yaml) |
| Jython | none; 2.7.4 (August 2024) is Python 2.7 | | [jython.org](https://www.jython.org/) |
| IronPython | none; 3.4.x is Python 3.4 with a library edited for it | | [repository](https://github.com/IronLanguages/ironpython3) |
| Brython | none; its own tests, plain asserts | | [CONTRIBUTING](https://github.com/brython-dev/brython/blob/master/CONTRIBUTING.md) |
| MicroPython | none; "implements Python 3.4 and some select features of Python 3.5 and above", with a list of differences | | [docs](https://docs.micropython.org/en/latest/genrst/index.html) |

## How to read this

- **The versions differ**, so the tests differ: 38,315 tests of 3.11 are not the 46,643 of 3.15. PyPy is measured on a language that is four releases old; nothing here says what it would pass of 3.15.
- **Unchanged tests are a harsh measure for the others, and one that this branch was developed against.** Every project edits the tests it runs, mostly to skip what tests CPython's internals. Unchanged, a test file that
  names a C accelerator at the top cannot even be loaded: a quarter of PyPy's deficit is `test_datetime` and `test_json`, whose Python halves it would pass. Bun has modules of those names because this scoreboard asked for them. Only 599 tests really fail under PyPy, 632 under Bun (2,597 under GraalPy).
- **Nobody but CPython can reach 100%**: some 840 of the 46,643 tests of 3.15 (1.8%) are marked `cpython_only`, pass under the reference and are skipped by everybody else.
- **The tests of the C API are left out for everybody** (`test_capi`, `test_cext`, ...). PyPy and GraalPy load C extension modules (NumPy and the like); Bun does not. That is the largest difference in practice, and this table is blind to it.
- **A share of tests is not a share of programs.** PyPy has run real programs for fifteen years. A test suite measures the corners.
- **GraalPy was not measured as people run it**: the native executable could not be downloaded here, so this is the JVM distribution without its compiler (3 to 6 seconds to start, 5 times slower than CPython after that); it got 1,800 s a module instead of 900 (no module needed more) and 600 s without output instead of 300. Some of its 57 "hangs" are tests that are
  only very slow without the compiler (`test_adaptive_find`, `test_find_many_lengths`), and the machine was overloaded throughout. It cannot start CPython's own driver: `test.support` of 3.13 imports `_opcode`, `regrtest` wants `faulthandler.register`, `gc.garbage` and a list in every `__path__`. It was given those four (`shims/_other_engines`); without them the figure is 0. Its own CI does not use `regrtest`.
- In 3.11 four packages of tests are outside `Lib/test` (`ctypes.test`, `distutils.tests`, `lib2to3.tests`, `unittest.test`, 2,300 tests): for PyPy those are its own copies, 26 files of which are edited.
- The reference has to be complete. Until today this scoreboard's CPython had been built without OpenSSL, `_decimal`, `_uuid`, gdbm, readline and curses, and totals were divided: that gave Bun 93.2%. Against a complete CPython, matched by name, it is 90.7%.

## Speed, as a footnote

Two small sets of microbenchmarks, best of three, on the loaded machine; the CPythons are plain builds (no PGO, no LTO).

| | first set | second set |
|---|---|---|
| CPython 3.15.2 | 928 ms | 619 ms |
| CPython 3.13.14 | 874 ms | 622 ms |
| CPython 3.11.15 | 940 ms | 668 ms |
| Bun (this branch) | 507 ms | 600 ms |
| PyPy 7.3.23 | 176 ms | 122 ms |
| GraalPy 25.3.4.1 on the JVM without its compiler | 4,368 ms | 3,239 ms |

The whole suite: Bun 5m44 (four modules at a time, quieter machine), CPython 3.15.2 2m45 (seven at a time), PyPy 20m50 (four at a time; most of it is waiting 300 s for each of nine hangs),
GraalPy 4 hours (six at a time at the lowest priority on the overloaded machine; 18 hours of module time, of which 9.5 are waiting for hangs).
