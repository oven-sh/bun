def t(f):
    try:
        print(repr(f()))
    except Exception as e:
        print(type(e).__name__ + ':', e)

p = (1, 2, 3, 4, 5)
print(p, len(p), p[0], p[-1], p[1:3], p[::-1], p[::2], p[10:], p[:], p[-2:], type(p[1:2]), p[:] is p or True, p[4:1:-2])
t(lambda: p[5])
t(lambda: p[-6])
t(lambda: p["a"])
t(lambda: p[1.0])
t(lambda: ()[0])
t(lambda: p[::0])
def assign(): p[0] = 1
def delete(): del p[0]
def sassign(): p[0:1] = (1,)
def sdelete(): del p[0:1]
t(assign); t(delete); t(sassign); t(sdelete)
print((), (1,), (1, 2), ((),), ((1,),), (1, (2, (3,))), 1, (1), (1,)[0], tuple(), tuple([1, 2]), tuple("ab"), tuple(range(3)), tuple({1: 2}), tuple((1, 2)), tuple(x for x in [1]), tuple(iter([2])), tuple(b"a"), tuple({3}))
x = 1, 2; y = 1,; z = (); w = (1, 2, 3,)
print(x, y, z, w, type(x), type(y), len(y))
t(lambda: tuple(1))
t(lambda: tuple(None))
t(lambda: tuple(1, 2))
t(lambda: tuple(sequence=[1]))
print((1,) + (2,), (1, 2) * 2, 2 * (1, 2), (1,) * 0, (1,) * -1, () + (), () * 5, (1,) + () + (2,), ((),) * 2)
t(lambda: (1,) + [2])
t(lambda: (1,) + 1)
t(lambda: (1,) * "a")
t(lambda: (1,) * 1.5)
t(lambda: (1,) - (1,))
t(lambda: (1,) + "a")
print(1 in (1, 2), 3 in (1, 2), (1,) in ((1,),), None in (None,), 1 not in (), 1.0 in (1,))
print((1, 2) == (1, 2), (1, 2) != (1, 2), (1, 2) < (1, 3), (1, 2) < (1, 2, 0), (2,) > (1, 9), () < (0,), (1,) <= (1,), (1,) == [1], (1,) == (1.0,), ((1, 2), 3) == ((1, 2), 3), ("a", 1) < ("b", 0), (1, "a") < (2, None), () == ())
t(lambda: (1,) < (None,))
t(lambda: (1,) < ("a",))
t(lambda: (1,) < [1])
t(lambda: (1,) < 1)
print(hash(()) == hash(()), hash((1, 2)) == hash((1, 2)), hash((1,)) != hash((2,)), hash((1, 2)) == hash((1.0, 2.0)), {(1, 2): "a"}[(1, 2)], {(): 0}[()], (1, 2) in {(1, 2)}, {(1, (2, 3)): 1}[1, (2, 3)])
print(hash(()), hash((1,)), hash((1, 2)), hash((1, 2, 3)), hash((0,)), hash((-1,)), hash(((),)), hash((1, (2, 3))), hash((10 ** 20,)), hash((1.5,)), hash((True, False)), hash(tuple(range(20))), hash((None,)) == hash((None,)))
t(lambda: hash(([],)))
t(lambda: {([],): 1})
t(lambda: hash((1, {})))
print(p.count(1), p.count(9), (1, 1, 1.0, True).count(1), ().count(1), p.index(3), p.index(3, 1), p.index(3, -4), p.index(5, 2, 5), (1, 2, 1).index(1, 1))
t(lambda: p.index(9))
t(lambda: p.index(1, 1))
t(lambda: p.index())
t(lambda: p.count())
t(lambda: p.append(1))
t(lambda: p.sort())
t(lambda: p.nope)
a = ([1], 2); a[0].append(9); print(a)
def iadd_in_tuple():
    a = ([1], 2)
    try:
        a[0] += [5]
    except TypeError as e:
        print("TypeError:", e)
    return a
print(iadd_in_tuple())
q = r = (1,); q += (2,); print(q, r, q is r)
q *= 2; print(q)
def iadd_bad():
    s = (1,); s += [2]
t(iadd_bad)
print(str(()), repr((1,)), str((1, "a", None)), str(((),)), repr(("a'b",)), str((1.0, 1j, b"x")), "%s" % ((1,),), "{}".format((1, 2)), f"{(1,)}")
print(sum((1, 2, 3)), max((1, 3, 2)), min((1, 3, 2)), sorted((3, 1, 2)), tuple(reversed((1, 2, 3))), any((0, 1)), all((0, 1)), list(enumerate(("a",))), tuple(sorted((2, 1))), tuple(map(str, (1, 2))), len(()), bool(()), bool((0,)), bool(((),)), sum(((1,), (2,)), ()))
a, b = (1, 2); print(a, b); (a, b) = (b, a); print(a, b); a, (b, c) = 1, (2, 3); print(a, b, c); [a, b] = (5, 6); print(a, b); a, = (7,); print(a); (a,) = [8]; print(a); a, b, c = "xyz"; print(a, b, c)
for i, (k, v) in enumerate((("a", 1), ("b", 2))): print(i, k, v, end="; ")
print()
def ret(): return 1, "a", [2]
print(ret(), type(ret()), ret()[2], len(ret()))
print((1, 2).__len__(), (1, 2).__getitem__(0), (1, 2).__getitem__(slice(0, 1)), (1, 2).__contains__(1), (1,).__add__((2,)), (1,).__mul__(2), (1,).__rmul__(2), (1,).__eq__((1,)), (1,).__eq__([1]), (1,).__lt__((2,)), (1,).__ne__((1,)), (1,).__repr__(), (1,).__hash__() == hash((1,)), (1, 2).__getnewargs__(), (1,).__add__([2]) if False else "", (1,).__ge__(1))
print(type(()), tuple.__mro__, isinstance((), tuple), tuple.__name__, type(iter(())).__name__, sorted(n for n in dir(tuple) if not n.startswith("_")))
it = iter((1, 2)); print(next(it), next(it), next(it, "done"), it.__length_hint__())
n = ((1, 2), (3, 4)); print(n[0][1], n[1], [v for r in n for v in r], tuple(zip(*n)), dict(n), n[-1][-1])
big = tuple(range(100000)); print(len(big), big[-1], sum(big), big[500:503], big.index(99999), big.count(0), len(big + big), hash(big) == hash(tuple(range(100000))), big == tuple(range(100000)), big < big + (0,))
class T(tuple):
    def first(self): return self[0]
s = T((1, 2, 3))
print(s, s.first(), type(s), type(s[:2]), type(s + (4,)), type(s * 2), len(s), s == (1, 2, 3), hash(s) == hash((1, 2, 3)), isinstance(s, tuple), list(s), tuple(s), type(tuple(s)), repr(s), {s: 1}[(1, 2, 3)], T(), T("ab"), s.count(1), s.index(2), 2 in s, sorted(s, reverse=True))
class T2(tuple):
    def __new__(cls, a, b): return super().__new__(cls, (a, b))
    def __repr__(self): return "T2(%r, %r)" % self
    x = property(lambda self: self[0])
v = T2(1, 2); print(v, v.x, v[1], len(v), tuple(v), v + v, [v], (v,), "%s" % (v,), a := v == (1, 2))
v.extra = 5; print(v.extra, v.__dict__)
t(lambda: T2(1))
t(lambda: tuple.__new__(T2, 5))
t(lambda: tuple.__new__(int))
t(lambda: tuple.__new__(list))
