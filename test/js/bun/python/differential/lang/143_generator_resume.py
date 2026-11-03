# Generators and coroutines resumed by for, by yield from and await, and from outside, and all the ways they can stop.
import sys, traceback, gc, types, inspect

def try_(f, *a):
    try:
        return f(*a)
    except BaseException as e:
        return type(e).__name__ + ": " + str(e)

def tb_names(e):
    return [(f.name, f.line) for f in traceback.extract_tb(e.__traceback__)]

print("--- plain loops")
def count(n):
    for i in range(n):
        yield i
print([x for x in count(5)], list(count(3)), sum(count(10)), tuple(count(2)), max(count(4)), sorted(count(3), reverse=True))
g = count(3)
for x in g: print("first loop", x)
for x in g: print("never")
print(next(g, "done"), g.gi_frame, g.gi_running, inspect.getgeneratorstate(g))
g = count(5)
for x in g:
    if x == 1: break
print(next(g), [y for y in g], inspect.getgeneratorstate(g))
def empty():
    return
    yield
for x in empty(): print("never")
print(list(empty()))

print("--- values of many kinds, and many variables")
def kinds():
    a = 1; b = 2.0; c = "s"; d = None; e = [1]; f = (2,); h = {3: 4}; i = 1 << 70; j = 1.5; k = True
    yield a; yield b; yield c; yield d; yield e; yield f; yield h; yield i; yield j; yield k
    yield (a, b, c, d, e, f, h, i, j, k)
for v in kinds(): print(repr(v), type(v).__name__)

print("--- exceptions that leave the body")
def raises(n):
    yield 1
    raise ValueError("from the generator %d" % n)
def loop_over(g):
    out = []
    try:
        for x in g: out.append(x)
    except ValueError as e:
        out.append(("caught", str(e), tb_names(e)))
    return out
g = raises(1)
print(loop_over(g), inspect.getgeneratorstate(g), g.gi_frame, list(g))
def outer_for(n):
    for x in raises(n): yield x
def outer_from(n):
    yield from raises(n)
print(loop_over(outer_for(2)))
print(loop_over(outer_from(3)))
def catches(n):
    try:
        for x in raises(n): yield x
    except ValueError as e:
        yield "caught inside: " + str(e)
    try:
        yield from raises(n + 1)
    except ValueError as e:
        yield "caught inside: " + str(e)
print(list(catches(4)))

print("--- StopIteration must not leave a generator")
def stops():
    yield 1
    raise StopIteration("value")
def report(f):
    try:
        f()
    except RuntimeError as e:
        print(type(e).__name__, e, "|", repr(e.__cause__), repr(e.__context__), e.__suppress_context__, tb_names(e))
report(lambda: [x for x in stops()])
report(lambda: list(stops()))
def via_next():
    yield next(iter(()))
report(lambda: [x for x in via_next()])
def from_stops():
    yield from stops()
report(lambda: [x for x in from_stops()])
async def coro_stops():
    raise StopIteration("in a coroutine")
report(lambda: coro_stops().send(None))

print("--- a generator that is running")
def reenters():
    yield 1
    for x in me: yield x
me = reenters()
print(try_(list, me))
def reenters_next():
    yield next(me2)
me2 = reenters_next()
print(try_(list, me2))
def shows_running():
    yield (me3.gi_running, inspect.getgeneratorstate(me3), me3.gi_frame is sys._getframe())
me3 = shows_running()
for v in me3: print(v)
print(me3.gi_running, inspect.getgeneratorstate(me3))

print("--- frames")
def names_up():
    f = sys._getframe(); out = []
    while f: out.append(f.f_code.co_name); f = f.f_back
    return out
def inner_frames():
    yield names_up()
def middle_frames():
    for x in inner_frames(): yield x
    yield from inner_frames()
def top_frames():
    return [x for x in middle_frames()] + list(middle_frames())
for names in top_frames(): print(names)
g = count(2)
print(g.gi_frame.f_lineno - count.__code__.co_firstlineno, g.gi_frame.f_locals, g.gi_frame.f_back)
for x in g:
    print(g.gi_frame.f_lineno - count.__code__.co_firstlineno, sorted(g.gi_frame.f_locals.items()), g.gi_frame.f_back, g.gi_suspended)
frame_kept = None
def keeps_frame():
    global frame_kept
    frame_kept = sys._getframe()
    local = "value"
    yield 1
    yield 2
for x in keeps_frame(): print(x, frame_kept.f_locals, frame_kept.f_lineno - keeps_frame.__code__.co_firstlineno)
print(frame_kept.f_lineno - keeps_frame.__code__.co_firstlineno, frame_kept.f_back)

print("--- the exception being handled belongs to each generator")
def handling():
    try:
        raise KeyError("inner")
    except KeyError:
        yield repr(sys.exception())
        yield repr(sys.exception())
    yield repr(sys.exception())
def outer_handling():
    out = []
    try:
        raise ValueError("outer")
    except ValueError:
        for v in handling():
            out.append((v, repr(sys.exception())))
    for v in handling():
        out.append((v, repr(sys.exception())))
    return out
for line in outer_handling(): print(line)
def context_chain():
    try:
        raise KeyError("first")
    except KeyError:
        yield
        raise ValueError("second")
try:
    try:
        raise OSError("around the loop")
    except OSError:
        for _ in context_chain(): pass
except ValueError as e:
    print(repr(e), repr(e.__context__), repr(e.__context__.__context__))

print("--- send, throw, close")
def echo():
    got = None
    while True:
        try:
            got = yield got
        except ValueError as e:
            got = "threw " + str(e)
g = echo()
print(try_(g.send, 1), g.send(None), g.send(5), g.throw(ValueError("x")), g.send(6), g.close(), try_(g.send, 7), try_(next, g))
def delegating():
    r = yield from echo_until()
    yield ("returned", r)
def echo_until():
    got = None
    while got != "stop":
        try:
            got = yield got
        except ValueError as e:
            got = "threw " + str(e)
    return "result"
g = delegating()
print(next(g), g.gi_yieldfrom.__name__, g.send(1), g.throw(ValueError("y")), g.send("stop"), g.gi_yieldfrom, try_(next, g))
log = []
def cleans(name):
    try:
        yield name
        yield name
    finally:
        log.append("cleaned " + name)
def cleans_outer():
    try:
        yield from cleans("inner")
    finally:
        log.append("cleaned outer")
g = cleans_outer(); next(g); g.close(); print(log); log.clear()
for x in cleans("loop"): break
gc.collect(); print(log); log.clear()
def refuses():
    try: yield 1
    except GeneratorExit: yield 2
g = refuses(); next(g); print(try_(g.close))
def returns_on_close():
    try: yield 1
    except GeneratorExit: return "closing value"
g = returns_on_close(); next(g); print(g.close())
g = count(3); print(try_(g.throw, KeyError("not started")), list(g))

print("--- what yield from evaluates to")
def returns(v):
    yield "y"
    return v
def takes():
    a = yield from returns(1)
    b = yield from returns(None)
    c = yield from returns((1, 2))
    d = yield from []
    e = yield from iter("ab")
    f = yield from returns(StopIteration("as a value"))
    return [a, b, c, d, e, f]
def drive(g):
    out = []
    try:
        while True: out.append(next(g))
    except StopIteration as e:
        return out, e.value
print(drive(takes()))
class Iter:
    def __init__(self): self.n = 0
    def __iter__(self): return self
    def __next__(self):
        self.n += 1
        if self.n > 2: raise StopIteration("iterator's value")
        return self.n
def from_object():
    r = yield from Iter()
    yield r
print(list(from_object()))

print("--- depth")
def deep(n):
    if n: yield from deep(n - 1)
    else: yield "bottom"
print(list(deep(200)))
def deep_for(n):
    if n:
        for x in deep_for(n - 1): yield x
    else: yield "bottom"
print(list(deep_for(200)))
def endless(n):
    yield from endless(n + 1)
print(try_(list, endless(0))[:40])
def endless_for(n):
    for x in endless_for(n + 1): yield x
print(try_(list, endless_for(0))[:40])
g = endless_for(0); try_(next, g); print(inspect.getgeneratorstate(g))
print(list(deep(50)), sum(count(5)))

print("--- coroutines")
class Suspend:
    def __init__(self, v): self.v = v
    def __await__(self):
        r = yield self.v
        return r
async def leaf(v): return await Suspend(v)
async def chain(k, v): return (await chain(k - 1, v)) if k else (await leaf(v))
async def main():
    a = await chain(5, "first")
    b = await chain(0, "second")
    try:
        await failing(3)
    except LookupError as e:
        c = (str(e), tb_names(e))
    return a, b, c
async def failing(k):
    if k: return await failing(k - 1)
    await Suspend("before failing")
    raise LookupError("deep in the chain")
c = main()
print(c.send(None), c.cr_await.__name__, inspect.getcoroutinestate(c), c.send("A"), c.send("B"))
try: c.send(None)
except StopIteration as e: print(e.value)
print(inspect.getcoroutinestate(c), c.cr_await, try_(c.send, None))
async def simple(): return 5
async def awaits_twice():
    x = simple()
    return await x, try_(lambda: x.send(None))
print(try_(awaits_twice().send, None))
c = chain(3, "thrown into"); c.send(None)
print(try_(c.throw, KeyError("from outside")), inspect.getcoroutinestate(c))
c = chain(3, "closed"); c.send(None); print(c.close(), inspect.getcoroutinestate(c))
@types.coroutine
def old_style(v):
    r = yield v
    return r
async def awaits_old(): return await old_style("old")
c = awaits_old(); print(c.send(None), try_(c.send, "answer"))

print("--- asynchronous generators, driven by hand")
async def agen():
    yield 1
    await Suspend("in the middle")
    yield 2
async def consume():
    out = []
    async for x in agen(): out.append(x)
    return out
c = consume(); print(c.send(None), try_(c.send, None))

print("--- generators in odd places")
print(dict(zip(count(3), count(3))), list(map(lambda a, b: a + b, count(3), count(3))), list(enumerate(count(2))), list(filter(None, count(3))), any(count(2)), all(count(2)), ",".join(str(x) for x in count(3)), {x for x in count(3)}, [*count(2), *count(2)], (lambda *a: a)(*count(3)))
a, b, *c = count(5); print(a, b, c)
print(3 in count(5), 7 in count(5))
def gen_in_gen():
    yield from (x * 2 for x in (y + 1 for y in count(3)))
print(list(gen_in_gen()))
class HasGen:
    def __iter__(self):
        yield "from __iter__"
for x in HasGen(): print(x)
print(list(HasGen()))
