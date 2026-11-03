# Differential tests of Python in Bun

Python scripts, and what CPython 3.15 prints when it runs them. `bun script.py` must print the same.

Compared: stdout (byte for byte), the exit status and, when CPython's status is not 0, the last line of stderr that is not empty.

## Running them

- **In Bun's test runner**, which needs no CPython: `bun bd test test/js/bun/python/differential/lang.test.ts`, and so on. One test
  for each script. The files are cut so that each takes about ten minutes of processor time in a debug build, and a few seconds
  in a release build:

  | file                             | what                                                                                        |
  | -------------------------------- | ------------------------------------------------------------------------------------------- |
  | `lang.test.ts`                   | `lang/`                                                                                     |
  | `modules-a-b.test.ts` ... `-u-z` | `mod_*/`, by the first letter of the name                                                   |
  | `grid-1.test.ts`, `-2`           | `extra/grid_*`                                                                              |
  | `runtime.test.ts`                | every other directory: `gc/`, `llint/`, `extra/`, `interop/`, `once_crashed/`, `once_hung/` |
  | `command-line.test.ts`           | `command-line/`                                                                             |

- **By hand**, with differences that are easier to read:

      tools/run.py --ours build/debug/bun-debug                 everything
      tools/run.py --ours ... -v 045 'lang/1[01]*' mod_io       some (numbers and names in lang/, globs, directories), with the differences
      tools/run.py --oracle python3.15 --update [tests]         ask CPython again, and write the .expected files
      tools/run.py --oracle python3.15 --live [tests]           compare with CPython now; writes nothing
      tools/command_line.py --ours ... [part of a name]         the same for command-line/ (--update as well)

  `$BUN_EXE` and `$PYTHON_ORACLE` are the defaults of `--ours` and `--oracle`.

Every script runs in a copy of its directory, with that as the working directory, nothing on stdin, and the same small environment
on both sides (`HOME` and `TMPDIR` in the copy, `LANG=C.UTF-8`, `TZ=UTC0`). CPython runs with `-I -X utf8`. The path of the copy is
shown as `<dir>`.

## The files

- `DIRECTORY/NAME.py`: a script. `DIRECTORY/NAME.expected`: what CPython did with it.

      status: 1
      stderr: ValueError: the last line of stderr (only if the status is not 0; a negative status is a signal)
      script: the first 16 digits of the SHA-256 of the script
      ---
      stdout

  A script that has changed since its `.expected` file was written fails, whatever it prints: `tools/run.py --update`.

- `expected-failures.json`: the scripts (and `command-line/NAME`) that are known to print something else, and why. They run, and
  **one that passes is a failure**, so that the list stays true: take it off the list.
- `not-in-ci.json`: the scripts that the `.test.ts` files leave out, and why: what they print depends on the machine or on timing, or
  they take too long. `tools/run.py` runs them when they are named, or with `--all`.
- `helpers.txt`: modules that scripts import, which are no tests themselves.

The expectations were made on Linux (x86-64, glibc), and the tests run only on Linux with glibc so far: names and numbers of errors, what
the system offers and what its C library computes are in them.

## The directories

- `lang/NNN_topic.py`: the language, from the most basic to the advanced. 001-053 types, functions, classes, exceptions; 054-092 one
  small test for each kind of uncaught exception and `sys.exit`; 093-106 generators, iterators, `with`, `match`, async driven by hand;
  107-119 evaluation order, builtins, `eval`/`exec`/`compile`, PEP 695/696, `type` aliases, t-strings, the import statement and lazy
  imports; 120-127 big constructs (written by `tools/gen_big.py`), recursion, SyntaxError messages and positions, lexical analysis;
  128-129 `sys`, frames and tracebacks; 130-137 whole programs; from 138 on, whatever was found later.
- `lang/generated/`: **what really runs.** The tests in `lang/` are written compactly, `print(a, b, c, ...)` with dozens of expressions
  on a line, and run as written one unexpected exception would end a test. `tools/split.py` makes the version that runs, on both
  sides:
  - every value is on a line of its own, labelled with the source of its expression: `pow(2, -1, 5) => 3`;
  - inside a module-level `for` loop the label also shows the loop variables: `eval(e) [e='None + 1'] => TypeError: ...`;
  - every module-level statement is guarded, so that an exception costs one line: `<!TypeError: message> in: source`.

  Under CPython no guard ever fires (`tools/verify.py` checks that). Do not edit these files: `tools/run.py --update` makes them, and
  the `.expected` file remembers which version of `lang/NAME.py` they were made from. `--raw` runs the files as written.

- `mod_NAME/`: the modules that CPython has in C and Bun in C++ (`_io`, `posix`, `_sre`, `math`...), and library modules that lean on
  them. Files called `g_*.py` are generated by the `tools/gen.py` of their directory.
- `gc/`, `llint/`, `extra/`: finalizers and their order; the fast paths of the interpreter against its slow paths; odds and ends.
- `extra/grid/grid.py`: the grid, five million calls of the methods of the built-in types, of operators and of built-in functions on
  ordinary and borderline arguments. `grid.py --groups` lists its groups, `grid.py GROUP [NAME]` prints a line for each call. The tests are
  `extra/grid_NN_*.py`, samples of it that a debug build can bear: each Nth call, and digests of what came out.
  `tools/grid_compare.py` and `tools/grid_classes.py` make all the calls under CPython and under a release build, in half a minute, and show
  what differs, call by call or put in classes. After a change to `grid.py`: `tools/grid_scripts.py`, which writes the samples, then
  `tools/run.py --update`.
- `once_crashed/`, `once_hung/`: a few lines each that once killed the interpreter or made it hang, found by running CPython's test
  suite (`../cpython-suite/TRIAGE.md`).
- `interop/`, `mod_threads/bun/`, `mod_memoryview/js/`: programs that use JavaScript as well. There is no CPython to ask, so a person
  wrote the `.expected` file (`oracle: none` in it) by reasoning about what should be seen, not by copying a run. If there is
  a `NAME.js` it is what runs, and `NAME.py` is a module it imports. `mask: addresses` reads `0x7f...` as `0xADDR`.
- `slow/`: too heavy for a debug build, where the `.test.ts` files skip it.
- `command-line/`: `cases.json` has about 130 command lines of `python3` (options, environment variables, stdin, `-m`, `-c`, `-i`,
  directories and archives as programs) and the files they need; `expected.json` has stdout, stderr and the status that CPython
  gave. Bun is run through a link named `python3`.
- `crashers/`: tests that look for crashes and hangs, with a driver and a README of their own. Not run by the `.test.ts` files: some take
  minutes, or all the memory there is.

## Writing one

- Deterministic, also under hash randomisation: no addresses, times, process ids or temporary names in the output.
- Nothing that depends on the machine: users, host names, the resolver, routes, IPv6, time zone files, limits, the umask, what is in
  `/etc`. No network but the loopback interface, and port 0.
- No waiting for time to pass where an event can be waited for.
- In `lang/`: a name with `_uncaught` or `_exit` in it means that the test ends with a status that is not 0; top-level `await` is not
  used, since CPython has none.
- What relies on reference counts (an object gone at the last `del`) calls `gc.collect()` first.

Other tools: `tools/verify.py` (checks the tests of `lang/` themselves against CPython), `tools/keep_generators.py` (shows whether a test
relies on reference counting), `tools/cold_warm.py` (runs each test of `lang/` as a module twice: compiled, and from its `.pyc` file).
