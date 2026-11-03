try:
    def t(f):
        try:
            print(repr(f()))
        except Exception as e:
            print(type(e).__name__ + ':', e)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def t(f):')

try:
    def deco(fn):
        def wrapper(*a, **k):
            print("before", fn.__name__, end="; ")
            r = fn(*a, **k)
            print("after", end="; ")
            return r
        return wrapper
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def deco(fn):')
try:
    @deco
    def add(a, b): return a + b
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def add(a, b): return a + b')
try: print('add(1, 2) =>', add(1, 2))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: add(1, 2)')
try: print('add.__name__ =>', add.__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: add.__name__')
try:
    def param(n):
        print("param", n, end="; ")
        def d(fn):
            print("deco", n, end="; ")
            def w(*a): return fn(*a) * n
            return w
        return d
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def param(n):')
try:
    @param(2)
    @param(3)
    def one(): return 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def one(): return 1')
try: print(one())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: one()')
try:
    @lambda f: f()
    def called(): return "called at definition"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def called(): return "called at definition"')
try: print(called)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: called')
try:
    @(lambda f: print('deco got', f.__name__))
    def printed(): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def printed(): pass')
try: print(printed)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: printed')
try: reg = []
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: reg = []')
try:
    def register(f): reg.append(f.__name__); return f
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def register(f): reg.append(f.__name__); return f')
try:
    @register
    def r1(): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def r1(): pass')
try:
    @register
    def r2(): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def r2(): pass')
try: print('reg =>', reg)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: reg')
try: print('r1.__name__ =>', r1.__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: r1.__name__')
try: ds = {"a": lambda f: "from dict"}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ds = {"a": lambda f: "from dict"}')
try:
    @ds["a"]
    def viadict(): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def viadict(): pass')
try: print(viadict)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: viadict')
try:
    class NS:
        @staticmethod
        def d(f): return "from attr"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class NS:')
try:
    @NS.d
    def viaattr(): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def viaattr(): pass')
try: print(viaattr)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: viaattr')
try:
    @(lambda f: f) if True else None
    def cond(): return "cond"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def cond(): return "cond"')
try: print(cond())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: cond()')
try:
    @[lambda f: "list"][0]
    def sub(): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def sub(): pass')
try: print(sub)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sub')
try:
    @(x := lambda f: "walrus")
    def wal(): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def wal(): pass')
try: print('wal =>', wal)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: wal')
try: print('x(0) =>', x(0))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: x(0)')
try:
    def order(tag):
        print("eval", tag, end="; ")
        def d(f): print("apply", tag, end="; "); return f
        return d
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def order(tag):')
try:
    @order(1)
    @order(2)
    @order(3)
    def o(a=print("default", end="; ")): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def o(a=print("default", end="; ")): pass')
try: print()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: print()')
try:
    def cls_deco(c): c.added = 1; return c
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def cls_deco(c): c.added = 1; return c')
try:
    @cls_deco
    class C: pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class C: pass')
try: print(C.added)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: C.added')
try:
    @lambda c: c()
    class Inst:
        def __repr__(self): return "instance of Inst"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Inst:')
try: print(Inst)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Inst')
try:
    class CountCalls:
        def __init__(self, f): self.f = f; self.n = 0
        def __call__(self, *a): self.n += 1; return self.f(*a)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class CountCalls:')
try:
    @CountCalls
    def sq(x): return x * x
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def sq(x): return x * x')
try: print('sq(2) =>', sq(2))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sq(2)')
try: print('sq(3) =>', sq(3))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sq(3)')
try: print('sq.n =>', sq.n)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sq.n')
try: print('type(sq).__name__ =>', type(sq).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(sq).__name__')
try:
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
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class K:')
try: print('K().m() =>', K().m())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: K().m()')
try: print('K.s() =>', K.s())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: K.s()')
try: print('K.c() =>', K.c())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: K.c()')
try: print('K().p =>', K().p)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: K().p')
try:
    def memo(f):
        cache = {}
        def w(n):
            if n not in cache: cache[n] = f(n)
            return cache[n]
        w.cache = cache
        return w
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def memo(f):')
try:
    @memo
    def fib(n): return n if n < 2 else fib(n - 1) + fib(n - 2)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def fib(n): return n if n < 2 else fib(n - 1) + fib(n - 2)')
try: print('fib(80) =>', fib(80))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: fib(80)')
try: print('len(fib.cache) =>', len(fib.cache))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: len(fib.cache)')
try: print('exec("@1\\ndef f(): pass") =>', end=" "); t(lambda: exec("@1\ndef f(): pass"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: exec("@1\\ndef f(): pass"))')
try: print('exec("@None\\ndef f(): pass") =>', end=" "); t(lambda: exec("@None\ndef f(): pass"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: exec("@None\\ndef f(): pass"))')
try: print('exec("@undefined\\ndef f(): pass") =>', end=" "); t(lambda: exec("@undefined\ndef f(): pass"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: exec("@undefined\\ndef f(): pass"))')
try: print('exec("@(lambda: 0)\\ndef f(): pass") =>', end=" "); t(lambda: exec("@(lambda: 0)\ndef f(): pass"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: exec("@(lambda: 0)\\ndef f(): pass"))')
try:
    for src in ("@\ndef f(): pass", "@a\n", "@a\nx = 1", "@a def f(): pass", "@a\n@b\n", "@a;\ndef f(): pass", "@a\n\ndef f(): pass", "@a # c\ndef f(): pass", "@a\nasync def f(): pass", "@a\nclass C: pass", "@a = 1\ndef f(): pass", "@yield\ndef f(): pass", "@*a\ndef f(): pass", "@a, b\ndef f(): pass", "@a\nlambda: 1", "@a b\ndef f(): pass", "@a.b.c(1)[2](3)\ndef f(): pass", "@not a\ndef f(): pass", "@a if b else c\ndef f(): pass", "@a := b\ndef f(): pass", "@lambda f: f\ndef f(): pass", "@await a\ndef f(): pass"):
        try:
            compile(src, "<s>", "exec")
            print("ok:", 'src.replace("\\n", "\\\\n") [' + 'src=' + (repr(src) if type(src) in (str, int, float, bytes, bool, type(None)) or (type(src) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in src)) else src.__name__ if type(src) is type else type(src).__name__) + '] =>', src.replace("\n", "\\n"))
        except SyntaxError as e:
            print("SyntaxError:", 'e.msg [' + 'src=' + (repr(src) if type(src) in (str, int, float, bytes, bool, type(None)) or (type(src) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in src)) else src.__name__ if type(src) is type else type(src).__name__) + '] =>', e.msg)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for src in ("@\\ndef f(): pass", "@a\\n", "@a\\nx = 1", "@a def f(): pas...')
# Closures.
try:
    def acc():
        total = []
        def add(x): total.append(x); return sum(total)
        return add
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def acc():')
try: a = acc()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a = acc()')
try: print('a(1) =>', a(1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a(1)')
try: print('a(2) =>', a(2))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a(2)')
try: print('a(3) =>', a(3))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a(3)')
try: print('acc()(10) =>', acc()(10))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: acc()(10)')
try:
    def shared():
        v = 0
        def get(): return v
        def set_(x):
            nonlocal v; v = x
        def inc():
            nonlocal v; v += 1; return v
        return get, set_, inc
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def shared():')
try: g, s, i = shared()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g, s, i = shared()')
try: s(5)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: s(5)')
try: print('g() =>', g())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g()')
try: print('i() =>', i())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: i()')
try: print('i() =>', i())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: i()')
try: print('g() =>', g())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g()')
try: g2, s2, i2 = shared()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g2, s2, i2 = shared()')
try: print('g2() =>', g2())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g2()')
try: print('g() =>', g())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g()')
try:
    def late():
        fs = []
        for n in range(3):
            def f(): return n
            fs.append(f)
        n = "changed"
        return [f() for f in fs]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def late():')
try: print(late())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: late()')
try:
    def param_cell(p):
        def get(): return p
        p = p + 1
        return get
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def param_cell(p):')
try: print(param_cell(1)())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: param_cell(1)()')
try:
    def default_captures(p):
        def get(q=p): return q
        p = "changed"
        return get
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def default_captures(p):')
try: print(default_captures("orig")())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: default_captures("orig")()')
try:
    def rec():
        def fact(n): return 1 if n < 2 else n * fact(n - 1)
        return fact
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def rec():')
try: print(rec()(10))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: rec()(10)')
try:
    def cell_in_loop():
        out = []
        for k in range(3):
            v = k * 10
            out.append((lambda: v, lambda v=v: v))
        return [(a(), b()) for a, b in out]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def cell_in_loop():')
try: print(cell_in_loop())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: cell_in_loop()')
try:
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
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def try_cell():')
try: print(try_cell())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try_cell()')
try:
    def with_cell():
        class CM:
            def __enter__(s): return "entered"
            def __exit__(s, *a): return False
        with CM() as w:
            f = lambda: w
        return f()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def with_cell():')
try: print(with_cell())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: with_cell()')
try:
    def star_cells(*args, **kw):
        return lambda: (args, kw)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def star_cells(*args, **kw):')
try: print(star_cells(1, 2, a=3)())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: star_cells(1, 2, a=3)()')
try:
    def kwonly_cell(*, k=1):
        def f(): return k
        k += 1
        return f
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def kwonly_cell(*, k=1):')
try: print('kwonly_cell()() =>', kwonly_cell()())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: kwonly_cell()()')
try: print('kwonly_cell(k=10)() =>', kwonly_cell(k=10)())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: kwonly_cell(k=10)()')
try:
    def class_cell():
        v = "v"
        class A:
            def m(self): return v
            w = v
        v = "changed"
        return A().m(), A.w
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def class_cell():')
try: print(class_cell())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class_cell()')
try:
    def gen_cell():
        n = 0
        def g():
            nonlocal n
            while n < 3:
                n += 1; yield n
        return g, lambda: n
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def gen_cell():')
try: gg, gn = gen_cell()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: gg, gn = gen_cell()')
try: it = gg()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: it = gg()')
try: print('next(it) =>', next(it))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: next(it)')
try: print('gn() =>', gn())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: gn()')
try: print('next(it) =>', next(it))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: next(it)')
try: print('gn() =>', gn())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: gn()')
try: print('list(it) =>', list(it))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list(it)')
try: print('gn() =>', gn())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: gn()')
try:
    def nonlocal_del():
        v = 1
        def d():
            nonlocal v; del v
        def r(): return v
        d()
        try: return r()
        except NameError as e: return str(e)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def nonlocal_del():')
try: print(nonlocal_del())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: nonlocal_del()')
try:
    def comp_cell():
        k = 2
        return [(lambda: k * x)() for x in range(3)], [f() for f in [lambda: k * x for x in range(3)]]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def comp_cell():')
try: print(comp_cell())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: comp_cell()')
try:
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
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def deep():')
try: print('deep()()()()() =>', deep()()()()())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: deep()()()()()')
try: print('deep()()()().__code__.co_freevars =>', deep()()()().__code__.co_freevars)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: deep()()()().__code__.co_freevars')
try: print('deep()().__code__.co_freevars =>', deep()().__code__.co_freevars)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: deep()().__code__.co_freevars')
try: print('deep()().__code__.co_cellvars =>', deep()().__code__.co_cellvars)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: deep()().__code__.co_cellvars')
try:
    def same_name():
        x = "outer"
        def mid():
            x = "mid"
            def inner(): return x
            return inner()
        return mid(), x
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def same_name():')
try: print(same_name())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: same_name()')
try:
    def global_in_nested():
        gv = "local"
        def inner():
            global gv
            gv = "set by inner"
        inner()
        return gv
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def global_in_nested():')
try: print('global_in_nested() =>', global_in_nested())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: global_in_nested()')
try: print('gv =>', gv)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: gv')
try: counter = (lambda: (lambda c: lambda: c.__setitem__(0, c[0] + 1) or c[0])([0]))()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: counter = (lambda: (lambda c: lambda: c.__setitem__(0, c[0] + 1) or c...')
try: print('counter() =>', counter())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: counter()')
try: print('counter() =>', counter())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: counter()')
try: print('counter() =>', counter())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: counter()')
try: Y = lambda f: (lambda x: x(x))(lambda x: f(lambda *a: x(x)(*a)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Y = lambda f: (lambda x: x(x))(lambda x: f(lambda *a: x(x)(*a)))')
try: print(Y(lambda f: lambda n: 1 if n == 0 else n * f(n - 1))(6))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Y(lambda f: lambda n: 1 if n == 0 else n * f(n - 1))(6)')
try: compose = lambda *fs: (lambda x: x) if not fs else (lambda x: fs[0](compose(*fs[1:])(x)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: compose = lambda *fs: (lambda x: x) if not fs else (lambda x: fs[0](c...')
try: print(compose(lambda x: x + 1, lambda x: x * 2, lambda x: x - 3)(10))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: compose(lambda x: x + 1, lambda x: x * 2, lambda x: x - 3)(10)')
try: curry = lambda a: lambda b: lambda c: (a, b, c)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: curry = lambda a: lambda b: lambda c: (a, b, c)')
try: print(curry(1)(2)(3))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: curry(1)(2)(3)')
