def t(f):
    try:
        print(repr(f()))
    except Exception as e:
        print(type(e).__name__ + ':', e)

class Seq:
    def __init__(s, *v): s.v = list(v)
    def __len__(s): return len(s.v)
    def __getitem__(s, i): print("getitem", i, end="; "); return s.v[i]
    def __setitem__(s, i, x): print("setitem", i, x, end="; "); s.v[i] = x
    def __delitem__(s, i): print("delitem", i, end="; "); del s.v[i]
q = Seq(1, 2, 3)
print(len(q), q[0], q[-1], q[1:], q[::2]); q[0] = 9; q[1:2] = [7, 8]; del q[0]; del q[0:1]; print(q.v)
print(list(q)); print([x for x in q]); print(8 in q); print(99 in q); print(tuple(q), sum(q), max(q)); print(list(reversed(q))); a, b = q; print(a, b); print(list(zip(q, "ab"))); print(list(enumerate(q))); print(sorted(q, reverse=True)); print(bool(q), bool(Seq())); print(type(iter(q)).__name__, type(reversed(q)).__name__, [*q], {*q}, (lambda *a: a)(*q))
t(lambda: q[10]); t(lambda: q["a"])
# __getitem__-only iteration stops at IndexError.
class G:
    def __getitem__(s, i):
        if i >= 3: raise IndexError
        return i * i
print(list(G()), 4 in G(), 5 in G(), [x for x in G()], tuple(G()), sum(G()), dict(enumerate(G())), "".join(map(str, G())))
t(lambda: len(G())); t(lambda: reversed(G())); t(lambda: bool(G()) )
class GStop:
    def __getitem__(s, i):
        if i >= 2: raise StopIteration
        return i
print(list(GStop()))
class GErr:
    def __getitem__(s, i):
        if i >= 2: raise KeyError(i)
        return i
t(lambda: list(GErr())); t(lambda: 5 in GErr())
class GInf:
    def __getitem__(s, i): return i
it = iter(GInf()); print(next(it), next(it), next(it), 100 in GInf())
# __iter__ takes precedence; __contains__ over both.
class It:
    def __iter__(s): print("iter", end="; "); return iter([1, 2, 3])
    def __getitem__(s, i): raise RuntimeError("not used")
print(list(It()), 2 in It(), 9 in It(), [*It()], max(It()))
class Cont:
    def __contains__(s, v): print("contains", v, end="; "); return v == 1
    def __iter__(s): raise RuntimeError("not used")
print(1 in Cont(), 2 in Cont(), 1 not in Cont())
class ContOdd:
    def __contains__(s, v): return [] if v else "x"
print(1 in ContOdd(), 0 in ContOdd())
# What __iter__ and __next__ must be.
class BadIter1:
    def __iter__(s): return 5
class BadIter2:
    def __iter__(s): return [1]
class BadIter3:
    __iter__ = 5
class NextOnly:
    def __next__(s): return 1
class IterSelfNoNext:
    def __iter__(s): return s
t(lambda: iter(BadIter1())); t(lambda: list(BadIter2())); t(lambda: iter(BadIter3())); t(lambda: iter(NextOnly())); print(next(NextOnly())); t(lambda: iter(IterSelfNoNext())); t(lambda: [x for x in IterSelfNoNext()]); t(lambda: 1 in BadIter1())
def for_loop(o):
    for x in o: pass
t(lambda: for_loop(5)); t(lambda: for_loop(None)); t(lambda: for_loop(BadIter1())); t(lambda: for_loop(NextOnly())); t(lambda: for_loop(int)); t(lambda: for_loop(len)); t(lambda: for_loop(1.5)); t(lambda: for_loop(object()))
t(lambda: iter(5)); t(lambda: iter()); t(lambda: next(5)); t(lambda: next([1])); t(lambda: next()); t(lambda: next("a")); t(lambda: next(iter([]))); t(lambda: next(range(1))); t(lambda: iter(1, 2)); t(lambda: iter(1, 2, 3)); t(lambda: list(5)); t(lambda: tuple(None)); t(lambda: set(1.5)); t(lambda: sum(5)); t(lambda: max(5)); t(lambda: sorted(5)); t(lambda: "".join(5)); t(lambda: dict(5)); t(lambda: zip(5)); t(lambda: map(str, 5)); t(lambda: enumerate(5)); t(lambda: filter(None, 5)); t(lambda: reversed(5)); t(lambda: all(5)); t(lambda: any(None)); t(lambda: [].extend(5)); t(lambda: 1 in 5)
class Count:
    def __init__(s, n): s.n = n; s.i = 0
    def __iter__(s): return s
    def __next__(s):
        if s.i >= s.n: raise StopIteration("done", s.i)
        s.i += 1; return s.i
c = Count(3); print(list(c), list(c), next(c, "exhausted"), list(Count(0)), sum(Count(4)), 2 in Count(3), list(zip(Count(2), Count(5))), [a * b for a in Count(2) for b in Count(2)])
try: next(Count(0))
except StopIteration as e: print(e.args, e.value)
c = Count(5); print(next(c), 3 in c, list(c))
# __len__
def L(v):
    class X:
        def __len__(s): return v
    return X()
print(len(L(0)), len(L(5)), len(L(True)), len(L(2 ** 62)), bool(L(0)), bool(L(1)))
t(lambda: len(L(-1))); t(lambda: len(L(1.0))); t(lambda: len(L("a"))); t(lambda: len(L(None))); t(lambda: len(L(2 ** 63))); t(lambda: len(L(2 ** 100))); t(lambda: bool(L(-1))); t(lambda: bool(L(2 ** 100))); t(lambda: bool(L(1.5))); t(lambda: len(5)); t(lambda: len(None)); t(lambda: len()); t(lambda: len(1, 2)); t(lambda: len(int)); t(lambda: len(x for x in [])); t(lambda: len(iter([]))); t(lambda: len(lambda: 0)); t(lambda: len(1.5)); t(lambda: len(zip())); t(lambda: len(map(str, [])))
class IdxLen:
    def __len__(s):
        class I:
            def __index__(s): return 4
        return I()
print(len(IdxLen()))
# __length_hint__
class Hint:
    def __init__(s, h): s.h = h
    def __iter__(s): return iter([1, 2, 3])
    def __length_hint__(s): return s.h
print(list(Hint(0)), list(Hint(100)), list(Hint(NotImplemented)), tuple(Hint(1))); t(lambda: list(Hint(-1))); t(lambda: list(Hint("a"))); t(lambda: list(Hint(1.5)))
# __reversed__
class Rev:
    def __reversed__(s): return iter("cba")
class RevNone:
    __reversed__ = None
    def __len__(s): return 1
    def __getitem__(s, i): return i
class RevOdd:
    def __reversed__(s): return 5
print(list(reversed(Rev())), reversed(RevOdd())); t(lambda: reversed(RevNone())); t(lambda: reversed({1})); t(lambda: reversed(x for x in [])); t(lambda: reversed(iter([]))); t(lambda: reversed()); t(lambda: reversed([], 1)); print(list(reversed({1: 2, 3: 4})), list(reversed("abc")), list(reversed((1, 2))), list(reversed(range(3))), list(reversed([])), list(reversed({1: 2}.items())), list(reversed(b"ab")))
rv = reversed([1, 2, 3]); print(next(rv), rv.__length_hint__(), list(rv), next(rv, None))
l = [1, 2, 3]; rv = reversed(l); l.pop(); print(list(rv)); l = [1, 2, 3]; rv = reversed(l); next(rv); l.append(4); print(list(rv))
# Mapping-like objects.
class Map:
    def __init__(s): s.d = {}
    def __getitem__(s, k): return s.d[k]
    def __setitem__(s, k, v): s.d[k] = v
    def __delitem__(s, k): del s.d[k]
    def __contains__(s, k): return k in s.d
    def __iter__(s): return iter(s.d)
    def __len__(s): return len(s.d)
    def keys(s): return s.d.keys()
m = Map(); m["a"] = 1; m["b"] = 2; m[1, 2] = 3; print(m["a"], m[1, 2], "a" in m, len(m), list(m), dict(m), {**m}, (lambda **k: k)(**{k: v for k, v in dict(m).items() if isinstance(k, str)})); del m["a"]; print(list(m)); m["b"] += 10; print(m["b"]); t(lambda: m["zz"])
del m[1, 2]; print((lambda **k: k)(**m), "%(b)s" % m, "{b}".format_map(m), "{0[b]}".format(m))
class Missing(dict):
    def __missing__(s, k): print("missing", k, end="; "); return "default for %r" % (k,)
md = Missing(a=1); print(md["a"], md["zz"], md.get("zz"), "zz" in md, md, md[1, 2]); t(lambda: md.pop("zz"))
class MissingSet(dict):
    def __missing__(s, k): s[k] = []; return s[k]
ms = MissingSet(); ms["x"].append(1); ms["x"].append(2); ms["y"].append(3); print(ms)
class MissingRaise(dict):
    def __missing__(s, k): raise ValueError("no " + k)
t(lambda: MissingRaise()["q"])
# Item access with odd keys; augmented item assignment order.
class Tr:
    def __getitem__(s, k): print("get", k, end="; "); return 10
    def __setitem__(s, k, v): print("set", k, v, end="; ")
    def __delitem__(s, k): print("del", k, end="; ")
tr = Tr(); tr[1] += 5; tr["a", "b"] *= 2; tr[1:2] -= 1; tr[...] = 0; del tr[None]; tr[()] = 1; tr[[1]] = 2; tr[{}] = 3; print()
def k(v): print("key", v, end="; "); return v
def ob(): print("obj", end="; "); return tr
def val(v): print("val", v, end="; "); return v
ob()[k(1)] = val(2); print(); ob()[k(1)] += val(2); print(); del ob()[k(1)]; print(); x = ob()[k(1)]; print()
for obj in (1, None, 1.5, len, object(), int, lambda: 0, {1}, iter([]), (x for x in ()), ..., 1j, True, type, frozenset(), range(1).__iter__(), zip()):
    try: obj[0]
    except TypeError as e: print(e, end=" | ")
print()
for obj in (1, None, "s", (1,), b"b", len, object(), {1}, range(1), frozenset(), int, 1.5):
    try: obj[0] = 1
    except TypeError as e: print(e, end=" | ")
print()
for obj in (1, None, "s", (1,), b"b", len, object(), {1}, range(1), frozenset(), int):
    try: del obj[0]
    except TypeError as e: print(e, end=" | ")
print()
# __index__
class Ix:
    def __init__(s, v): s.v = v
    def __index__(s): return s.v
print([10, 20, 30][Ix(1)], "abc"[Ix(-1)], (1, 2, 3)[Ix(0):Ix(2)], list(range(Ix(3))), "a" * Ix(3), [0] * Ix(2), bin(Ix(5)), hex(Ix(255)), oct(Ix(8)), chr(Ix(65)), int(Ix(7)), range(10)[Ix(2)], b"abc"[Ix(1)], bytes(Ix(2)), bytearray(Ix(1)), [1, 2, 3].pop(Ix(0)), "abc".center(Ix(5), "*"), round(1.234, Ix(1)), pow(2, Ix(3)) if False else "", 1 << 2, slice(Ix(1)).indices(5), "{:{}}".format(1, 3), [1, 2, 3].index(2, Ix(0)), divmod(7, 2), float(Ix(3)), complex(Ix(2)), "%d" % Ix(4), "%x" % Ix(255), format(Ix(5), "") [:1] != "5", isinstance(Ix(1), int), (5).to_bytes(Ix(2)), int.from_bytes(b"\x01", "big"), "ab".zfill(Ix(4)), list(enumerate("a", Ix(5))))
t(lambda: [1][Ix("a")]); t(lambda: [1][Ix(1.0)]); t(lambda: [1][Ix(None)]); t(lambda: [1, 2][Ix(True)]); t(lambda: [1][Ix(2 ** 100)]); t(lambda: [1][Ix(5)]); t(lambda: "a" * Ix(2 ** 100)); t(lambda: 1 + Ix(1)); t(lambda: Ix(1) + 1); t(lambda: 1 << Ix(1)); t(lambda: Ix(1) & 1); t(lambda: range(Ix("a"))); t(lambda: [1][1.0]); t(lambda: [1]["0"]); t(lambda: [1][None]); t(lambda: [1][[0]]); t(lambda: [1][(0,)]); t(lambda: "a"[1.0]); t(lambda: (1,)[1.0]); t(lambda: b"a"[1.0]); t(lambda: range(1)[1.0]); t(lambda: [1][1j]); t(lambda: [1][1.0:2])
