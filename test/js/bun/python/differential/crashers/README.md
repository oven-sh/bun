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
| `evil_generators.py` | generators and coroutines resumed from within, from finalizers, trace functions and other threads; their frames read, written, cleared, jumped in; at the recursion limit and at the end of the stack; thousands of locals; odd `throw()`, delegates and hooks |
| `evil_waits.py` | what waits (locks, joins, `SimpleQueue.get`, sleeps, `select`) with odd arguments, through odd call paths, from finalizers, trace functions and signal handlers, at the recursion limit, with signals arriving meanwhile, under contention |
| `evil_imports.py` | `sys.modules`, `sys.meta_path`, `sys.path_hooks`, `__import__`, `__builtins__`, `__spec__`, `__path__`... replaced by junk or deleted; finders and loaders that misbehave; `_imp` and the frozen importer with junk; built-in modules made twice and emptied; damaged `.pyc` files; rings of imports in threads |
| `dict_popitem_cycles.py` | `d[k] = v; d.popitem()` again and again (used to fill the index table with dummies: endless lookup) |
| `gc_values_stored_while_marking.py` | ints and objects stored by turns to dicts, sets, lists, deques, generators' variables, attributes and containers just made, each in a process in which one full collection follows the other: what a thread of the collector reads must be the old value or the new one. Most telling on a release build: there it died within 3 s while the values of a dict were not aligned |

    python3 fuzz_drive.py [-j N] [--ours CMD] [--seeds A-B] [--trials N] [modules...]

runs `fuzz_api.py MODULE SEED TRIALS`: every function and every method of every type of ~100 modules written in C++, on instances made with junk, by
`T.__new__(T)` and by `object.__new__(T)`, called with junk arguments. The call about to be made is written to stderr, so the last line names the culprit.
No oracle: any death is a bug (or a call to add to `SKIP_NAMES`: what blocks, exits or needs all the memory in CPython too).

    python3 fuzz_syntax_errors.py generate LIB cases.jsonl [--seed N] [--count N]    # with CPython
    python3 fuzz_syntax_errors.py run cases.jsonl reference.jsonl                     # with CPython
    OURS    fuzz_syntax_errors.py run cases.jsonl ours.jsonl                          # with ours, as python3
    python3 fuzz_syntax_errors.py compare cases.jsonl reference.jsonl ours.jsonl [--examples N] [--only TEXT]

What the compiler says about programs that are wrong. `generate` takes statements of the `.py` files under LIB and damages each in one place (a token deleted, doubled,
swapped, replaced, inserted; the text cut off; a line indented differently; two lines joined). `run` compiles each case and notes the exception with all its attributes
(type, message, line, offsets, text, `_metadata`) and the warnings. `compare` groups the differences by the two messages. The same seed gives the same cases.
Seeds 1 to 6, 40 000 cases each over CPython's `Lib`, were used to find and fix differences: 4 cases still differ. Seeds 7 to 9 were run once, afterwards: 11 of 120 000 differ
("cannot mix bytes and nonbytes literals", which CPython raises as soon as the strings are joined, whatever is wrong around them: 4; the rest one each). No case crashes.
