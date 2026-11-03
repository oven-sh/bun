import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "lz"))
def t(f):
    try: print("->", f())
    except BaseException as e:
        c = e.__cause__
        print(type(e).__name__, e, "| cause:", type(c).__name__, c, "| notes:", getattr(e, "__notes__", None), "| ctx:", type(e.__context__).__name__, e.__suppress_context__)
        if c is not None and c.__traceback__ is not None:
            tb = c.__traceback__
            print("   cause tb:", os.path.basename(tb.tb_frame.f_code.co_filename), tb.tb_frame.f_code.co_name, tb.tb_lineno, tb.tb_next)
def raw(n): return globals()[n]
def lm(): return sorted(n for n in sys.lazy_modules if n not in ("locale", "pkgutil", "traceback", "warnings"))
print("--- basic")
lazy import plain
print(repr(raw("plain")), type(raw("plain")), lm())
t(lambda: raw("plain").a)
t(lambda: repr(raw("plain").resolve)[:50])
print("plain" in sys.modules)
print(plain.a, type(raw("plain")).__name__, lm(), "plain" in sys.modules)
print("--- from")
lazy from pk.mod import v, mod as m2
print(repr(raw("v")), repr(raw("m2")), lm(), "pk" in sys.modules)
print(v, type(raw("v")).__name__, type(raw("m2")).__name__, lm())
print(m2(), type(raw("m2")).__name__)
print("--- dotted")
lazy import pk.sub.leaf
print(repr(raw("pk")), lm())
print(pk.x, sorted(k for k in sys.modules if k.startswith("pk")), lm())
print("sub" in vars(pk))
print(pk.sub.y, sorted(k for k in sys.modules if k.startswith("pk")), lm())
print(pk.sub.leaf.z, sorted(k for k in sys.modules if k.startswith("pk")), lm())
print("--- dotted as")
for k in [k for k in sys.modules if k.startswith("pk")]: del sys.modules[k]
lazy import pk.sub.leaf as lf
print(repr(raw("lf")), lm())
print(lf.z, repr(raw("lf"))[:30], lm())
print("--- package with lazy from .child import child")
import pk2
print(type(vars(pk2)["child"]).__name__, type(vars(pk2)["other"]).__name__, lm())
print(pk2.use()(), type(vars(pk2)["child"]).__name__, pk2.child(), sys.modules["pk2.child"])
print(pk2.other.o, type(vars(pk2)["other"]).__name__)
print("--- errors")
lazy import broken
t(lambda: broken)
t(lambda: broken)
print(type(raw("broken")).__name__, lm())
lazy import nope_missing.sub
t(lambda: nope_missing)
lazy from plain import nothing_here
t(lambda: nothing_here)
lazy from plain import a as pa
print(type(raw("pa")).__name__, pa)
def in_handler():
    try: raise KeyError("k")
    except KeyError:
        return broken
t(in_handler)
t(in_handler)
print("--- plain.sub where plain is no package")
lazy import plain.sub
t(lambda: plain)
print(type(raw("plain")).__name__)
print("--- cycles")
import cyc.a
t(cyc.a.get)
import selfref
print(selfref.thing)
print("--- resolve()")
lazy import pk.mod as pm
R = [raw("pm")]
print(R[0].resolve().v, type(raw("pm")).__name__, R[0].resolve() is sys.modules["pk.mod"], repr(R[0]))
r = raw("pm"); print(type(r).__name__, type(raw("r")).__name__, type(raw("pm")).__name__)
print("--- module attribute access resolves")
me = sys.modules[__name__]
lazy import plain as pl2
print(type(vars(me)["pl2"]).__name__, me.pl2.a, type(vars(me)["pl2"]).__name__)
lazy import plain as pl3
print(hasattr(me, "pl3"), type(vars(me)["pl3"]).__name__)
lazy import plain as pl4
print(getattr(me, "pl4", None) is plain if False else getattr(me, "pl4").b)
lazy import nope_again
print(hasattr(me, "nope_again") if False else "skip")
t(lambda: me.nope_again)
t(lambda: getattr(me, "nope_again", "default"))
print("--- dir and dict do not resolve")
lazy import plain as pl5
print("pl5" in dir(me), type(me.__dict__["pl5"]).__name__, type(globals().get("pl5")).__name__, type(list(v for k, v in globals().items() if k == "pl5")[0]).__name__)
print("--- exec")
ns = {}
exec("lazy import plain as q", ns); print(type(ns["q"]).__name__)
exec("print(q.a)", ns); print(type(ns["q"]).__name__)
t(lambda: exec("lazy import plain as q", {}, {}))
class M(dict): pass
mns = M()
t(lambda: exec("lazy import plain as q\nprint(type(globals()['q']).__name__)\nprint(q.a)\nprint(type(globals()['q']).__name__)", mns))
print("--- eval of a name")
lazy import plain as pl6
print(eval("pl6").a, type(raw("pl6")).__name__)
print("--- function globals")
lazy import plain as pl7
def usepl7(): return pl7.a
print(usepl7(), type(raw("pl7")).__name__)
print("--- del, rebind")
lazy import nope_del
del nope_del
lazy import nope_rebind
nope_rebind = 3; print(nope_rebind, lm())
print("--- __lazy_import__")
X = [__lazy_import__("plain"), __lazy_import__("pk.mod", fromlist=("v",)), __lazy_import__("pk.mod", fromlist="v"), __lazy_import__("pk.mod", fromlist=()), __lazy_import__("pk.mod", globals(), globals(), None), __lazy_import__("pk.sub.leaf"), __lazy_import__("zz.yy", fromlist=("a", "b"))]
print(X, lm())
t(lambda: __lazy_import__("plain"))
t(lambda: __lazy_import__(1))
for args in [(1,), ("",), ("plain", 1), ("plain", None), ("plain", {}), ("plain", globals(), None, ["a"]), ("plain", globals(), None, (1,)), ("plain", globals(), None, (), -1), ("plain", globals(), None, (), 1), ()]:
    try: print([__lazy_import__(*args)])
    except Exception as e: print(type(e).__name__, e)
LT = type(X[0]); print(LT)
try: LT()
except TypeError as e: print(e)
try: LT(__builtins__.__dict__, "a")
except TypeError as e: print(e)
try:
    class S(LT): pass
except TypeError as e: print(e)
print(X[0] == X[0], X[0] != X[0], X[0] == X[1], hash(X[0]) == hash(X[0]), bool(X[0]), [n for n in dir(X[0]) if not n.startswith("__")])
def sa(): X[0].foo = 1
t(sa)
t(lambda: X[1].v); t(lambda: X[5].sub); t(lambda: X[0].__name__); t(lambda: X[0].__class__); t(lambda: X[0].__dict__)
print(LT.__name__, LT.__module__, LT.__qualname__, LT.__doc__ is not None, LT.__mro__)
print([type(x.resolve()).__name__ for x in X[:6]], [x.resolve().__name__ for x in X[:6]])
t(X[6].resolve)
print("--- filter")
calls = []
def flt(importer, name, fromlist):
    calls.append((importer, name, fromlist)); return name != "plain"
sys.set_lazy_imports_filter(flt)
lazy import plain as f1
lazy import pk.mod as f2
lazy from pk.mod import v as f3
lazy from plain import a as f4
print(type(raw("f1")).__name__, type(raw("f2")).__name__, type(raw("f3")).__name__, type(raw("f4")).__name__, calls)
def bad(*a): raise RuntimeError("filter failed")
sys.set_lazy_imports_filter(bad)
def fb(): exec("lazy import plain as f5", globals())
t(fb)
sys.set_lazy_imports_filter(None); print(sys.get_lazy_imports_filter())
t(lambda: sys.set_lazy_imports_filter(1))
print("--- mode all")
sys.set_lazy_imports("all"); print(sys.get_lazy_imports())
exec("import plain as g1\nfrom plain import a as g2\nfrom plain import *\ntry:\n    import plain as g3\nexcept ImportError: pass\ndef f():\n    import plain as g4\n    return type(g4).__name__\nclass C:\n    import plain as g5\n    n = type(vars()['g5']).__name__\nwith open(__file__) as fh:\n    import plain as g6\nif True:\n    import plain as g7\nprint(type(globals()['g1']).__name__, type(globals()['g2']).__name__, type(globals()['g3']).__name__, f(), C.n, type(globals()['g6']).__name__, type(globals()['g7']).__name__, b)", globals())
sys.set_lazy_imports("normal")
for bad_mode in ("none", "x", 1, None):
    try: sys.set_lazy_imports(bad_mode)
    except Exception as e: print(type(e).__name__, e)
print("--- __lazy_modules__")
import compat
print(compat.f(), compat.a, type(vars(compat)["a"]).__name__)
print("--- custom __import__")
import builtins
real = builtins.__import__
def hook(name, globals=None, locals=None, fromlist=(), level=0):
    print("hook:", name, fromlist, level); return real(name, globals, locals, fromlist, level)
lazy import pk.sub.leaf as h1
lazy import pk.sub.leaf
lazy from pk.mod import v as h2, mod as h3
builtins.__import__ = hook
try:
    print(h1.z); print(pk.x); print(h2); print(h3())
finally: builtins.__import__ = real
print("--- star import of a module with lazy names")
m = type(sys)("withlazy"); sys.modules["withlazy"] = m
exec("lazy import plain as lp\nlazy import nope_star as ns_", m.__dict__)
m.__all__ = ["lp"]
ns = {}; exec("from withlazy import *", ns); print(type(ns["lp"]).__name__, type(m.__dict__["lp"]).__name__)
print("--- from import of lazy attr")
exec("lazy import plain as lp2", m.__dict__)
from withlazy import lp2
print(type(lp2).__name__, type(m.__dict__["lp2"]).__name__)
lazy from withlazy import lp2 as lp3, ns_ as bad3
print(type(raw("lp3")).__name__, type(raw("bad3")).__name__)
t(lambda: bad3)
print("--- class body")
lazy import plain as cb
class K:
    got = cb.a
print(K.got, type(raw("cb")).__name__)
print(lm())
