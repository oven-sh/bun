# str: items, comparisons, join and the methods that take another str, over every way a text can be laid out.
out = []
def rec(label, f, *a):
    try:
        r = ascii(f(*a))
    except Exception as e:
        r = type(e).__name__ + ":" + ascii(str(e))
    out.append("%s -> %s" % (label, r))

class SS(str): pass
class SG(str):
    def __getitem__(self, i): return ("SG", i)
class SE(str):
    def __eq__(self, o): return "SE.eq"
    def __ne__(self, o): return "SE.ne"
    def __lt__(self, o): return "SE.lt"
    def __gt__(self, o): return "SE.gt"
    def __le__(self, o): return "SE.le"
    def __ge__(self, o): return "SE.ge"
    __hash__ = str.__hash__
class Idx:
    def __init__(self, i): self.i = i
    def __index__(self): return self.i
    def __repr__(self): return "Idx(%d)" % self.i

def glue(*parts):
    # Put together at run time: not flat until somebody needs it to be.
    s = ""
    for p in parts: s = s + p
    return s

def texts():
    return [
        "", "a", "abc", "hello world", "\x00", "\xe9", "caf\xe9", "\xff\xfe", "a\x00b",
        "Ā", "abĀ", "€ uro", "￿", "abcΔ",
        "\U0001f600", "a\U0001f600b", "\U0001f600\U0001f601", "x" * 3 + "\U00010000" + "y" * 3,
        # Lone surrogates, but never a leading one right before a trailing one: in UTF-16 that is a pair.
        "\ud800", "\udc00", "a\ud800", "\ud800a", "\udc00x\ud800", "\ud83d" + "xy" + "\ude00",
        glue("\ude00", "-\ud83d"),
        glue("hello", " ", "world"), glue("caf", "\xe9"), glue("ab", "Ā"), glue("a", "\U0001f600", "b"), glue("x" * 40, "y" * 40),
        glue("x" * 60, "\U0001f600", "y" * 60),       # long enough for what is remembered about pairs
        "hello world"[2:9], ("abĀcd")[0:2],      # 16-bit units that hold nothing beyond Latin-1
        SS("abc"), SS(""), SS("\U0001f600x"), SG("abc"), SE("abc"),
    ]

def get(s, i): return s[i]
IDX = [0, 1, 2, 3, 6, 10, 11, 59, 60, 61, 62, 120, 121, -1, -2, -3, -4, -11, -12, -121, -122, 2**31 - 1, -2**31, 2**31, 2**64, -2**64, True, False, Idx(1), Idx(-1), Idx(99),
       1.0, "0", None, (0,), slice(None), slice(1, 3), slice(None, None, -1), slice(-2, None), slice(0, 100, 2), slice(59, 63)]
for n, s in enumerate(texts()):
    for i in IDX:
        rec("item %d %s" % (n, i.i if isinstance(i, Idx) else i), get, s, i)

# The same instruction sees one kind of object after another.
def item_of_each(things): return [t[1] for t in things]
rec("mixed", item_of_each, ["abc", [1, 2, 3], (4, 5, 6), "Āā", b"xyz", "a\U0001f600", SG("q"), {1: "one"}, range(5), glue("p", "q")])

import operator
OPS = [operator.eq, operator.ne, operator.lt, operator.le, operator.gt, operator.ge]
def lt(a, b): return a < b
def eq(a, b): return a == b
def ne(a, b): return a != b
def branch(a, b): return ("eq" if a == b else "ne", "lt" if a < b else "ge", "le" if a <= b else "gt", "ne" if a != b else "eq")
T = texts()
for n, a in enumerate(T):
    for m, b in enumerate(T):
        rec("cmp %d %d" % (n, m), lambda: [op(a, b) for op in OPS] + [branch(a, b)])
for n, a in enumerate(T):
    for other in (None, 0, 1.5, b"abc", ["a"], ("a",), object):
        rec("cmp %d %s" % (n, other), lambda: (a == other, a != other, other == a, other != a))
        rec("ord %d %s" % (n, other), lt, a, other)
        rec("ord' %d %s" % (n, other), lt, other, a)
rec("sorted", sorted, [t for t in T if type(t) is str])
rec("sorted reverse", lambda: sorted([t for t in T if type(t) is str], reverse=True))
rec("min max", lambda: (min(t for t in T if type(t) is str), max(t for t in T if type(t) is str)))
# Equal texts in units of different widths.
narrow, wide = "abc", ("abcĀ")[:3]
rec("widths", lambda: (narrow == wide, wide == narrow, narrow != wide, narrow < wide, narrow <= wide, hash(narrow) == hash(wide), {narrow: 1}[wide], wide in {narrow}, narrow is not None))

# join
class LI(list):
    def __iter__(self): return iter(["from", "iter"])
class TI(tuple):
    def __iter__(self): return iter(["from", "iter"])
class It:
    def __init__(self, n): self.n = n
    def __iter__(self): return self
    def __next__(self):
        if not self.n: raise StopIteration
        self.n -= 1
        return str(self.n)
class Bad:
    def __iter__(self): raise TypeError("mine")
class Bad2:
    def __iter__(self): raise ValueError("mine")
def gen_raises():
    yield "a"
    raise KeyError("in the middle")
SEPS = ["", ",", ", ", "\xe9", "Ā", "\U0001f600", "\ud800", glue("-", "+"), SS("/"), SE("|")]
SEQS = [[], [""], ["a"], ["a", "b"], ["a", "", "b"], ["", ""], ["\xe9", "a"], ["a", "Ā"], ["Ā", "a"], ["\U0001f600", "x", "\ud800"], ["\ude00", "\ud83d"],
        [glue("a", "b"), glue("c", "Ā")], [SS("x"), "y"], [SS("only")], [SE("e"), SE("f")], ["x"] * 100, (), ("a",), ("a", "b", "c"), (SS("t"),),
        LI(["x", "y"]), TI(("x", "y")), "abc", "", "\U0001f600Ā", SS("ab"), {"k1": 1, "k2": 2}, {"only"}, frozenset(), It(3), It(0), iter(["i", "j"]), (c for c in "gen"), map(str, range(3)),
        ["a", 1], [1, "a"], ["a", None, 2], [b"a"], ["a", b"b"], ("a", 1.5), [["a"]], [SS], range(2), b"ab", 5, None, Bad(), Bad2(), gen_raises(), [0.5], [1, 2], [2**40]]
for n, sep in enumerate(SEPS):
    for m in range(len(SEQS)):
        # Made anew each time: some can be gone through only once.
        seq = {29: It(3), 30: It(0), 31: iter(["i", "j"]), 32: (c for c in "gen"), 33: map(str, range(3)), 48: gen_raises()}.get(m, SEQS[m])
        rec("join %d %d" % (n, m), sep.join, seq)
        rec("join type %d %d" % (n, m), lambda: type(sep.join({29: It(3), 30: It(0), 31: iter(["i", "j"]), 32: (c for c in "gen"), 33: map(str, range(3)), 48: gen_raises()}.get(m, SEQS[m]))).__name__)
one = glue("on", "e!")
rec("join one", lambda: (",".join([one]) is one, ",".join((one,)) is one, ",".join(iter([one])) is one, type(",".join([SS("s")])), ",".join([SS("s")]) == "s"))
rec("join unbound", lambda: (str.join(",", ["a", "b"]), str.join(SS(","), ("a", "b"))))
rec("join wrong self", str.join, 1, ["a"])
rec("join no args", ",".join)
rec("join long", lambda: (len("ab".join(["x" * 1000] * 1000)), len("Ā".join(["x" * 10] * 10)), "Ā".join(["x" * 10] * 10).count("Ā")))
def grows():
    items = ["a", "b"]
    def g():
        for x in items:
            if len(items) < 6: items.append(x + x)
            yield x
    return "-".join(g())
rec("join grows", grows)
# Texts that are not flat yet, among others and alone; what is wrong with a later item is found whatever comes before it.
def ropes(): return [glue("ab", "cd"), "-", glue("\u0100", "x"), glue("p" * 20, "q" * 20)]
rec("join ropes", lambda: (",".join(ropes()), glue(",", ";").join(ropes()), glue("\u0100", "!").join(tuple(ropes())), "".join(ropes() * 3)))
rec("join rope then int", lambda: ",".join([glue("ab", "cd"), 1]))
rec("join rope then None", lambda: ",".join((glue("ab", "cd"), glue("e", "f"), None)))
def same_rope():
    r = glue("ab" * 30, "cd" * 30)
    return ("".join([r]) is r, ",".join((r,)) is r, glue(",", ";").join([r]) is r, len(r))
rec("join one rope", same_rope)
def storages():
    ints = [];  floats = []; mixed = []
    for i in range(3): ints.append(i); floats.append(i + 0.5); mixed.append(i)
    mixed[1] = "s"
    emptied = ["a", "b"]; emptied.clear()
    popped = ["a", "b", "c"]; popped.pop()
    return [ints, floats, mixed, emptied, popped, [] + [], ["x"] * 0, list("abc"), [None] * 2]
for n, l in enumerate(storages()): rec("join storage %d" % n, "+".join, l)
rec("sort ropes", lambda: sorted([glue("b", "a"), glue("a", "b"), glue("a", "\u0100"), glue("a", "\U0001f600"), glue("a", ""), "ab", glue("\xe9", "a"), glue("a" * 50, "b"), glue("a" * 50, "a")]))
rec("sort keys", lambda: sorted(["bb", "a", "ccc", "\u0100", ""], key=lambda t: glue(t, "!")))

# Methods that take another str.
HAY = ["", "a", "hello world", "aaa", "caf\xe9 caf\xe9", "abĀab", "x\U0001f600y\U0001f600", "\ude00\U0001f600\ud83d", glue("hello", " world"), glue("a\U0001f600", "b\U0001f600"), SS("hello"), ("abcĀ")[:3]]
NEEDLE = ["", "a", "o", "lo w", "aa", "\xe9", "Ā", "ab", "\U0001f600", "\ud83d", "\ude00", "zz", "hello world!", glue("l", "l"), SS("l"), ("aĀ")[:1]]
for n, h in enumerate(HAY):
    for m, x in enumerate(NEEDLE):
        rec("methods %d %d" % (n, m), lambda: (
            h.startswith(x), h.endswith(x), h.find(x), h.rfind(x), h.count(x), x in h, h.replace(x, "<>"), h.replace(x, "Ā", 1), h.replace(x, ""), h.partition(x) if x else None,
            h.rpartition(x) if x else None, h.split(x) if x else None, h.rsplit(x, 1) if x else None, h.removeprefix(x), h.removesuffix(x), h.strip(x), h.lstrip(x), h.rstrip(x),
            h.startswith(x, 1), h.endswith(x, 0, -1), h.find(x, 1, -1), h.count(x, 2), h.startswith((x, "zz")), h.endswith(("zz", x)), h.startswith(x, -3), h.startswith(x, 100), h.startswith(x, 3, 1)))
        rec("index %d %d" % (n, m), h.index, x)
        rec("rindex %d %d" % (n, m), h.rindex, x)
for name in ("startswith", "endswith", "find", "rfind", "index", "rindex", "count", "partition", "rpartition", "split", "rsplit", "removeprefix", "removesuffix", "strip", "replace", "__contains__", "__eq__", "__lt__", "__add__", "join"):
    for bad in (None, 1, b"a", ["a"], ("a", 1), (), 1.5):
        rec("%s(%r)" % (name, bad), getattr("hello", name), bad)
rec("empty separators", lambda: [f("") for f in ("a".split, "a".rsplit, "a".partition, "a".rpartition)])
for f in ("a".split, "a".rsplit, "a".partition, "a".rpartition): rec("empty separator", f, "")
rec("identity", lambda: (one.replace("zz", "y") is one, one.removeprefix("zz") is one, one.removesuffix("zz") is one, one.strip() is one, one.split("zz")[0] is one, one.partition("zz")[0] is one,
                         one.rpartition("zz")[2] is one, one[:] is one, type(SS("q").replace("zz", "y")), type(SS("q")[:]), type(SS("q").strip()), type(SS("q").split("zz")[0]), type(SS("q").partition("z")[0])))
# The text that a method works on becomes the name of an attribute meanwhile and afterwards: names are kept one of a kind.
class O: pass
def named():
    o = O(); r = []
    for base in ("attr", "caf\xe9", "nĀme"):
        name = glue(base, "_x")
        before = (name.upper(), name.find("_"), name[1], name.startswith(base))
        setattr(o, name, 1)
        r.append((before == (name.upper(), name.find("_"), name[1], name.startswith(base)), getattr(o, name), name in vars(o), name == glue(base, "_x"), "-".join([name, name])))
    return r
rec("named", named)
print("\n".join(out))
print(len(out))
