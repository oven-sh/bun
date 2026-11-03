# Keyword names that are instances of classes derived from str; hashes kept by dicts.
import functools
class BadStr(str):
    def __eq__(self, other): raise RuntimeError("eq")
    def __hash__(self): return str.__hash__(self)
class S(str): pass
def f(**kwargs): return [(type(k).__name__, k) for k in kwargs]
print(f(**{S("a"): 1, "b": 2}))
def g(*args, **kwargs): return f(**kwargs)
print(g(**{S("a"): 1}))
def attempt(thunk):
    try:
        return thunk()
    except BaseException as e:
        return type(e).__name__ + ": " + str(e)
print(attempt(lambda: {**{"poison": ""}, **{BadStr("poison"): 1}}))
def h(**kw): return {**{"poison": ""}, **kw}
print(attempt(lambda: h(**{BadStr("poison"): 1})))
p = functools.partial(f, poison="")
print(attempt(lambda: p(**{BadStr("poison"): "new"})))
def k(poison=None, **kw): return poison, kw
print(attempt(lambda: k(**{BadStr("poison"): 1})))
print(attempt(lambda: k(**{S("poison"): 1})), attempt(lambda: k(**{S("other"): 1})))
print(attempt(lambda: dict(**{S("x"): 1})), [type(x).__name__ for x in dict(**{S("x"): 1})])

# The hash of a key is not asked again when a dict is merged into another.
class Counting(str):
    count = 0
    def __hash__(self):
        Counting.count += 1
        return str.__hash__(self)
    __eq__ = str.__eq__
d = {Counting("a"): 1}
Counting.count = 0
e = dict(d); e2 = {**d}; e3 = d.copy(); e4 = {}; e4.update(d); e5 = d | {}
print(Counting.count)

def old_function(*args, **kwargs): return "old_function", args, kwargs
def new_function(*args, **kwargs): return "new_function", args, kwargs
g_partial = None
class EvilKey(str):
    armed = False
    def __hash__(self):
        if EvilKey.armed and g_partial is not None:
            EvilKey.armed = False
            g_partial.__setstate__((new_function, ("new_arg",), {"new_keyword": None}, None))
        return str.__hash__(self)
g_partial = functools.partial(old_function, "old_arg", old_keyword=None)
kwargs = {EvilKey("evil_key"): None}
EvilKey.armed = True
print(g_partial(**kwargs))
print(g_partial())
