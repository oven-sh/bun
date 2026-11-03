import builtins
import re
import sys
import time
import warnings


def plain(text):
    return re.sub(r"0x[0-9a-f]+", "0x", text)


# __self__ of built-in functions and methods
for name, function in [("len", len), ("time.sleep", time.sleep), ("dict.fromkeys", dict.fromkeys), ("float.fromhex", float.fromhex),
                       ("str.maketrans", str.maketrans), ("bytes.maketrans", bytes.maketrans), ("bytearray.maketrans", bytearray.maketrans),
                       ("int.__new__", int.__new__), ("object.__new__", object.__new__), ("[].append", [].append), ("''.join", "".join),
                       ("object.__init_subclass__", object.__init_subclass__), ("dict.__class_getitem__", dict.__class_getitem__)]:
    print(name, "|", function.__self__ if not isinstance(function.__self__, type(sys)) else function.__self__.__name__, "|", plain(repr(function)), "|",
          function.__qualname__, "|", function.__reduce__() if function.__self__ is None or isinstance(function.__self__, type) else "-")
print(type(str.__dict__["maketrans"]).__name__, str.__dict__["maketrans"].__func__ is str.maketrans, "x".maketrans.__self__)


# An iterator over a sequence that never ends
class Endless:
    def __getitem__(self, index):
        return index


it = iter(Endless())
it.__setstate__(sys.maxsize - 2)
for _ in range(5):
    try:
        print(next(it))
    except Exception as e:
        print(type(e).__name__, e)
print(it.__reduce__()[2])
it.__setstate__(-5)
print(next(it), it.__reduce__()[2])
it.__setstate__(sys.maxsize)
try:
    print(next(it))
except Exception as e:
    print(type(e).__name__, e)
try:
    it.__setstate__(sys.maxsize + 1)
except Exception as e:
    print(type(e).__name__, e)

with warnings.catch_warnings(record=True) as caught:
    warnings.simplefilter("always")
    print(sys._clear_type_cache(), sys._clear_internal_caches())
    print([(str(w.message), w.category.__name__, w.lineno) for w in caught])

# What built-in functions are bound to, and what inspect and pydoc make of that.
import copy, inspect, io, pickle, pydoc
for f in (object.__new__, int.__new__, str.__new__, dict.__new__, io.BytesIO.__new__, type.__new__, tuple.__new__, str.maketrans,
          bytes.maketrans, bytearray.maketrans, dict.fromkeys, int.from_bytes, float.fromhex, bytes.fromhex, object.__init_subclass__,
          object.__subclasshook__, type.__prepare__, len, [].append, "".join):
    bound = getattr(f, "__self__", "none")
    print(f.__qualname__, type(f).__name__, bound if bound is None or isinstance(bound, type) else type(bound).__name__, repr(f).split(" at 0x")[0])
    try:
        print("   ", inspect.signature(f))
    except (ValueError, TypeError) as e:
        print("   ", type(e).__name__)
print(pydoc.render_doc(str.maketrans, renderer=pydoc.plaintext).splitlines()[2])
print(pydoc.render_doc(dict.fromkeys, renderer=pydoc.plaintext).splitlines()[2])

class DerivedStr(str):
    pass

class DerivedList(list):
    pass

print(DerivedStr.maketrans.__self__, DerivedStr.maketrans is str.maketrans, DerivedStr().maketrans.__self__, DerivedStr.__new__.__self__)
print(copy.copy(DerivedList([1])), [pickle.loads(pickle.dumps(DerivedList([2]), protocol)) for protocol in range(pickle.HIGHEST_PROTOCOL + 1)])
