try: import builtins
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import builtins')
try: import re
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import re')
try: import sys
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import sys')
try: import time
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import time')
try: import warnings
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import warnings')


try:
    def plain(text):
        return re.sub(r"0x[0-9a-f]+", "0x", text)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def plain(text):')


# __self__ of built-in functions and methods
try:
    for name, function in [("len", len), ("time.sleep", time.sleep), ("dict.fromkeys", dict.fromkeys), ("float.fromhex", float.fromhex),
                           ("str.maketrans", str.maketrans), ("bytes.maketrans", bytes.maketrans), ("bytearray.maketrans", bytearray.maketrans),
                           ("int.__new__", int.__new__), ("object.__new__", object.__new__), ("[].append", [].append), ("''.join", "".join),
                           ("object.__init_subclass__", object.__init_subclass__), ("dict.__class_getitem__", dict.__class_getitem__)]:
        try: print('name [' + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + ", " + 'function=' + (repr(function) if type(function) in (str, int, float, bytes, bool, type(None)) or (type(function) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in function)) else function.__name__ if type(function) is type else type(function).__name__) + '] =>', name)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: name')
        try: print("|", 'function.__self__ if not isinstance(function.__self__, type(sys)) els... [' + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + ", " + 'function=' + (repr(function) if type(function) in (str, int, float, bytes, bool, type(None)) or (type(function) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in function)) else function.__name__ if type(function) is type else type(function).__name__) + '] =>', function.__self__ if not isinstance(function.__self__, type(sys)) else function.__self__.__name__)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: function.__self__ if not isinstance(function.__self__, type(sys)) els...')
        try: print("|", 'plain(repr(function)) [' + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + ", " + 'function=' + (repr(function) if type(function) in (str, int, float, bytes, bool, type(None)) or (type(function) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in function)) else function.__name__ if type(function) is type else type(function).__name__) + '] =>', plain(repr(function)))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: plain(repr(function))')
        try: print("|", 'function.__qualname__ [' + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + ", " + 'function=' + (repr(function) if type(function) in (str, int, float, bytes, bool, type(None)) or (type(function) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in function)) else function.__name__ if type(function) is type else type(function).__name__) + '] =>', function.__qualname__)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: function.__qualname__')
        try: print("|", 'function.__reduce__() if function.__self__ is None or isinstance(func... [' + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + ", " + 'function=' + (repr(function) if type(function) in (str, int, float, bytes, bool, type(None)) or (type(function) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in function)) else function.__name__ if type(function) is type else type(function).__name__) + '] =>', function.__reduce__() if function.__self__ is None or isinstance(function.__self__, type) else "-")
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: function.__reduce__() if function.__self__ is None or isinstance(func...')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for name, function in [("len", len), ("time.sleep", time.sleep), ("di...')
try: print('type(str.__dict__["maketrans"]).__name__ =>', type(str.__dict__["maketrans"]).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(str.__dict__["maketrans"]).__name__')
try: print('str.__dict__["maketrans"].__func__ is str.maketrans =>', str.__dict__["maketrans"].__func__ is str.maketrans)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: str.__dict__["maketrans"].__func__ is str.maketrans')
try: print('"x".maketrans.__self__ =>', "x".maketrans.__self__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: "x".maketrans.__self__')


# An iterator over a sequence that never ends
try:
    class Endless:
        def __getitem__(self, index):
            return index
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Endless:')


try: it = iter(Endless())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: it = iter(Endless())')
try: it.__setstate__(sys.maxsize - 2)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: it.__setstate__(sys.maxsize - 2)')
try:
    for _ in range(5):
        try:
            print('next(it) [' + '_=' + (repr(_) if type(_) in (str, int, float, bytes, bool, type(None)) or (type(_) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in _)) else _.__name__ if type(_) is type else type(_).__name__) + '] =>', next(it))
        except Exception as e:
            print('type(e).__name__ [' + '_=' + (repr(_) if type(_) in (str, int, float, bytes, bool, type(None)) or (type(_) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in _)) else _.__name__ if type(_) is type else type(_).__name__) + '] =>', type(e).__name__)
            print('e [' + '_=' + (repr(_) if type(_) in (str, int, float, bytes, bool, type(None)) or (type(_) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in _)) else _.__name__ if type(_) is type else type(_).__name__) + '] =>', e)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for _ in range(5):')
try: print(it.__reduce__()[2])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: it.__reduce__()[2]')
try: it.__setstate__(-5)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: it.__setstate__(-5)')
try: print('next(it) =>', next(it))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: next(it)')
try: print('it.__reduce__()[2] =>', it.__reduce__()[2])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: it.__reduce__()[2]')
try: it.__setstate__(sys.maxsize)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: it.__setstate__(sys.maxsize)')
try:
    try:
        print(next(it))
    except Exception as e:
        print('type(e).__name__ =>', type(e).__name__)
        print('e =>', e)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try:')
try:
    try:
        it.__setstate__(sys.maxsize + 1)
    except Exception as e:
        print('type(e).__name__ =>', type(e).__name__)
        print('e =>', e)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try:')

try:
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        print('sys._clear_type_cache() =>', sys._clear_type_cache())
        print('sys._clear_internal_caches() =>', sys._clear_internal_caches())
        print([(str(w.message), w.category.__name__, w.lineno) for w in caught])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: with warnings.catch_warnings(record=True) as caught:')

# What built-in functions are bound to, and what inspect and pydoc make of that.
try: import copy, inspect, io, pickle, pydoc
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import copy, inspect, io, pickle, pydoc')
try:
    for f in (object.__new__, int.__new__, str.__new__, dict.__new__, io.BytesIO.__new__, type.__new__, tuple.__new__, str.maketrans,
              bytes.maketrans, bytearray.maketrans, dict.fromkeys, int.from_bytes, float.fromhex, bytes.fromhex, object.__init_subclass__,
              object.__subclasshook__, type.__prepare__, len, [].append, "".join):
        try: bound = getattr(f, "__self__", "none")
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: bound = getattr(f, "__self__", "none")')
        try: print('f.__qualname__ [' + 'f=' + (repr(f) if type(f) in (str, int, float, bytes, bool, type(None)) or (type(f) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in f)) else f.__name__ if type(f) is type else type(f).__name__) + '] =>', f.__qualname__)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: f.__qualname__')
        try: print('type(f).__name__ [' + 'f=' + (repr(f) if type(f) in (str, int, float, bytes, bool, type(None)) or (type(f) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in f)) else f.__name__ if type(f) is type else type(f).__name__) + '] =>', type(f).__name__)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(f).__name__')
        try: print('bound if bound is None or isinstance(bound, type) else type(bound).__... [' + 'f=' + (repr(f) if type(f) in (str, int, float, bytes, bool, type(None)) or (type(f) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in f)) else f.__name__ if type(f) is type else type(f).__name__) + '] =>', bound if bound is None or isinstance(bound, type) else type(bound).__name__)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: bound if bound is None or isinstance(bound, type) else type(bound).__...')
        try: print('repr(f).split(" at 0x")[0] [' + 'f=' + (repr(f) if type(f) in (str, int, float, bytes, bool, type(None)) or (type(f) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in f)) else f.__name__ if type(f) is type else type(f).__name__) + '] =>', repr(f).split(" at 0x")[0])
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: repr(f).split(" at 0x")[0]')
        try:
            print("   ", 'inspect.signature(f) [' + 'f=' + (repr(f) if type(f) in (str, int, float, bytes, bool, type(None)) or (type(f) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in f)) else f.__name__ if type(f) is type else type(f).__name__) + '] =>', inspect.signature(f))
        except (ValueError, TypeError) as e:
            print("   ", 'type(e).__name__ [' + 'f=' + (repr(f) if type(f) in (str, int, float, bytes, bool, type(None)) or (type(f) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in f)) else f.__name__ if type(f) is type else type(f).__name__) + '] =>', type(e).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for f in (object.__new__, int.__new__, str.__new__, dict.__new__, io....')
try: print(pydoc.render_doc(str.maketrans, renderer=pydoc.plaintext).splitlines()[2])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: pydoc.render_doc(str.maketrans, renderer=pydoc.plaintext).splitlines(...')
try: print(pydoc.render_doc(dict.fromkeys, renderer=pydoc.plaintext).splitlines()[2])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: pydoc.render_doc(dict.fromkeys, renderer=pydoc.plaintext).splitlines(...')

try:
    class DerivedStr(str):
        pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class DerivedStr(str):')

try:
    class DerivedList(list):
        pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class DerivedList(list):')

try: print('DerivedStr.maketrans.__self__ =>', DerivedStr.maketrans.__self__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: DerivedStr.maketrans.__self__')
try: print('DerivedStr.maketrans is str.maketrans =>', DerivedStr.maketrans is str.maketrans)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: DerivedStr.maketrans is str.maketrans')
try: print('DerivedStr().maketrans.__self__ =>', DerivedStr().maketrans.__self__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: DerivedStr().maketrans.__self__')
try: print('DerivedStr.__new__.__self__ =>', DerivedStr.__new__.__self__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: DerivedStr.__new__.__self__')
try: print('copy.copy(DerivedList([1])) =>', copy.copy(DerivedList([1])))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: copy.copy(DerivedList([1]))')
try: print('[pickle.loads(pickle.dumps(DerivedList([2]), protocol)) for protocol ... =>', [pickle.loads(pickle.dumps(DerivedList([2]), protocol)) for protocol in range(pickle.HIGHEST_PROTOCOL + 1)])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [pickle.loads(pickle.dumps(DerivedList([2]), protocol)) for protocol ...')
