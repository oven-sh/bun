from _collections import deque

def t(f):
    try:
        print(repr(f()))
    except BaseException as e:
        print(type(e).__name__, e)

def tn(f):
    try:
        print(repr(f()))
    except BaseException as e:
        print(type(e).__name__)

class D(deque):
    pass
d = D([1, 2, 3]); d.x = 5
print(d, type(d).__name__, d.x, d.__dict__, isinstance(d, deque), len(d))
c = d.copy(); print(c, type(c).__name__, c.__dict__)
print(type(d + deque([1])).__name__, type(deque([1]) + d).__name__, type(d * 2).__name__, d + d, d == deque([1, 2, 3]), deque([1, 2, 3]) == d)
r = d.__reduce__(); print(r[0] is D, r[1], r[2], list(r[3]))
r = D([1], 4).__reduce__(); print(r[1], r[2], list(r[3]))
r = deque([1, 2]).__reduce__(); print(r[0] is deque, r[1], r[2], list(r[3]))
class E(deque):
    def __init__(self, it=(), maxlen=None, extra=0):
        super().__init__(it, maxlen)
        self.extra = extra
e = E([1, 2], 5, extra=3); print(e, e.extra, e.copy(), e.copy().extra, e.copy().maxlen)
class F(deque):
    def __new__(cls, *a):
        return [1]
t(lambda: F())
class G(deque):
    def __iter__(self):
        return iter([7, 8])
g = G([1, 2]); print(g, list(g), g == deque([7, 8]), g == deque([1, 2]), g[0], list(reversed(g)))
class H(deque):
    __slots__ = ()
h = H([1]); t(lambda: setattr(h, "x", 1)); print(h)
class Bad(deque):
    def __call__(self): pass
class Weird(deque):
    def __init__(self, *a): pass
w = Weird([1, 2]); print(w, w.copy())
class NotDeque(deque):
    calls = 0
    def __new__(cls, *a):
        cls.calls += 1
        if cls.calls > 1:
            return 5
        return super().__new__(cls)
n = NotDeque(); t(lambda: n.copy())
print(deque.__new__(deque), deque.__new__(D), type(deque.__new__(D)).__name__)
tn(lambda: deque.__new__(int)); tn(lambda: deque.__new__()); tn(lambda: deque.__init__([]))
tn(lambda: deque.append([], 1))
print(deque.__name__, deque.__qualname__, deque.__module__, deque.__mro__, deque.__base__)
print(deque[int], deque[int].__origin__ is deque, D[str].__args__)
match deque([1, 2]):
    case [a, b]:
        print("seq", a, b)
print(sorted(k for k in deque.__dict__ if k not in ("__doc__", "__module__", "__getattribute__")))
print(deque.__doc__)
t(lambda: deque().pop(1)); t(lambda: deque().append()); t(lambda: deque().rotate(1, 2)); t(lambda: deque().rotate("a")); t(lambda: deque().rotate(2 ** 70)); t(lambda: deque().insert("a", 1)); t(lambda: deque().insert(1))
t(lambda: deque().append(item=1)); t(lambda: deque().index()); t(lambda: deque().index(1, 2, 3, 4))
class I:
    def __index__(self): return 1
d = deque("abc"); print(d[I()], d * I()); d.rotate(I()); print(d); d.insert(I(), "z"); print(d, d.index("a", I()))
# big
d = deque()
for i in range(10000):
    d.append(i); d.appendleft(-i)
print(len(d), d[0], d[-1], d[10000], sum(d))
for i in range(9990):
    d.pop(); d.popleft()
print(d)
d = deque(range(100000)); d.rotate(12345); print(d[0], d[-1], d[50000]); d.rotate(-12345); print(d[0], d[-1], list(d) == list(range(100000)))
del d[50000]; print(len(d), d[49999], d[50000]); d.insert(50000, "x"); print(d[49999], d[50000], d[50001], len(d))
