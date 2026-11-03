# A module written in C that is taken out of sys.modules and imported again: a new module, without what was done to the old one.
import _imp
import codecs
import gc
import importlib
import importlib.machinery
import importlib.util
import os
import sys
import time
import warnings


def again(name):
    old = sys.modules.pop(name)
    new = importlib.import_module(name)
    return old, new


for name in ("time", "math", "_json", "_collections", "_thread", "_io", "_functools", "itertools", "_struct", "_operator", "marshal", "posix", "errno",
             "_signal", "_weakref", "_abc", "_codecs", "_sre", "_stat", "atexit", "_string", "_random", "_datetime", "_pickle", "_socket", "select", "zlib",
             "binascii", "_heapq", "_bisect", "_contextvars", "_asyncio", "array", "_csv", "unicodedata", "_warnings", "gc", "_imp", "_locale", "_opcode"):
    importlib.import_module(name)
    old, new = again(name)
    print(name, old is new, sys.modules[name] is new, type(new).__name__, sorted(vars(old)) == sorted(vars(new)), new.__name__, new.__spec__.name,
          new.__spec__ is old.__spec__, new.__spec__.origin == old.__spec__.origin, type(new.__loader__) is type(old.__loader__))

# What was done to the old one is not in the new one.
import math
original = math.pi
math.pi = 3
math.extra = "added"
del math.sin
old, math = again("math")
print(old.pi, hasattr(old, "extra"), hasattr(old, "sin"), math.pi == original, hasattr(math, "extra"), math.sin(0.0), old.cos(0.0))
math.tau = 6
print(old.tau == math.tau)
print(vars(old) is vars(math), old.__dict__ is vars(old))

# Both work.
old, new = again("_struct")
print(old.pack("<H", 258), new.pack("<H", 258), new.unpack("<H", old.pack("<H", 7)))
old, new = again("_json")
print(old.encode_basestring("a\n"), new.encode_basestring("a\n"))
old, new = again("itertools")
print(list(old.chain([1], [2])), list(new.chain([1], [2])), list(new.islice(old.count(), 3)))

# What belongs to the interpreter stays.
def search(name):
    if name == "made_up":
        return codecs.lookup("utf-8")


codecs.register(search)
old, new = again("_codecs")
print(new.lookup("made_up").name, old.lookup("made_up").name, "x".encode("made_up"))
codecs.unregister(search)
old, new = again("_warnings")
print(old.filters is new.filters, old._onceregistry is new._onceregistry, new.filters is warnings.filters)
old, new = again("gc")
print(old.garbage is new.garbage, old.callbacks is new.callbacks, new.isenabled() == old.isenabled())
old, new = again("_thread")
lock = old.allocate_lock()
print(lock.acquire(False), lock.locked(), new.get_ident() == old.get_ident())
lock.release()
old, new = again("atexit")
new.register(print, "registered with the new one")
old.register(print, "registered with the old one")
print(old._ncallbacks() == new._ncallbacks())

# time.tzset() is about the module that can be imported.
old, new = again("time")
os.environ["TZ"] = "XYZ-3"
old.tzset()
print(new.tzname[0], new.timezone, old.tzname[0] == "XYZ")
os.environ["TZ"] = "UTC0"
new.tzset()
print(new.tzname[0], new.timezone)

# _imp.create_builtin() makes one each time, whatever is in sys.modules.
spec = importlib.machinery.BuiltinImporter.find_spec("_operator")
one = _imp.create_builtin(spec)
two = _imp.create_builtin(spec)
print(one is two, one is sys.modules.get("_operator"), one.__name__, type(one).__name__, _imp.exec_builtin(one), _imp.exec_builtin(two), one.add(1, 2), two.add(1, 2))
module = importlib.util.module_from_spec(spec)
print(module.__spec__ is spec, module.__loader__ is importlib.machinery.BuiltinImporter, module is sys.modules.get("_operator"))
spec.loader.exec_module(module)
print(module.mul(2, 3))
import _operator
print(importlib.reload(_operator) is _operator)

# What test.support.import_helper.import_fresh_module() does.
def import_fresh(name, fresh=(), blocked=()):
    saved = {other: sys.modules.pop(other, None) for other in (name, *fresh, *blocked)}
    for other in blocked:
        sys.modules[other] = None
    try:
        for other in fresh:
            importlib.import_module(other)
        return importlib.import_module(name)
    finally:
        for other, module in saved.items():
            if module is None:
                sys.modules.pop(other, None)
            else:
                sys.modules[other] = module


fresh = import_fresh("operator", fresh=["_operator"])
pure = import_fresh("operator", blocked=["_operator"])
import operator
print(fresh is operator, pure is operator, fresh.add.__module__, type(pure.add).__name__, sys.modules["_operator"] is _operator)
