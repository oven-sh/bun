#!/usr/bin/env python3
"""Makes instances of every built-in type without initializing them (T.__new__(T), object.__new__(T), copyreg.__newobj__(T),
copyreg._reconstructor(T, object, None)) and then tries everything on them: each attribute is read, set and deleted, each method called
with a few lists of arguments, the operators applied. Whatever is raised is fine. What counts is a crash, or a report of a sanitizer:
a method that takes it that __init__ has run.

    uninitialized_instances.py --ours 'build/debug/bun-debug' [-j N] [--timeout S] [module.Type ...]

One process per type. With a debug build and -j 10: 12 minutes. (CPython 3.15 itself crashes on _pickle.Pickler,
_sqlite3.Connection, _sqlite3.Cursor and super.)
"""
import argparse, os, shlex, subprocess, sys, tempfile
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import run

MODULES = '''bz2 lzma zlib _thread select hashlib _hashlib _sha3 _blake2 _md5 _sha1 _sha2 _io _collections _functools itertools operator _operator
_sre _struct array _datetime _decimal _random _queue _csv _json _pickle _socket _ssl _sqlite3 mmap _contextvars _asyncio _weakref types builtins _codecs
unicodedata _zoneinfo _bz2 _lzma _zstd _ctypes _elementtree pyexpat _multibytecodec _lsprof _tracemalloc _tokenize _symtable _ast _abc _string _locale
_statistics _uuid _multiprocessing _posixshmem _remote_debugging _hmac _typing _interpqueues _interpchannels _curses _dbm _gdbm readline time posix _signal
_warnings _imp sys gc marshal _heapq _bisect _opcode'''

LIST = '''
import importlib
seen = set()
for name in %r.split():
    try:
        module = importlib.import_module(name)
    except ImportError:
        continue
    for key, value in sorted(vars(module).items()):
        if isinstance(value, type) and value not in seen and not issubclass(value, BaseException):
            seen.add(value)
            print(name + "." + key)
''' % MODULES

ONE = '''
import copyreg, gc, importlib, itertools, sys
module, _, name = sys.argv[1].rpartition(".")
T = getattr(importlib.import_module(module), name)
# What waits for ever, or for somebody else.
skip = {"__init__", "__new__", "__class__", "__del__", "__init_subclass__", "__subclasshook__", "acquire", "acquire_lock", "get", "join", "wait", "poll", "select",
        "accept", "__enter__", "wait_for", "_at_fork_reinit", "serve_forever", "__reduce__", "__reduce_ex__"}
def some(o):
    return list(itertools.islice(iter(o), 5))
calls = 0
for make in (lambda: T.__new__(T), lambda: object.__new__(T), lambda: copyreg.__newobj__(T), lambda: copyreg._reconstructor(T, object, None)):
    try:
        instance = make()
    except BaseException:
        continue
    for attribute in dir(T):
        if attribute in skip:
            continue
        try:
            value = getattr(instance, attribute)
        except BaseException:
            continue
        if callable(value):
            for arguments in ((), (0,), (b"x",), ("x",), (instance,), (None, None), (1, 2, 3), ([],), (bytearray(4),)):
                calls += 1
                try:
                    result = value(*arguments)
                    if hasattr(result, "__next__"):
                        some(result)
                except BaseException:
                    pass
        else:
            for change in (lambda: setattr(instance, attribute, value), lambda: delattr(instance, attribute)):
                try:
                    change()
                except BaseException:
                    pass
    for operation in (repr, str, hash, len, some, bool, memoryview, lambda o: o == o, lambda o: o < o, lambda o: o + o, lambda o: o[0], lambda o: o(),
                      lambda o: o.__reduce_ex__(2), lambda o: o.__reduce_ex__(0), lambda o: 1 in o, lambda o: o.__sizeof__()):
        try:
            operation(instance)
        except BaseException:
            pass
    del instance
    gc.collect()
print("done", calls)
'''


def main():
    parser = argparse.ArgumentParser(usage=__doc__)
    parser.add_argument('-j', type=int, default=8)
    parser.add_argument('--ours', default=os.environ.get('BUN_EXE', 'bun'))
    parser.add_argument('--timeout', type=int, default=400)
    parser.add_argument('types', nargs='*')
    options = parser.parse_args()
    command = shlex.split(options.ours)
    with tempfile.TemporaryDirectory(prefix='python-uninitialized-') as directory:
        os.makedirs(os.path.join(directory, 'tmp'))
        environment = run.environment(directory, True)
        for name, source in (('list.py', LIST), ('one.py', ONE)):
            with open(os.path.join(directory, name), 'w') as f:
                f.write(source)
        types = options.types or subprocess.run(command + ['list.py'], cwd=directory, env=environment, capture_output=True, text=True).stdout.split()
        print(len(types), 'types', flush=True)

        def one(name):
            try:
                p = subprocess.run(command + ['one.py', name], cwd=directory, env=environment, stdin=subprocess.DEVNULL, capture_output=True, timeout=options.timeout)
            except subprocess.TimeoutExpired:
                return name, 'takes too long', ''
            if p.returncode == 0 and p.stdout.rstrip().rpartition(b'\n')[2].startswith(b'done') and not run.CRASH.search(run.text(p.stderr)):
                return name, '', ''
            return name, 'CRASH (status %s)' % p.returncode, run.crash_line(p.stderr)

        crashes = 0
        with ThreadPoolExecutor(options.j) as pool:
            for name, outcome, detail in pool.map(one, types):
                if outcome:
                    crashes += outcome.startswith('CRASH')
                    print(outcome, name, flush=True)
                    if detail:
                        print('   ', detail, flush=True)
    print('crashes:', crashes)
    return 1 if crashes else 0


if __name__ == '__main__':
    sys.exit(main())
