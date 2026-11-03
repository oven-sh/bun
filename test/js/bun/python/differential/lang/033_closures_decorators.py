def t(f):
    try:
        print(repr(f()))
    except Exception as e:
        print(type(e).__name__ + ':', e)

def deco(fn):
    def wrapper(*a, **k):
        print("before", fn.__name__, end="; ")
        r = fn(*a, **k)
        print("after", end="; ")
        return r
    return wrapper
@deco
def add(a, b): return a + b
print(add(1, 2), add.__name__)
def param(n):
    print("param", n, end="; ")
    def d(fn):
        print("deco", n, end="; ")
        def w(*a): return fn(*a) * n
        return w
    return d
@param(2)
@param(3)
def one(): return 1
print(one())
@lambda f: f()
def called(): return "called at definition"
print(called)
@(lambda f: print('deco got', f.__name__))
def printed(): pass
print(printed)
reg = []
def register(f): reg.append(f.__name__); return f
@register
def r1(): pass
@register
def r2(): pass
print(reg, r1.__name__)
ds = {"a": lambda f: "from dict"}
@ds["a"]
def viadict(): pass
print(viadict)
class NS:
    @staticmethod
    def d(f): return "from attr"
@NS.d
def viaattr(): pass
print(viaattr)
@(lambda f: f) if True else None
def cond(): return "cond"
print(cond())
@[lambda f: "list"][0]
def sub(): pass
print(sub)
@(x := lambda f: "walrus")
def wal(): pass
print(wal, x(0))
def order(tag):
    print("eval", tag, end="; ")
    def d(f): print("apply", tag, end="; "); return f
    return d
@order(1)
@order(2)
@order(3)
def o(a=print("default", end="; ")): pass
print()
def cls_deco(c): c.added = 1; return c
@cls_deco
class C: pass
print(C.added)
@lambda c: c()
class Inst:
    def __repr__(self): return "instance of Inst"
print(Inst)
class CountCalls:
    def __init__(self, f): self.f = f; self.n = 0
    def __call__(self, *a): self.n += 1; return self.f(*a)
@CountCalls
def sq(x): return x * x
print(sq(2), sq(3), sq.n, type(sq).__name__)
class K:
    @deco
    def m(self): return "m"
    @staticmethod
    @deco
    def s(): return "s"
    @classmethod
    @deco
    def c(cls): return cls.__name__
    @property
    @deco
    def p(self): return "p"
print(K().m(), K.s(), K.c(), K().p)
def memo(f):
    cache = {}
    def w(n):
        if n not in cache: cache[n] = f(n)
        return cache[n]
    w.cache = cache
    return w
@memo
def fib(n): return n if n < 2 else fib(n - 1) + fib(n - 2)
print(fib(80), len(fib.cache))
t(lambda: exec("@1\ndef f(): pass"))
t(lambda: exec("@None\ndef f(): pass"))
t(lambda: exec("@undefined\ndef f(): pass"))
t(lambda: exec("@(lambda: 0)\ndef f(): pass"))
for src in ("@\ndef f(): pass", "@a\n", "@a\nx = 1", "@a def f(): pass", "@a\n@b\n", "@a;\ndef f(): pass", "@a\n\ndef f(): pass", "@a # c\ndef f(): pass", "@a\nasync def f(): pass", "@a\nclass C: pass", "@a = 1\ndef f(): pass", "@yield\ndef f(): pass", "@*a\ndef f(): pass", "@a, b\ndef f(): pass", "@a\nlambda: 1", "@a b\ndef f(): pass", "@a.b.c(1)[2](3)\ndef f(): pass", "@not a\ndef f(): pass", "@a if b else c\ndef f(): pass", "@a := b\ndef f(): pass", "@lambda f: f\ndef f(): pass", "@await a\ndef f(): pass"):
    try:
        compile(src, "<s>", "exec"); print("ok:", src.replace("\n", "\\n"))
    except SyntaxError as e:
        print("SyntaxError:", e.msg)
# Closures.
def acc():
    total = []
    def add(x): total.append(x); return sum(total)
    return add
a = acc(); print(a(1), a(2), a(3), acc()(10))
def shared():
    v = 0
    def get(): return v
    def set_(x):
        nonlocal v; v = x
    def inc():
        nonlocal v; v += 1; return v
    return get, set_, inc
g, s, i = shared(); s(5); print(g(), i(), i(), g()); g2, s2, i2 = shared(); print(g2(), g())
def late():
    fs = []
    for n in range(3):
        def f(): return n
        fs.append(f)
    n = "changed"
    return [f() for f in fs]
print(late())
def param_cell(p):
    def get(): return p
    p = p + 1
    return get
print(param_cell(1)())
def default_captures(p):
    def get(q=p): return q
    p = "changed"
    return get
print(default_captures("orig")())
def rec():
    def fact(n): return 1 if n < 2 else n * fact(n - 1)
    return fact
print(rec()(10))
def cell_in_loop():
    out = []
    for k in range(3):
        v = k * 10
        out.append((lambda: v, lambda v=v: v))
    return [(a(), b()) for a, b in out]
print(cell_in_loop())
def try_cell():
    try:
        raise ValueError("boom")
    except ValueError as e:
        f = lambda: e
        g = str(e)
    try:
        return f()
    except NameError as ne:
        return "NameError: " + str(ne), g
print(try_cell())
def with_cell():
    class CM:
        def __enter__(s): return "entered"
        def __exit__(s, *a): return False
    with CM() as w:
        f = lambda: w
    return f()
print(with_cell())
def star_cells(*args, **kw):
    return lambda: (args, kw)
print(star_cells(1, 2, a=3)())
def kwonly_cell(*, k=1):
    def f(): return k
    k += 1
    return f
print(kwonly_cell()(), kwonly_cell(k=10)())
def class_cell():
    v = "v"
    class A:
        def m(self): return v
        w = v
    v = "changed"
    return A().m(), A.w
print(class_cell())
def gen_cell():
    n = 0
    def g():
        nonlocal n
        while n < 3:
            n += 1; yield n
    return g, lambda: n
gg, gn = gen_cell(); it = gg(); print(next(it), gn(), next(it), gn(), list(it), gn())
def nonlocal_del():
    v = 1
    def d():
        nonlocal v; del v
    def r(): return v
    d()
    try: return r()
    except NameError as e: return str(e)
print(nonlocal_del())
def comp_cell():
    k = 2
    return [(lambda: k * x)() for x in range(3)], [f() for f in [lambda: k * x for x in range(3)]]
print(comp_cell())
def deep():
    a = 1
    def l1():
        b = 2
        def l2():
            c = 3
            def l3():
                d = 4
                def l4(): return a + b + c + d
                return l4
            return l3
        return l2
    return l1
print(deep()()()()(), deep()()()().__code__.co_freevars, deep()().__code__.co_freevars, deep()().__code__.co_cellvars)
def same_name():
    x = "outer"
    def mid():
        x = "mid"
        def inner(): return x
        return inner()
    return mid(), x
print(same_name())
def global_in_nested():
    gv = "local"
    def inner():
        global gv
        gv = "set by inner"
    inner()
    return gv
print(global_in_nested(), gv)
counter = (lambda: (lambda c: lambda: c.__setitem__(0, c[0] + 1) or c[0])([0]))()
print(counter(), counter(), counter())
Y = lambda f: (lambda x: x(x))(lambda x: f(lambda *a: x(x)(*a)))
print(Y(lambda f: lambda n: 1 if n == 0 else n * f(n - 1))(6))
compose = lambda *fs: (lambda x: x) if not fs else (lambda x: fs[0](compose(*fs[1:])(x)))
print(compose(lambda x: x + 1, lambda x: x * 2, lambda x: x - 3)(10))
curry = lambda a: lambda b: lambda c: (a, b, c)
print(curry(1)(2)(3))
