# Functional style: higher-order functions, decorators, lazy sequences, hand-made itertools.
try:
    def compose(*fs):
        def run(x):
            for f in reversed(fs): x = f(x)
            return x
        return run
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def compose(*fs):')
try:
    def pipe(x, *fs):
        for f in fs: x = f(x)
        return x
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def pipe(x, *fs):')
try:
    def curry(f, n=None):
        n = f.__code__.co_argcount if n is None else n
        def step(*a): return f(*a) if len(a) >= n else lambda *b: step(*a, *b)
        return step
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def curry(f, n=None):')
try:
    def partial(f, *a, **k):
        def call(*b, **l): return f(*a, *b, **{**k, **l})
        call.func, call.args, call.keywords = f, a, k
        return call
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def partial(f, *a, **k):')
try:
    def flip(f): return lambda a, b: f(b, a)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def flip(f): return lambda a, b: f(b, a)')
try:
    def reduce(f, it, *init):
        it = iter(it)
        if init: acc, = init
        else:
            try: acc = next(it)
            except StopIteration: raise TypeError("reduce() of empty iterable with no initial value") from None
        for x in it: acc = f(acc, x)
        return acc
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def reduce(f, it, *init):')
try: inc = lambda x: x + 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: inc = lambda x: x + 1')
try: dbl = lambda x: x * 2
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: dbl = lambda x: x * 2')
try: sq = lambda x: x * x
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sq = lambda x: x * x')
try: print('compose(inc, dbl, sq)(3) =>', compose(inc, dbl, sq)(3))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: compose(inc, dbl, sq)(3)')
try: print('compose()(5) =>', compose()(5))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: compose()(5)')
try: print('pipe(3, sq, dbl, inc) =>', pipe(3, sq, dbl, inc))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: pipe(3, sq, dbl, inc)')
try: print('curry(lambda a, b, c: a + b * c)(1)(2)(3) =>', curry(lambda a, b, c: a + b * c)(1)(2)(3))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: curry(lambda a, b, c: a + b * c)(1)(2)(3)')
try: print('curry(lambda a, b, c: (a, b, c))(1, 2)(3) =>', curry(lambda a, b, c: (a, b, c))(1, 2)(3))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: curry(lambda a, b, c: (a, b, c))(1, 2)(3)')
try: print('curry(lambda a, b: a - b)(5, 3) =>', curry(lambda a, b: a - b)(5, 3))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: curry(lambda a, b: a - b)(5, 3)')
try: print('partial(pow, 2)(10) =>', partial(pow, 2)(10))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: partial(pow, 2)(10)')
try: print('partial(int, base=2)("101") =>', partial(int, base=2)("101"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: partial(int, base=2)("101")')
try: print('partial(print, "a", sep="-").keywords =>', partial(print, "a", sep="-").keywords)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: partial(print, "a", sep="-").keywords')
try: print('flip(pow)(2, 10) =>', flip(pow)(2, 10))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: flip(pow)(2, 10)')
try: print('reduce(lambda a, b: a * b, range(1, 8)) =>', reduce(lambda a, b: a * b, range(1, 8)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: reduce(lambda a, b: a * b, range(1, 8))')
try: print('reduce(lambda a, b: a + [b], "abc", []) =>', reduce(lambda a, b: a + [b], "abc", []))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: reduce(lambda a, b: a + [b], "abc", [])')
try: print('reduce(max, [3, 9, 2]) =>', reduce(max, [3, 9, 2]))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: reduce(max, [3, 9, 2])')
try: print('reduce(lambda a, b: a + b, [], 0) =>', reduce(lambda a, b: a + b, [], 0))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: reduce(lambda a, b: a + b, [], 0)')
try:
    try: reduce(max, [])
    except TypeError as e: print("TypeError:", e)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try: reduce(max, [])')
try: print('list(map(compose(str, sq), range(4))) =>', list(map(compose(str, sq), range(4))))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list(map(compose(str, sq), range(4)))')
try: print('list(filter(compose(lambda b: not b, lambda x: x % 3), range(10))) =>', list(filter(compose(lambda b: not b, lambda x: x % 3), range(10))))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list(filter(compose(lambda b: not b, lambda x: x % 3), range(10)))')
try: print('sorted("hello World".split(), key=str.lower) =>', sorted("hello World".split(), key=str.lower))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sorted("hello World".split(), key=str.lower)')
try: print('sorted(range(-3, 4), key=lambda x: (abs(x), x)) =>', sorted(range(-3, 4), key=lambda x: (abs(x), x)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sorted(range(-3, 4), key=lambda x: (abs(x), x))')
try: print('[f(3) for f in (inc, dbl, sq)] =>', [f(3) for f in (inc, dbl, sq)])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [f(3) for f in (inc, dbl, sq)]')
try: print('[(lambda y: lambda x: x + y)(i)(10) for i in range(3)] =>', [(lambda y: lambda x: x + y)(i)(10) for i in range(3)])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [(lambda y: lambda x: x + y)(i)(10) for i in range(3)]')
try: print('list(map(lambda f, x: f(x), (inc, dbl), (1, 2))) =>', list(map(lambda f, x: f(x), (inc, dbl), (1, 2))))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list(map(lambda f, x: f(x), (inc, dbl), (1, 2)))')
try: print('(lambda *a, **k: (a, k))(1, 2, z=3) =>', (lambda *a, **k: (a, k))(1, 2, z=3))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: (lambda *a, **k: (a, k))(1, 2, z=3)')
try: print('(lambda f: f(f, 5))(lambda f, n: 1 if n == 0 else n * f(f, n - 1)) =>', (lambda f: f(f, 5))(lambda f, n: 1 if n == 0 else n * f(f, n - 1)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: (lambda f: f(f, 5))(lambda f, n: 1 if n == 0 else n * f(f, n - 1))')
# Decorators.
try:
    def memoize(f):
        cache = {}
        def wrapper(*a):
            if a not in cache: cache[a] = f(*a)
            return cache[a]
        wrapper.cache = cache; wrapper.__name__ = f.__name__; wrapper.__wrapped__ = f
        return wrapper
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def memoize(f):')
try:
    def count_calls(f):
        def wrapper(*a, **k): wrapper.calls += 1; return f(*a, **k)
        wrapper.calls = 0; return wrapper
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def count_calls(f):')
try:
    def trace(log):
        def deco(f):
            depth = [0]
            def wrapper(*a):
                log.append("%s%s%r" % ("  " * depth[0], f.__name__, a)); depth[0] += 1
                try: r = f(*a)
                finally: depth[0] -= 1
                log.append("%s-> %r" % ("  " * depth[0], r)); return r
            return wrapper
        return deco
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def trace(log):')
try:
    def retry(times, exc=Exception):
        def deco(f):
            def wrapper(*a, **k):
                for attempt in range(1, times + 1):
                    try: return f(*a, **k)
                    except exc as e:
                        if attempt == times: raise RuntimeError("gave up after %d attempts" % times) from e
            return wrapper
        return deco
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def retry(times, exc=Exception):')
try:
    def typed(*types):
        def deco(f):
            def wrapper(*a):
                for v, ty in zip(a, types):
                    if not isinstance(v, ty): raise TypeError("%s: expected %s, got %s" % (f.__name__, ty.__name__, type(v).__name__))
                return f(*a)
            return wrapper
        return deco
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def typed(*types):')
try:
    @memoize
    @count_calls
    def fib(n): return n if n < 2 else fib(n - 1) + fib(n - 2)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def fib(n): return n if n < 2 else fib(n - 1) + fib(n - 2)')
try: print('fib(60) =>', fib(60))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: fib(60)')
try: print('fib.__wrapped__.calls =>', fib.__wrapped__.calls)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: fib.__wrapped__.calls')
try: print('len(fib.cache) =>', len(fib.cache))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: len(fib.cache)')
try: print('fib.__name__ =>', fib.__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: fib.__name__')
try: log = []
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: log = []')
try:
    @trace(log)
    def fact(n): return 1 if n <= 1 else n * fact(n - 1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def fact(n): return 1 if n <= 1 else n * fact(n - 1)')
try: print(fact(3))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: fact(3)')
try: print("\n".join(log))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: "\\n".join(log)')
try: attempts = []
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: attempts = []')
try:
    @retry(3, ValueError)
    def flaky(ok_on):
        attempts.append(1)
        if len(attempts) < ok_on: raise ValueError("attempt %d failed" % len(attempts))
        return "ok after %d" % len(attempts)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def flaky(ok_on):')
try: print(flaky(2))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: flaky(2)')
try: attempts.clear()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: attempts.clear()')
try:
    try: flaky(9)
    except RuntimeError as e: print("RuntimeError:", e, "| cause:", repr(e.__cause__))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try: flaky(9)')
try:
    @typed(int, str)
    def rep(n, s): return s * n
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def rep(n, s): return s * n')
try: print(rep(2, "ab"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: rep(2, "ab")')
try:
    try: rep("2", "ab")
    except TypeError as e: print("TypeError:", e)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try: rep("2", "ab")')
try:
    class CountedMethod:
        def __init__(self, f): self.f = f; self.n = 0
        def __get__(self, o, t): return self if o is None else lambda *a: (setattr(self, "n", self.n + 1), self.f(o, *a))[1]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class CountedMethod:')
try:
    class Svc:
        @CountedMethod
        def ping(self, x): return "pong " + x
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Svc:')
try: sv = Svc()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sv = Svc()')
try: print('sv.ping("a") =>', sv.ping("a"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sv.ping("a")')
try: print('sv.ping("b") =>', sv.ping("b"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sv.ping("b")')
try: print('Svc.ping.n =>', Svc.ping.n)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Svc.ping.n')
try:
    def singleton(cls):
        inst = []
        def get(*a, **k):
            if not inst: inst.append(cls(*a, **k))
            return inst[0]
        return get
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def singleton(cls):')
try:
    @singleton
    class Config:
        def __init__(self, v=1): self.v = v
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Config:')
try: print('Config(5) is Config(6) =>', Config(5) is Config(6))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Config(5) is Config(6)')
try: print('Config().v =>', Config().v)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Config().v')
# Hand-made itertools.
try:
    def count(start=0, step=1):
        while True: yield start; start += step
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def count(start=0, step=1):')
try:
    def cycle(it):
        saved = list(it)
        while saved: yield from saved
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def cycle(it):')
try:
    def repeat(v, n=None):
        while n is None or n > 0:
            yield v
            if n is not None: n -= 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def repeat(v, n=None):')
try:
    def islice(it, *a):
        s = slice(*a); start, stop, step = s.start or 0, s.stop, s.step or 1; nxt = start
        for i, v in enumerate(it):
            if stop is not None and i >= stop: return
            if i == nxt: yield v; nxt += step
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def islice(it, *a):')
try:
    def chain(*its):
        for it in its: yield from it
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def chain(*its):')
try:
    def takewhile(p, it):
        for v in it:
            if not p(v): return
            yield v
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def takewhile(p, it):')
try:
    def dropwhile(p, it):
        it = iter(it)
        for v in it:
            if not p(v): yield v; break
        yield from it
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def dropwhile(p, it):')
try:
    def accumulate(it, f=lambda a, b: a + b):
        it = iter(it)
        try: acc = next(it)
        except StopIteration: return
        yield acc
        for v in it: acc = f(acc, v); yield acc
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def accumulate(it, f=lambda a, b: a + b):')
try:
    def groupby(it, key=lambda v: v):
        group = []; cur = marker = object()
        for v in it:
            k = key(v)
            if k != cur and group: yield cur, group; group = []
            cur = k; group.append(v)
        if group: yield cur, group
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def groupby(it, key=lambda v: v):')
try:
    def product(*its):
        if not its: yield (); return
        for v in its[0]:
            for rest in product(*its[1:]): yield (v,) + rest
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def product(*its):')
try:
    def permutations(a, r=None):
        a = tuple(a); r = len(a) if r is None else r
        if r == 0: yield (); return
        for i in range(len(a)):
            for p in permutations(a[:i] + a[i + 1:], r - 1): yield (a[i],) + p
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def permutations(a, r=None):')
try:
    def combinations(a, r):
        a = tuple(a)
        if r == 0: yield (); return
        for i in range(len(a)):
            for c in combinations(a[i + 1:], r - 1): yield (a[i],) + c
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def combinations(a, r):')
try:
    def zip_longest(*its, fill=None):
        its = [iter(i) for i in its]; done = object()
        while True:
            row = [next(i, done) for i in its]
            if all(v is done for v in row): return
            yield tuple(fill if v is done else v for v in row)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def zip_longest(*its, fill=None):')
try:
    def pairwise(it):
        it = iter(it); a = next(it, None)
        for b in it: yield a, b; a = b
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def pairwise(it):')
try:
    def batched(it, n):
        b = []
        for v in it:
            b.append(v)
            if len(b) == n: yield tuple(b); b = []
        if b: yield tuple(b)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def batched(it, n):')
try:
    def tee(it, n=2):
        it = iter(it); queues = [[] for _ in range(n)]
        def gen(q):
            while True:
                if not q:
                    try: v = next(it)
                    except StopIteration: return
                    for other in queues: other.append(v)
                yield q.pop(0)
        return tuple(gen(q) for q in queues)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def tee(it, n=2):')
try:
    def starmap(f, it): return (f(*a) for a in it)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def starmap(f, it): return (f(*a) for a in it)')
try:
    def compress(d, s): return (v for v, k in zip(d, s) if k)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def compress(d, s): return (v for v, k in zip(d, s) if k)')
try:
    def unique(it, key=lambda v: v):
        seen = set()
        for v in it:
            if key(v) not in seen: seen.add(key(v)); yield v
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def unique(it, key=lambda v: v):')
try:
    def flatten(it):
        for v in it:
            if isinstance(v, (list, tuple)): yield from flatten(v)
            else: yield v
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def flatten(it):')
try: print('list(islice(count(5, 3), 4)) =>', list(islice(count(5, 3), 4)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list(islice(count(5, 3), 4))')
try: print('list(islice(cycle("ab"), 5)) =>', list(islice(cycle("ab"), 5)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list(islice(cycle("ab"), 5))')
try: print('list(repeat("x", 3)) =>', list(repeat("x", 3)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list(repeat("x", 3))')
try: print('list(islice(range(20), 2, 12, 3)) =>', list(islice(range(20), 2, 12, 3)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list(islice(range(20), 2, 12, 3))')
try: print('list(islice("abcdef", 2)) =>', list(islice("abcdef", 2)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list(islice("abcdef", 2))')
try: print('list(chain("ab", [1], (2,), range(2))) =>', list(chain("ab", [1], (2,), range(2))))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list(chain("ab", [1], (2,), range(2)))')
try: print('list(takewhile(lambda v: v < 3, [1, 2, 3, 1])) =>', list(takewhile(lambda v: v < 3, [1, 2, 3, 1])))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list(takewhile(lambda v: v < 3, [1, 2, 3, 1]))')
try: print('list(dropwhile(lambda v: v < 3, [1, 2, 3, 1])) =>', list(dropwhile(lambda v: v < 3, [1, 2, 3, 1])))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list(dropwhile(lambda v: v < 3, [1, 2, 3, 1]))')
try: print('list(accumulate([1, 2, 3, 4])) =>', list(accumulate([1, 2, 3, 4])))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list(accumulate([1, 2, 3, 4]))')
try: print('list(accumulate([1, 2, 3, 4], lambda a, b: a * b)) =>', list(accumulate([1, 2, 3, 4], lambda a, b: a * b)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list(accumulate([1, 2, 3, 4], lambda a, b: a * b))')
try: print('list(accumulate([])) =>', list(accumulate([])))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list(accumulate([]))')
try: print('list(groupby("aaabbcaa")) =>', list(groupby("aaabbcaa")))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list(groupby("aaabbcaa"))')
try: print('[(k, len(g)) for k, g in groupby(sorted("hello world".replace(" ", ""... =>', [(k, len(g)) for k, g in groupby(sorted("hello world".replace(" ", "")))])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [(k, len(g)) for k, g in groupby(sorted("hello world".replace(" ", ""...')
try: print('list(groupby(range(7), lambda v: v // 3)) =>', list(groupby(range(7), lambda v: v // 3)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list(groupby(range(7), lambda v: v // 3))')
try: print('list(product("ab", [1, 2])) =>', list(product("ab", [1, 2])))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list(product("ab", [1, 2]))')
try: print('len(list(product(range(3), range(3), range(3)))) =>', len(list(product(range(3), range(3), range(3)))))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: len(list(product(range(3), range(3), range(3))))')
try: print('list(product()) =>', list(product()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list(product())')
try: print('list(permutations("abc", 2)) =>', list(permutations("abc", 2)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list(permutations("abc", 2))')
try: print('len(list(permutations(range(5)))) =>', len(list(permutations(range(5)))))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: len(list(permutations(range(5))))')
try: print('list(combinations("abcd", 3)) =>', list(combinations("abcd", 3)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list(combinations("abcd", 3))')
try: print('len(list(combinations(range(10), 4))) =>', len(list(combinations(range(10), 4))))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: len(list(combinations(range(10), 4)))')
try: print('list(zip_longest("abc", [1], fill="-")) =>', list(zip_longest("abc", [1], fill="-")))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list(zip_longest("abc", [1], fill="-"))')
try: print('list(pairwise("abcd")) =>', list(pairwise("abcd")))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list(pairwise("abcd"))')
try: print('list(batched(range(7), 3)) =>', list(batched(range(7), 3)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list(batched(range(7), 3))')
try: print('[list(g) for g in tee(range(4), 3)] =>', [list(g) for g in tee(range(4), 3)])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [list(g) for g in tee(range(4), 3)]')
try: print('list(starmap(pow, [(2, 3), (3, 2)])) =>', list(starmap(pow, [(2, 3), (3, 2)])))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list(starmap(pow, [(2, 3), (3, 2)]))')
try: print('list(compress("abcd", [1, 0, 1, 0])) =>', list(compress("abcd", [1, 0, 1, 0])))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list(compress("abcd", [1, 0, 1, 0]))')
try: print('list(unique([3, 1, 3, 2, 1])) =>', list(unique([3, 1, 3, 2, 1])))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list(unique([3, 1, 3, 2, 1]))')
try: print('list(unique("aAbBa", str.lower)) =>', list(unique("aAbBa", str.lower)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list(unique("aAbBa", str.lower))')
try: print('list(flatten([1, [2, (3, [4, [5]])], 6])) =>', list(flatten([1, [2, (3, [4, [5]])], 6])))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list(flatten([1, [2, (3, [4, [5]])], 6]))')
try: a, b = tee(count())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a, b = tee(count())')
try: print('next(a) =>', next(a))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: next(a)')
try: print('next(a) =>', next(a))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: next(a)')
try: print('next(b) =>', next(b))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: next(b)')
try: print('next(a) =>', next(a))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: next(a)')
try: print('next(b) =>', next(b))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: next(b)')
try: print('next(b) =>', next(b))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: next(b)')
try: print('next(b) =>', next(b))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: next(b)')
# Lazy pipelines over infinite sequences.
try:
    def primes():
        found = []
        for n in count(2):
            if all(n % p for p in takewhile(lambda p: p * p <= n, found)): found.append(n); yield n
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def primes():')
try:
    def fibs():
        a, b = 0, 1
        while True: yield a; a, b = b, a + b
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def fibs():')
try: print('list(islice(primes(), 15)) =>', list(islice(primes(), 15)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list(islice(primes(), 15))')
try: print('list(takewhile(lambda v: v < 100, fibs())) =>', list(takewhile(lambda v: v < 100, fibs())))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list(takewhile(lambda v: v < 100, fibs()))')
try: print('next(v for v in fibs() if v > 10 ** 12) =>', next(v for v in fibs() if v > 10 ** 12))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: next(v for v in fibs() if v > 10 ** 12)')
try: print('list(islice((p for p in primes() if p % 10 == 3), 6)) =>', list(islice((p for p in primes() if p % 10 == 3), 6)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list(islice((p for p in primes() if p % 10 == 3), 6))')
try: print('sum(islice((v * v for v in count(1) if v % 2), 10)) =>', sum(islice((v * v for v in count(1) if v % 2), 10)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sum(islice((v * v for v in count(1) if v % 2), 10))')
try: print('list(islice(zip(primes(), fibs()), 4)) =>', list(islice(zip(primes(), fibs()), 4)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list(islice(zip(primes(), fibs()), 4))')
try: print('next(dropwhile(lambda p: p < 500, primes())) =>', next(dropwhile(lambda p: p < 500, primes())))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: next(dropwhile(lambda p: p < 500, primes()))')
try:
    def sieve(it):
        p = next(it); yield p
        yield from sieve(v for v in it if v % p)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def sieve(it):')
try: print(list(islice(sieve(count(2)), 12)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list(islice(sieve(count(2)), 12))')
# Closures as objects.
try:
    def counter(start=0):
        n = start
        def inc(by=1): nonlocal n; n += by; return n
        def get(): return n
        def reset(): nonlocal n; n = start
        return inc, get, reset
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def counter(start=0):')
try: i1, g1, r1 = counter()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: i1, g1, r1 = counter()')
try: i2, g2, _ = counter(100)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: i2, g2, _ = counter(100)')
try: i1()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: i1()')
try: i1(5)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: i1(5)')
try: i2()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: i2()')
try: print('g1() =>', g1())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g1()')
try: print('g2() =>', g2())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g2()')
try: r1()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: r1()')
try: print('g1() =>', g1())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g1()')
try: print('i1.__closure__[0].cell_contents =>', i1.__closure__[0].cell_contents)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: i1.__closure__[0].cell_contents')
try: print('[c.cell_contents for c in r1.__closure__] =>', [c.cell_contents for c in r1.__closure__])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [c.cell_contents for c in r1.__closure__]')
try:
    def make_stack():
        items = []
        return {"push": items.append, "pop": items.pop, "size": lambda: len(items), "peek": lambda: items[-1]}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def make_stack():')
try: st = make_stack()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: st = make_stack()')
try: st["push"](1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: st["push"](1)')
try: st["push"](2)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: st["push"](2)')
try: print('st["pop"]() =>', st["pop"]())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: st["pop"]()')
try: print('st["size"]() =>', st["size"]())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: st["size"]()')
try: print('st["peek"]() =>', st["peek"]())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: st["peek"]()')
try:
    def trampoline(f, *a):
        r = f(*a)
        while callable(r): r = r()
        return r
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def trampoline(f, *a):')
try:
    def t_sum(n, acc=0): return acc if n == 0 else lambda: t_sum(n - 1, acc + n)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def t_sum(n, acc=0): return acc if n == 0 else lambda: t_sum(n - 1, a...')
try:
    def t_even(n): return True if n == 0 else lambda: t_odd(n - 1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def t_even(n): return True if n == 0 else lambda: t_odd(n - 1)')
try:
    def t_odd(n): return False if n == 0 else lambda: t_even(n - 1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def t_odd(n): return False if n == 0 else lambda: t_even(n - 1)')
try: print('trampoline(t_sum, 3000) =>', trampoline(t_sum, 3000))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: trampoline(t_sum, 3000)')
try: print('trampoline(t_even, 2001) =>', trampoline(t_even, 2001))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: trampoline(t_even, 2001)')
# A round-robin scheduler of generator tasks.
try:
    def task(name, n):
        for i in range(n):
            got = yield "%s%d" % (name, i)
            if got: out.append("%s got %s" % (name, got))
        return name + " finished"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def task(name, n):')
try: out = []
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: out = []')
try: queue = [[task("a", 3), False], [task("b", 1), False], [task("c", 2), False]]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: queue = [[task("a", 3), False], [task("b", 1), False], [task("c", 2),...')
try: tick = 0
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: tick = 0')
try:
    while queue:
        try: entry = queue.pop(0)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: entry = queue.pop(0)')
        try: tick += 1
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: tick += 1')
        try:
            out.append(entry[0].send("tick%d" % tick if entry[1] and tick % 4 == 0 else None))
            entry[1] = True
            queue.append(entry)
        except StopIteration as e: out.append(e.value)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: while queue:')
try: print(out)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: out')
# Church numerals and friends.
try: zero = lambda f: lambda x: x
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: zero = lambda f: lambda x: x')
try: succ = lambda n: lambda f: lambda x: f(n(f)(x))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: succ = lambda n: lambda f: lambda x: f(n(f)(x))')
try: add = lambda m: lambda n: lambda f: lambda x: m(f)(n(f)(x))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: add = lambda m: lambda n: lambda f: lambda x: m(f)(n(f)(x))')
try: mul = lambda m: lambda n: lambda f: m(n(f))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: mul = lambda m: lambda n: lambda f: m(n(f))')
try: to_int = lambda n: n(lambda v: v + 1)(0)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: to_int = lambda n: n(lambda v: v + 1)(0)')
try: one = succ(zero)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: one = succ(zero)')
try: two = succ(one)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: two = succ(one)')
try: three = add(one)(two)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: three = add(one)(two)')
try: print('to_int(zero) =>', to_int(zero))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: to_int(zero)')
try: print('to_int(three) =>', to_int(three))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: to_int(three)')
try: print('to_int(mul(three)(two)) =>', to_int(mul(three)(two)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: to_int(mul(three)(two))')
try: print('to_int(mul(three)(add(three)(two))) =>', to_int(mul(three)(add(three)(two))))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: to_int(mul(three)(add(three)(two)))')
try: print('to_int(three(two)) =>', to_int(three(two)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: to_int(three(two))')
try: T = lambda a: lambda b: a
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: T = lambda a: lambda b: a')
try: F = lambda a: lambda b: b
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: F = lambda a: lambda b: b')
try: AND = lambda p: lambda q: p(q)(p)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: AND = lambda p: lambda q: p(q)(p)')
try: OR = lambda p: lambda q: p(p)(q)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: OR = lambda p: lambda q: p(p)(q)')
try: NOT = lambda p: p(F)(T)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: NOT = lambda p: p(F)(T)')
try: show = lambda p: p("T")("F")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show = lambda p: p("T")("F")')
try: print('show(AND(T)(F)) =>', show(AND(T)(F)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(AND(T)(F))')
try: print('show(OR(T)(F)) =>', show(OR(T)(F)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(OR(T)(F))')
try: print('show(NOT(F)) =>', show(NOT(F)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(NOT(F))')
try: print('show(AND(T)(NOT(F))) =>', show(AND(T)(NOT(F))))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(AND(T)(NOT(F)))')
try: pair = lambda a: lambda b: lambda f: f(a)(b)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: pair = lambda a: lambda b: lambda f: f(a)(b)')
try: fst = lambda p: p(T)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: fst = lambda p: p(T)')
try: snd = lambda p: p(F)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: snd = lambda p: p(F)')
try: print('fst(pair(1)(2)) =>', fst(pair(1)(2)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: fst(pair(1)(2))')
try: print('snd(pair(1)(2)) =>', snd(pair(1)(2)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: snd(pair(1)(2))')
