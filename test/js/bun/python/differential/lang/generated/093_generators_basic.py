try:
    def t(f):
        try:
            print(repr(f()))
        except BaseException as e:
            print(type(e).__name__ + ':', e)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def t(f):')

try:
    def g():
        print("start", end="; ")
        yield 1
        print("middle", end="; ")
        yield 2
        print("end", end="; ")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def g():')
try: it = g()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: it = g()')
try: print('type(it).__name__ =>', type(it).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(it).__name__')
try: print('iter(it) is it =>', iter(it) is it)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: iter(it) is it')
try: print(next(it))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: next(it)')
try: print(next(it))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: next(it)')
try: print('next(it) =>', end=" "); t(lambda: next(it))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: next(it))')
try: print('next(it) =>', end=" "); t(lambda: next(it))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: next(it))')
try: print(next(it, "default"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: next(it, "default")')
try: print(list(g()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list(g())')
try: print([x for x in g()])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [x for x in g()]')
try: print('sum(g()) =>', sum(g()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sum(g())')
try: print('max(g()) =>', max(g()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: max(g())')
try: print('tuple(g()) =>', tuple(g()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: tuple(g())')
try: print('2 in g() =>', 2 in g())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: 2 in g()')
try: print('5 in g() =>', 5 in g())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: 5 in g()')
try: a, b = g()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a, b = g()')
try: print('a =>', a)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a')
try: print('b =>', b)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: b')
try: print(*g())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: print(*g())')
try: print(dict(zip(g(), g())))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: dict(zip(g(), g()))')
try:
    def empty():
        return
        yield
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def empty():')
try:
    def only_return():
        if False: yield
        return "value"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def only_return():')
try: print('list(empty()) =>', list(empty()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list(empty())')
try: print('list(only_return()) =>', list(only_return()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list(only_return())')
try:
    try: next(only_return())
    except StopIteration as e: print(repr(e), e.value, e.args)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try: next(only_return())')
try:
    try: next(empty())
    except StopIteration as e: print(repr(e), e.value, e.args)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try: next(empty())')
try:
    def ret_tuple():
        yield 1
        return 1, 2
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def ret_tuple():')
try: r = ret_tuple()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: r = ret_tuple()')
try: next(r)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: next(r)')
try:
    try: next(r)
    except StopIteration as e: print(repr(e), e.value, e.args)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try: next(r)')
try:
    def ret_exc():
        yield
        return ValueError("returned, not raised")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def ret_exc():')
try: r = ret_exc()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: r = ret_exc()')
try: next(r)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: next(r)')
try:
    try: next(r)
    except StopIteration as e: print(repr(e), repr(e.value))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try: next(r)')
try:
    def count(n):
        i = 0
        while i < n:
            yield i
            i += 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def count(n):')
try: print('list(count(5)) =>', list(count(5)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list(count(5))')
try: print('list(count(0)) =>', list(count(0)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list(count(0))')
try: print('sum(count(100)) =>', sum(count(100)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sum(count(100))')
try: print('list(zip(count(3), count(10))) =>', list(zip(count(3), count(10))))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list(zip(count(3), count(10)))')
try: print('list(map(lambda v: v * 2, count(3))) =>', list(map(lambda v: v * 2, count(3))))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list(map(lambda v: v * 2, count(3)))')
try: print('list(enumerate(count(2))) =>', list(enumerate(count(2))))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list(enumerate(count(2)))')
try: print('sorted(count(3), reverse=True) =>', sorted(count(3), reverse=True))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sorted(count(3), reverse=True)')
try: print('list(filter(None, count(3))) =>', list(filter(None, count(3))))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list(filter(None, count(3)))')
try: print('any(count(2)) =>', any(count(2)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: any(count(2))')
try: print('all(count(2)) =>', all(count(2)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: all(count(2))')
try: print('min(count(3)) =>', min(count(3)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: min(count(3))')
try: print('"".join(str(v) for v in count(3)) =>', "".join(str(v) for v in count(3)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: "".join(str(v) for v in count(3))')
try: print('[*count(2), *count(2)] =>', [*count(2), *count(2)])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [*count(2), *count(2)]')
try: print('{*count(3)} =>', {*count(3)})
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: {*count(3)}')
try: print('{k: k for k in count(2)} =>', {k: k for k in count(2)})
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: {k: k for k in count(2)}')
try:
    def fib():
        a, b = 0, 1
        while True:
            yield a
            a, b = b, a + b
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def fib():')
try: f = fib()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: f = fib()')
try: print([next(f) for _ in range(15)])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [next(f) for _ in range(15)]')
try:
    def take(n, it):
        for _, v in zip(range(n), it): yield v
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def take(n, it):')
try: print('list(take(5, fib())) =>', list(take(5, fib())))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list(take(5, fib()))')
try: print('list(take(3, take(10, fib()))) =>', list(take(3, take(10, fib()))))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list(take(3, take(10, fib())))')
# Arguments and locals are kept between resumptions; the body does not start until the first next().
try:
    def lazy(x): print("body runs with", x, end="; "); yield x
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def lazy(x): print("body runs with", x, end="; "); yield x')
try: l = lazy(1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: l = lazy(1)')
try: print("created")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: "created"')
try: print(next(l))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: next(l)')
try:
    def args(a, b=2, *c, d, **e): yield (a, b, c, d, e)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def args(a, b=2, *c, d, **e): yield (a, b, c, d, e)')
try: print('next(args(1, d=4)) =>', next(args(1, d=4)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: next(args(1, d=4))')
try: print('next(args(1, 2, 3, d=4, z=5)) =>', next(args(1, 2, 3, d=4, z=5)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: next(args(1, 2, 3, d=4, z=5))')
try: print('args() =>', end=" "); t(lambda: args())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: args())')
try: print('args(1) =>', end=" "); t(lambda: args(1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: args(1))')
try: print('args(1, d=1, a=2) =>', end=" "); t(lambda: args(1, d=1, a=2))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: args(1, d=1, a=2))')
try:
    def state():
        total = 0
        for i in range(3):
            total += i
            yield total, i, sorted(locals())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def state():')
try: print(list(state()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list(state())')
try: g1, g2 = count(3), count(3)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g1, g2 = count(3), count(3)')
try: print('next(g1) =>', next(g1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: next(g1)')
try: print('next(g1) =>', next(g1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: next(g1)')
try: print('next(g2) =>', next(g2))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: next(g2)')
try: print('next(g1) =>', next(g1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: next(g1)')
try: print('next(g2) =>', next(g2))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: next(g2)')
# yield as an expression.
try:
    def echo():
        r = yield "first"
        while True: r = yield ("got", r)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def echo():')
try: e = echo()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: e = echo()')
try: print('next(e) =>', next(e))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: next(e)')
try: print('next(e) =>', next(e))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: next(e)')
try: print('e.send(5) =>', e.send(5))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: e.send(5)')
try: print('e.send(None) =>', e.send(None))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: e.send(None)')
try: print('e.send((1, 2)) =>', e.send((1, 2)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: e.send((1, 2))')
try:
    def exprs():
        x = yield
        y = (yield) or "dflt"
        z = [(yield 1), (yield 2)]
        w = (yield 3) + (yield 4)
        print((yield 5), end="; ")
        v = yield (yield 6)
        u = f"{(yield 7)}"
        d = {(yield 8): (yield 9)}
        s = yield 10, 11
        q = yield
        return x, y, z, w, v, u, d, s, q
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def exprs():')
try: ex = exprs()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ex = exprs()')
try: out = [next(ex)]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: out = [next(ex)]')
try:
    try:
        for i in range(100): out.append(ex.send(i))
    except StopIteration as st: print(out, st.value)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try:')
try:
    def yl():
        yield
        yield None
        yield ()
        yield 1,
        yield 1, 2
        yield (1, 2)
        yield [1]
        yield *[1, 2], 3
        yield lambda: 1
        yield not True
        yield 1 if False else 2
        yield (yield)
        x = yield; yield x
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def yl():')
try: print([v if not callable(v) else "fn" for v in yl()])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [v if not callable(v) else "fn" for v in yl()]')
# Generators in various constructs.
try:
    def in_try():
        try:
            yield 1
            yield 2
        finally: print("cleanup", end="; ")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def in_try():')
try: print(list(in_try()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list(in_try())')
try:
    def in_with():
        class CM:
            def __enter__(s): print("enter", end="; "); return "cm"
            def __exit__(s, *a): print("exit", a[0], end="; ")
        with CM() as c: yield c; yield c + "2"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def in_with():')
try: print(list(in_with()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list(in_with())')
try:
    def in_loop_else():
        for i in range(2): yield i
        else: yield "else"
        while False: yield "never"
        else: yield "while else"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def in_loop_else():')
try: print(list(in_loop_else()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list(in_loop_else())')
try:
    def nested_loops():
        for i in range(3):
            for j in range(3):
                if j == 2: break
                if i == 1: continue
                yield i, j
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def nested_loops():')
try: print(list(nested_loops()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list(nested_loops())')
try:
    def in_except():
        try: raise ValueError("v")
        except ValueError as e:
            yield "handling " + str(e)
            yield "still handling " + str(e)
        yield "after"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def in_except():')
try: print(list(in_except()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list(in_except())')
try:
    def rec(n):
        if n > 0:
            yield n
            for v in rec(n - 1): yield v
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def rec(n):')
try: print(list(rec(5)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list(rec(5))')
try:
    def tree(t):
        if isinstance(t, list):
            for x in t: yield from tree(x)
        else: yield t
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def tree(t):')
try: print(list(tree([1, [2, [3, 4], 5], [[6]], []])))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list(tree([1, [2, [3, 4], 5], [[6]], []]))')
try:
    class C:
        def __init__(s): s.items = [1, 2, 3]
        def __iter__(s):
            for x in s.items: yield x * 10
        def gen(s, k): yield from (x * k for x in s.items)
        @staticmethod
        def sg(): yield "static"
        @classmethod
        def cg(cls): yield cls.__name__
        @property
        def pg(s): yield "prop"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class C:')
try: c = C()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c = C()')
try: print('list(c) =>', list(c))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list(c)')
try: print('list(c) =>', list(c))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list(c)')
try: print('list(c.gen(2)) =>', list(c.gen(2)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list(c.gen(2))')
try: print('list(C.sg()) =>', list(C.sg()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list(C.sg())')
try: print('list(c.cg()) =>', list(c.cg()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list(c.cg())')
try: print('list(c.pg) =>', list(c.pg))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list(c.pg)')
try: print('[a * b for a in c for b in c][:4] =>', [a * b for a in c for b in c][:4])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [a * b for a in c for b in c][:4]')
try: print('20 in c =>', 20 in c)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: 20 in c')
try: print('max(c) =>', max(c))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: max(c)')
try: lam = lambda: (yield 1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: lam = lambda: (yield 1)')
try: print('list(lam()) =>', list(lam()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list(lam())')
try: print('type(lam()).__name__ =>', type(lam()).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(lam()).__name__')
try: lam2 = lambda x: [(yield x), (yield x + 1)]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: lam2 = lambda x: [(yield x), (yield x + 1)]')
try: print(list(lam2(1)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list(lam2(1))')
# Attributes.
try:
    def named(): yield
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def named(): yield')
try: n = named()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: n = named()')
try: print('n.__name__ =>', n.__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: n.__name__')
try: print('n.__qualname__ =>', n.__qualname__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: n.__qualname__')
try: print('n.gi_code is named.__code__ =>', n.gi_code is named.__code__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: n.gi_code is named.__code__')
try: print('n.gi_running =>', n.gi_running)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: n.gi_running')
try: print('n.gi_suspended =>', n.gi_suspended)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: n.gi_suspended')
try: print('n.gi_yieldfrom =>', n.gi_yieldfrom)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: n.gi_yieldfrom')
try: print('n.gi_frame is not None =>', n.gi_frame is not None)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: n.gi_frame is not None')
try: print('n.gi_frame.f_code.co_name =>', n.gi_frame.f_code.co_name)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: n.gi_frame.f_code.co_name')
try: print('n.gi_frame.f_lineno == named.__code__.co_firstlineno =>', n.gi_frame.f_lineno == named.__code__.co_firstlineno)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: n.gi_frame.f_lineno == named.__code__.co_firstlineno')
try: print('repr(n)[:29] =>', repr(n)[:29])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: repr(n)[:29]')
try: print('type(n).__module__ =>', type(n).__module__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(n).__module__')
try: print('hasattr(n, "__dict__") =>', hasattr(n, "__dict__"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: hasattr(n, "__dict__")')
try: print('n.gi_frame.f_locals =>', n.gi_frame.f_locals)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: n.gi_frame.f_locals')
try: print('n.gi_frame.f_back =>', n.gi_frame.f_back)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: n.gi_frame.f_back')
try: next(n)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: next(n)')
try: print('n.gi_running =>', n.gi_running)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: n.gi_running')
try: print('n.gi_suspended =>', n.gi_suspended)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: n.gi_suspended')
try: print('n.gi_frame is not None =>', n.gi_frame is not None)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: n.gi_frame is not None')
try: next(n, None)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: next(n, None)')
try: print('n.gi_running =>', n.gi_running)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: n.gi_running')
try: print('n.gi_suspended =>', n.gi_suspended)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: n.gi_suspended')
try: print('n.gi_frame =>', n.gi_frame)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: n.gi_frame')
try: n.__name__ = "renamed"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: n.__name__ = "renamed"')
try: n.__qualname__ = "q.renamed"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: n.__qualname__ = "q.renamed"')
try: print('n.__name__ =>', n.__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: n.__name__')
try: print('n.__qualname__ =>', n.__qualname__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: n.__qualname__')
try: print('repr(n)[:32] =>', repr(n)[:32])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: repr(n)[:32]')
try: print('named.__name__ =>', named.__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: named.__name__')
try:
    def s1(): n.__name__ = 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def s1(): n.__name__ = 1')
try:
    def s2(): n.gi_code = None
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def s2(): n.gi_code = None')
try:
    def s3(): n.x = 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def s3(): n.x = 1')
try:
    def s4(): del n.__name__
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def s4(): del n.__name__')
try:
    def s5(): n.gi_running = True
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def s5(): n.gi_running = True')
try:
    for s in (s1, s2, s3, s4, s5): t(s)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for s in (s1, s2, s3, s4, s5): t(s)')
try:
    def running():
        yield me.gi_running, me.gi_suspended, me.gi_frame.f_lineno > 0
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def running():')
try: me = running()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: me = running()')
try: print('next(me) =>', next(me))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: next(me)')
try: print('me.gi_running =>', me.gi_running)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: me.gi_running')
try: print('me.gi_suspended =>', me.gi_suspended)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: me.gi_suspended')
try: print('C.__iter__.__code__.co_flags & 0x20 != 0 =>', C.__iter__.__code__.co_flags & 0x20 != 0)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: C.__iter__.__code__.co_flags & 0x20 != 0')
try: print('named.__code__.co_flags & 0x20 != 0 =>', named.__code__.co_flags & 0x20 != 0)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: named.__code__.co_flags & 0x20 != 0')
try: print('(lambda: 0).__code__.co_flags & 0x20 != 0 =>', (lambda: 0).__code__.co_flags & 0x20 != 0)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: (lambda: 0).__code__.co_flags & 0x20 != 0')
try: print('type(named).__name__ =>', type(named).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(named).__name__')
try: print('C().gen(1).__qualname__ =>', C().gen(1).__qualname__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: C().gen(1).__qualname__')
try: print('type(n)() =>', end=" "); t(lambda: type(n)())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: type(n)())')
try: print('type(n)(named.__code__) =>', end=" "); t(lambda: type(n)(named.__code__))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: type(n)(named.__code__))')
try: print('len(n) =>', end=" "); t(lambda: len(n))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: len(n))')
try: print('n[0] =>', end=" "); t(lambda: n[0])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: n[0])')
try: print('n + n =>', end=" "); t(lambda: n + n)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: n + n)')
try: print('n() =>', end=" "); t(lambda: n())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: n())')
try: print('reversed(n) =>', end=" "); t(lambda: reversed(n))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: reversed(n))')
try: print('hash(n) == hash(n) =>', end=" "); t(lambda: hash(n) == hash(n))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: hash(n) == hash(n))')
try: print('n == n =>', end=" "); t(lambda: n == n)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: n == n)')
try: print('n < n =>', end=" "); t(lambda: n < n)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: n < n)')
try: print('bool(n) =>', end=" "); t(lambda: bool(n))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: bool(n))')
try: print('type("X", (type(n),), {}) =>', end=" "); t(lambda: type("X", (type(n),), {}))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: type("X", (type(n),), {}))')
try: import sys
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import sys')
try: t(lambda: n.__reduce__()) if False else None
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: n.__reduce__()) if False else None')
# Locals visible through the frame.
try:
    def fl(a):
        b = a + 1
        yield
        c = b + 1
        yield
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def fl(a):')
try: x = fl(1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: x = fl(1)')
try: print(x.gi_frame.f_locals)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: x.gi_frame.f_locals')
try: next(x)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: next(x)')
try: print(x.gi_frame.f_locals)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: x.gi_frame.f_locals')
try: next(x)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: next(x)')
try: print(x.gi_frame.f_locals)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: x.gi_frame.f_locals')
try:
    for src in ("yield", "yield 1", "x = yield", "def f(): yield = 1", "def f(): x = yield = 1", "def f(): yield: int", "def f(): yield x for x in y", "def f(): (yield) = 1", "def f(): yield += 1", "def f(): x = yield 1, 2", "def f(): x = 1 + yield", "def f(): x = 1 + (yield)", "def f(): f(yield)", "def f(): f(yield 1)", "def f(): f(yield, 1)", "def f(): f(a=yield)", "def f(): [yield]", "def f(): [(yield)]", "def f(): x[yield]", "def f(): x[yield 1]", "def f(): return yield", "def f(): return (yield)", "def f(): yield yield", "def f(): yield (yield)", "def f(): del yield", "def f(): not yield", "def f(): yield not x", "def f(): lambda: yield", "def f(): lambda: (yield)", "def f(): x = yield from", "def f(): yield from x, y", "def f(): yield from *x", "def f(): yield *x", "def f(): yield *x, y", "def f(): yield **x", "class C: yield", "class C:\n def f(self): yield", "def f(): [(yield x) for x in y]", "def f(): ((yield x) for x in y)", "def f(): {(yield x) for x in y}", "def f(): {x: (yield) for x in y}", "def f(): [x for x in (yield)]", "def f(): [x for x in y if (yield)]", "def f(): [x for x in y for z in (yield)]", "def f(x=(yield)): pass", "def g():\n def f(x=(yield)): pass", "def f(x: (yield)): pass", "def f() -> (yield): pass", "def g():\n @(yield)\n def f(): pass", "def f(): if (yield): pass", "def f():\n if (yield): pass", "def f():\n while (yield): pass", "def f():\n for x in (yield): pass", "def f():\n with (yield): pass", "def f():\n with (yield) as x: pass", "def f():\n assert (yield)", "def f():\n raise (yield)", "def f(): yield; return 1", "def f(): await x; yield", "def f(): print(yield)", "def f(): x = yield; y = yield x", "def f(): (x := (yield))", "def f(): x := yield", "def f(): yield x := 1", "def f(): yield (x := 1)", "def f(): f'{yield}'", "def f(): f'{(yield)}'", "def f(): yield 1 if x else 2", "def f(): (yield 1) if x else (yield 2)", "def f(): x if yield else y", "def f(): yield,", "def f(): yield()", "def f(): yield[1]", "def f(): yield.x", "def f(): yield -1", "def f(): yield...", "def f(): global yield"):
        try: compile(src, "<s>", "exec"); print("ok:", src.replace("\n", "\\n"))
        except SyntaxError as e: print("SyntaxError:", e.msg, "<-", src.replace("\n", "\\n"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for src in ("yield", "yield 1", "x = yield", "def f(): yield = 1", "d...')
