def t(f):
    try:
        print(repr(f()))
    except Exception as e:
        print(type(e).__name__ + ':', e)

class P:
    def __init__(s, a, b): s.a = a; s.b = b
    def __eq__(s, o): return isinstance(o, P) and (s.a, s.b) == (o.a, o.b)
    def __hash__(s): return hash((s.a, s.b))
    def __lt__(s, o): return (s.a, s.b) < (o.a, o.b)
    def __repr__(s): return "P(%r,%r)" % (s.a, s.b)
p, q, r = P(1, 2), P(1, 2), P(2, 1)
print(p == q, p != q, p == r, p != r, p is q, hash(p) == hash(q), p < r, r < p, p > r, r > p, p == 1, p != 1, 1 == p, {p: "v"}[q], len({p, q, r}), p in [q], [p].index(q), [p, r].count(q), p in {q}, p in (r,), sorted([r, p]), max(p, r), min([r, p]), [p] == [q], (p,) == (q,), {1: p} == {1: q}, {p} == {q})
t(lambda: p <= r); t(lambda: p >= r); t(lambda: p < 1); t(lambda: 1 < p); t(lambda: 1 > p)
# Defining __eq__ without __hash__ makes instances unhashable.
class EqOnly:
    def __eq__(s, o): return True
class EqHash:
    def __eq__(s, o): return True
    def __hash__(s): return 1
class EqInherit(EqHash): pass
class EqOverride(EqHash):
    def __eq__(s, o): return False
class EqRestore(EqOnly):
    __hash__ = object.__hash__
class HashNone: __hash__ = None
class HashNoneSub(HashNone): pass
class HashBack(HashNone):
    def __hash__(s): return 5
print(EqOnly.__hash__, EqHash.__hash__ is not None, EqOverride.__hash__, "__hash__" in EqOnly.__dict__, "__hash__" in EqInherit.__dict__, hash(EqHash()), hash(EqInherit()), isinstance(hash(EqRestore()), int), hash(HashBack()))
t(lambda: hash(EqOnly())); t(lambda: {EqOnly()}); t(lambda: {EqOnly(): 1}); t(lambda: hash(EqOverride())); t(lambda: hash(HashNone())); t(lambda: hash(HashNoneSub())); t(lambda: EqOnly() in {1}); t(lambda: {}.get(EqOnly())); t(lambda: hash((1, EqOnly()))); t(lambda: frozenset([EqOnly()])); t(lambda: EqOnly() in [1])
# What __hash__ may return.
def H(v):
    class X:
        def __hash__(s): return v
    return X()
print(hash(H(5)), hash(H(-1)), hash(H(-2)), hash(H(0)), hash(H(True)), hash(H(2 ** 61 - 1)), hash(H(2 ** 61)), hash(H(2 ** 63)), hash(H(2 ** 64)), hash(H(-(2 ** 63))), hash(H(2 ** 63 - 1)), hash(H(-(2 ** 63) - 1)), hash(H(10 ** 30)), hash(H(-(10 ** 30))), hash(H(2 ** 62)))
t(lambda: hash(H(1.0))); t(lambda: hash(H("a"))); t(lambda: hash(H(None))); t(lambda: {H(1.5): 1})
class IntLike(int): pass
print(hash(H(IntLike(7))), type(hash(H(IntLike(7)))))
# Default comparisons.
class D: pass
d1, d2 = D(), D()
print(d1 == d1, d1 == d2, d1 != d2, d1 != d1, d1 is d1, hash(d1) == hash(d1), d1 in [d1], d1 in [d2], {d1: 1}.get(d2), len({d1, d2, d1}), d1.__eq__(d1), d1.__eq__(d2), d1.__ne__(d1), d1.__ne__(d2), d1.__lt__(d2), d1.__le__(d1), d1.__gt__(d2), d1.__ge__(d2), [d1] == [d1], [d1] == [d2], (d1, 1) == (d1, 1))
t(lambda: d1 < d2); t(lambda: d1 <= d1); t(lambda: d1 > 1); t(lambda: "a" >= d1); t(lambda: sorted([d1, d2])); t(lambda: max(d1, d2)); t(lambda: [d1] < [d2]); t(lambda: (1, d1) < (1, d2)); print([d1] < [d1] if False else "", (1, d1) < (2, d2), [d1, 1] == [d1, 2], (d1,) <= (d1,), [d1] >= [d1])
# Identity shortcuts in containers.
class NeverEq:
    def __eq__(s, o): return False
    def __hash__(s): return 1
ne = NeverEq(); print(ne == ne, ne in [ne], ne in (ne,), ne in {ne}, ne in {ne: 1}, [ne] == [ne], (ne,) == (ne,), {ne: 1} == {ne: 1}, {ne} == {ne}, [ne].index(ne), [ne].count(ne), [ne, ne].count(ne), {1: ne} == {1: ne}, ne in iter([ne]), [ne] != [ne])
nan = float("nan"); print(nan == nan, nan in [nan], [nan] == [nan], {nan: 1}[nan], nan in {nan}, (nan,) == (nan,), [nan].count(nan), [nan].index(nan), float("nan") in [nan], [float("nan")] == [nan], {nan} == {nan}, len({nan, nan}), len({float("nan"), float("nan")}), nan in (x for x in [nan]), nan in {nan: 1}.values(), (1, nan) in {1: nan}.items())
# Comparison of sequences calls == first, then the ordering on the first difference.
log = []
class T:
    def __init__(s, v): s.v = v
    def __eq__(s, o): log.append("eq%d%d" % (s.v, o.v)); return s.v == o.v
    def __lt__(s, o): log.append("lt%d%d" % (s.v, o.v)); return s.v < o.v
    def __le__(s, o): log.append("le%d%d" % (s.v, o.v)); return s.v <= o.v
    def __gt__(s, o): log.append("gt%d%d" % (s.v, o.v)); return s.v > o.v
    __hash__ = None
def run(f): log.clear(); print(f(), log)
run(lambda: [T(1), T(2)] < [T(1), T(3)]); run(lambda: [T(1), T(2)] == [T(1), T(3)]); run(lambda: [T(1)] < [T(1), T(2)]); run(lambda: (T(1), T(2)) <= (T(1), T(2))); run(lambda: [T(1), T(2)] == [T(1)]); run(lambda: [T(2)] > [T(1)]); run(lambda: [T(1), T(2)] != [T(1), T(2)]); run(lambda: T(1) in [T(0), T(1), T(2)]); run(lambda: [T(0), T(1)].index(T(1))); run(lambda: [T(0), T(1), T(1)].count(T(1))); run(lambda: max([T(1), T(3), T(2)]).v); run(lambda: min([T(2), T(1), T(3)]).v); run(lambda: [x.v for x in sorted([T(2), T(1), T(3)])]); run(lambda: T(1) < T(2) < T(3)); run(lambda: T(1) < T(0) < T(3)); run(lambda: T(1) == T(1) != T(2))
x = T(5); run(lambda: x in [x]); run(lambda: [x] == [x]); run(lambda: [x] < [x]); run(lambda: x == x)
# Chained comparisons evaluate the middle once.
def ev(v): print("ev", v, end="; "); return v
print(ev(1) < ev(2) < ev(3)); print(ev(1) < ev(0) < ev(3)); print(ev(1) == ev(1) == ev(1) != ev(2)); print(ev(1) < ev(2) > ev(0) in [ev(0)] is not None); print(ev(3) > ev(2) is ev(2)) if False else None; print(1 < 2 in [2], 1 in [1] == True, (1 in [1]) == True, 1 is 1 is 1 if False else "", not 1 < 2, not 1 == 2, 1 < 2 and 2 < 3, 1 if 1 < 2 < 3 else 0)
# functools.total_ordering by hand: reflected fallbacks.
class OnlyLt:
    def __init__(s, v): s.v = v
    def __lt__(s, o): return s.v < o.v
print(OnlyLt(1) < OnlyLt(2), OnlyLt(1) > OnlyLt(2), OnlyLt(2) > OnlyLt(1), sorted([OnlyLt(3), OnlyLt(1)])[0].v, max(OnlyLt(1), OnlyLt(2)).v, min(OnlyLt(1), OnlyLt(2)).v); t(lambda: OnlyLt(1) <= OnlyLt(2)); t(lambda: OnlyLt(1) >= OnlyLt(2))
class OnlyGt:
    def __init__(s, v): s.v = v
    def __gt__(s, o): return s.v > o.v
print(OnlyGt(1) < OnlyGt(2), OnlyGt(2) > OnlyGt(1), sorted([OnlyGt(3), OnlyGt(1)])[0].v, max(OnlyGt(1), OnlyGt(2)).v)
# Mixed built-in types.
print(1 == 1.0 == 1 + 0j == True, hash(1) == hash(1.0) == hash(1 + 0j) == hash(True), 0 == 0.0 == -0.0 == False == 0j, "1" == 1, b"1" == "1", [] == (), () == [], {} == set(), set() == frozenset(), None == False, None == 0, None == "", "" == b"", 1 == "1", (1,) == [1], range(0) == [], 1.0 == "1.0", [1] == [1.0], {1} == {1.0}, {1: 1} == {1.0: 1.0}, (1, 2) == (1.0, 2.0), "a" == "a", b"a" == bytearray(b"a"), int == int, int == float, len == len, None == None, ... == ..., NotImplemented == NotImplemented)
for a, b in ((1, "a"), ("a", 1), (1, None), (None, 1), ([], ()), ((), []), ({}, {}), (set(), []), ([], set()), (1, []), ("a", b"a"), (b"a", "a"), (1j, 1), (1, 1j), (int, int), (len, len), (None, None), (..., ...), (object(), 1), (1.5, "a"), ([1], 1), (range(1), range(1)), (slice(1), 1), ({}.keys(), []), ({}.values(), {}.values()), (frozenset(), 1), (bytearray(), ""), (True, None), (NotImplemented, 1), (type, type)):
    for op in ("<", "<=", ">", ">="):
        try: eval("a %s b" % op); 
        except TypeError as e: print(e, end=" | ")
    print()
print(bool(NotImplemented) if False else "", NotImplemented is NotImplemented, repr(NotImplemented), type(NotImplemented).__name__, type(NotImplemented)() is NotImplemented)
t(lambda: bool(NotImplemented)); t(lambda: not NotImplemented); t(lambda: 1 if NotImplemented else 2)
