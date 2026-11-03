# verify: fake imports  (only sys, builtins and modules made up here are imported)
try: import sys
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import sys')
try:
    def t(f):
        try:
            print(repr(f()))
        except BaseException as e:
            print(type(e).__name__ + ':', e)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def t(f):')

try: print('type(sys).__name__ =>', type(sys).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(sys).__name__')
try: print('sys.__name__ =>', sys.__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sys.__name__')
try: print('repr(sys) =>', repr(sys))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: repr(sys)')
try: print('sys is sys.modules["sys"] =>', sys is sys.modules["sys"])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sys is sys.modules["sys"]')
try: print('sys.__doc__ is not None =>', sys.__doc__ is not None)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sys.__doc__ is not None')
try: print('sys.__spec__.name =>', sys.__spec__.name)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sys.__spec__.name')
try: print('sys.__loader__.__name__ =>', sys.__loader__.__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sys.__loader__.__name__')
try: print('sys.__package__ == "" =>', sys.__package__ == "")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sys.__package__ == ""')
try: print('hasattr(sys, "__file__") =>', hasattr(sys, "__file__"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: hasattr(sys, "__file__")')
try: import sys as system
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import sys as system')
try: import sys as a, sys as b
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import sys as a, sys as b')
try: from sys import maxsize
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: from sys import maxsize')
try: from sys import maxsize as ms, version_info as vi
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: from sys import maxsize as ms, version_info as vi')
try: from sys import (maxsize as m2, path,)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: from sys import (maxsize as m2, path,)')
try: from sys import (
    argv,
    modules,
)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: from sys import ( argv, modules, )')
try: print('system is sys =>', system is sys)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: system is sys')
try: print('a is b is sys =>', a is b is sys)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a is b is sys')
try: print('maxsize == sys.maxsize =>', maxsize == sys.maxsize)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: maxsize == sys.maxsize')
try: print('ms == m2 == maxsize =>', ms == m2 == maxsize)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ms == m2 == maxsize')
try: print('vi[0] =>', vi[0])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: vi[0]')
try: print('path is sys.path =>', path is sys.path)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: path is sys.path')
try: print('modules is sys.modules =>', modules is sys.modules)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: modules is sys.modules')
try: print('type(argv).__name__ =>', type(argv).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(argv).__name__')
try: print('len(argv) =>', len(argv))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: len(argv)')
try: print('argv[0].rsplit("/", 1)[-1] =>', argv[0].rsplit("/", 1)[-1])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: argv[0].rsplit("/", 1)[-1]')
try: import builtins
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import builtins')
try: print('builtins.len is len =>', builtins.len is len)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: builtins.len is len')
try: print('builtins.__name__ =>', builtins.__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: builtins.__name__')
try: print('type(__builtins__).__name__ =>', type(__builtins__).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(__builtins__).__name__')
try: print('__builtins__ is builtins =>', __builtins__ is builtins)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: __builtins__ is builtins')
try: print('repr(builtins) =>', repr(builtins))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: repr(builtins)')
try: print('"print" in dir(builtins) =>', "print" in dir(builtins))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: "print" in dir(builtins)')
try: print('builtins.__spec__.origin =>', builtins.__spec__.origin)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: builtins.__spec__.origin')
try: print('builtins.__dict__["int"] is int =>', builtins.__dict__["int"] is int)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: builtins.__dict__["int"] is int')
try:
    def in_func():
        import sys as local_sys
        from sys import maxsize as local_max
        return local_sys is sys, local_max == maxsize, sorted(locals())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def in_func():')
try: print(in_func())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: in_func()')
try:
    class InClass:
        import sys as s
        from sys import maxsize as mx
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class InClass:')
try: print('InClass.s is sys =>', InClass.s is sys)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: InClass.s is sys')
try: print('InClass.mx == maxsize =>', InClass.mx == maxsize)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: InClass.mx == maxsize')
try:
    if True: import sys as cond
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: if True: import sys as cond')
try:
    for _ in range(2): import sys as loop
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for _ in range(2): import sys as loop')
try:
    try: import sys as tried
    finally: pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try: import sys as tried')
try: print(cond is loop is tried is sys)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: cond is loop is tried is sys')
try: import sys
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import sys')
try: import sys
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import sys')
try: print("repeated imports are fine")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: "repeated imports are fine"')
# Failures.
try:
    def f1(): import no_such_module
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def f1(): import no_such_module')
try:
    def f2(): import no_such_pkg.sub.mod
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def f2(): import no_such_pkg.sub.mod')
try:
    def f3(): from no_such_module import x
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def f3(): from no_such_module import x')
try:
    def f4(): from sys import no_such_name
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def f4(): from sys import no_such_name')
try:
    def f5(): from sys import maxsize, no_such_name
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def f5(): from sys import maxsize, no_such_name')
try:
    def f6(): import sys.no_such_submodule
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def f6(): import sys.no_such_submodule')
try:
    def f7(): from sys.sub import x
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def f7(): from sys.sub import x')
try:
    def f8(): from . import x
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def f8(): from . import x')
try:
    def f9(): from .mod import x
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def f9(): from .mod import x')
try:
    def f10(): from .. import x
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def f10(): from .. import x')
try:
    def f11(): from builtins import nope
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def f11(): from builtins import nope')
try:
    def f12(): import sys.path
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def f12(): import sys.path')
try:
    def f13(): import builtins.len
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def f13(): import builtins.len')
try:
    for f in (f1, f2, f3, f4, f5, f6, f7, f8, f9, f10, f11, f12, f13):
        try: f(); print("ok")
        except ImportError as e: print(type(e).__name__ + ":", e, "| name:", e.name, "| path:", e.path, "| name_from:", e.name_from)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for f in (f1, f2, f3, f4, f5, f6, f7, f8, f9, f10, f11, f12, f13):')
try:
    def partial():
        try: from sys import maxsize as got, no_such_name
        except ImportError: pass
        return "got" in locals()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def partial():')
try: print(partial())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: partial()')
# __import__
try: print('__import__("sys") is sys =>', __import__("sys") is sys)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: __import__("sys") is sys')
try: print('__import__("sys", globals(), locals(), [], 0) is sys =>', __import__("sys", globals(), locals(), [], 0) is sys)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: __import__("sys", globals(), locals(), [], 0) is sys')
try: print('__import__("sys", fromlist=["maxsize"]) is sys =>', __import__("sys", fromlist=["maxsize"]) is sys)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: __import__("sys", fromlist=["maxsize"]) is sys')
try: print('__import__(name="sys") is sys =>', __import__(name="sys") is sys)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: __import__(name="sys") is sys')
try: print('__import__("builtins").len is len =>', __import__("builtins").len is len)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: __import__("builtins").len is len')
try: print('__import__() =>', end=" "); t(lambda: __import__())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: __import__())')
try: print('__import__(1) =>', end=" "); t(lambda: __import__(1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: __import__(1))')
try: print('__import__("") =>', end=" "); t(lambda: __import__(""))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: __import__(""))')
try: print('__import__("no_such_module") =>', end=" "); t(lambda: __import__("no_such_module"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: __import__("no_such_module"))')
try: print('__import__("sys", level=-1) =>', end=" "); t(lambda: __import__("sys", level=-1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: __import__("sys", level=-1))')
try: print('__import__("sys", level=1) =>', end=" "); t(lambda: __import__("sys", level=1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: __import__("sys", level=1))')
try: print('__import__("sys", {"__package__": None, "__name__": "x"}, level=1) =>', end=" "); t(lambda: __import__("sys", {"__package__": None, "__name__": "x"}, level=1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: __import__("sys", {"__package__": None, "__name__": "x"}, l...')
try: print('__import__("sys", fromlist=["nope"]) is sys =>', end=" "); t(lambda: __import__("sys", fromlist=["nope"]) is sys)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: __import__("sys", fromlist=["nope"]) is sys)')
try: print('__import__("sys", fromlist=[1]) =>', end=" "); t(lambda: __import__("sys", fromlist=[1]))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: __import__("sys", fromlist=[1]))')
try: print('__import__("sys.nope") =>', end=" "); t(lambda: __import__("sys.nope"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: __import__("sys.nope"))')
try: print('__import__(None) =>', end=" "); t(lambda: __import__(None))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: __import__(None))')
try: print('__import__("a\\0b") =>', end=" "); t(lambda: __import__("a\0b"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: __import__("a\\0b"))')
try: print('__import__("sys", level="1") =>', end=" "); t(lambda: __import__("sys", level="1"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: __import__("sys", level="1"))')
try: print('__import__("", level=1) =>', end=" "); t(lambda: __import__("", level=1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: __import__("", level=1))')
# The import statement calls builtins.__import__.
try: calls = []
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: calls = []')
try: real = builtins.__import__
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: real = builtins.__import__')
try:
    def hook(name, globals=None, locals=None, fromlist=(), level=0):
        calls.append((name, fromlist, level, globals is not None and globals.get("__name__")))
        return real(name, globals, locals, fromlist, level)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def hook(name, globals=None, locals=None, fromlist=(), level=0):')
try: builtins.__import__ = hook
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: builtins.__import__ = hook')
try: import sys
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import sys')
try: import sys as s2
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import sys as s2')
try: from sys import maxsize
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: from sys import maxsize')
try: from sys import maxsize as q, path as p
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: from sys import maxsize as q, path as p')
try:
    try: import nope_a.nope_b
    except ImportError: pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try: import nope_a.nope_b')
try:
    try: from . import rel
    except ImportError: pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try: from . import rel')
try:
    try: from ..pkg import rel
    except ImportError: pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try: from ..pkg import rel')
try: builtins.__import__ = real
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: builtins.__import__ = real')
try: print(calls)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: calls')
try:
    class Fake:
        attr = "from a fake module"
        class sub: deep = "deep"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Fake:')
try: builtins.__import__ = lambda *a, **k: Fake
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: builtins.__import__ = lambda *a, **k: Fake')
try: import anything
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import anything')
try: import x.y.z
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import x.y.z')
try: import x.sub as xs
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import x.sub as xs')
try: from whatever import attr
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: from whatever import attr')
try: from whatever import sub as sb
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: from whatever import sub as sb')
try: builtins.__import__ = real
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: builtins.__import__ = real')
try: print('anything is Fake =>', anything is Fake)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: anything is Fake')
try: print('x is Fake =>', x is Fake)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: x is Fake')
try: print('xs is Fake.sub =>', xs is Fake.sub)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: xs is Fake.sub')
try: print('attr =>', attr)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: attr')
try: print('sb.deep =>', sb.deep)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sb.deep')
try: builtins.__import__ = lambda *a, **k: Fake
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: builtins.__import__ = lambda *a, **k: Fake')
try:
    try:
        from whatever import missing
    except ImportError as e: print("ImportError:", e)
    finally: builtins.__import__ = real
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try:')
try: del builtins.__import__
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del builtins.__import__')
try:
    try:
        import sys
    except ImportError as e: print("ImportError:", e)
    finally: builtins.__import__ = real
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try:')
# sys.modules is consulted first.
try: Mod = type(sys)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Mod = type(sys)')
try: fake = Mod("fake_mod")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: fake = Mod("fake_mod")')
try: fake.value = 42
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: fake.value = 42')
try: fake.__all__ = ["value", "other"]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: fake.__all__ = ["value", "other"]')
try: fake.other = "o"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: fake.other = "o"')
try: fake._private = "p"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: fake._private = "p"')
try: fake.hidden = "h"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: fake.hidden = "h"')
try: sys.modules["fake_mod"] = fake
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sys.modules["fake_mod"] = fake')
try: import fake_mod
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import fake_mod')
try: from fake_mod import value
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: from fake_mod import value')
try: print('fake_mod is fake =>', fake_mod is fake)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: fake_mod is fake')
try: print('value =>', value)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: value')
try: print('fake_mod.__name__ =>', fake_mod.__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: fake_mod.__name__')
try: print('repr(fake_mod) =>', repr(fake_mod))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: repr(fake_mod)')
try: print('fake_mod.__dict__.keys() >= {"value", "__name__"} =>', fake_mod.__dict__.keys() >= {"value", "__name__"})
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: fake_mod.__dict__.keys() >= {"value", "__name__"}')
try: print('fake_mod.__doc__ =>', fake_mod.__doc__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: fake_mod.__doc__')
try: print('fake_mod.__spec__ =>', fake_mod.__spec__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: fake_mod.__spec__')
try: print('fake_mod.__loader__ =>', fake_mod.__loader__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: fake_mod.__loader__')
try: print('fake_mod.__package__ =>', fake_mod.__package__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: fake_mod.__package__')
try: ns = {}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ns = {}')
try: exec("from fake_mod import *", ns)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: exec("from fake_mod import *", ns)')
try: print(sorted(k for k in ns if k != "__builtins__"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sorted(k for k in ns if k != "__builtins__")')
try: del fake.__all__
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del fake.__all__')
try: ns = {}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ns = {}')
try: exec("from fake_mod import *", ns)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: exec("from fake_mod import *", ns)')
try: print(sorted(k for k in ns if k != "__builtins__"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sorted(k for k in ns if k != "__builtins__")')
try: fake.__all__ = ["nope"]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: fake.__all__ = ["nope"]')
try: print('exec("from fake_mod import *", {}) =>', end=" "); t(lambda: exec("from fake_mod import *", {}))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: exec("from fake_mod import *", {}))')
try: fake.__all__ = [1]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: fake.__all__ = [1]')
try: print('exec("from fake_mod import *", {}) =>', end=" "); t(lambda: exec("from fake_mod import *", {}))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: exec("from fake_mod import *", {}))')
try: fake.__all__ = 5
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: fake.__all__ = 5')
try: print('exec("from fake_mod import *", {}) =>', end=" "); t(lambda: exec("from fake_mod import *", {}))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: exec("from fake_mod import *", {}))')
try: fake.__all__ = ()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: fake.__all__ = ()')
try: ns = {}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ns = {}')
try: exec("from fake_mod import *", ns)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: exec("from fake_mod import *", ns)')
try: print(sorted(k for k in ns if k != "__builtins__"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sorted(k for k in ns if k != "__builtins__")')
try: fake.__all__ = "ab"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: fake.__all__ = "ab"')
try: print('exec("from fake_mod import *", {}) =>', end=" "); t(lambda: exec("from fake_mod import *", {}))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: exec("from fake_mod import *", {}))')
try: sys.modules["none_mod"] = None
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sys.modules["none_mod"] = None')
try:
    def n1(): import none_mod
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def n1(): import none_mod')
try:
    def n2(): from none_mod import x
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def n2(): from none_mod import x')
try: print('n1() =>', end=" "); t(n1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(n1)')
try: print('n2() =>', end=" "); t(n2)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(n2)')
try: del sys.modules["none_mod"]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del sys.modules["none_mod"]')
try: sys.modules["not_a_module"] = "a string"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sys.modules["not_a_module"] = "a string"')
try: import not_a_module
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import not_a_module')
try: from not_a_module import upper
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: from not_a_module import upper')
try: print('not_a_module =>', not_a_module)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: not_a_module')
try: print('upper() =>', upper())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: upper()')
try: del sys.modules["not_a_module"], sys.modules["fake_mod"]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del sys.modules["not_a_module"], sys.modules["fake_mod"]')
try: pkg = Mod("pkg")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: pkg = Mod("pkg")')
try: pkg.__path__ = []
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: pkg.__path__ = []')
try: sub = Mod("pkg.sub")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sub = Mod("pkg.sub")')
try: sub.v = 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sub.v = 1')
try: sys.modules["pkg"] = pkg
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sys.modules["pkg"] = pkg')
try: sys.modules["pkg.sub"] = sub
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sys.modules["pkg.sub"] = sub')
try: import pkg.sub
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import pkg.sub')
try: print('pkg.sub =>', end=" "); t(lambda: pkg.sub)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: pkg.sub)')
try: pkg.sub = sub
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: pkg.sub = sub')
try: import pkg.sub
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import pkg.sub')
try: import pkg.sub as ps
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import pkg.sub as ps')
try: from pkg import sub as s3
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: from pkg import sub as s3')
try: from pkg.sub import v
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: from pkg.sub import v')
try: print('pkg.sub is sub =>', pkg.sub is sub)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: pkg.sub is sub')
try: print('ps is sub =>', ps is sub)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ps is sub')
try: print('s3 is sub =>', s3 is sub)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: s3 is sub')
try: print('v =>', v)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: v')
try: del pkg.sub
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del pkg.sub')
try: from pkg import sub as s4
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: from pkg import sub as s4')
try: print('s4 is sub =>', s4 is sub)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: s4 is sub')
try: print("from-import falls back to sys.modules")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: "from-import falls back to sys.modules"')
try:
    def m1(): import pkg.missing
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def m1(): import pkg.missing')
try:
    def m2(): from pkg import missing
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def m2(): from pkg import missing')
try: print('m1() =>', end=" "); t(m1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(m1)')
try: print('m2() =>', end=" "); t(m2)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(m2)')
try: del sys.modules["pkg"], sys.modules["pkg.sub"]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del sys.modules["pkg"], sys.modules["pkg.sub"]')
# Module objects.
try: m = Mod("m", "the doc")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: m = Mod("m", "the doc")')
try: print('m.__name__ =>', m.__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: m.__name__')
try: print('m.__doc__ =>', m.__doc__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: m.__doc__')
try: print('sorted(m.__dict__) =>', sorted(m.__dict__))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sorted(m.__dict__)')
try: print('repr(m) =>', repr(m))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: repr(m)')
try: print('m.__dict__ is vars(m) =>', m.__dict__ is vars(m))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: m.__dict__ is vars(m)')
try: print('dir(m) =>', dir(m))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: dir(m)')
try: m.x = 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: m.x = 1')
try: print('m.x =>', m.x)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: m.x')
try: print('m.__dict__["x"] =>', m.__dict__["x"])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: m.__dict__["x"]')
try: del m.x
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del m.x')
try: print('m.x =>', end=" "); t(lambda: m.x)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: m.x)')
try: print('m.nope =>', end=" "); t(lambda: m.nope)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: m.nope)')
try: print('Mod() =>', end=" "); t(lambda: Mod())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: Mod())')
try: print('Mod(1) =>', end=" "); t(lambda: Mod(1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: Mod(1))')
try: print('Mod("a", "b", "c") =>', end=" "); t(lambda: Mod("a", "b", "c"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: Mod("a", "b", "c"))')
try: print('sys.nope =>', end=" "); t(lambda: sys.nope)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: sys.nope)')
try: print('Mod("é").nope =>', end=" "); t(lambda: Mod("é").nope)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: Mod("é").nope)')
try: m.__getattr__ = lambda n: "dynamic " + n
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: m.__getattr__ = lambda n: "dynamic " + n')
try: print('m.anything =>', m.anything)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: m.anything')
try: print('hasattr(m, "zzz") =>', hasattr(m, "zzz"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: hasattr(m, "zzz")')
try: m.__dir__ = lambda: ["custom", "dir"]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: m.__dir__ = lambda: ["custom", "dir"]')
try: print(dir(m))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: dir(m)')
try: m.__name__ = "renamed"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: m.__name__ = "renamed"')
try: print(repr(m))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: repr(m)')
try: del m.__name__
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del m.__name__')
try: print(repr(m))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: repr(m)')
try: m.__file__ = "/x/y.py"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: m.__file__ = "/x/y.py"')
try: print(repr(m))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: repr(m)')
try:
    class SubMod(Mod):
        @property
        def prop(s): return "property on a module subclass"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class SubMod(Mod):')
try: sm = SubMod("sm")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sm = SubMod("sm")')
try: print('sm.prop =>', sm.prop)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sm.prop')
try: print('repr(sm) =>', repr(sm))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: repr(sm)')
try: print('isinstance(sm, Mod) =>', isinstance(sm, Mod))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: isinstance(sm, Mod)')
try:
    def d1(): m.__dict__ = {}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def d1(): m.__dict__ = {}')
try: print('d1() =>', end=" "); t(d1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(d1)')
try: main = sys.modules["__main__"]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: main = sys.modules["__main__"]')
try: print('main.__name__ =>', main.__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: main.__name__')
try: print('main.t is t =>', main.t is t)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: main.t is t')
try: print('main.__dict__ is globals() =>', main.__dict__ is globals())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: main.__dict__ is globals()')
try: print('type(main).__name__ =>', type(main).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(main).__name__')
# Lazy imports (PEP 810).
lazy import sys as lz
lazy from sys import maxsize as lzmax
try: print('type(lz).__name__ =>', type(lz).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(lz).__name__')
try: print('lz is sys =>', lz is sys)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: lz is sys')
try: print('lzmax == sys.maxsize =>', lzmax == sys.maxsize)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: lzmax == sys.maxsize')
lazy import lazily_missing_module
try: print("a lazy import of a missing module does not fail until it is used")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: "a lazy import of a missing module does not fail until it is used"')
try: print('lazily_missing_module =>', end=" "); t(lambda: lazily_missing_module)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: lazily_missing_module)')
try: print('lazily_missing_module.attr =>', end=" "); t(lambda: lazily_missing_module.attr)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: lazily_missing_module.attr)')
lazy from lazily_missing_too import thing
try: print('thing =>', end=" "); t(lambda: thing)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: thing)')
lazy = "a soft keyword"
try: print(lazy)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: lazy')
try: print('sys.get_lazy_imports() =>', sys.get_lazy_imports())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sys.get_lazy_imports()')
try: print('sys.get_lazy_imports_filter() =>', sys.get_lazy_imports_filter())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sys.get_lazy_imports_filter()')
try: print('type(sys.lazy_modules).__name__ =>', type(sys.lazy_modules).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(sys.lazy_modules).__name__')
lazy import sys as raw_lazy
try: print('type(globals()["raw_lazy"]).__name__ =>', type(globals()["raw_lazy"]).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(globals()["raw_lazy"]).__name__')
try: print('type(raw_lazy).__name__ =>', type(raw_lazy).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(raw_lazy).__name__')
try: print('type(globals()["raw_lazy"]).__name__ =>', type(globals()["raw_lazy"]).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(globals()["raw_lazy"]).__name__')
try:
    for src in ("import", "import a,", "import a b", "import a as", "import a as b.c", "import a.b as c", "import a as 1", "import 1", "import a.", "import .a", "import a..b", "import (a)", "import a, b as c, d.e", "import *", "import a as b as c", "import a; import b", "import a.b.c", "import 'a'", "import a-b", "import a as None", "import None", "import True", "import __debug__", "import a as __debug__", "from a import", "from import b", "from a", "from a import b,", "from a import (b,)", "from a import (b)", "from a import ()", "from a import (b c)", "from a import b as", "from a import b as c.d", "from a import b.c", "from a import *", "from a import (*)", "from a import *, b", "from a import b, *", "from a import * as b", "from . import a", "from .. import a", "from ... import a", "from .... import a", "from . . import a", "from .a import b", "from ..a.b import c", "from . a import b", "from a. import b", "from a.b import c", "from .import a", "from.import a", "from . import *", "from . import", "from a import b as c, d as e", "from a import (b as c,\n d)", "from a import b,\n c", "from a import None", "from a import b as None", "from None import a", "from a import __debug__", "from 1 import a", "from a import 1", "def f(): from a import *", "class C: from a import *", "def f():\n class C: from a import *", "lambda: import a", "x = import a", "import a if b else c", "from __future__ import annotations", "from __future__ import nope", "from __future__ import braces", "from __future__ import barry_as_FLUFL", "x = 1\nfrom __future__ import annotations", "'doc'\nfrom __future__ import annotations", "'doc'\n'second'\nfrom __future__ import annotations", "from __future__ import annotations, division", "from __future__ import *", "from __future__ import annotations as a", "import __future__", "from __future__ import annotations\nfrom __future__ import division\nx = 1", "# c\n\nfrom __future__ import generators", "import a\nfrom __future__ import division", "from __future__ import (division)", "def f(): from __future__ import division",
                "lazy import a", "lazy import a.b as c, d", "lazy from a import b", "lazy from a import (b, c)", "lazy from . import a", "lazy from a import *", "lazy import", "lazy from a", "lazy a", "lazy lazy import a", "lazy import lazy", "def f(): lazy import a", "def f(): lazy from a import b", "class C: lazy import a", "class C:\n def f(self): lazy import a", "async def f(): lazy import a", "try: lazy import a\nexcept: pass", "try: pass\nexcept: lazy import a", "try: pass\nfinally: lazy import a", "try: pass\nexcept: pass\nelse: lazy import a", "try: lazy from a import b\nfinally: pass", "try:\n if 1: lazy import a\nfinally: pass", "try: pass\nexcept* E: lazy import a", "if 1: lazy import a", "with x: lazy import a", "for i in x: lazy import a", "while x: lazy import a", "lazy from __future__ import annotations", "lazy = 1", "lazy: int = 1", "lazy.x = 1", "lazy()", "lazy[0]", "lazy + 1", "lazy, x = 1, 2", "def lazy(): pass", "class lazy: pass", "import lazy", "from lazy import lazy", "lazy\nimport a", "lazy; import a", "x = lazy import a", "lazy import a; lazy import b", "lazy import a as None", "lazy from a import b as c.d"):
        try: compile(src, "<s>", "exec"); print("ok:", src.replace("\n", "\\n"))
        except SyntaxError as e: print("SyntaxError:", e.msg, "<-", src.replace("\n", "\\n"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for src in ("import", "import a,", "import a b", "import a as", "impo...')
