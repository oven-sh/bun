# Functional style: higher-order functions, decorators, lazy sequences, hand-made itertools.
def compose(*fs):
    def run(x):
        for f in reversed(fs): x = f(x)
        return x
    return run
def pipe(x, *fs):
    for f in fs: x = f(x)
    return x
def curry(f, n=None):
    n = f.__code__.co_argcount if n is None else n
    def step(*a): return f(*a) if len(a) >= n else lambda *b: step(*a, *b)
    return step
def partial(f, *a, **k):
    def call(*b, **l): return f(*a, *b, **{**k, **l})
    call.func, call.args, call.keywords = f, a, k
    return call
def flip(f): return lambda a, b: f(b, a)
def reduce(f, it, *init):
    it = iter(it)
    if init: acc, = init
    else:
        try: acc = next(it)
        except StopIteration: raise TypeError("reduce() of empty iterable with no initial value") from None
    for x in it: acc = f(acc, x)
    return acc
inc = lambda x: x + 1; dbl = lambda x: x * 2; sq = lambda x: x * x
print(compose(inc, dbl, sq)(3), compose()(5), pipe(3, sq, dbl, inc), curry(lambda a, b, c: a + b * c)(1)(2)(3), curry(lambda a, b, c: (a, b, c))(1, 2)(3), curry(lambda a, b: a - b)(5, 3), partial(pow, 2)(10), partial(int, base=2)("101"), partial(print, "a", sep="-").keywords, flip(pow)(2, 10), reduce(lambda a, b: a * b, range(1, 8)), reduce(lambda a, b: a + [b], "abc", []), reduce(max, [3, 9, 2]), reduce(lambda a, b: a + b, [], 0))
try: reduce(max, [])
except TypeError as e: print("TypeError:", e)
print(list(map(compose(str, sq), range(4))), list(filter(compose(lambda b: not b, lambda x: x % 3), range(10))), sorted("hello World".split(), key=str.lower), sorted(range(-3, 4), key=lambda x: (abs(x), x)), [f(3) for f in (inc, dbl, sq)], [(lambda y: lambda x: x + y)(i)(10) for i in range(3)], list(map(lambda f, x: f(x), (inc, dbl), (1, 2))), (lambda *a, **k: (a, k))(1, 2, z=3), (lambda f: f(f, 5))(lambda f, n: 1 if n == 0 else n * f(f, n - 1)))
# Decorators.
def memoize(f):
    cache = {}
    def wrapper(*a):
        if a not in cache: cache[a] = f(*a)
        return cache[a]
    wrapper.cache = cache; wrapper.__name__ = f.__name__; wrapper.__wrapped__ = f
    return wrapper
def count_calls(f):
    def wrapper(*a, **k): wrapper.calls += 1; return f(*a, **k)
    wrapper.calls = 0; return wrapper
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
def retry(times, exc=Exception):
    def deco(f):
        def wrapper(*a, **k):
            for attempt in range(1, times + 1):
                try: return f(*a, **k)
                except exc as e:
                    if attempt == times: raise RuntimeError("gave up after %d attempts" % times) from e
        return wrapper
    return deco
def typed(*types):
    def deco(f):
        def wrapper(*a):
            for v, ty in zip(a, types):
                if not isinstance(v, ty): raise TypeError("%s: expected %s, got %s" % (f.__name__, ty.__name__, type(v).__name__))
            return f(*a)
        return wrapper
    return deco
@memoize
@count_calls
def fib(n): return n if n < 2 else fib(n - 1) + fib(n - 2)
print(fib(60), fib.__wrapped__.calls, len(fib.cache), fib.__name__)
log = []
@trace(log)
def fact(n): return 1 if n <= 1 else n * fact(n - 1)
print(fact(3)); print("\n".join(log))
attempts = []
@retry(3, ValueError)
def flaky(ok_on):
    attempts.append(1)
    if len(attempts) < ok_on: raise ValueError("attempt %d failed" % len(attempts))
    return "ok after %d" % len(attempts)
print(flaky(2)); attempts.clear()
try: flaky(9)
except RuntimeError as e: print("RuntimeError:", e, "| cause:", repr(e.__cause__))
@typed(int, str)
def rep(n, s): return s * n
print(rep(2, "ab"))
try: rep("2", "ab")
except TypeError as e: print("TypeError:", e)
class CountedMethod:
    def __init__(self, f): self.f = f; self.n = 0
    def __get__(self, o, t): return self if o is None else lambda *a: (setattr(self, "n", self.n + 1), self.f(o, *a))[1]
class Svc:
    @CountedMethod
    def ping(self, x): return "pong " + x
sv = Svc(); print(sv.ping("a"), sv.ping("b"), Svc.ping.n)
def singleton(cls):
    inst = []
    def get(*a, **k):
        if not inst: inst.append(cls(*a, **k))
        return inst[0]
    return get
@singleton
class Config:
    def __init__(self, v=1): self.v = v
print(Config(5) is Config(6), Config().v)
# Hand-made itertools.
def count(start=0, step=1):
    while True: yield start; start += step
def cycle(it):
    saved = list(it)
    while saved: yield from saved
def repeat(v, n=None):
    while n is None or n > 0:
        yield v
        if n is not None: n -= 1
def islice(it, *a):
    s = slice(*a); start, stop, step = s.start or 0, s.stop, s.step or 1; nxt = start
    for i, v in enumerate(it):
        if stop is not None and i >= stop: return
        if i == nxt: yield v; nxt += step
def chain(*its):
    for it in its: yield from it
def takewhile(p, it):
    for v in it:
        if not p(v): return
        yield v
def dropwhile(p, it):
    it = iter(it)
    for v in it:
        if not p(v): yield v; break
    yield from it
def accumulate(it, f=lambda a, b: a + b):
    it = iter(it)
    try: acc = next(it)
    except StopIteration: return
    yield acc
    for v in it: acc = f(acc, v); yield acc
def groupby(it, key=lambda v: v):
    group = []; cur = marker = object()
    for v in it:
        k = key(v)
        if k != cur and group: yield cur, group; group = []
        cur = k; group.append(v)
    if group: yield cur, group
def product(*its):
    if not its: yield (); return
    for v in its[0]:
        for rest in product(*its[1:]): yield (v,) + rest
def permutations(a, r=None):
    a = tuple(a); r = len(a) if r is None else r
    if r == 0: yield (); return
    for i in range(len(a)):
        for p in permutations(a[:i] + a[i + 1:], r - 1): yield (a[i],) + p
def combinations(a, r):
    a = tuple(a)
    if r == 0: yield (); return
    for i in range(len(a)):
        for c in combinations(a[i + 1:], r - 1): yield (a[i],) + c
def zip_longest(*its, fill=None):
    its = [iter(i) for i in its]; done = object()
    while True:
        row = [next(i, done) for i in its]
        if all(v is done for v in row): return
        yield tuple(fill if v is done else v for v in row)
def pairwise(it):
    it = iter(it); a = next(it, None)
    for b in it: yield a, b; a = b
def batched(it, n):
    b = []
    for v in it:
        b.append(v)
        if len(b) == n: yield tuple(b); b = []
    if b: yield tuple(b)
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
def starmap(f, it): return (f(*a) for a in it)
def compress(d, s): return (v for v, k in zip(d, s) if k)
def unique(it, key=lambda v: v):
    seen = set()
    for v in it:
        if key(v) not in seen: seen.add(key(v)); yield v
def flatten(it):
    for v in it:
        if isinstance(v, (list, tuple)): yield from flatten(v)
        else: yield v
print(list(islice(count(5, 3), 4)), list(islice(cycle("ab"), 5)), list(repeat("x", 3)), list(islice(range(20), 2, 12, 3)), list(islice("abcdef", 2)), list(chain("ab", [1], (2,), range(2))), list(takewhile(lambda v: v < 3, [1, 2, 3, 1])), list(dropwhile(lambda v: v < 3, [1, 2, 3, 1])), list(accumulate([1, 2, 3, 4])), list(accumulate([1, 2, 3, 4], lambda a, b: a * b)), list(accumulate([])))
print(list(groupby("aaabbcaa")), [(k, len(g)) for k, g in groupby(sorted("hello world".replace(" ", "")))], list(groupby(range(7), lambda v: v // 3)), list(product("ab", [1, 2])), len(list(product(range(3), range(3), range(3)))), list(product()), list(permutations("abc", 2)), len(list(permutations(range(5)))), list(combinations("abcd", 3)), len(list(combinations(range(10), 4))))
print(list(zip_longest("abc", [1], fill="-")), list(pairwise("abcd")), list(batched(range(7), 3)), [list(g) for g in tee(range(4), 3)], list(starmap(pow, [(2, 3), (3, 2)])), list(compress("abcd", [1, 0, 1, 0])), list(unique([3, 1, 3, 2, 1])), list(unique("aAbBa", str.lower)), list(flatten([1, [2, (3, [4, [5]])], 6])))
a, b = tee(count()); print(next(a), next(a), next(b), next(a), next(b), next(b), next(b))
# Lazy pipelines over infinite sequences.
def primes():
    found = []
    for n in count(2):
        if all(n % p for p in takewhile(lambda p: p * p <= n, found)): found.append(n); yield n
def fibs():
    a, b = 0, 1
    while True: yield a; a, b = b, a + b
print(list(islice(primes(), 15)), list(takewhile(lambda v: v < 100, fibs())), next(v for v in fibs() if v > 10 ** 12), list(islice((p for p in primes() if p % 10 == 3), 6)), sum(islice((v * v for v in count(1) if v % 2), 10)), list(islice(zip(primes(), fibs()), 4)), next(dropwhile(lambda p: p < 500, primes())))
def sieve(it):
    p = next(it); yield p
    yield from sieve(v for v in it if v % p)
print(list(islice(sieve(count(2)), 12)))
# Closures as objects.
def counter(start=0):
    n = start
    def inc(by=1): nonlocal n; n += by; return n
    def get(): return n
    def reset(): nonlocal n; n = start
    return inc, get, reset
i1, g1, r1 = counter(); i2, g2, _ = counter(100); i1(); i1(5); i2(); print(g1(), g2()); r1(); print(g1(), i1.__closure__[0].cell_contents, [c.cell_contents for c in r1.__closure__])
def make_stack():
    items = []
    return {"push": items.append, "pop": items.pop, "size": lambda: len(items), "peek": lambda: items[-1]}
st = make_stack(); st["push"](1); st["push"](2); print(st["pop"](), st["size"](), st["peek"]())
def trampoline(f, *a):
    r = f(*a)
    while callable(r): r = r()
    return r
def t_sum(n, acc=0): return acc if n == 0 else lambda: t_sum(n - 1, acc + n)
def t_even(n): return True if n == 0 else lambda: t_odd(n - 1)
def t_odd(n): return False if n == 0 else lambda: t_even(n - 1)
print(trampoline(t_sum, 3000), trampoline(t_even, 2001))
# A round-robin scheduler of generator tasks.
def task(name, n):
    for i in range(n):
        got = yield "%s%d" % (name, i)
        if got: out.append("%s got %s" % (name, got))
    return name + " finished"
out = []; queue = [[task("a", 3), False], [task("b", 1), False], [task("c", 2), False]]; tick = 0
while queue:
    entry = queue.pop(0); tick += 1
    try:
        out.append(entry[0].send("tick%d" % tick if entry[1] and tick % 4 == 0 else None)); entry[1] = True; queue.append(entry)
    except StopIteration as e: out.append(e.value)
print(out)
# Church numerals and friends.
zero = lambda f: lambda x: x; succ = lambda n: lambda f: lambda x: f(n(f)(x)); add = lambda m: lambda n: lambda f: lambda x: m(f)(n(f)(x)); mul = lambda m: lambda n: lambda f: m(n(f)); to_int = lambda n: n(lambda v: v + 1)(0)
one = succ(zero); two = succ(one); three = add(one)(two); print(to_int(zero), to_int(three), to_int(mul(three)(two)), to_int(mul(three)(add(three)(two))), to_int(three(two)))
T = lambda a: lambda b: a; F = lambda a: lambda b: b; AND = lambda p: lambda q: p(q)(p); OR = lambda p: lambda q: p(p)(q); NOT = lambda p: p(F)(T); show = lambda p: p("T")("F"); print(show(AND(T)(F)), show(OR(T)(F)), show(NOT(F)), show(AND(T)(NOT(F))))
pair = lambda a: lambda b: lambda f: f(a)(b); fst = lambda p: p(T); snd = lambda p: p(F); print(fst(pair(1)(2)), snd(pair(1)(2)))
