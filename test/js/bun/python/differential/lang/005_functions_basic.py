def t(f):
    try:
        print(repr(f()))
    except Exception as e:
        print(type(e).__name__ + ':', e)

def f():
    return 1
print(f())
def g():
    pass
print(g())
def h(): return
print(h())
def add(a, b):
    return a + b
print(add(1, 2), add("a", "b"), add([1], [2]), add(a=1, b=2), add(b=1, a=2), add(1, b=2))
def default(a, b=2, c=3):
    return (a, b, c)
print(default(1), default(1, 5), default(1, 5, 6), default(1, c=9), default(a=0), default(c=1, a=2, b=3))
def multi():
    return 1, 2, 3
print(multi())
a, b, c = multi()
print(a, b, c)
def fact(n):
    return 1 if n <= 1 else n * fact(n - 1)
print(fact(5), fact(20), fact(30))
def fib(n):
    if n < 2:
        return n
    return fib(n - 1) + fib(n - 2)
print([fib(i) for i in range(15)])
def early(x):
    if x > 0:
        return "pos"
    if x < 0:
        return "neg"
    return "zero"
print(early(1), early(-1), early(0))
def loop_return():
    for i in range(10):
        if i == 3:
            return i
    return -1
print(loop_return())
def nested():
    def inner(x):
        return x * 2
    return inner(21)
print(nested())
print(f.__name__, add.__name__, type(f).__name__, callable(f), callable(1))
def doc():
    "the docstring"
print(doc.__doc__, f.__doc__)
def doc2():
    """multi
    line"""
    return 1
print(repr(doc2.__doc__))
# Functions are values.
fs = [f, fact, len, abs]
print([fn.__name__ for fn in fs])
def apply(fn, *args):
    return fn(*args)
print(apply(add, 1, 2), apply(len, "abc"), apply(f))
alias = add
print(alias(3, 4), alias is add, alias.__name__)
# Mutable default.
def acc(x, l=[]):
    l.append(x)
    return l
print(acc(1), acc(2), acc(3, []), acc(4))
# Defaults are evaluated at definition time.
v = 1
def dflt(x=v):
    return x
v = 2
print(dflt())
# Arguments are evaluated left to right.
def show(x):
    print("eval", x, end="; ")
    return x
print(add(show(1), show(2)))
print(add(b=show(1), a=show(2)))
print(default(show(1), c=show(2), b=show(3)))
# Assigning to a parameter does not affect the caller; mutation does.
def rebind(x):
    x = 5
    return x
y = 1
print(rebind(y), y)
def mutate(l):
    l.append(1)
lst = []
mutate(lst); mutate(lst)
print(lst)
t(lambda: add(1))
t(lambda: add())
t(lambda: add(1, 2, 3))
t(lambda: add(1, 2, c=3))
t(lambda: add(1, a=2))
t(lambda: f(1))
t(lambda: default())
t(lambda: default(1, 2, 3, 4))
t(lambda: undefined_function())
t(lambda: (1)())
t(lambda: "str"())
t(lambda: None())
t(lambda: [1, 2](0))
lam = lambda x, y=2: x * y
print(lam(3), lam(3, 4), lam.__name__, (lambda: 7)(), (lambda *a, **k: (a, k))(1, 2, z=3))
print(sorted([3, 1, 2], key=lambda v: -v), list(map(lambda v: v * v, [1, 2, 3])), list(filter(lambda v: v % 2, range(6))))
print((lambda x: (lambda y: x + y))(1)(2))
def returns_lambda(n):
    return lambda x: x + n
add5 = returns_lambda(5)
print(add5(1), returns_lambda(10)(1))
def even(n): return True if n == 0 else odd(n - 1)
def odd(n): return False if n == 0 else even(n - 1)
print(even(10), odd(10), even(7))
def no_return_value(x):
    x + 1
print(no_return_value(1))
def many(a, b, c, d, e, f, g, h, i, j):
    return a + b + c + d + e + f + g + h + i + j
print(many(1, 2, 3, 4, 5, 6, 7, 8, 9, 10))
print(many(*range(10)), many(*range(5), *range(5)), many(1, 2, 3, *(4, 5, 6), g=7, h=8, **{"i": 9, "j": 10}))
