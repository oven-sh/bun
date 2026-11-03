# Keyword names that are instances of classes derived from str; hashes kept by dicts.
try: import functools
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import functools')
try:
    class BadStr(str):
        def __eq__(self, other): raise RuntimeError("eq")
        def __hash__(self): return str.__hash__(self)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class BadStr(str):')
try:
    class S(str): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class S(str): pass')
try:
    def f(**kwargs): return [(type(k).__name__, k) for k in kwargs]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def f(**kwargs): return [(type(k).__name__, k) for k in kwargs]')
try: print(f(**{S("a"): 1, "b": 2}))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: f(**{S("a"): 1, "b": 2})')
try:
    def g(*args, **kwargs): return f(**kwargs)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def g(*args, **kwargs): return f(**kwargs)')
try: print(g(**{S("a"): 1}))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g(**{S("a"): 1})')
try:
    def attempt(thunk):
        try:
            return thunk()
        except BaseException as e:
            return type(e).__name__ + ": " + str(e)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def attempt(thunk):')
try: print(attempt(lambda: {**{"poison": ""}, **{BadStr("poison"): 1}}))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: attempt(lambda: {**{"poison": ""}, **{BadStr("poison"): 1}})')
try:
    def h(**kw): return {**{"poison": ""}, **kw}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def h(**kw): return {**{"poison": ""}, **kw}')
try: print(attempt(lambda: h(**{BadStr("poison"): 1})))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: attempt(lambda: h(**{BadStr("poison"): 1}))')
try: p = functools.partial(f, poison="")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: p = functools.partial(f, poison="")')
try: print(attempt(lambda: p(**{BadStr("poison"): "new"})))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: attempt(lambda: p(**{BadStr("poison"): "new"}))')
try:
    def k(poison=None, **kw): return poison, kw
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def k(poison=None, **kw): return poison, kw')
try: print(attempt(lambda: k(**{BadStr("poison"): 1})))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: attempt(lambda: k(**{BadStr("poison"): 1}))')
try: print('attempt(lambda: k(**{S("poison"): 1})) =>', attempt(lambda: k(**{S("poison"): 1})))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: attempt(lambda: k(**{S("poison"): 1}))')
try: print('attempt(lambda: k(**{S("other"): 1})) =>', attempt(lambda: k(**{S("other"): 1})))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: attempt(lambda: k(**{S("other"): 1}))')
try: print('attempt(lambda: dict(**{S("x"): 1})) =>', attempt(lambda: dict(**{S("x"): 1})))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: attempt(lambda: dict(**{S("x"): 1}))')
try: print('[type(x).__name__ for x in dict(**{S("x"): 1})] =>', [type(x).__name__ for x in dict(**{S("x"): 1})])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [type(x).__name__ for x in dict(**{S("x"): 1})]')

# The hash of a key is not asked again when a dict is merged into another.
try:
    class Counting(str):
        count = 0
        def __hash__(self):
            Counting.count += 1
            return str.__hash__(self)
        __eq__ = str.__eq__
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Counting(str):')
try: d = {Counting("a"): 1}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: d = {Counting("a"): 1}')
try: Counting.count = 0
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Counting.count = 0')
try: e = dict(d)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: e = dict(d)')
try: e2 = {**d}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: e2 = {**d}')
try: e3 = d.copy()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: e3 = d.copy()')
try: e4 = {}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: e4 = {}')
try: e4.update(d)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: e4.update(d)')
try: e5 = d | {}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: e5 = d | {}')
try: print(Counting.count)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Counting.count')

try:
    def old_function(*args, **kwargs): return "old_function", args, kwargs
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def old_function(*args, **kwargs): return "old_function", args, kwargs')
try:
    def new_function(*args, **kwargs): return "new_function", args, kwargs
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def new_function(*args, **kwargs): return "new_function", args, kwargs')
try: g_partial = None
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g_partial = None')
try:
    class EvilKey(str):
        armed = False
        def __hash__(self):
            if EvilKey.armed and g_partial is not None:
                EvilKey.armed = False
                g_partial.__setstate__((new_function, ("new_arg",), {"new_keyword": None}, None))
            return str.__hash__(self)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class EvilKey(str):')
try: g_partial = functools.partial(old_function, "old_arg", old_keyword=None)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g_partial = functools.partial(old_function, "old_arg", old_keyword=None)')
try: kwargs = {EvilKey("evil_key"): None}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: kwargs = {EvilKey("evil_key"): None}')
try: EvilKey.armed = True
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: EvilKey.armed = True')
try: print(g_partial(**kwargs))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g_partial(**kwargs)')
try: print(g_partial())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g_partial()')
