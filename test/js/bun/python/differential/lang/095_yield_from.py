def t(f):
    try:
        print(repr(f()))
    except BaseException as e:
        print(type(e).__name__ + ':', e)

def inner():
    yield 1
    yield 2
    return "inner result"
def outer():
    r = yield from inner()
    print("got", r, end="; ")
    yield 3
    return "outer result"
print(list(outer()))
g = outer(); print(next(g), next(g), next(g))
try: next(g)
except StopIteration as e: print(e.value)
def from_iterables():
    yield from [1, 2]
    yield from (3, 4)
    yield from "ab"
    yield from range(2)
    yield from {5: 6}
    yield from {7}
    yield from iter([8])
    yield from (x * 2 for x in range(2))
    yield from b"\x01"
    yield from []
    yield from ()
    yield from map(str, [9])
    yield from zip("a", "b")
    yield from enumerate("z")
    r = yield from [10]
    yield ("result of a plain iterable", r)
print(list(from_iterables()))
def bad(x):
    yield from x
t(lambda: list(bad(5))); t(lambda: list(bad(None))); t(lambda: list(bad(len))); t(lambda: list(bad(object()))); t(lambda: list(bad(1.5))); t(lambda: list(bad(int)))
# send, throw and close are forwarded.
def sub():
    log = []
    while True:
        try: v = yield len(log)
        except ValueError as e: log.append("thrown " + str(e)); continue
        except GeneratorExit: print("sub closed with", log, end="; "); raise
        if v == "stop": return log
        log.append(v)
def deleg():
    r = yield from sub()
    yield ("sub returned", r)
d = deleg(); print(next(d), d.send("a"), d.send("b"), d.throw(ValueError("x")), d.send("c"), d.send("stop"))
d = deleg(); next(d); d.send("a"); print(d.close())
d = deleg(); next(d); t(lambda: d.throw(KeyError("not handled by sub"))); t(lambda: next(d))
def deleg_catch():
    try: yield from sub()
    except KeyError as e: yield ("outer caught", repr(e))
d = deleg_catch(); next(d); print(d.throw(KeyError("k")))
# gi_yieldfrom
def yf():
    yield from inner()
    yield "own"
y = yf(); print(y.gi_yieldfrom); next(y); print(type(y.gi_yieldfrom).__name__, y.gi_yieldfrom.__name__); next(y); next(y); print(y.gi_yieldfrom)
def yfl(): yield from [1, 2]
y = yfl(); next(y); print(type(y.gi_yieldfrom).__name__)
# send() to a plain iterator: None uses next(), anything else needs send.
def to_list(): yield from [1, 2, 3]
g = to_list(); print(next(g), g.send(None)); t(lambda: g.send(5)); t(lambda: next(g))
g = to_list(); next(g); t(lambda: g.throw(ValueError("to a list iterator"))); t(lambda: next(g))
g = to_list(); next(g); print(g.close())
class It:
    def __init__(s): s.n = 0
    def __iter__(s): return s
    def __next__(s):
        s.n += 1
        if s.n > 2: raise StopIteration("iterator result")
        return s.n
def from_it():
    r = yield from It()
    yield r
print(list(from_it()))
class Full(It):
    def send(s, v): return ("send", v)
    def throw(s, *a): return ("throw", a[0].__name__ if isinstance(a[0], type) else repr(a[0]), len(a))
    def close(s): print("Full.close", end="; ")
def from_full(): yield from Full()
g = from_full(); print(next(g), g.send(1), g.throw(ValueError), g.throw(KeyError("k")), g.send(None), g.close())
class CloseRaises(It):
    def close(s): raise RuntimeError("close failed")
def from_cr(): yield from CloseRaises()
g = from_cr(); next(g); t(g.close)
class ThrowRaisesStop(It):
    def throw(s, *a): raise StopIteration("from throw")
def from_trs():
    r = yield from ThrowRaisesStop()
    yield ("resumed with", r)
g = from_trs(); next(g); print(g.throw(ValueError))
class NoThrowButClose(It):
    def close(s): print("closed before re-raising", end="; ")
def from_ntc(): yield from NoThrowButClose()
g = from_ntc(); next(g); t(lambda: g.throw(ValueError("v")))
# GeneratorExit thrown explicitly closes the sub-iterator.
g = deleg(); next(g); t(lambda: g.throw(GeneratorExit))
# Deep delegation.
def level(n):
    if n == 0:
        v = yield "bottom"
        return [v]
    r = yield from level(n - 1)
    return r + [n]
g = level(50); print(next(g))
try: g.send("sent")
except StopIteration as e: print(e.value[:5], len(e.value))
def chain(*its):
    for it in its: yield from it
print(list(chain([1], (2,), "3", range(4, 6), chain([6], chain([7])))))
def flatten(x):
    for e in x:
        if isinstance(e, (list, tuple)): yield from flatten(e)
        else: yield e
print(list(flatten([1, (2, [3, (4, 5)], 6), [[[7]]]])))
def inorder(t):
    if t:
        yield from inorder(t[0]); yield t[1]; yield from inorder(t[2])
print(list(inorder(((None, 1, None), 2, ((None, 3, None), 4, None)))))
# Return values through several levels; exceptions in the sub-generator.
def r1(): return 1; yield
def r2(): return (yield from r1()) + 1
def r3(): return (yield from r2()) + (yield from r2())
def r4(): x = yield from r3(); yield x
print(list(r4()))
def sub_raises():
    yield 1
    raise ValueError("in sub")
def outer_catches():
    try: yield from sub_raises()
    except ValueError as e: yield "caught " + str(e)
    yield "continues"
print(list(outer_catches()))
def outer_finally():
    try: yield from sub_raises()
    finally: print("outer finally", end="; ")
t(lambda: list(outer_finally()))
def sub_stop():
    yield 1
    raise StopIteration("bad")
def outer_stop(): yield from sub_stop()
t(lambda: list(outer_stop()))
# The same generator delegated twice; already running; exhausted.
shared = inner()
def two():
    a = yield from shared
    b = yield from shared
    yield (a, b)
print(list(two()))
def selfdel():
    yield 1
    yield from me
me = selfdel(); next(me); t(lambda: next(me))
def a_gen():
    yield 1
    yield from b_ref
def b_gen():
    yield 2
    yield from a_ref
a_ref = a_gen(); b_ref = b_gen(); print(next(a_ref), next(a_ref)); t(lambda: next(a_ref))
# yield from as an expression in odd places.
def odd():
    x = [(yield from inner()), (yield from inner())]
    y = {"k": (yield from r1())}
    z = (yield from r1()) if (yield from r1()) else 0
    print((yield from r1()), end="; ")
    return x, y, z, f"{(yield from r1())}"
g = odd(); out = []
try:
    while True: out.append(next(g))
except StopIteration as e: print(out, e.value)
lam = lambda: (yield from [1, 2]); print(list(lam()))
for src in ("yield from x", "def f(): yield from", "def f(): x = yield from y", "def f(): yield from x = 1", "def f(): yield from (yield)", "def f(): yield from yield x", "def f(): yield from x for x in y", "def f(): yield from (x for x in y)", "def f(): yield from [x for x in y]", "def f(): return yield from x", "def f(): return (yield from x)", "def f(): f(yield from x)", "def f(): f((yield from x))", "async def f(): yield from x", "class C: yield from x", "def f(): [(yield from x) for y in z]", "def f(): yield from x, ", "def f(): yield from lambda: 1", "def f(): yield from not x", "def f(): yield from x if y else z", "def f(): yield  from  x", "def f(): yield\\\nfrom x", "def f(): yieldfrom x", "def f(): await (yield from x)", "def f(): yield from x; yield from y", "def f(): yield from(x)", "def f(): yield from x := y", "def f(): yield from (x := y)"):
    try: compile(src, "<s>", "exec"); print("ok:", src.replace("\n", "\\n"))
    except SyntaxError as e: print("SyntaxError:", e.msg, "<-", src.replace("\n", "\\n"))
