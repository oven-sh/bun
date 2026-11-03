# Small things that packages from PyPI ran into.
try: import weakref, gc, inspect, operator, sysconfig, sys
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import weakref, gc, inspect, operator, sysconfig, sys')
# attrs: exceptions have no __weakref__ of their own
try:
    for cls in (Exception, ValueError, OSError, BaseException, KeyError, StopIteration, SyntaxError, UnicodeDecodeError, BaseExceptionGroup):
        try: print('cls.__name__ [' + 'cls=' + (repr(cls) if type(cls) in (str, int, float, bytes, bool, type(None)) or (type(cls) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in cls)) else cls.__name__ if type(cls) is type else type(cls).__name__) + '] =>', cls.__name__)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: cls.__name__')
        try: print('cls.__weakrefoffset__ [' + 'cls=' + (repr(cls) if type(cls) in (str, int, float, bytes, bool, type(None)) or (type(cls) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in cls)) else cls.__name__ if type(cls) is type else type(cls).__name__) + '] =>', cls.__weakrefoffset__)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: cls.__weakrefoffset__')
        try: print('"__weakref__" in dir(cls) [' + 'cls=' + (repr(cls) if type(cls) in (str, int, float, bytes, bool, type(None)) or (type(cls) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in cls)) else cls.__name__ if type(cls) is type else type(cls).__name__) + '] =>', "__weakref__" in dir(cls))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: "__weakref__" in dir(cls)')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for cls in (Exception, ValueError, OSError, BaseException, KeyError, ...')
try:
    try: weakref.ref(ValueError())
    except TypeError as e: print(e)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try: weakref.ref(ValueError())')
try:
    class E1(Exception): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class E1(Exception): pass')
try:
    class E2(Exception): __slots__ = ("__weakref__",)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class E2(Exception): __slots__ = ("__weakref__",)')
try:
    class E3(Exception): __slots__ = ()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class E3(Exception): __slots__ = ()')
try: print('weakref.ref(E1()) is not None =>', weakref.ref(E1()) is not None)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: weakref.ref(E1()) is not None')
try: print('weakref.ref(E2()) is not None =>', weakref.ref(E2()) is not None)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: weakref.ref(E2()) is not None')
try: print('E1.__weakrefoffset__ != 0 =>', E1.__weakrefoffset__ != 0)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: E1.__weakrefoffset__ != 0')
try: print('E2.__weakrefoffset__ != 0 =>', E2.__weakrefoffset__ != 0)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: E2.__weakrefoffset__ != 0')
try: print('E3.__weakrefoffset__ =>', E3.__weakrefoffset__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: E3.__weakrefoffset__')
try:
    try: weakref.ref(E3())
    except TypeError as e: print(e)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try: weakref.ref(E3())')
try:
    try:
        class E4(E1): __slots__ = ("__weakref__",)
    except TypeError as e: print(e)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try:')
# toolz, fire: signatures of functions written in C
try:
    for f in (operator.call, print, str.format, type.__call__, object.__init__, int.__new__, list.__init__, max, dict.update, getattr):
        try: print(getattr(f, "__name__", f), inspect.signature(f))
        except ValueError as e: print(e)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for f in (operator.call, print, str.format, type.__call__, object.__i...')
# pip, packaging.tags
try:
    for name in ("EXT_SUFFIX", "SOABI", "SHLIB_SUFFIX"):
        try: v = sysconfig.get_config_var(name)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: v = sysconfig.get_config_var(name)')
        try: print('name [' + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + '] =>', name)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: name')
        try: print('type(v).__name__ [' + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + '] =>', type(v).__name__)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(v).__name__')
        try: print('v[0] == "." if name != "SOABI" else v.count("-") >= 2 [' + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + '] =>', v[0] == "." if name != "SOABI" else v.count("-") >= 2)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: v[0] == "." if name != "SOABI" else v.count("-") >= 2')
        try: print('v.endswith(".so") if name != "SOABI" else "" [' + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + '] =>', v.endswith(".so") if name != "SOABI" else "")
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: v.endswith(".so") if name != "SOABI" else ""')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for name in ("EXT_SUFFIX", "SOABI", "SHLIB_SUFFIX"):')
try: print(sysconfig.get_config_var("EXT_SUFFIX") == "." + sysconfig.get_config_var("SOABI") + ".so")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sysconfig.get_config_var("EXT_SUFFIX") == "." + sysconfig.get_config_...')
# hypothesis: who refers to an object
try:
    class K: pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class K: pass')
try: x = K()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: x = K()')
try: l = [x]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: l = [x]')
try: t = (x,)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t = (x,)')
try: d = {"k": x}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: d = {"k": x}')
try: s = {x}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: s = {x}')
try: o = K()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o = K()')
try: o.attr = x
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o.attr = x')
try:
    def closure():
        return x
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def closure():')
try:
    def cell_holder(v):
        return lambda: v
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def cell_holder(v):')
try: fn = cell_holder(x)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: fn = cell_holder(x)')
try: r = gc.get_referrers(x)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: r = gc.get_referrers(x)')
try: has = lambda c: any(i is c for i in r)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: has = lambda c: any(i is c for i in r)')
try: print('has(l) =>', has(l))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: has(l)')
try: print('has(t) =>', has(t))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: has(t)')
try: print('has(d) =>', has(d))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: has(d)')
try: print('has(s) =>', has(s))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: has(s)')
try: print('has(o) or has(o.__dict__) =>', has(o) or has(o.__dict__))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: has(o) or has(o.__dict__)')
try: print('has(fn.__closure__[0]) =>', has(fn.__closure__[0]))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: has(fn.__closure__[0])')
try: print('has(globals()) =>', has(globals()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: has(globals())')
try: print('has(K) =>', has(K))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: has(K)')
try: print('type(r).__name__ =>', type(r).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(r).__name__')
try: lonely = K()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: lonely = K()')
try: print([type(i).__name__ for i in gc.get_referrers(lonely) if i is not globals() and type(i).__name__ != "frame"])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [type(i).__name__ for i in gc.get_referrers(lonely) if i is not globa...')
try: print('any(i is K for i in gc.get_referrers(K.__init__)) or True =>', any(i is K for i in gc.get_referrers(K.__init__)) or True)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: any(i is K for i in gc.get_referrers(K.__init__)) or True')
try: print('gc.get_referrers() =>', gc.get_referrers())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: gc.get_referrers()')
try: print('gc.get_referrers(1) == [] or True =>', gc.get_referrers(1) == [] or True)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: gc.get_referrers(1) == [] or True')
try: refs = gc.get_referents([x, l])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: refs = gc.get_referents([x, l])')
try: print('any(i is x for i in refs) =>', any(i is x for i in refs))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: any(i is x for i in refs)')
try: print('any(i is l for i in refs) =>', any(i is l for i in refs))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: any(i is l for i in refs)')
try: print('any(i is x for i in gc.get_referents(d)) =>', any(i is x for i in gc.get_referents(d)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: any(i is x for i in gc.get_referents(d))')
try: print('any(i is x for i in gc.get_referents(t, s)) =>', any(i is x for i in gc.get_referents(t, s)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: any(i is x for i in gc.get_referents(t, s))')
try: print('gc.get_referents() =>', gc.get_referents())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: gc.get_referents()')
try: print('type(refs).__name__ =>', type(refs).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(refs).__name__')
try: objs = gc.get_objects()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: objs = gc.get_objects()')
try: print('any(i is l for i in objs) =>', any(i is l for i in objs))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: any(i is l for i in objs)')
try: print('any(i is d for i in objs) =>', any(i is d for i in objs))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: any(i is d for i in objs)')
try: print('any(i is o for i in objs) =>', any(i is o for i in objs))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: any(i is o for i in objs)')
try: print('any(i is K for i in objs) =>', any(i is K for i in objs))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: any(i is K for i in objs)')
try: print('any(i is closure for i in objs) =>', any(i is closure for i in objs))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: any(i is closure for i in objs)')
try: print('type(objs).__name__ =>', type(objs).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(objs).__name__')
try: print('not any(isinstance(i, (int, str, float)) for i in objs) =>', not any(isinstance(i, (int, str, float)) for i in objs))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: not any(isinstance(i, (int, str, float)) for i in objs)')
try:
    for bad in (-1, 3, "x"):
        try: gc.get_objects(bad)
        except (ValueError, TypeError) as e: print(type(e).__name__, e)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for bad in (-1, 3, "x"):')
