def t(f):
    try:
        print(repr(f()))
    except Exception as e:
        print(type(e).__name__ + ':', e)

def f(*args): return args
print(f(), f(1), f(1, 2), f(*[1, 2]), f(*"ab"), f(1, *[2, 3]), f(*[1], 2), f(*[1], *[2]), f(*()), f(*range(3)), f(*{1: 2}), f(*(i for i in range(2))), f(*[1], 2, *[3], 4), type(f()))
def g(**kw): return kw
print(g(), g(a=1), g(a=1, b=2), g(**{"a": 1}), g(a=1, **{"b": 2}), g(**{"a": 1}, b=2), g(**{"a": 1}, **{"b": 2}), g(**{}), g(b=1, a=2), type(g()), g(**dict(x=1)), g(**{"not an identifier": 1}), g(**{"": 1}), g(**{"é": 1}), g(**{"class": 1}), g(self=1), g(kw=1))
def h(a, *args, **kw): return a, args, kw
print(h(1), h(1, 2), h(1, 2, 3, x=4), h(a=1), h(a=1, b=2), h(1, b=2), h(*[1, 2], **{"c": 3}), h(1, *[2], c=3, **{"d": 4}), h(**{"a": 1}), h(*[1], **{}), h(1, *(), **{}))
def k(a, b=2, *args, c, d=4, **kw): return a, b, args, c, d, kw
print(k(1, c=3), k(1, 2, 3, c=4), k(1, c=3, d=5, e=6), k(a=1, c=3), k(c=3, a=1, b=0), k(1, 2, 3, 4, c=5, d=6, e=7, f=8), k(*[1, 2, 3], **{"c": 4}))
def ko(*, a, b=2): return a, b
print(ko(a=1), ko(a=1, b=3), ko(b=1, a=2), ko(**{"a": 1}))
def po(a, b=2, /): return a, b
print(po(1), po(1, 3), po(*[1, 2]))
def mix(a, /, b, *, c): return a, b, c
print(mix(1, 2, c=3), mix(1, b=2, c=3), mix(1, c=3, b=2))
def pokw(a, /, **kw): return a, kw
print(pokw(1, a=2), pokw(1, a=2, b=3), pokw(1))
def podef(a=1, /, b=2, *, c=3): return a, b, c
print(podef(), podef(9), podef(9, 8), podef(9, b=8, c=7), podef(c=0))
t(lambda: f(a=1))
t(lambda: g(1))
t(lambda: g(1, 2))
t(lambda: g(1, a=2))
t(lambda: h())
t(lambda: h(b=1))
t(lambda: h(1, a=2))
t(lambda: h(1, 2, a=3))
t(lambda: k(1))
t(lambda: k())
t(lambda: k(c=1))
t(lambda: k(1, 2, 3))
t(lambda: ko())
t(lambda: ko(1))
t(lambda: ko(1, 2))
t(lambda: ko(1, a=2))
t(lambda: ko(b=1))
t(lambda: ko(a=1, c=2))
t(lambda: ko(a=1, a1=2))
t(lambda: po())
t(lambda: po(a=1))
t(lambda: po(1, b=2))
t(lambda: po(a=1, b=2))
t(lambda: po(1, 2, 3))
t(lambda: mix(1, 2, 3))
t(lambda: mix(1, 2))
t(lambda: mix(a=1, b=2, c=3))
t(lambda: mix())
t(lambda: mix(1))
t(lambda: mix(c=3))
t(lambda: mix(1, 2, c=3, d=4))
t(lambda: pokw())
t(lambda: pokw(a=1))
t(lambda: podef(1, 2, 3))
t(lambda: podef(a=1))
def two(a, b): pass
def three(a, b, c): pass
def four(a, b, c, d): pass
def one(a): pass
def zero(): pass
def dflt(a, b=1, c=2): pass
def kw2(*, x, y): pass
def kw3(*, x, y, z): pass
def kwmix(a, *, x): pass
t(lambda: zero(1)); t(lambda: zero(1, 2)); t(lambda: zero(a=1)); t(lambda: one()); t(lambda: one(1, 2)); t(lambda: one(1, 2, 3)); t(lambda: one(b=1)); t(lambda: one(1, a=1)); t(lambda: one(1, b=1))
t(lambda: two()); t(lambda: two(1)); t(lambda: two(b=1)); t(lambda: two(a=1)); t(lambda: two(1, 2, 3)); t(lambda: two(1, 2, 3, 4)); t(lambda: two(1, 2, b=3)); t(lambda: two(1, c=3)); t(lambda: two(1, 2, c=3))
t(lambda: three()); t(lambda: three(1)); t(lambda: three(b=1)); t(lambda: four()); t(lambda: four(1)); t(lambda: four(c=1)); t(lambda: four(1, d=1))
t(lambda: dflt()); t(lambda: dflt(1, 2, 3, 4)); t(lambda: dflt(1, 2, 3, 4, 5)); t(lambda: dflt(b=1)); t(lambda: dflt(1, 2, 3, c=4)); t(lambda: dflt(1, d=4))
t(lambda: kw2()); t(lambda: kw2(x=1)); t(lambda: kw2(y=1)); t(lambda: kw3()); t(lambda: kw3(y=1)); t(lambda: kw2(1, x=1, y=2)); t(lambda: kw2(1, 2, x=1, y=2)); t(lambda: kw2(1)); t(lambda: kwmix(1, 2)); t(lambda: kwmix(1, 2, x=3)); t(lambda: kwmix(1, 2, 3, x=3)); t(lambda: kwmix()); t(lambda: kwmix(x=1)); t(lambda: kwmix(1))
# Suggestions for misspelt keywords.
def sug(color, size=1, *, weight=2): pass
t(lambda: sug(1, colour=2)); t(lambda: sug(1, sise=2)); t(lambda: sug(1, Weight=2)); t(lambda: sug(1, wieght=2)); t(lambda: sug(1, zzzzz=2)); t(lambda: sug(1, s=2)); t(lambda: sug(colr=1))
# Duplicates.
t(lambda: g(**{"a": 1}, **{"a": 2}))
t(lambda: g(a=1, **{"a": 2}))
t(lambda: g(**{"a": 1}, a=2) if False else eval('g(**{"a": 1}, a=2)'))
t(lambda: two(1, 2, **{"a": 3}))
t(lambda: two(*[1, 2], **{"b": 3}))
t(lambda: two(**{"a": 1, "b": 2, "c": 3}))
t(lambda: h(1, **{"a": 2}))
t(lambda: g(**{1: 2}))
t(lambda: g(**{"a": 1, 2: 3}))
t(lambda: g(**{None: 1}))
t(lambda: two(*1))
t(lambda: two(**1))
t(lambda: two(*None))
t(lambda: two(**None))
t(lambda: two(**[("a", 1)]))
t(lambda: two(*[1], *2))
t(lambda: two(**{"a": 1}, **2))
t(lambda: len(*1))
t(lambda: len(**1))
t(lambda: (lambda: 0)(*1))
class C:
    def m(self, a): return a
    @classmethod
    def cm(cls, a): return a
    @staticmethod
    def sm(a): return a
    def __call__(self, a): return a
    def __init__(self, x=0): pass
t(lambda: C().m()); t(lambda: C().m(1, 2)); t(lambda: C().m(b=1)); t(lambda: C.m()); t(lambda: C.m(1)); t(lambda: C.cm()); t(lambda: C.cm(1, 2)); t(lambda: C.sm()); t(lambda: C.sm(1, 2)); t(lambda: C()()); t(lambda: C()(1, 2)); t(lambda: C(1, 2)); t(lambda: C(y=1)); t(lambda: C().m(*1)); t(lambda: C().m(**1)); t(lambda: C().m(1, a=2)); t(lambda: C().m(self=1))
def outer():
    def inner(a): pass
    return inner
t(lambda: outer()()); t(lambda: (lambda a: a)()); t(lambda: (lambda a, b: a)(1)); t(lambda: (lambda: 0)(1)); t(lambda: (lambda *, a: a)()); t(lambda: (lambda a, /: a)(a=1))
for src in ("f(a=1, 2)", "f(**{}, 1)", "f(**{}, *[])", "f(a=1, a=2)", "f(a=1, *[2])", "f(1=2)", "f(a.b=1)", "f(a[0]=1)", "f(None=1)", "f(True=1)", "f(a+b=1)", "f('a'=1)", "f(*)", "f(**)", "f(a=)", "f(=1)", "f(a, , b)", "f(,)", "f(a for a in b, c)", "f(c, a for a in b)", "f(a for a in b)", "f(*a for a in b)" if False else "f(**a for a in b)", "f(a := 1)", "f(a=b := 1)", "f(a=(b := 1))", "f(*a=1)", "f(lambda: 1=2)", "f(__debug__=1)", "f(x for x in y=1)", "f(a, b=1, *c, d=2, **e)", "f(*a, *b, **c, **d)", "f(a)(b)(c)", "f(print=1)", "f(a=1 b=2)", "f(a b)", "f(1 2)", "f(a, b c)", "f(yield)", "f(if=1)", "f(*, a)"):
    try:
        compile(src, "<s>", "eval"); print("ok:", src)
    except SyntaxError as e:
        print("SyntaxError:", e.msg)
for src in ("def f(a, a): pass", "def f(a, *a): pass", "def f(a, **a): pass", "def f(a, *, a): pass", "def f(*a, *b): pass", "def f(**a, b): pass", "def f(**a, *b): pass", "def f(**a, **b): pass", "def f(a=1, b): pass", "def f(a=1, /, b): pass", "def f(*): pass", "def f(*, **k): pass", "def f(*, /): pass", "def f(/): pass", "def f(/, a): pass", "def f(a, /, /): pass", "def f(a, /, b, /): pass", "def f(*a, /): pass", "def f(*, a, /): pass", "def f(a, *, *b): pass", "def f(*a, *, b): pass", "def f(*a=1): pass", "def f(**a=1): pass", "def f(a, *, b=1, c): pass", "def f(1): pass", "def f(a.b): pass", "def f((a, b)): pass", "def f(None): pass", "def f(__debug__): pass", "def f(a,, b): pass", "def f(a b): pass", "def f(a=): pass", "def f(*, a=1, **k,): pass", "def f(a, b,): pass", "def f(*a,): pass", "def f(**k,): pass", "def f(,): pass", "lambda a, a: 1", "lambda a=1, b: 1", "lambda *: 1", "lambda /: 1", "lambda **a, b: 1", "lambda (a): 1", "lambda a, /, b, *, c: 1", "lambda *a, **k: 1", "lambda a: int: 1", "def f(a: int = 1, *b: int, c: int = 2, **d: int) -> int: pass", "def f(a = 1: int): pass", "def f(*a: *b): pass", "def f(a: *b): pass", "def f(**a: *b): pass", "def f(a, *, b, /, c): pass", "def f(): pass; pass", "def f() pass", "def f: pass", "def (): pass", "def f():", "def f(a, *): pass", "def f(a, *, ): pass"):
    try:
        compile(src, "<s>", "exec"); print("ok:", src)
    except SyntaxError as e:
        print("SyntaxError:", e.msg)
def big(*a, **k): return len(a), len(k)
print(big(*range(300)), big(**{"k%d" % i: i for i in range(300)}), big(*range(1000), **{"k%d" % i: i for i in range(100)}), eval("big(" + ", ".join(str(i) for i in range(300)) + ")"), eval("big(" + ", ".join("a%d=%d" % (i, i) for i in range(300)) + ")"))
exec("def many(" + ", ".join("p%d" % i for i in range(300)) + "): return p0 + p299")
print(many(*range(300)), many(**{"p%d" % i: i for i in range(300)}), eval("many(" + ", ".join(str(i) for i in range(300)) + ")"))
t(lambda: many(*range(299)))
t(lambda: many(*range(301)))
