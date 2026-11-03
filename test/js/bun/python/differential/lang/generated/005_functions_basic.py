try:
    def t(f):
        try:
            print(repr(f()))
        except Exception as e:
            print(type(e).__name__ + ':', e)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def t(f):')

try:
    def f():
        return 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def f():')
try: print(f())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: f()')
try:
    def g():
        pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def g():')
try: print(g())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g()')
try:
    def h(): return
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def h(): return')
try: print(h())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: h()')
try:
    def add(a, b):
        return a + b
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def add(a, b):')
try: print('add(1, 2) =>', add(1, 2))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: add(1, 2)')
try: print('add("a", "b") =>', add("a", "b"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: add("a", "b")')
try: print('add([1], [2]) =>', add([1], [2]))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: add([1], [2])')
try: print('add(a=1, b=2) =>', add(a=1, b=2))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: add(a=1, b=2)')
try: print('add(b=1, a=2) =>', add(b=1, a=2))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: add(b=1, a=2)')
try: print('add(1, b=2) =>', add(1, b=2))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: add(1, b=2)')
try:
    def default(a, b=2, c=3):
        return (a, b, c)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def default(a, b=2, c=3):')
try: print('default(1) =>', default(1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: default(1)')
try: print('default(1, 5) =>', default(1, 5))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: default(1, 5)')
try: print('default(1, 5, 6) =>', default(1, 5, 6))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: default(1, 5, 6)')
try: print('default(1, c=9) =>', default(1, c=9))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: default(1, c=9)')
try: print('default(a=0) =>', default(a=0))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: default(a=0)')
try: print('default(c=1, a=2, b=3) =>', default(c=1, a=2, b=3))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: default(c=1, a=2, b=3)')
try:
    def multi():
        return 1, 2, 3
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def multi():')
try: print(multi())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: multi()')
try: a, b, c = multi()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a, b, c = multi()')
try: print('a =>', a)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a')
try: print('b =>', b)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: b')
try: print('c =>', c)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c')
try:
    def fact(n):
        return 1 if n <= 1 else n * fact(n - 1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def fact(n):')
try: print('fact(5) =>', fact(5))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: fact(5)')
try: print('fact(20) =>', fact(20))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: fact(20)')
try: print('fact(30) =>', fact(30))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: fact(30)')
try:
    def fib(n):
        if n < 2:
            return n
        return fib(n - 1) + fib(n - 2)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def fib(n):')
try: print([fib(i) for i in range(15)])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [fib(i) for i in range(15)]')
try:
    def early(x):
        if x > 0:
            return "pos"
        if x < 0:
            return "neg"
        return "zero"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def early(x):')
try: print('early(1) =>', early(1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: early(1)')
try: print('early(-1) =>', early(-1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: early(-1)')
try: print('early(0) =>', early(0))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: early(0)')
try:
    def loop_return():
        for i in range(10):
            if i == 3:
                return i
        return -1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def loop_return():')
try: print(loop_return())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: loop_return()')
try:
    def nested():
        def inner(x):
            return x * 2
        return inner(21)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def nested():')
try: print(nested())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: nested()')
try: print('f.__name__ =>', f.__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: f.__name__')
try: print('add.__name__ =>', add.__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: add.__name__')
try: print('type(f).__name__ =>', type(f).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(f).__name__')
try: print('callable(f) =>', callable(f))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: callable(f)')
try: print('callable(1) =>', callable(1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: callable(1)')
try:
    def doc():
        "the docstring"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def doc():')
try: print('doc.__doc__ =>', doc.__doc__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: doc.__doc__')
try: print('f.__doc__ =>', f.__doc__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: f.__doc__')
def doc2():
    """multi
    line"""
    return 1
try: print(repr(doc2.__doc__))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: repr(doc2.__doc__)')
# Functions are values.
try: fs = [f, fact, len, abs]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: fs = [f, fact, len, abs]')
try: print([fn.__name__ for fn in fs])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [fn.__name__ for fn in fs]')
try:
    def apply(fn, *args):
        return fn(*args)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def apply(fn, *args):')
try: print('apply(add, 1, 2) =>', apply(add, 1, 2))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: apply(add, 1, 2)')
try: print('apply(len, "abc") =>', apply(len, "abc"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: apply(len, "abc")')
try: print('apply(f) =>', apply(f))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: apply(f)')
try: alias = add
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: alias = add')
try: print('alias(3, 4) =>', alias(3, 4))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: alias(3, 4)')
try: print('alias is add =>', alias is add)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: alias is add')
try: print('alias.__name__ =>', alias.__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: alias.__name__')
# Mutable default.
try:
    def acc(x, l=[]):
        l.append(x)
        return l
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def acc(x, l=[]):')
try: print('acc(1) =>', acc(1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: acc(1)')
try: print('acc(2) =>', acc(2))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: acc(2)')
try: print('acc(3, []) =>', acc(3, []))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: acc(3, [])')
try: print('acc(4) =>', acc(4))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: acc(4)')
# Defaults are evaluated at definition time.
try: v = 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: v = 1')
try:
    def dflt(x=v):
        return x
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def dflt(x=v):')
try: v = 2
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: v = 2')
try: print(dflt())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: dflt()')
# Arguments are evaluated left to right.
try:
    def show(x):
        print("eval", x, end="; ")
        return x
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def show(x):')
try: print(add(show(1), show(2)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: add(show(1), show(2))')
try: print(add(b=show(1), a=show(2)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: add(b=show(1), a=show(2))')
try: print(default(show(1), c=show(2), b=show(3)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: default(show(1), c=show(2), b=show(3))')
# Assigning to a parameter does not affect the caller; mutation does.
try:
    def rebind(x):
        x = 5
        return x
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def rebind(x):')
try: y = 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: y = 1')
try: print('rebind(y) =>', rebind(y))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: rebind(y)')
try: print('y =>', y)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: y')
try:
    def mutate(l):
        l.append(1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def mutate(l):')
try: lst = []
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: lst = []')
try: mutate(lst)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: mutate(lst)')
try: mutate(lst)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: mutate(lst)')
try: print(lst)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: lst')
try: print('add(1) =>', end=" "); t(lambda: add(1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: add(1))')
try: print('add() =>', end=" "); t(lambda: add())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: add())')
try: print('add(1, 2, 3) =>', end=" "); t(lambda: add(1, 2, 3))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: add(1, 2, 3))')
try: print('add(1, 2, c=3) =>', end=" "); t(lambda: add(1, 2, c=3))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: add(1, 2, c=3))')
try: print('add(1, a=2) =>', end=" "); t(lambda: add(1, a=2))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: add(1, a=2))')
try: print('f(1) =>', end=" "); t(lambda: f(1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: f(1))')
try: print('default() =>', end=" "); t(lambda: default())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: default())')
try: print('default(1, 2, 3, 4) =>', end=" "); t(lambda: default(1, 2, 3, 4))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: default(1, 2, 3, 4))')
try: print('undefined_function() =>', end=" "); t(lambda: undefined_function())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: undefined_function())')
try: print('(1)() =>', end=" "); t(lambda: (1)())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: (1)())')
try: print('"str"() =>', end=" "); t(lambda: "str"())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: "str"())')
try: print('None() =>', end=" "); t(lambda: None())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: None())')
try: print('[1, 2](0) =>', end=" "); t(lambda: [1, 2](0))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: [1, 2](0))')
try: lam = lambda x, y=2: x * y
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: lam = lambda x, y=2: x * y')
try: print('lam(3) =>', lam(3))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: lam(3)')
try: print('lam(3, 4) =>', lam(3, 4))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: lam(3, 4)')
try: print('lam.__name__ =>', lam.__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: lam.__name__')
try: print('(lambda: 7)() =>', (lambda: 7)())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: (lambda: 7)()')
try: print('(lambda *a, **k: (a, k))(1, 2, z=3) =>', (lambda *a, **k: (a, k))(1, 2, z=3))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: (lambda *a, **k: (a, k))(1, 2, z=3)')
try: print('sorted([3, 1, 2], key=lambda v: -v) =>', sorted([3, 1, 2], key=lambda v: -v))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sorted([3, 1, 2], key=lambda v: -v)')
try: print('list(map(lambda v: v * v, [1, 2, 3])) =>', list(map(lambda v: v * v, [1, 2, 3])))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list(map(lambda v: v * v, [1, 2, 3]))')
try: print('list(filter(lambda v: v % 2, range(6))) =>', list(filter(lambda v: v % 2, range(6))))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list(filter(lambda v: v % 2, range(6)))')
try: print((lambda x: (lambda y: x + y))(1)(2))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: (lambda x: (lambda y: x + y))(1)(2)')
try:
    def returns_lambda(n):
        return lambda x: x + n
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def returns_lambda(n):')
try: add5 = returns_lambda(5)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: add5 = returns_lambda(5)')
try: print('add5(1) =>', add5(1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: add5(1)')
try: print('returns_lambda(10)(1) =>', returns_lambda(10)(1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: returns_lambda(10)(1)')
try:
    def even(n): return True if n == 0 else odd(n - 1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def even(n): return True if n == 0 else odd(n - 1)')
try:
    def odd(n): return False if n == 0 else even(n - 1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def odd(n): return False if n == 0 else even(n - 1)')
try: print('even(10) =>', even(10))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: even(10)')
try: print('odd(10) =>', odd(10))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: odd(10)')
try: print('even(7) =>', even(7))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: even(7)')
try:
    def no_return_value(x):
        x + 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def no_return_value(x):')
try: print(no_return_value(1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: no_return_value(1)')
try:
    def many(a, b, c, d, e, f, g, h, i, j):
        return a + b + c + d + e + f + g + h + i + j
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def many(a, b, c, d, e, f, g, h, i, j):')
try: print(many(1, 2, 3, 4, 5, 6, 7, 8, 9, 10))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: many(1, 2, 3, 4, 5, 6, 7, 8, 9, 10)')
try: print('many(*range(10)) =>', many(*range(10)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: many(*range(10))')
try: print('many(*range(5), *range(5)) =>', many(*range(5), *range(5)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: many(*range(5), *range(5))')
try: print('many(1, 2, 3, *(4, 5, 6), g=7, h=8, **{"i": 9, "j": 10}) =>', many(1, 2, 3, *(4, 5, 6), g=7, h=8, **{"i": 9, "j": 10}))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: many(1, 2, 3, *(4, 5, 6), g=7, h=8, **{"i": 9, "j": 10})')
