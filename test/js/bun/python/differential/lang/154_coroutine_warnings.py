# Coroutines and awaitables that are dropped, where coroutines were made, and other things test_coroutines, test_asyncgen,
# test_generators, test_yield_from and test_builtin ask.
import sys, gc, warnings, contextlib, types, asyncio
def attempt(thunk):
    with warnings.catch_warnings(record=True) as w:
        warnings.simplefilter("always")
        try:
            r = thunk()
        except BaseException as e:
            r = type(e).__name__ + ": " + str(e)
        gc.collect()
    return r, [(x.category.__name__, str(x.message)) for x in w]

# where a coroutine was made
async def corofn(): pass
print(sys.get_coroutine_origin_tracking_depth())
with contextlib.closing(corofn()) as c: print(c.cr_origin)
sys.set_coroutine_origin_tracking_depth(1)
print(sys.get_coroutine_origin_tracking_depth())
with contextlib.closing(corofn()) as c: print([(f.rpartition("/")[2], l, n) for f, l, n in c.cr_origin])
sys.set_coroutine_origin_tracking_depth(2)
def nested(): return corofn()
with contextlib.closing(nested()) as c: print([(f.rpartition("/")[2], l, n) for f, l, n in c.cr_origin])
sys.set_coroutine_origin_tracking_depth(1000)
with contextlib.closing(nested()) as c: print(len(c.cr_origin))
print(attempt(lambda: sys.set_coroutine_origin_tracking_depth(-1)), sys.get_coroutine_origin_tracking_depth())
print(attempt(lambda: sys.set_coroutine_origin_tracking_depth("a")))
sys.set_coroutine_origin_tracking_depth(2)
def drop(): nested()
r = attempt(drop)
print(r[0], [(c, m.replace(__file__, "FILE")) for c, m in r[1]])
sys.set_coroutine_origin_tracking_depth(0)
print(attempt(drop))

# the warning when warnings.py cannot give it
seen = []
old_hook = sys.unraisablehook
sys.unraisablehook = lambda u: seen.append((u.exc_type.__name__, u.err_msg.partition(" <")[0] if u.err_msg else None, u.object))
original = warnings._warn_unawaited_coroutine
warnings._warn_unawaited_coroutine = lambda coro: 1 / 0
print(attempt(drop), seen); seen.clear()
del warnings._warn_unawaited_coroutine
print(attempt(drop), seen); seen.clear()
warnings._warn_unawaited_coroutine = original
def fatal():
    with warnings.catch_warnings():
        warnings.simplefilter("error")
        nested()
        gc.collect()
fatal(); print(seen); seen.clear()

# frame.clear() of a coroutine that has not started
def clear2():
    c = corofn()
    c.cr_frame.clear()
    c.close()
print(attempt(clear2))

# asynchronous generators
async def agen():
    yield 1
def dropped(method, *args):
    def run():
        g = agen()
        getattr(g, method)(*args)
    return run
print(attempt(dropped("asend", None)))
print(attempt(dropped("athrow", RuntimeError)))
print(attempt(dropped("aclose")))
print(attempt(dropped("__anext__")))
def awaited():
    g = agen()
    try:
        g.asend(None).send(None)
    except StopIteration as e:
        return e.value
print(attempt(awaited))
def three():
    x = agen().athrow(GeneratorExit, GeneratorExit(), None)
    try:
        x.send(None)
    except GeneratorExit:
        return "exit"
print(attempt(three))
async def loop():
    return [x async for x in agen()]
print(attempt(lambda: asyncio.run(loop())))
sys.unraisablehook = old_hook

# a function made of the code of a module
g = {"a": 0}
types.FunctionType(compile("a = a + 1; b = 2", "m", "exec"), g)()
print(g["a"], g["b"])
import ast
co = compile("a = await f()", "m", "exec", flags=ast.PyCF_ALLOW_TOP_LEVEL_AWAIT)
async def f(): return 5
g = {"f": f}
try:
    types.FunctionType(co, g)().send(None)
except StopIteration:
    print(g["a"])

# yield from something whose attributes cannot be looked up
class Broken:
    def __iter__(self): return self
    def __next__(self): return 1
    def __getattr__(self, attr): 1 / 0
def gen(): yield from Broken()
seen = []
sys.unraisablehook = lambda u: seen.append((u.exc_type.__name__, u.err_msg.partition(" <")[0] if u.err_msg else None))
gi = gen(); print(next(gi)); print(gi.close(), seen)
sys.unraisablehook = old_hook
gi = gen(); next(gi); print(attempt(lambda: gi.send(1)))
gi = gen(); next(gi); print(attempt(lambda: gi.throw(AttributeError)))

# misc
array = bytearray(b',')
def iterator():
    array.clear()
    yield b'A'
    yield b'B'
print(attempt(lambda: array.join(iterator())), array, attempt(lambda: array.clear()), array)
print(attempt(lambda: __import__('', {'__package__': None, '__spec__': None, '__name__': '__main__'}, locals={}, fromlist=('foo',), level=1)))
class Spec: parent = "other"
print(attempt(lambda: __import__('', {'__package__': 'os', '__spec__': Spec, '__name__': 'os.x'}, fromlist=('path',), level=1).__name__))
class C_get_vars:
    def getDict(self): return {'a': 2}
    __dict__ = property(fget=getDict)
print(vars(C_get_vars()))
for s in (b'Tru\xe1\xb5\x89', b'x = Fal\xc5\xbfe', b'def N\xc2\xbane(): pass', b'a.N\xc2\xbane', 'ﬁ = 1; print(fi)'.encode()):
    print(attempt(lambda: ast.dump(ast.parse(s))[:60]), attempt(lambda: exec(s)))
