def t(f):
    try:
        print(repr(f()))
    except Exception as e:
        print(type(e).__name__ + ':', e)

print(range(5), range(1, 5), range(1, 5, 2), range(5, 1, -1), range(0), range(0, 5, 1), range(-3), list(range(5)), list(range(1, 5)), list(range(1, 10, 3)), list(range(5, 0, -1)), list(range(5, 0, -2)), list(range(0)), list(range(5, 1)), list(range(1, 5, -1)), list(range(-3, 3)), list(range(-1, -5, -1)), list(range(True, 3)))
t(lambda: range())
t(lambda: range(1, 2, 3, 4))
t(lambda: range(1, 2, 0))
t(lambda: range(1.0))
t(lambda: range("a"))
t(lambda: range(1, "a"))
t(lambda: range(1, 2, 1.0))
t(lambda: range(None))
t(lambda: range(stop=1))
r = range(1, 20, 3)
print(len(r), r[0], r[-1], r[2], r.start, r.stop, r.step, r[1:3], r[::-1], r[::2], r[10:], r[:2], r[-2:], list(r[::-1]), r[1:100], r[5:1], r[::-2], r[1:-1], range(10)[2:8][1:3], range(10)[::-1][::-1], range(10)[::-1][2:5], range(0)[::-1], range(5)[5:], range(5)[-100:100:2])
t(lambda: r[7])
t(lambda: r[-8])
t(lambda: r["a"])
t(lambda: r[1.0])
t(lambda: r[::0])
t(lambda: range(0)[0])
def assign(): r[0] = 1
t(assign)
def setstart(): r.start = 1
t(setstart)
print(4 in r, 5 in r, 1 in r, 19 in r, 20 in r, 22 in r, -2 in r, 4.0 in r, 4.5 in r, "a" in r, None in r, True in r, 10 ** 30 in r, 4 not in r, 3 in range(5, 0, -1), 0 in range(5, 0, -1), 5 in range(5, 0, -1), 0 in range(0), [] in r)
print(r.index(4), r.index(19), r.count(4), r.count(5), r.count("a"), r.index(4.0), r.count(4.0), range(5, 0, -1).index(3), range(3).count(True))
t(lambda: r.index(5))
t(lambda: r.index("a"))
t(lambda: r.index(22))
t(lambda: r.index())
print(range(5) == range(5), range(5) == range(0, 5), range(5) == range(0, 5, 1), range(0) == range(1, 1), range(0) == range(5, 1), range(1, 10, 3) == range(1, 8, 3), range(1, 2, 5) == range(1, 2, 9), range(5) != range(6), range(5) == [0, 1, 2, 3, 4], range(3) == range(3.0 .__int__()), range(0, 3, 2) == range(0, 4, 2), range(2) == range(0, 2, 1))
print(hash(range(5)) == hash(range(0, 5)), hash(range(0)) == hash(range(1, 1)), hash(range(1, 10, 3)) == hash(range(1, 8, 3)), {range(3): 1}[range(0, 3)], isinstance(hash(range(3)), int))
t(lambda: range(5) < range(6))
t(lambda: range(5) + range(5))
t(lambda: range(5) * 2)
print(bool(range(0)), bool(range(1)), bool(range(5, 1)), len(range(0)), len(range(5, 1)), len(range(10 ** 6)), len(range(0, 10, 3)), len(range(10, 0, -3)), len(range(-5, 5)), sum(range(101)), max(range(5)), min(range(5)), sorted(range(3), reverse=True), list(reversed(range(5))), list(reversed(range(1, 10, 3))), list(reversed(range(5, 0, -2))), list(reversed(range(0))), tuple(range(3)), set(range(3)), list(enumerate(range(2))), list(zip(range(3), range(3, 6))), any(range(1)), all(range(1, 3)))
b = range(10 ** 20, 10 ** 20 + 10, 3)
print(b, len(b), b[0], b[-1], b[1], list(b), 10 ** 20 + 3 in b, 10 ** 20 + 4 in b, b.index(10 ** 20 + 6), b.count(10 ** 20), b[1:3], b[::-1], list(reversed(b)), b.start, b.stop, sum(b), b == range(10 ** 20, 10 ** 20 + 12, 3), max(b), type(iter(b)).__name__)
h = range(10 ** 30); print(h[10 ** 29], h[-1], 10 ** 29 in h, h[10 ** 29:10 ** 29 + 2], h[::10 ** 29], len(h[::10 ** 29]), bool(h), h.index(5), h == h, range(-(10 ** 30), 10 ** 30, 10 ** 29)[5], range(2 ** 63)[-1], range(2 ** 53, 2 ** 53 + 3)[2], list(range(2 ** 53 - 1, 2 ** 53 + 2)), list(range(2 ** 63 - 1, 2 ** 63 + 2)))
t(lambda: len(h))
t(lambda: len(range(2 ** 63)))
t(lambda: h[10 ** 30])
print(len(range(2 ** 63 - 1)), len(range(-(2 ** 62), 2 ** 62 - 1)), len(range(0, 2 ** 63, 2)))
t(lambda: len(range(-(2 ** 62), 2 ** 62)))
it = iter(range(3)); print(next(it), it.__length_hint__(), next(it), next(it), next(it, "end"), type(it).__name__, type(reversed(range(3))).__name__, it.__length_hint__())
class I:
    def __index__(self): return 3
print(range(I()), list(range(I())), range(I(), 10, I()), range(10)[I()], range(10)[I():], len(range(I())))
print(repr(range(1, 2)), str(range(3)), repr(range(0, 3, 1)), repr(range(0, 3, 2)), repr(range(-1, -3, -1)), type(range(1)), range.__mro__, sorted(n for n in dir(range) if not n.startswith("_")), range(3).__len__(), range(3).__getitem__(1), range(3).__contains__(1), range(3).__reversed__().__next__(), range(3).__eq__(range(3)), range(3).__eq__(1), range(3).__reduce__())
for i in range(3): i = 100
print(i)
x = 3
for i in range(x): x = 10
print(i, x)

print(slice(1), slice(1, 2), slice(1, 2, 3), slice(None), slice(None, None, -1), slice("a", "b"), slice(1.5), slice(1, None), slice([1], (2,)))
s = slice(1, 10, 2); print(s.start, s.stop, s.step, slice(5).start, slice(5).stop, slice(5).step, s == slice(1, 10, 2), s != slice(1), s == (1, 10, 2), slice(1) < slice(2), slice(1, 2) < slice(1, 3), slice(1, 2) <= slice(1, 2), hash(slice(1, 2)) == hash(slice(1, 2)), {slice(1): 1}[slice(1)], repr(s), str(s), type(s), bool(s))
t(lambda: slice())
t(lambda: slice(1, 2, 3, 4))
t(lambda: hash(slice([])))
t(lambda: slice(1) < 1)
t(lambda: slice(1) < slice("a"))
def setattr_slice(): s.start = 5
t(setattr_slice)
t(lambda: type("S", (slice,), {}))
for sl, n in ((slice(None), 10), (slice(2, 5), 10), (slice(-3, None), 10), (slice(None, None, -1), 10), (slice(100), 10), (slice(-100, 100), 10), (slice(5, 2), 10), (slice(5, 2, -1), 10), (slice(None, None, 3), 10), (slice(None, -100, -1), 10), (slice(100, None, -1), 10), (slice(1, 2), 0), (slice(None, None, -1), 0), (slice(-1, None, -2), 5), (slice(10 ** 30), 5), (slice(-(10 ** 30), 10 ** 30, 10 ** 30), 5), (slice(None, None, -(10 ** 30)), 5), (slice(I(), None), 10), (slice(2, 5), 10 ** 30), (slice(True, None), 3)):
    print(sl.indices(n), end=" ")
print()
t(lambda: slice(None, None, 0).indices(5))
t(lambda: slice(1.0).indices(5))
t(lambda: slice("a").indices(5))
t(lambda: slice(1).indices(-1))
t(lambda: slice(1).indices("a"))
t(lambda: slice(1).indices())
l = list(range(10))
print(l[slice(2, 5)], l[slice(None, None, -1)], l[slice(-3, None)], "hello"[slice(1, 3)], (1, 2, 3)[slice(1)], l[s], l[slice(I())], l[I():], l[:I()], l[::I()], l[None:None], l[None:None:None], l[True:], l[10 ** 30:], l[:10 ** 30], l[-(10 ** 30):], l[::10 ** 30], l[::-(10 ** 30)])
class G:
    def __getitem__(self, k): return k
    def __setitem__(self, k, v): print("set", k, v)
    def __delitem__(self, k): print("del", k)
g = G()
print(g[1], g[1:2], g[1:2:3], g[:], g[::], g[1:], g[:1], g[::2], g[1, 2], g[1:2, 3], g[..., 1], g[()], g[1,], g[:, :], g["a":"b"], g[1:2, ::3, ...], g[None], g[(1, 2)], g[[1]], g[*[1, 2]], g[*[1], 2], g[0, *(1, 2)], g[*()], g[1:2, *[3]])
g[1:2] = 3; g[1, 2] = 4; g[:] = 5; del g[1:2]; del g[::2]; del g[1, 2]; g[*[1, 2]] = 6; del g[*"ab"]
