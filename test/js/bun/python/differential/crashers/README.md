# Nothing a Python program does may kill or hang the interpreter

Tests that look for crashes and hangs. Each runs its groups in processes of their own, because CPython 3.15 itself dies of some of them.

    python3 drive.py [-j N] [--ours CMD] [--timeout S] [-v] test.py...    # CMD: $BUN_EXE, or `bun`. CPython: $PYTHON_ORACLE, or `python3.15`

runs every group (`test.py --list`) under CPython and under ours. `CRASH/HANG`: ours died or hung (the one thing that must not happen).
`both die`: it takes for ever, or all the memory, in CPython too. `oracle dies`: only CPython died. `different`: other output; read it, most are accidents
of CPython (stale lengths, freed memory shown) or messages.

| test | what it does |
|---|---|
| `evil_index.py` | `__index__` (and `__len__`, `__int__`) that clears, shrinks or grows the container it is used on: list, bytearray, array, deque, memoryview, mmap, str methods |
| `evil_eq.py` | `__eq__`/`__hash__` that mutate the set, dict, list, deque, OrderedDict, Counter... that is being searched, compared or merged |
| `evil_iter.py` | iterators, `__length_hint__`, `__next__`, `keys()` that mutate what consumes them or lie about their length; printing, pickling, copying containers that change meanwhile |
| `deep_recursion.py` | 200 000 levels of everything that C++ walks recursively: repr, ==, hash, pickle, json, marshal, copy, compile, ast, nested iterators, chains of exceptions, `A.__call__ = A()`, `A.__get__ = A()` |
| `huge_results.py` | small inputs that ask for results too large to exist: `"a".ljust(2**40)`, `s.replace("a", s)`, `"%*d"`, `(1).to_bytes(2**62)`, `BytesIO.seek(2**40)`, sizes in pickles and marshal data |
| `dict_popitem_cycles.py` | `d[k] = v; d.popitem()` again and again (used to fill the index table with dummies: endless lookup) |

    python3 fuzz_drive.py [-j N] [--ours CMD] [--seeds A-B] [--trials N] [modules...]

runs `fuzz_api.py MODULE SEED TRIALS`: every function and every method of every type of ~100 modules written in C++, on instances made with junk, by
`T.__new__(T)` and by `object.__new__(T)`, called with junk arguments. The call about to be made is written to stderr, so the last line names the culprit.
No oracle: any death is a bug (or a call to add to `SKIP_NAMES`: what blocks, exits or needs all the memory in CPython too).
