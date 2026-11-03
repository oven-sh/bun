# verify: fake imports  (only sys, builtins and modules made up here are imported)
import sys
def t(f):
    try:
        print(repr(f()))
    except BaseException as e:
        print(type(e).__name__ + ':', e)

print(type(sys).__name__, sys.__name__, repr(sys), sys is sys.modules["sys"], sys.__doc__ is not None, sys.__spec__.name, sys.__loader__.__name__, sys.__package__ == "", hasattr(sys, "__file__"))
import sys as system
import sys as a, sys as b
from sys import maxsize
from sys import maxsize as ms, version_info as vi
from sys import (maxsize as m2, path,)
from sys import (
    argv,
    modules,
)
print(system is sys, a is b is sys, maxsize == sys.maxsize, ms == m2 == maxsize, vi[0], path is sys.path, modules is sys.modules, type(argv).__name__, len(argv), argv[0].rsplit("/", 1)[-1])
import builtins
print(builtins.len is len, builtins.__name__, type(__builtins__).__name__, __builtins__ is builtins, repr(builtins), "print" in dir(builtins), builtins.__spec__.origin, builtins.__dict__["int"] is int)
def in_func():
    import sys as local_sys
    from sys import maxsize as local_max
    return local_sys is sys, local_max == maxsize, sorted(locals())
print(in_func())
class InClass:
    import sys as s
    from sys import maxsize as mx
print(InClass.s is sys, InClass.mx == maxsize)
if True: import sys as cond
for _ in range(2): import sys as loop
try: import sys as tried
finally: pass
print(cond is loop is tried is sys)
import sys; import sys; print("repeated imports are fine")
# Failures.
def f1(): import no_such_module
def f2(): import no_such_pkg.sub.mod
def f3(): from no_such_module import x
def f4(): from sys import no_such_name
def f5(): from sys import maxsize, no_such_name
def f6(): import sys.no_such_submodule
def f7(): from sys.sub import x
def f8(): from . import x
def f9(): from .mod import x
def f10(): from .. import x
def f11(): from builtins import nope
def f12(): import sys.path
def f13(): import builtins.len
for f in (f1, f2, f3, f4, f5, f6, f7, f8, f9, f10, f11, f12, f13):
    try: f(); print("ok")
    except ImportError as e: print(type(e).__name__ + ":", e, "| name:", e.name, "| path:", e.path, "| name_from:", e.name_from)
def partial():
    try: from sys import maxsize as got, no_such_name
    except ImportError: pass
    return "got" in locals()
print(partial())
# __import__
print(__import__("sys") is sys, __import__("sys", globals(), locals(), [], 0) is sys, __import__("sys", fromlist=["maxsize"]) is sys, __import__(name="sys") is sys, __import__("builtins").len is len)
t(lambda: __import__()); t(lambda: __import__(1)); t(lambda: __import__("")); t(lambda: __import__("no_such_module")); t(lambda: __import__("sys", level=-1)); t(lambda: __import__("sys", level=1)); t(lambda: __import__("sys", {"__package__": None, "__name__": "x"}, level=1)); t(lambda: __import__("sys", fromlist=["nope"]) is sys); t(lambda: __import__("sys", fromlist=[1])); t(lambda: __import__("sys.nope")); t(lambda: __import__(None)); t(lambda: __import__("a\0b")); t(lambda: __import__("sys", level="1")); t(lambda: __import__("", level=1))
# The import statement calls builtins.__import__.
calls = []
real = builtins.__import__
def hook(name, globals=None, locals=None, fromlist=(), level=0):
    calls.append((name, fromlist, level, globals is not None and globals.get("__name__")))
    return real(name, globals, locals, fromlist, level)
builtins.__import__ = hook
import sys
import sys as s2
from sys import maxsize
from sys import maxsize as q, path as p
try: import nope_a.nope_b
except ImportError: pass
try: from . import rel
except ImportError: pass
try: from ..pkg import rel
except ImportError: pass
builtins.__import__ = real
print(calls)
class Fake:
    attr = "from a fake module"
    class sub: deep = "deep"
builtins.__import__ = lambda *a, **k: Fake
import anything
import x.y.z
import x.sub as xs
from whatever import attr
from whatever import sub as sb
builtins.__import__ = real
print(anything is Fake, x is Fake, xs is Fake.sub, attr, sb.deep)
builtins.__import__ = lambda *a, **k: Fake
try:
    from whatever import missing
except ImportError as e: print("ImportError:", e)
finally: builtins.__import__ = real
del builtins.__import__
try:
    import sys
except ImportError as e: print("ImportError:", e)
finally: builtins.__import__ = real
# sys.modules is consulted first.
Mod = type(sys)
fake = Mod("fake_mod"); fake.value = 42; fake.__all__ = ["value", "other"]; fake.other = "o"; fake._private = "p"; fake.hidden = "h"
sys.modules["fake_mod"] = fake
import fake_mod
from fake_mod import value
print(fake_mod is fake, value, fake_mod.__name__, repr(fake_mod), fake_mod.__dict__.keys() >= {"value", "__name__"}, fake_mod.__doc__, fake_mod.__spec__, fake_mod.__loader__, fake_mod.__package__)
ns = {}; exec("from fake_mod import *", ns); print(sorted(k for k in ns if k != "__builtins__"))
del fake.__all__; ns = {}; exec("from fake_mod import *", ns); print(sorted(k for k in ns if k != "__builtins__"))
fake.__all__ = ["nope"]; t(lambda: exec("from fake_mod import *", {})); fake.__all__ = [1]; t(lambda: exec("from fake_mod import *", {})); fake.__all__ = 5; t(lambda: exec("from fake_mod import *", {})); fake.__all__ = (); ns = {}; exec("from fake_mod import *", ns); print(sorted(k for k in ns if k != "__builtins__")); fake.__all__ = "ab"; t(lambda: exec("from fake_mod import *", {}))
sys.modules["none_mod"] = None
def n1(): import none_mod
def n2(): from none_mod import x
t(n1); t(n2); del sys.modules["none_mod"]
sys.modules["not_a_module"] = "a string"
import not_a_module
from not_a_module import upper
print(not_a_module, upper())
del sys.modules["not_a_module"], sys.modules["fake_mod"]
pkg = Mod("pkg"); pkg.__path__ = []; sub = Mod("pkg.sub"); sub.v = 1
sys.modules["pkg"] = pkg; sys.modules["pkg.sub"] = sub
import pkg.sub
t(lambda: pkg.sub)
pkg.sub = sub
import pkg.sub
import pkg.sub as ps
from pkg import sub as s3
from pkg.sub import v
print(pkg.sub is sub, ps is sub, s3 is sub, v)
del pkg.sub
from pkg import sub as s4
print(s4 is sub, "from-import falls back to sys.modules")
def m1(): import pkg.missing
def m2(): from pkg import missing
t(m1); t(m2)
del sys.modules["pkg"], sys.modules["pkg.sub"]
# Module objects.
m = Mod("m", "the doc"); print(m.__name__, m.__doc__, sorted(m.__dict__), repr(m), m.__dict__ is vars(m), dir(m))
m.x = 1; print(m.x, m.__dict__["x"]); del m.x; t(lambda: m.x); t(lambda: m.nope); t(lambda: Mod()); t(lambda: Mod(1)); t(lambda: Mod("a", "b", "c")); t(lambda: sys.nope); t(lambda: Mod("é").nope)
m.__getattr__ = lambda n: "dynamic " + n; print(m.anything, hasattr(m, "zzz")); m.__dir__ = lambda: ["custom", "dir"]; print(dir(m))
m.__name__ = "renamed"; print(repr(m)); del m.__name__; print(repr(m)); m.__file__ = "/x/y.py"; print(repr(m))
class SubMod(Mod):
    @property
    def prop(s): return "property on a module subclass"
sm = SubMod("sm"); print(sm.prop, repr(sm), isinstance(sm, Mod))
def d1(): m.__dict__ = {}
t(d1)
main = sys.modules["__main__"]; print(main.__name__, main.t is t, main.__dict__ is globals(), type(main).__name__)
# Lazy imports (PEP 810).
lazy import sys as lz
lazy from sys import maxsize as lzmax
print(type(lz).__name__, lz is sys, lzmax == sys.maxsize)
lazy import lazily_missing_module
print("a lazy import of a missing module does not fail until it is used")
t(lambda: lazily_missing_module)
t(lambda: lazily_missing_module.attr)
lazy from lazily_missing_too import thing
t(lambda: thing)
lazy = "a soft keyword"; print(lazy)
print(sys.get_lazy_imports(), sys.get_lazy_imports_filter(), type(sys.lazy_modules).__name__)
lazy import sys as raw_lazy
print(type(globals()["raw_lazy"]).__name__, type(raw_lazy).__name__, type(globals()["raw_lazy"]).__name__)
for src in ("import", "import a,", "import a b", "import a as", "import a as b.c", "import a.b as c", "import a as 1", "import 1", "import a.", "import .a", "import a..b", "import (a)", "import a, b as c, d.e", "import *", "import a as b as c", "import a; import b", "import a.b.c", "import 'a'", "import a-b", "import a as None", "import None", "import True", "import __debug__", "import a as __debug__", "from a import", "from import b", "from a", "from a import b,", "from a import (b,)", "from a import (b)", "from a import ()", "from a import (b c)", "from a import b as", "from a import b as c.d", "from a import b.c", "from a import *", "from a import (*)", "from a import *, b", "from a import b, *", "from a import * as b", "from . import a", "from .. import a", "from ... import a", "from .... import a", "from . . import a", "from .a import b", "from ..a.b import c", "from . a import b", "from a. import b", "from a.b import c", "from .import a", "from.import a", "from . import *", "from . import", "from a import b as c, d as e", "from a import (b as c,\n d)", "from a import b,\n c", "from a import None", "from a import b as None", "from None import a", "from a import __debug__", "from 1 import a", "from a import 1", "def f(): from a import *", "class C: from a import *", "def f():\n class C: from a import *", "lambda: import a", "x = import a", "import a if b else c", "from __future__ import annotations", "from __future__ import nope", "from __future__ import braces", "from __future__ import barry_as_FLUFL", "x = 1\nfrom __future__ import annotations", "'doc'\nfrom __future__ import annotations", "'doc'\n'second'\nfrom __future__ import annotations", "from __future__ import annotations, division", "from __future__ import *", "from __future__ import annotations as a", "import __future__", "from __future__ import annotations\nfrom __future__ import division\nx = 1", "# c\n\nfrom __future__ import generators", "import a\nfrom __future__ import division", "from __future__ import (division)", "def f(): from __future__ import division",
            "lazy import a", "lazy import a.b as c, d", "lazy from a import b", "lazy from a import (b, c)", "lazy from . import a", "lazy from a import *", "lazy import", "lazy from a", "lazy a", "lazy lazy import a", "lazy import lazy", "def f(): lazy import a", "def f(): lazy from a import b", "class C: lazy import a", "class C:\n def f(self): lazy import a", "async def f(): lazy import a", "try: lazy import a\nexcept: pass", "try: pass\nexcept: lazy import a", "try: pass\nfinally: lazy import a", "try: pass\nexcept: pass\nelse: lazy import a", "try: lazy from a import b\nfinally: pass", "try:\n if 1: lazy import a\nfinally: pass", "try: pass\nexcept* E: lazy import a", "if 1: lazy import a", "with x: lazy import a", "for i in x: lazy import a", "while x: lazy import a", "lazy from __future__ import annotations", "lazy = 1", "lazy: int = 1", "lazy.x = 1", "lazy()", "lazy[0]", "lazy + 1", "lazy, x = 1, 2", "def lazy(): pass", "class lazy: pass", "import lazy", "from lazy import lazy", "lazy\nimport a", "lazy; import a", "x = lazy import a", "lazy import a; lazy import b", "lazy import a as None", "lazy from a import b as c.d"):
    try: compile(src, "<s>", "exec"); print("ok:", src.replace("\n", "\\n"))
    except SyntaxError as e: print("SyntaxError:", e.msg, "<-", src.replace("\n", "\\n"))
