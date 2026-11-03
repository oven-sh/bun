# Small things that packages from PyPI ran into.
import weakref, gc, inspect, operator, sysconfig, sys
# attrs: exceptions have no __weakref__ of their own
for cls in (Exception, ValueError, OSError, BaseException, KeyError, StopIteration, SyntaxError, UnicodeDecodeError, BaseExceptionGroup):
    print(cls.__name__, cls.__weakrefoffset__, "__weakref__" in dir(cls))
try: weakref.ref(ValueError())
except TypeError as e: print(e)
class E1(Exception): pass
class E2(Exception): __slots__ = ("__weakref__",)
class E3(Exception): __slots__ = ()
print(weakref.ref(E1()) is not None, weakref.ref(E2()) is not None, E1.__weakrefoffset__ != 0, E2.__weakrefoffset__ != 0, E3.__weakrefoffset__)
try: weakref.ref(E3())
except TypeError as e: print(e)
try:
    class E4(E1): __slots__ = ("__weakref__",)
except TypeError as e: print(e)
# toolz, fire: signatures of functions written in C
for f in (operator.call, print, str.format, type.__call__, object.__init__, int.__new__, list.__init__, max, dict.update, getattr):
    try: print(getattr(f, "__name__", f), inspect.signature(f))
    except ValueError as e: print(e)
# pip, packaging.tags
for name in ("EXT_SUFFIX", "SOABI", "SHLIB_SUFFIX"):
    v = sysconfig.get_config_var(name); print(name, type(v).__name__, v[0] == "." if name != "SOABI" else v.count("-") >= 2, v.endswith(".so") if name != "SOABI" else "")
print(sysconfig.get_config_var("EXT_SUFFIX") == "." + sysconfig.get_config_var("SOABI") + ".so")
# hypothesis: who refers to an object
class K: pass
x = K(); l = [x]; t = (x,); d = {"k": x}; s = {x}; o = K(); o.attr = x
def closure():
    return x
def cell_holder(v):
    return lambda: v
fn = cell_holder(x)
r = gc.get_referrers(x)
has = lambda c: any(i is c for i in r)
print(has(l), has(t), has(d), has(s), has(o) or has(o.__dict__), has(fn.__closure__[0]), has(globals()), has(K), type(r).__name__)
lonely = K(); print([type(i).__name__ for i in gc.get_referrers(lonely) if i is not globals() and type(i).__name__ != "frame"])
print(any(i is K for i in gc.get_referrers(K.__init__)) or True, gc.get_referrers(), gc.get_referrers(1) == [] or True)
refs = gc.get_referents([x, l]); print(any(i is x for i in refs), any(i is l for i in refs), any(i is x for i in gc.get_referents(d)), any(i is x for i in gc.get_referents(t, s)), gc.get_referents(), type(refs).__name__)
objs = gc.get_objects(); print(any(i is l for i in objs), any(i is d for i in objs), any(i is o for i in objs), any(i is K for i in objs), any(i is closure for i in objs), type(objs).__name__, not any(isinstance(i, (int, str, float)) for i in objs))
for bad in (-1, 3, "x"):
    try: gc.get_objects(bad)
    except (ValueError, TypeError) as e: print(type(e).__name__, e)
