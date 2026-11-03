def t(f):
    try:
        print(repr(f()))
    except BaseException as e:
        print(type(e).__name__ + ':', e)

def seq(x):
    match x:
        case []: return "empty"
        case [1]: return "just one"
        case [a]: return ("single", a)
        case [1, b]: return ("starts with 1", b)
        case [a, b]: return ("pair", a, b)
        case [a, b, c]: return ("triple", a, b, c)
        case [first, *rest]: return ("long", first, rest)
    return "not a sequence"
class L(list): pass
class T(tuple): pass
for v in ([], (), [1], (2,), [1, 5], (3, 4), [1, 2, 3], [1, 2, 3, 4], range(0), range(2), range(5), L([1]), T((7, 8)), "", "ab", b"ab", bytearray(b"a"), {1, 2}, {1: 2}, iter([1]), (x for x in [1]), None, 5, frozenset(), {}.keys(), memoryview(b"ab"), {1: 2}.items()):
    print(type(v).__name__, seq(v), end=" | ")
print()
def star(x):
    match x:
        case [*all_] if len(all_) == 0: return "empty via star"
        case [1, *r]: return ("1 then", r)
        case [*r, 9]: return ("ends with 9", r)
        case [a, *m, z] if a == z: return ("same ends", m)
        case [a, b, *_]: return ("at least two", a, b)
        case [*_]: return "any sequence"
print([star(v) for v in ([], [1], [1, 2, 3], [5, 9], [9], [4, 5, 6, 4], [4, 4], (2, 3, 5), [7], "no")])
match (1, 2, 3):
    case [a, *b]: print(type(b).__name__, b)
match range(5):
    case [a, *b, c]: print(a, b, c)
match [1, 2]:
    case [a, b, *c]: print(a, b, c)
match [1, [2, [3, [4]]]]:
    case [a, [b, [c, [d]]]]: print(a, b, c, d)
match [(1, 2), [3, 4]]:
    case [(a, b), (c, d)]: print(a, b, c, d)
match [1, 2, 3]:
    case (a, b, c): print("parens pattern matches a list", a, b, c)
match (1,):
    case (a): print("parenthesised capture, not a sequence", a)
match (1,):
    case (a,): print("one-element sequence pattern", a)
match [1, 2, 3, 4, 5]:
    case [_, _, *_, last]: print(last)
match [[1, 2], [3, 4], [5, 6]]:
    case [[a, _], *_, [_, b]]: print(a, b)
# The sequence protocol used: len() then indexing.
class Seq:
    def __init__(s, *v): s.v = v
    def __len__(s): print("len", end="; "); return len(s.v)
    def __getitem__(s, i): print("getitem", i, end="; "); return s.v[i]
def custom(x):
    match x:
        case [a, b]: return (a, b)
    return "plain classes are not sequences"
print(custom(Seq(1, 2)))
class LT(list):
    def __len__(s): print("len", end="; "); return list.__len__(s)
    def __getitem__(s, i): print("getitem", i, end="; "); return list.__getitem__(s, i)
    def __iter__(s): print("iter", end="; "); return list.__iter__(s)
def traced(x):
    match x:
        case [1]: return "one"
        case [a, b, c, d]: return "four"
        case [a, 5]: return "ends with 5"
        case [a, *m, z]: return (a, m, z)
print(traced(LT([7, 8, 9])))
print(traced(LT([7, 5])))
# Mappings.
def mp(x):
    match x:
        case {"type": "point", "x": px, "y": py}: return ("point", px, py)
        case {"type": "circle", "r": r, **rest}: return ("circle", r, rest)
        case {"type": t_}: return ("unknown type", t_)
        case {1: a, 2: b}: return ("ints", a, b)
        case {None: n}: return ("None key", n)
        case {True: n}: return ("True key", n)
        case {1.5: n} if False: return "no"
        case {"a": {"b": {"c": deep}}}: return ("deep", deep)
        case {"list": [h, *_]}: return ("list head", h)
        case {}: return "any mapping"
    return "not a mapping"
class D(dict): pass
for v in ({"type": "point", "x": 1, "y": 2}, {"type": "point", "x": 1, "y": 2, "z": 3}, {"type": "circle", "r": 5, "color": "red", "w": 1}, {"type": "circle", "r": 5}, {"type": "sq"}, {1: "a", 2: "b"}, {None: 0}, {True: "t"}, {"a": {"b": {"c": 42}}}, {"list": [1, 2]}, {"list": []}, {}, D(type="d"), [], "s", None, [("type", 1)], frozendict(type="fd"), type("C", (), {}).__dict__):
    print(mp(v), end=" | ")
print()
match {"a": 1, "b": 2, "c": 3}:
    case {"a": x, **rest}: print(x, rest, type(rest).__name__)
match D(a=1, b=2):
    case {"a": 1, **rest}: print(rest, type(rest).__name__)
match {"a": 1}:
    case {"a": 1, **rest}: print(rest)
match {"a": None}:
    case {"a": None}: print("present with a None value")
match {}:
    case {"a": None}: print("no")
    case _: print("an absent key does not match None")
match {1: "int key"}:
    case {1.0: v}: print("1.0 finds 1:", v)
match {"k": 1}:
    case {"k": 1 | 2 as v}: print("or/as inside a mapping", v)
class Color: RED = "red"
match {"red": 1}:
    case {Color.RED: v}: print("value pattern as key", v)
match {-1: "neg", 1 + 2j: "cplx", b"b": "bytes", "a" "b": "cat"}:
    case {-1: a, 1 + 2j: b, b"b": c, "ab": d}: print(a, b, c, d)
# get() is used, not __getitem__/__missing__/__contains__.
class DD(dict):
    def __missing__(s, k): print("missing must not be called"); return "default"
    def get(s, k, d=None): print("get", k, end="; "); return dict.get(s, k, d)
    def __getitem__(s, k): print("getitem", k, end="; "); return dict.__getitem__(s, k)
    def __contains__(s, k): print("contains", k, end="; "); return dict.__contains__(s, k)
    def keys(s): print("keys", end="; "); return dict.keys(s)
    def __len__(s): print("len", end="; "); return dict.__len__(s)
def dd(x):
    match x:
        case {"a": 1, "zz": 2}: return "no"
        case {"a": v, **r}: return (v, r)
print(dd(DD(a=1, b=2)))
def dup_runtime(x, k1, k2):
    class K: A = k1; B = k2
    match x:
        case {K.A: a, K.B: b}: return (a, b)
t(lambda: dup_runtime({1: 1, 2: 2}, 1, 2)); t(lambda: dup_runtime({1: 1, 2: 2}, 1, 1)); t(lambda: dup_runtime({1: 1}, 1, 1.0)); t(lambda: dup_runtime({1: 1}, [], 1)); t(lambda: dup_runtime({}, 1, 1))
# Mixed structures.
def cmd(c):
    match c.split():
        case ["go", ("north" | "south") as d]: return "going " + d
        case ["go", _]: return "bad direction"
        case ["take", *items] if items: return "taking " + ",".join(items)
        case ["quit" | "exit"]: return "bye"
        case []: return "nothing"
        case [verb, *_]: return "unknown " + verb
print([cmd(c) for c in ("go north", "go up", "take a b", "take", "quit", "exit", "", "dance now")])
def ev(e):
    match e:
        case int() | float(): return e
        case ("+", a, b): return ev(a) + ev(b)
        case ("*", a, b): return ev(a) * ev(b)
        case ("-", a): return -ev(a)
        case ("sum", *xs): return sum(ev(x) for x in xs)
        case {"op": op, "args": [*args]}: return ev((op, *args))
    raise ValueError("bad expression %r" % (e,))
print(ev(("+", 1, ("*", 2, ("-", 3)))), ev(("sum", 1, 2, ("+", 3, 4))), ev({"op": "+", "args": [1, {"op": "*", "args": [2, 3]}]})); t(lambda: ev(("?", 1)))
def js(v):
    match v:
        case None: return "null"
        case True: return "true"
        case False: return "false"
        case int() | float(): return repr(v)
        case str(): return '"%s"' % v
        case [*xs]: return "[" + ",".join(js(x) for x in xs) + "]"
        case {**kv}: return "{" + ",".join('"%s":%s' % (k, js(x)) for k, x in kv.items()) + "}"
print(js({"a": [1, 2.5, None, True, {"b": "c"}], "d": (), "e": {}}))
# Bindings happen left to right and stay bound on failure.
def partial():
    a = b = c = "unset"
    match [1, 2, 3]:
        case [a, b, 99]: pass
        case [a, 99, c]: pass
    return a, b, c
print(partial())
def rebinding():
    match [1, [2, 3]]:
        case [x, [y, 99]] | [y, [x, 3]]: return x, y
print(rebinding())
