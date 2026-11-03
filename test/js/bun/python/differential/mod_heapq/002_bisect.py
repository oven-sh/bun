import _bisect as b

def t(f):
    try:
        print(repr(f()))
    except BaseException as e:
        print(type(e).__name__, e)

a = [1, 2, 2, 2, 3, 5, 8]
for x in (0, 1, 2, 2.5, 3, 4, 8, 9):
    print(x, b.bisect_left(a, x), b.bisect_right(a, x), b.bisect_left(a, x, 2), b.bisect_right(a, x, 2, 5), b.bisect_left(a, x, lo=1, hi=3), b.bisect_right(a, x, hi=None))
print(b.bisect_left([], 1), b.bisect_right([], 1), b.bisect_left(a, 2, 5, 2), b.bisect_left(a, 2, 100), b.bisect_left(a, 2, 0, -1), b.bisect_right(a, 2, 0, -1))
print(b.bisect_left((1, 2, 3), 2), b.bisect_left("abc", "b"), b.bisect_left(range(100), 50), b.bisect_right(range(0, 100, 2), 50))
words = ["a", "bb", "ccc", "dddd"]
print(b.bisect_left(words, 3, key=len), b.bisect_right(words, 3, key=len), b.bisect_left(words, 3, key=None) if False else "-")
l = [1, 3, 5]; b.insort_left(l, 3); b.insort_right(l, 4); b.insort_right(l, 0); b.insort_left(l, 9); print(l)
l = ["a", "ccc"]; b.insort_left(l, "bb", key=len); b.insort_right(l, "dd", key=len); b.insort_left(l, "ee", key=len); print(l)
l = [1, 2, 3]; b.insort_left(l, 0, 2); print(l); b.insort_right(l, 10, 0, 1); print(l)
t(lambda: b.bisect_left(a, 1, -1)); t(lambda: b.bisect_right(a, 1, -1)); t(lambda: b.insort_left(a[:], 1, -1)); t(lambda: b.insort_right(a[:], 1, lo=-5))
t(lambda: b.bisect_left(1, 1)); t(lambda: b.bisect_left({}, 1)); t(lambda: b.bisect_left({1: 2}, 1)); t(lambda: b.bisect_left({1, 2}, 1)); t(lambda: b.bisect_left(None, 1, 0, 5)); t(lambda: b.bisect_left({1: 1}, 1, 0, 5))
t(lambda: b.bisect_left(a, 1, "a")); t(lambda: b.bisect_left(a, 1, 0, "a")); t(lambda: b.bisect_left(a, 1, None)); t(lambda: b.bisect_left(a, 1, 1.0)); t(lambda: b.bisect_left(a, 1, 0, 1.0))
t(lambda: b.bisect_left(a)); t(lambda: b.bisect_left()); t(lambda: b.bisect_left(a, 1, 0, 1, len)); t(lambda: b.bisect_left(a, 1, foo=1)); t(lambda: b.bisect_left(a, x=1, a=2))
t(lambda: b.bisect_left(a, 1, 0, 100)); t(lambda: b.bisect_left(a, "x")); t(lambda: b.bisect_left(a, 1, key=1)); t(lambda: b.bisect_left(a, 1, 2 ** 70)); t(lambda: b.bisect_left(a, 1, 0, 2 ** 70))
t(lambda: b.insort_left((1, 2), 1)); t(lambda: b.insort_right("abc", "b"))
class Seq:
    def __init__(self, d): self.d = d
    def __len__(self): return len(self.d)
    def __getitem__(self, i): print("get", i); return self.d[i]
    def insert(self, i, x): print("insert", i, x); self.d.insert(i, x)
s = Seq([1, 2, 3, 4, 5]); print(b.bisect_left(s, 3), b.bisect_right(s, 3)); b.insort_left(s, 3); b.insort_right(s, 3); print(s.d)
class L(list):
    def insert(self, i, x): print("L.insert", i, x); super().insert(i, x)
l = L([1, 2]); b.insort_left(l, 2); print(l)
class Cmp:
    def __init__(self, v): self.v = v
    def __lt__(self, o): print("lt", self.v, o.v); return self.v < o.v
c = [Cmp(1), Cmp(2), Cmp(3)]; print(b.bisect_left(c, Cmp(2)), b.bisect_right(c, Cmp(2)))
class NoLt:
    pass
t(lambda: b.bisect_left([NoLt()], NoLt()))
class I:
    def __index__(self): return 1
print(b.bisect_left(a, 0, I()), b.bisect_left(a, 100, 0, I()))
print(sorted(n for n in dir(b) if not n.startswith("__")), b.bisect_left.__name__, b.bisect_left.__module__)
