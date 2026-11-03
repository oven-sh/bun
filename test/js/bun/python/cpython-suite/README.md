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

One module by hand, with Bun under the name `python3` (a symbolic link to the executable does):

    BUN_PYTHON_STDLIB=vendor/cpython/Lib python3 -m test -v test_x
