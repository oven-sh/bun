# f(**mapping): in what order the mapping is asked, and what is said when it is none, or repeats a keyword.
try:
    def f(*args, **kwargs):
        return args, sorted(kwargs.items())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def f(*args, **kwargs):')

try: import re
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import re')
try:
    def attempt(call, *args, **kw):
        try:
            print("->", call(*args, **kw))
        except Exception as e:
            print(type(e).__name__ + ":", re.sub(r" at 0x[0-9a-f]+", "", str(e)), "| cause:", repr(e.__cause__), "| context:", type(e.__context__).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def attempt(call, *args, **kw):')

try: log = []
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: log = []')
try:
    class Mapping:
        def __init__(self, **items): self.items_ = items
        def keys(self):
            log.append("keys")
            return iter(list(self.items_))
        def __getitem__(self, key):
            log.append("get " + key)
            return self.items_[key]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Mapping:')
try: attempt(lambda: f(**Mapping(a=1, b=2)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: attempt(lambda: f(**Mapping(a=1, b=2)))')
try: print(log)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: log')
try: log.clear()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: log.clear()')
try: attempt(lambda: f(a=0, **Mapping(b=1, a=2, c=3)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: attempt(lambda: f(a=0, **Mapping(b=1, a=2, c=3)))')
try: print(log)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: log')
try: log.clear()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: log.clear()')
try: attempt(lambda: f(**Mapping(a=1), **Mapping(b=1, a=2)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: attempt(lambda: f(**Mapping(a=1), **Mapping(b=1, a=2)))')
try: print(log)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: log')
try: log.clear()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: log.clear()')
try: attempt(lambda: f(**{"a": 1}, **Mapping(a=2)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: attempt(lambda: f(**{"a": 1}, **Mapping(a=2)))')
try: print(log)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: log')
try: log.clear()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: log.clear()')
try: attempt(lambda: f(**{"a": 1}, **{"a": 2}))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: attempt(lambda: f(**{"a": 1}, **{"a": 2}))')
try: attempt(lambda: f(**{"a": 1}, a=2))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: attempt(lambda: f(**{"a": 1}, a=2))')

# No mapping
try:
    class NoKeys: pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class NoKeys: pass')
try:
    class KeysNotCallable: keys = 3
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class KeysNotCallable: keys = 3')
try:
    class KeysRaises:
        def keys(self): raise RuntimeError("from keys")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class KeysRaises:')
try:
    class KeysAttributeError:
        def keys(self): raise AttributeError("inside keys")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class KeysAttributeError:')
try:
    class KeysProperty:
        @property
        def keys(self): raise AttributeError("no keys today")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class KeysProperty:')
try:
    class KeysNotIterable:
        def keys(self): return 3
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class KeysNotIterable:')
try:
    class NoGetItem:
        def keys(self): return ["a"]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class NoGetItem:')
try:
    class GetItemRaises:
        def keys(self): return ["a"]
        def __getitem__(self, key): raise KeyError(key)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class GetItemRaises:')
try:
    class GetItemAttributeError:
        def keys(self): return ["a"]
        def __getitem__(self, key): raise AttributeError("inside getitem")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class GetItemAttributeError:')
try:
    class BadIterator:
        def keys(self):
            yield "a"
            raise ValueError("while listing the keys")
        def __getitem__(self, key): return 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class BadIterator:')
try:
    for value in (None, 3, "text", [1], (1, 2), {1}, NoKeys(), KeysNotCallable(), KeysRaises(), KeysAttributeError(), KeysProperty(), KeysNotIterable(), NoGetItem(),
                  GetItemRaises(), GetItemAttributeError(), BadIterator()):
        try: attempt(lambda: f(**value))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: attempt(lambda: f(**value))')
        try: attempt(lambda: f(a=1, **value))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: attempt(lambda: f(a=1, **value))')
        try: attempt(lambda: {**value})
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: attempt(lambda: {**value})')
        try: attempt(lambda: dict(**value))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: attempt(lambda: dict(**value))')
        try: attempt(lambda: dict(a=1).update(value) if not isinstance(value, (str, list, tuple, set)) else None)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: attempt(lambda: dict(a=1).update(value) if not isinstance(value, (str...')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for value in (None, 3, "text", [1], (1, 2), {1}, NoKeys(), KeysNotCal...')

# Keys that are no strings
try:
    class Keys:
        def __init__(self, *keys): self.k = keys
        def keys(self): return self.k
        def __getitem__(self, key): return key
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Keys:')
try: attempt(lambda: f(**{1: 2}))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: attempt(lambda: f(**{1: 2}))')
try: attempt(lambda: f(**Keys(1)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: attempt(lambda: f(**Keys(1)))')
try: attempt(lambda: f(**Keys("a", 1)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: attempt(lambda: f(**Keys("a", 1)))')
try: attempt(lambda: f(**Keys(None)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: attempt(lambda: f(**Keys(None)))')
try: attempt(lambda: f(**Keys(b"a")))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: attempt(lambda: f(**Keys(b"a")))')
try: attempt(lambda: {**Keys(1, None, b"a")})
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: attempt(lambda: {**Keys(1, None, b"a")})')
try:
    class Str(str): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Str(str): pass')
try: attempt(lambda: f(**{Str("a"): 1}))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: attempt(lambda: f(**{Str("a"): 1}))')
try: attempt(lambda: f(**{Str("a"): 1}, **{"a": 2}))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: attempt(lambda: f(**{Str("a"): 1}, **{"a": 2}))')
try: attempt(lambda: f(a=1, **{Str("a"): 2}))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: attempt(lambda: f(a=1, **{Str("a"): 2}))')

# Whose name is in the message
try:
    def g(**kw): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def g(**kw): pass')
try:
    class C:
        def m(self, **kw): pass
        def __call__(self, **kw): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class C:')
try: import functools
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import functools')
try:
    for callee in (g, C().m, C.m, C(), C, len, print, dict, functools.partial(g), lambda **kw: None, "not callable", None):
        try: attempt(lambda: callee(**3))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: attempt(lambda: callee(**3))')
        try: attempt(lambda: callee(**{"a": 1}, **{"a": 2}))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: attempt(lambda: callee(**{"a": 1}, **{"a": 2}))')
        try: attempt(lambda: callee(*3))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: attempt(lambda: callee(*3))')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for callee in (g, C().m, C.m, C(), C, len, print, dict, functools.par...')

# *iterable
try:
    class IterRaises:
        def __iter__(self): raise TypeError("from iter")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class IterRaises:')
try:
    class NextRaises:
        def __iter__(self): return self
        def __next__(self): raise ValueError("from next")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class NextRaises:')
try:
    for value in (None, 3, IterRaises(), NextRaises(), NoKeys()):
        try: attempt(lambda: f(*value))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: attempt(lambda: f(*value))')
        try: attempt(lambda: f(1, *value))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: attempt(lambda: f(1, *value))')
        try: attempt(lambda: [*value])
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: attempt(lambda: [*value])')
        try: attempt(lambda: (*value,))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: attempt(lambda: (*value,))')
        try: attempt(lambda: {*value})
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: attempt(lambda: {*value})')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for value in (None, 3, IterRaises(), NextRaises(), NoKeys()):')

# The order of evaluation
try:
    def note(x):
        log.append(x)
        return x
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def note(x):')
try: attempt(lambda: f(note(1), *note([2]), note(3), *note([4]), a=note(5), **note({"b": 6}), c=note(7), **note({"d": 8})))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: attempt(lambda: f(note(1), *note([2]), note(3), *note([4]), a=note(5)...')
try: print(log)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: log')
try: log.clear()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: log.clear()')
