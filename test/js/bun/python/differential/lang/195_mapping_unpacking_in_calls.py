# f(**mapping): in what order the mapping is asked, and what is said when it is none, or repeats a keyword.
def f(*args, **kwargs):
    return args, sorted(kwargs.items())

import re
def attempt(call, *args, **kw):
    try:
        print("->", call(*args, **kw))
    except Exception as e:
        print(type(e).__name__ + ":", re.sub(r" at 0x[0-9a-f]+", "", str(e)), "| cause:", repr(e.__cause__), "| context:", type(e.__context__).__name__)

log = []
class Mapping:
    def __init__(self, **items): self.items_ = items
    def keys(self):
        log.append("keys")
        return iter(list(self.items_))
    def __getitem__(self, key):
        log.append("get " + key)
        return self.items_[key]
attempt(lambda: f(**Mapping(a=1, b=2)))
print(log); log.clear()
attempt(lambda: f(a=0, **Mapping(b=1, a=2, c=3)))
print(log); log.clear()
attempt(lambda: f(**Mapping(a=1), **Mapping(b=1, a=2)))
print(log); log.clear()
attempt(lambda: f(**{"a": 1}, **Mapping(a=2)))
print(log); log.clear()
attempt(lambda: f(**{"a": 1}, **{"a": 2}))
attempt(lambda: f(**{"a": 1}, a=2))

# No mapping
class NoKeys: pass
class KeysNotCallable: keys = 3
class KeysRaises:
    def keys(self): raise RuntimeError("from keys")
class KeysAttributeError:
    def keys(self): raise AttributeError("inside keys")
class KeysProperty:
    @property
    def keys(self): raise AttributeError("no keys today")
class KeysNotIterable:
    def keys(self): return 3
class NoGetItem:
    def keys(self): return ["a"]
class GetItemRaises:
    def keys(self): return ["a"]
    def __getitem__(self, key): raise KeyError(key)
class GetItemAttributeError:
    def keys(self): return ["a"]
    def __getitem__(self, key): raise AttributeError("inside getitem")
class BadIterator:
    def keys(self):
        yield "a"
        raise ValueError("while listing the keys")
    def __getitem__(self, key): return 1
for value in (None, 3, "text", [1], (1, 2), {1}, NoKeys(), KeysNotCallable(), KeysRaises(), KeysAttributeError(), KeysProperty(), KeysNotIterable(), NoGetItem(),
              GetItemRaises(), GetItemAttributeError(), BadIterator()):
    attempt(lambda: f(**value))
    attempt(lambda: f(a=1, **value))
    attempt(lambda: {**value})
    attempt(lambda: dict(**value))
    attempt(lambda: dict(a=1).update(value) if not isinstance(value, (str, list, tuple, set)) else None)

# Keys that are no strings
class Keys:
    def __init__(self, *keys): self.k = keys
    def keys(self): return self.k
    def __getitem__(self, key): return key
attempt(lambda: f(**{1: 2}))
attempt(lambda: f(**Keys(1)))
attempt(lambda: f(**Keys("a", 1)))
attempt(lambda: f(**Keys(None)))
attempt(lambda: f(**Keys(b"a")))
attempt(lambda: {**Keys(1, None, b"a")})
class Str(str): pass
attempt(lambda: f(**{Str("a"): 1}))
attempt(lambda: f(**{Str("a"): 1}, **{"a": 2}))
attempt(lambda: f(a=1, **{Str("a"): 2}))

# Whose name is in the message
def g(**kw): pass
class C:
    def m(self, **kw): pass
    def __call__(self, **kw): pass
import functools
for callee in (g, C().m, C.m, C(), C, len, print, dict, functools.partial(g), lambda **kw: None, "not callable", None):
    attempt(lambda: callee(**3))
    attempt(lambda: callee(**{"a": 1}, **{"a": 2}))
    attempt(lambda: callee(*3))

# *iterable
class IterRaises:
    def __iter__(self): raise TypeError("from iter")
class NextRaises:
    def __iter__(self): return self
    def __next__(self): raise ValueError("from next")
for value in (None, 3, IterRaises(), NextRaises(), NoKeys()):
    attempt(lambda: f(*value))
    attempt(lambda: f(1, *value))
    attempt(lambda: [*value])
    attempt(lambda: (*value,))
    attempt(lambda: {*value})

# The order of evaluation
def note(x):
    log.append(x)
    return x
attempt(lambda: f(note(1), *note([2]), note(3), *note([4]), a=note(5), **note({"b": 6}), c=note(7), **note({"d": 8})))
print(log); log.clear()
