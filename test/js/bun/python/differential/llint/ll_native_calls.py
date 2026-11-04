# Functions and methods written in C++: called in order and out of order, found through types that change, on objects they are not for.
import collections, functools, operator, re, sys
out = []
def rec(label, f, *a, **k):
    try:
        r = f(*a, **k)
        # Hashes of text and addresses are the implementation's own.
        r = "a large int" if type(r) is int and abs(r) > 2 ** 20 and "hash" in label else re.sub(r" at 0x[0-9a-f]+", " at 0x...", repr(r))
    except RecursionError:
        r = "RecursionError"
    except Exception as e:
        r = type(e).__name__ + ":" + str(e)
    out.append("%s -> %s" % (label, r))

# ---- The number of arguments, and their names ----
CALLS = [(), (1,), (1, 2), (1, 2, 3), (1, 2, 3, 4), ("a",), ("a", "b"), ([1, 2],), ([1, 2], 1), (None,), ((),), ({},)]
KW = [{}, {"x": 1}, {"key": None}, {"default": 0}, {"start": 1}, {"sep": ","}, {"maxsplit": 1}, {"reverse": True}, {"base": 10}]
FUNCTIONS = [len, abs, ord, chr, hash, id and callable, isinstance, issubclass, divmod, pow, round, repr, iter, next, getattr, hasattr, sum, sorted, int, float, bool, str, list, tuple,
             operator.add, operator.neg, operator.index, operator.length_hint, functools.reduce, sys.intern, sys.getrefcount and operator.truth, min, max, print and format, any, all, bin, hex, oct, ascii, vars]
for n, f in enumerate(FUNCTIONS):
    for m, a in enumerate(CALLS):
        rec("f %d %d%s" % (n, m, " hash" if f is hash else ""), f, *a)
    for m, k in enumerate(KW[1:]):
        rec("fk %d %d" % (n, m), f, [3, 1, 2], **k)
        rec("fk0 %d %d" % (n, m), f, **k)

# ---- Methods: bound, as found in the type, and given the wrong object ----
class SS(str): pass
class LL(list): pass
class DD(dict): pass
class TT(tuple): pass
class II(int): pass
class BB(bytes): pass
class FS(frozenset): pass
OBJECTS = ["abc", SS("abc"), [1, 2], LL([1, 2]), {"a": 1}, DD(a=1), (1, 2), TT((1, 2)), 5, II(5), True, 1.5, b"ab", BB(b"ab"), bytearray(b"ab"), {1, 2}, frozenset({1}), FS({1}), None, object(), range(3),
           collections.OrderedDict(a=1), collections.defaultdict(int, a=1), collections.deque([1, 2]), 2 ** 70, 1j, slice(1), type, len]
METHODS = [(str, "upper"), (str, "strip"), (str, "startswith"), (str, "split"), (str, "__len__"), (str, "__getitem__"), (str, "__contains__"), (str, "__hash__"), (str, "__eq__"), (str, "__add__"),
           (list, "append"), (list, "pop"), (list, "copy"), (list, "index"), (list, "__len__"), (list, "__getitem__"), (list, "__contains__"), (list, "__iter__"), (list, "__eq__"),
           (dict, "get"), (dict, "keys"), (dict, "copy"), (dict, "__len__"), (dict, "__getitem__"), (dict, "__contains__"), (dict, "__iter__"), (dict, "setdefault"),
           (tuple, "index"), (tuple, "count"), (tuple, "__len__"), (tuple, "__getitem__"), (tuple, "__hash__"), (int, "bit_length"), (int, "__add__"), (int, "__index__"), (int, "__bool__"), (int, "__hash__"),
           (float, "is_integer"), (float, "__add__"), (bytes, "upper"), (bytes, "__len__"), (bytes, "__getitem__"), (set, "__contains__"), (set, "__len__"), (set, "copy"), (frozenset, "__contains__"), (frozenset, "__hash__"),
           (object, "__repr__") and (object, "__hash__") and (object, "__eq__"), (object, "__ne__"), (object, "__sizeof__") and (object, "__dir__") and (object, "__init__"), (type, "mro"), (range, "__len__"), (collections.deque, "__len__")]
def fresh(o):
    # What a method may change is made anew.
    return type(o)(o) if isinstance(o, (list, dict, set, bytearray, collections.deque)) and type(o) is not collections.defaultdict else o
def shown(r): return sorted(r) if isinstance(r, (set, frozenset)) else list(r) if type(r).__name__ in ("dict_keys", "list_iterator", "dict_keyiterator") else r
for t, name in METHODS:
    method = getattr(t, name)
    rec("none %s.%s" % (t.__name__, name), method)
    for n, o in enumerate(OBJECTS):
        for m, a in enumerate([(), (0,), ("a",), (0, 1), (0, 1, 2)]):
            rec("unbound %s.%s %d %d" % (t.__name__, name, n, m), lambda: shown(method(fresh(o), *a)))
        if isinstance(o, t):
            for m, a in enumerate([(), (0,), ("a",), (0, 1), (0, 1, 2)]):
                rec("bound %s.%s %d %d" % (t.__name__, name, n, m), lambda: shown(getattr(fresh(o), name)(*a)))
            rec("kw %s.%s %d" % (t.__name__, name, n), lambda: shown(getattr(fresh(o), name)(zzz=1)))

# One call site, one callee after another.
def call1(f, x): return f(x)
rec("site", lambda: [call1(f, x) for f, x in [(len, "abc"), (len, [1]), (abs, -2), (str.upper, "a"), (ord, "a"), (len, (1, 2)), (repr, 1), ("x".join, ["a", "b"]), (list.copy, [1]), (lambda v: v, 9), (int, "7"), (len, {1: 2})]])
def method1(o): return o.copy()
rec("site copy", lambda: [method1(o) for o in ([1], {1: 2}, {3}, LL([4]), DD(a=5), bytearray(b"x"), collections.deque([6]), collections.OrderedDict(b=7))])

# ---- Operations of built-in types, found through classes ----
def ops(o):
    r = []
    for label, f in (("len", len), ("bool", bool), ("hash", lambda v: hash(v) == hash(v)), ("iter", lambda v: list(iter(v))), ("in", lambda v: 1 in v), ("item", lambda v: v[0]), ("repr", repr), ("str", str), ("eq", lambda v: v == v),
                     ("lt", lambda v: v < v), ("add", lambda v: v + v), ("mul", lambda v: v * 2), ("neg", lambda v: -v), ("next", next), ("set", lambda v: v.__setitem__(0, 9)), ("del", lambda v: v.__delitem__(0))):
        try: r.append((label, f(o)))
        except Exception as e: r.append((label, type(e).__name__))
    return r
for n, o in enumerate(OBJECTS[:24]):
    if type(o) is not object: rec("ops %d" % n, ops, fresh(o))

# A class with the method of a type it has nothing to do with.
class Foreign:
    __len__ = list.__len__
    __getitem__ = dict.__getitem__
    __contains__ = set.__contains__
    __hash__ = str.__hash__
    __iter__ = tuple.__iter__
    __eq__ = int.__eq__
    __add__ = str.__add__
    __bool__ = int.__bool__
    __repr__ = list.__repr__
    __next__ = type(iter([])).__next__
rec("foreign", ops, Foreign())
class HalfForeign(list):
    __len__ = tuple.__len__
    __contains__ = list.__contains__
    __getitem__ = list.__getitem__
    __hash__ = object.__hash__ and None
rec("half foreign", ops, HalfForeign([1, 2]))
class Borrowed(dict):
    __len__ = dict.__len__
    __iter__ = dict.__iter__
    __contains__ = collections.OrderedDict.__contains__
rec("borrowed", ops, Borrowed({0: 1, 1: 2}))

# What a class has under the name changes after it has been used.
class C(list): pass
c = C([1, 2, 3])
def look(o): return (len(o), 1 in o, o[0], bool(o), list(iter(o)), o == o, repr(o))
rec("before", look, c)
C.__len__ = lambda self: 42
rec("len set", look, c)
C.__contains__ = lambda self, x: "yes"
C.__getitem__ = lambda self, i: ("item", i)
rec("more set", look, c)
del C.__len__
rec("len deleted", look, c)
C.__len__ = dict.__len__
rec("len foreign", look, c)
C.__len__ = list.__len__
rec("len its own", look, c)
C.__len__ = None
rec("len None", look, c)
del C.__len__, C.__contains__, C.__getitem__
rec("all deleted", look, c)
class Base(list): pass
class Derived(Base): pass
d = Derived([1])
rec("derived", look, d)
Base.__len__ = lambda self: 7
rec("base changed", look, d)
class Other(list):
    def __len__(self): return 8
    def __iter__(self): return iter("other")
Derived.__bases__ = (Other,)
rec("bases changed", look, d)
d.__class__ = Base
rec("class changed", look, d)
del Base.__len__
rec("base restored", look, d)
class Meta(type):
    def __len__(cls): return 99
class WithMeta(list, metaclass=Meta): pass
rec("meta", lambda: (len(WithMeta), len(WithMeta([1])), look(WithMeta([1, 2]))))

# Descriptors under the names of operations.
class Desc:
    def __get__(self, o, t): return lambda *a: ("desc", a)
class Raises:
    def __get__(self, o, t): raise AttributeError("gone")
class WithDesc(list):
    __len__ = Raises()
    __contains__ = Desc()
    __getitem__ = staticmethod(lambda i: ("static", i))
    __iter__ = classmethod(lambda cls: iter((cls.__name__,)))
    __eq__ = Raises()
    __hash__ = Raises()
rec("descriptors", ops, WithDesc([1]))

# What was looked up is no longer what the class has by the time it is called.
def stale_add():
    class A(int):
        def __add__(self, other): return NotImplemented
    class B(A):
        def __radd__(self, other):
            del A.__add__
            operator.add(A(1), 1)
            return NotImplemented
    return A(1) + B(2)
rec("stale __add__", stale_add)
def stale_radd():
    class A(int):
        def __add__(self, other):
            del B.__radd__
            operator.add(1, B(1))
            return NotImplemented
    class B(int):
        def __radd__(self, other): return "B.__radd__"
    return A(1) + B(2)
rec("stale __radd__", stale_radd)
def stale_compare():
    class A(int):
        def __lt__(self, other):
            del B.__gt__
            operator.gt(B(1), 0)
            return NotImplemented
    class B(int):
        def __gt__(self, other): return "B.__gt__"
    return A(1) < B(2)
rec("stale __gt__", stale_compare)
def stale_items():
    class L(list):
        def __getitem__(self, i): return ("L.__getitem__", i)
        def __setitem__(self, i, v): seen.append(("L.__setitem__", i, v))
        def __delitem__(self, i): seen.append(("L.__delitem__", i))
    class Key:
        def __init__(self, name): self.name = name
        def __index__(self):
            if self.name in L.__dict__:
                delattr(L, self.name); l[0]; l[0] = 5
            return 1
    seen = []; l = L([1, 2, 3])
    seen.append(l[Key("__getitem__")])
    l[Key("__setitem__")] = 7
    del l[Key("__delitem__")]
    return seen, l
rec("stale items", stale_items)
def class_changes_meanwhile():
    class A(list):
        def __eq__(self, other):
            other.__class__ = C
            return NotImplemented
    class B(list): pass
    class C(list):
        def __eq__(self, other): return "C.__eq__"
    return A([1]) == B([1])
rec("class changes meanwhile", class_changes_meanwhile)

# ---- Recursion among functions written in C++ ----
def nested(make, depth):
    x = make(None)
    for _ in range(depth): x = make(x)
    return x
for name, make in (("list", lambda x: [x]), ("tuple", lambda x: (x,)), ("dict", lambda x: {0: x}), ("frozenset", lambda x: frozenset((x,)))):
    for depth in (10, 100000):
        a, b = nested(make, depth), nested(make, depth)
        rec("deep repr %s %d" % (name, depth), lambda: len(repr(a)))
        rec("deep eq %s %d" % (name, depth), lambda: a == b)
        if name in ("tuple", "frozenset") and depth == 10: rec("deep hash %s %d" % (name, depth), lambda: hash(a) == hash(b))
        # Taken apart one level at a time: what lets go of such a thing at once may recurse as well.
        while a is not None and depth > 10: a = next(iter(a.values() if isinstance(a, dict) else a)); b = next(iter(b.values() if isinstance(b, dict) else b))
loop = []; loop.append(loop)
rec("self", lambda: (repr(loop), loop == loop, loop in loop, len(loop)))
# Whether an object is true: __bool__ and __len__ that are there, are None, are not there, or are descriptors that raise. A __len__ that says
# with an AttributeError that it is not there is believed only if the class has a __bool__ that has said the same.
def raises_attribute_error(self): raise AttributeError("attr")
def raises_value_error(self): raise ValueError("value")
class Raising:
    def __init__(self, error): self.error = error
    def __get__(self, instance, owner): raise self.error
ways = {"none": None, "absent": 0, "property A": property(raises_attribute_error), "property V": property(raises_value_error), "get A": Raising(AttributeError("g")), "get V": Raising(ValueError("g")),
        "0": lambda self: 0, "1": lambda self: 1, "False": lambda self: False, "True": lambda self: True, "str": lambda self: "abc", "empty str": lambda self: "", "-1": lambda self: -1, "big": lambda self: 2 ** 70,
        "0.0": lambda self: 0.0, "property 0": property(lambda self: lambda: 0), "property str": property(lambda self: lambda: "")}
for b in ways:
    for l in ways:
        namespace = {}
        if b != "absent": namespace["__bool__"] = ways[b]
        if l != "absent": namespace["__len__"] = ways[l]
        x = type("X", (), namespace)()
        for label, f in (("bool", lambda: bool(x)), ("not", lambda: not x), ("if", lambda: 1 if x else 2), ("and", lambda: (x and 5) is x), ("len", lambda: len(x))):
            rec("true? __bool__ %s, __len__ %s: %s" % (b, l, label), f)
class Later: pass
later = Later()
class LaterStill(Later): pass
for step, change in (("nothing", lambda: None), ("__len__", lambda: setattr(Later, "__len__", property(raises_attribute_error))), ("__bool__ too", lambda: setattr(Later, "__bool__", property(raises_attribute_error))),
                     ("__len__ alone again", lambda: delattr(Later, "__bool__")), ("__bool__ in the subclass", lambda: setattr(LaterStill, "__bool__", property(raises_attribute_error)))):
    change()
    rec("true? later: " + step, lambda: bool(later)); rec("true? later, subclass: " + step, lambda: bool(LaterStill()))
print("\n".join(out))
print(len(out))
