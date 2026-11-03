# Globals, builtins, cells, argument binding, recursion.
import builtins, sys, types
out = []
def rec(label, f, *a, **k):
    try:
        r = repr(f(*a, **k))
    except BaseException as e:
        r = type(e).__name__ + ":" + str(e)
    out.append("%s -> %s" % (label, r))

G = 1
def readG(): return G
def readlen(): return len
def readmissing(): return missing_name
def hot(f, n=5):
    r = None
    for _ in range(n): r = f()
    return r
rec("g1", hot, readG)
G = 2
rec("g2", hot, readG)
globals()["G"] = 3
rec("g3", hot, readG)
del G
rec("g4", hot, readG)
G = 4
rec("g5", hot, readG)
for i in range(40): globals()["filler%d" % i] = i      # makes the table grow
rec("g6", hot, readG)
for i in range(40): del globals()["filler%d" % i]
rec("g7", hot, readG)
rec("len1", lambda: hot(readlen) is builtins.len)
len = "shadow"
rec("len2", hot, readlen)
del len
rec("len3", lambda: hot(readlen) is builtins.len)
builtins.len, saved = "patched", builtins.len
rec("len4", hot, readlen)
builtins.len = saved
rec("len5", lambda: hot(readlen) is saved)
rec("m1", hot, readmissing)
builtins.missing_name = "in builtins"
rec("m2", hot, readmissing)
missing_name = "in globals"
rec("m3", hot, readmissing)
del missing_name
rec("m4", hot, readmissing)
del builtins.missing_name
rec("m5", hot, readmissing)

# One code object, several dicts of globals.
code = readG.__code__
fs = [types.FunctionType(code, {"G": i, "__builtins__": builtins}) for i in range(4)]
rec("multi", lambda: [f() for f in fs * 3])
fs[1].__globals__["G"] = "changed"
del fs[2].__globals__["G"]
rec("multi2", lambda: [f() for f in (fs[0], fs[1], fs[3]) * 2])
rec("multi3", fs[2])
f5 = types.FunctionType(code, {"__builtins__": {"G": "from custom builtins"}})
rec("custom builtins", hot, f5)
f5.__globals__["__builtins__"]["G"] = "changed in custom builtins"
rec("custom builtins 2", hot, f5)
f6 = types.FunctionType(code, {})
rec("no G", hot, f6)
class D(dict):
    def __getitem__(self, k): return "D.__getitem__"
    def __missing__(self, k): return "D.__missing__"
rec("dict subclass", lambda: eval("G", D()))
rec("dict subclass fn", lambda: types.FunctionType(code, D(G=5))())
ns = {}
exec("def f():\n    return X\ndef g(v):\n    global X\n    X = v\ndef h():\n    global X\n    del X\n", ns)
rec("x0", ns["f"])
for v in (1, "two", 3.0, None, [4]):
    ns["g"](v); rec("x", hot, ns["f"])
ns["h"](); rec("x del", ns["f"]); rec("x del2", ns["h"])
ns["g"](9); rec("x again", hot, ns["f"])
ns.clear(); 
def counter():
    global C
    C = 0
    for i in range(1000): C += i
    return C
rec("counter", counter); rec("C", lambda: C)
def store_many():
    global S0, S1, S2
    for i in range(3):
        S0 = i; S1 = [i]; S2 = float(i)
    return S0, S1, S2
rec("store_many", store_many); rec("store_many", store_many)

# Cells
def cells():
    x = 1
    def get(): return x
    def put(v):
        nonlocal x
        x = v
    def rem():
        nonlocal x
        del x
    return get, put, rem
g, p, r = cells()
rec("c1", g); p([2]); rec("c2", g); p(2.0); rec("c3", g); r(); rec("c4", g); rec("c5", r); p(None); rec("c6", g)
def late():
    def get(): return y
    try:
        get()
    except NameError as e:
        first = str(e)
    y = 5
    return first, get()
rec("late", late)
def loopcells():
    fs = []
    for i in range(3):
        fs.append(lambda: i)
    return [f() for f in fs]
rec("loopcells", loopcells)
def acc(n):
    t = 0
    def add(k):
        nonlocal t
        t += k
    for i in range(n): add(i)
    return t
rec("acc", acc, 100000)
def classcell():
    class A:
        def f(self): return __class__
    return A().f().__name__
rec("classcell", classcell)

# Binding
def f0(): return "f0"
def f1(a): return a
def f2(a, b): return a, b
def f3(a, b=2, c=3): return a, b, c
def fp(a, b, /): return a, b
def fk(a, *, b): return a, b
def fv(a, *r): return a, r
def fw(a, **k): return a, k
def fall(a, b=1, *r, c=2, **k): return a, b, r, c, k
for f in [f0, f1, f2, f3, fp, fk, fv, fw, fall]:
    for args, kw in [((), {}), ((1,), {}), ((1, 2), {}), ((1, 2, 3), {}), ((1, 2, 3, 4), {}), ((), {"a": 1}), ((1,), {"b": 2}), ((), {"a": 1, "b": 2}), ((1,), {"a": 2}), ((1, 2), {"z": 3}), ((1,), {"c": 5})]:
        rec("%s %r %r" % (f.__name__, args, kw), f, *args, **kw)
rec("direct", lambda: (f0(), f1(1), f2(1, 2), f2(1, b=2), f2(b=1, a=2), f2(*(1, 2)), f2(**{"a": 1, "b": 2}), f3(1), f3(1, c=9), fp(1, 2)))
rec("it as last", lambda: f2(1, iter([1]))[0]); rec("it as only", lambda: type(f1(iter([1]))).__name__); rec("range it", lambda: list(f1(iter(range(3)))))
class M:
    def m0(self): return "m0"
    def m1(self, a): return a
    @staticmethod
    def s1(a): return a
    @classmethod
    def c1(cls, a): return cls.__name__, a
o = M()
rec("methods", lambda: (o.m0(), o.m1(1), M.m1(o, 2), o.s1(3), o.c1(4), M.c1(5)))
rec("m bad", lambda: o.m0(1)); rec("m bad2", lambda: o.m1()); rec("m bad3", lambda: M.m1())
b = o.m1
rec("bound", lambda: [b(i) for i in range(3)])
rec("map", lambda: list(map(f1, [1, 2.0, "x"]))); rec("map2", lambda: list(map(f2, [1, 2], [3, 4]))); rec("sorted key", lambda: sorted([3, 1, 2], key=f1)); rec("filter", lambda: list(filter(f1, [0, 1, 2])))
rec("float result", lambda: (f1(2.0), type(f1(2.0)).__name__, list(map(f1, [1.0]))))

# Recursion
def depth(n): return 0 if n == 0 else 1 + depth(n - 1)
sys.setrecursionlimit(200)
rec("depth 100", depth, 100); rec("depth 300", depth, 300); rec("depth 100 again", depth, 100)
def find():
    lo = 0
    try:
        def go(n):
            nonlocal lo
            lo = n
            go(n + 1)
        go(1)
    except RecursionError:
        return lo
a = find(); bb = find()
rec("limit is stable", lambda: a == bb)
sys.setrecursionlimit(1000)
rec("depth 900", depth, 900)
def mutual_a(n): return n if n <= 0 else mutual_b(n - 1)
def mutual_b(n): return mutual_a(n - 1)
rec("mutual", mutual_a, 500)
def gen_depth(n):
    if n: yield from gen_depth(n - 1)
    yield n
rec("gen_depth", lambda: sum(gen_depth(100)))
def raises(n):
    if n == 0: raise KeyError("deep")
    return raises(n - 1)
for _ in range(3): rec("raises", raises, 50)
rec("depth after raises", depth, 900)
import hashlib
print(len(out), hashlib.md5("\n".join(out).encode()).hexdigest())
if len(sys.argv) > 1:
    print("\n".join(out))
