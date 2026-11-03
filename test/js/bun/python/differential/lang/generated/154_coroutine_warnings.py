# Coroutines and awaitables that are dropped, where coroutines were made, and other things test_coroutines, test_asyncgen,
# test_generators, test_yield_from and test_builtin ask.
try: import sys, gc, warnings, contextlib, types, asyncio
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import sys, gc, warnings, contextlib, types, asyncio')
try:
    def attempt(thunk):
        with warnings.catch_warnings(record=True) as w:
            warnings.simplefilter("always")
            try:
                r = thunk()
            except BaseException as e:
                r = type(e).__name__ + ": " + str(e)
            gc.collect()
        return r, [(x.category.__name__, str(x.message)) for x in w]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def attempt(thunk):')

# where a coroutine was made
try:
    async def corofn(): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def corofn(): pass')
try: print(sys.get_coroutine_origin_tracking_depth())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sys.get_coroutine_origin_tracking_depth()')
try:
    with contextlib.closing(corofn()) as c: print(c.cr_origin)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: with contextlib.closing(corofn()) as c: print(c.cr_origin)')
try: sys.set_coroutine_origin_tracking_depth(1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sys.set_coroutine_origin_tracking_depth(1)')
try: print(sys.get_coroutine_origin_tracking_depth())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sys.get_coroutine_origin_tracking_depth()')
try:
    with contextlib.closing(corofn()) as c: print([(f.rpartition("/")[2], l, n) for f, l, n in c.cr_origin])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: with contextlib.closing(corofn()) as c: print([(f.rpartition("/")[2],...')
try: sys.set_coroutine_origin_tracking_depth(2)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sys.set_coroutine_origin_tracking_depth(2)')
try:
    def nested(): return corofn()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def nested(): return corofn()')
try:
    with contextlib.closing(nested()) as c: print([(f.rpartition("/")[2], l, n) for f, l, n in c.cr_origin])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: with contextlib.closing(nested()) as c: print([(f.rpartition("/")[2],...')
try: sys.set_coroutine_origin_tracking_depth(1000)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sys.set_coroutine_origin_tracking_depth(1000)')
try:
    with contextlib.closing(nested()) as c: print(len(c.cr_origin))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: with contextlib.closing(nested()) as c: print(len(c.cr_origin))')
try: print('attempt(lambda: sys.set_coroutine_origin_tracking_depth(-1)) =>', attempt(lambda: sys.set_coroutine_origin_tracking_depth(-1)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: attempt(lambda: sys.set_coroutine_origin_tracking_depth(-1))')
try: print('sys.get_coroutine_origin_tracking_depth() =>', sys.get_coroutine_origin_tracking_depth())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sys.get_coroutine_origin_tracking_depth()')
try: print(attempt(lambda: sys.set_coroutine_origin_tracking_depth("a")))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: attempt(lambda: sys.set_coroutine_origin_tracking_depth("a"))')
try: sys.set_coroutine_origin_tracking_depth(2)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sys.set_coroutine_origin_tracking_depth(2)')
try:
    def drop(): nested()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def drop(): nested()')
try: r = attempt(drop)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: r = attempt(drop)')
try: print('r[0] =>', r[0])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: r[0]')
try: print('[(c, m.replace(__file__, "FILE")) for c, m in r[1]] =>', [(c, m.replace(__file__, "FILE")) for c, m in r[1]])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [(c, m.replace(__file__, "FILE")) for c, m in r[1]]')
try: sys.set_coroutine_origin_tracking_depth(0)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sys.set_coroutine_origin_tracking_depth(0)')
try: print(attempt(drop))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: attempt(drop)')

# the warning when warnings.py cannot give it
try: seen = []
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: seen = []')
try: old_hook = sys.unraisablehook
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: old_hook = sys.unraisablehook')
try: sys.unraisablehook = lambda u: seen.append((u.exc_type.__name__, u.err_msg.partition(" <")[0] if u.err_msg else None, u.object))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sys.unraisablehook = lambda u: seen.append((u.exc_type.__name__, u.er...')
try: original = warnings._warn_unawaited_coroutine
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: original = warnings._warn_unawaited_coroutine')
try: warnings._warn_unawaited_coroutine = lambda coro: 1 / 0
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: warnings._warn_unawaited_coroutine = lambda coro: 1 / 0')
try: print('attempt(drop) =>', attempt(drop))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: attempt(drop)')
try: print('seen =>', seen)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: seen')
try: seen.clear()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: seen.clear()')
try: del warnings._warn_unawaited_coroutine
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del warnings._warn_unawaited_coroutine')
try: print('attempt(drop) =>', attempt(drop))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: attempt(drop)')
try: print('seen =>', seen)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: seen')
try: seen.clear()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: seen.clear()')
try: warnings._warn_unawaited_coroutine = original
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: warnings._warn_unawaited_coroutine = original')
try:
    def fatal():
        with warnings.catch_warnings():
            warnings.simplefilter("error")
            nested()
            gc.collect()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def fatal():')
try: fatal()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: fatal()')
try: print(seen)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: seen')
try: seen.clear()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: seen.clear()')

# frame.clear() of a coroutine that has not started
try:
    def clear2():
        c = corofn()
        c.cr_frame.clear()
        c.close()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def clear2():')
try: print(attempt(clear2))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: attempt(clear2)')

# asynchronous generators
try:
    async def agen():
        yield 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def agen():')
try:
    def dropped(method, *args):
        def run():
            g = agen()
            getattr(g, method)(*args)
        return run
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def dropped(method, *args):')
try: print(attempt(dropped("asend", None)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: attempt(dropped("asend", None))')
try: print(attempt(dropped("athrow", RuntimeError)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: attempt(dropped("athrow", RuntimeError))')
try: print(attempt(dropped("aclose")))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: attempt(dropped("aclose"))')
try: print(attempt(dropped("__anext__")))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: attempt(dropped("__anext__"))')
try:
    def awaited():
        g = agen()
        try:
            g.asend(None).send(None)
        except StopIteration as e:
            return e.value
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def awaited():')
try: print(attempt(awaited))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: attempt(awaited)')
try:
    def three():
        x = agen().athrow(GeneratorExit, GeneratorExit(), None)
        try:
            x.send(None)
        except GeneratorExit:
            return "exit"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def three():')
try: print(attempt(three))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: attempt(three)')
try:
    async def loop():
        return [x async for x in agen()]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def loop():')
try: print(attempt(lambda: asyncio.run(loop())))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: attempt(lambda: asyncio.run(loop()))')
try: sys.unraisablehook = old_hook
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sys.unraisablehook = old_hook')

# a function made of the code of a module
try: g = {"a": 0}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g = {"a": 0}')
try: types.FunctionType(compile("a = a + 1; b = 2", "m", "exec"), g)()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: types.FunctionType(compile("a = a + 1; b = 2", "m", "exec"), g)()')
try: print('g["a"] =>', g["a"])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g["a"]')
try: print('g["b"] =>', g["b"])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g["b"]')
try: import ast
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import ast')
try: co = compile("a = await f()", "m", "exec", flags=ast.PyCF_ALLOW_TOP_LEVEL_AWAIT)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: co = compile("a = await f()", "m", "exec", flags=ast.PyCF_ALLOW_TOP_L...')
try:
    async def f(): return 5
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def f(): return 5')
try: g = {"f": f}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g = {"f": f}')
try:
    try:
        types.FunctionType(co, g)().send(None)
    except StopIteration:
        print(g["a"])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try:')

# yield from something whose attributes cannot be looked up
try:
    class Broken:
        def __iter__(self): return self
        def __next__(self): return 1
        def __getattr__(self, attr): 1 / 0
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Broken:')
try:
    def gen(): yield from Broken()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def gen(): yield from Broken()')
try: seen = []
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: seen = []')
try: sys.unraisablehook = lambda u: seen.append((u.exc_type.__name__, u.err_msg.partition(" <")[0] if u.err_msg else None))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sys.unraisablehook = lambda u: seen.append((u.exc_type.__name__, u.er...')
try: gi = gen()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: gi = gen()')
try: print(next(gi))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: next(gi)')
try: print('gi.close() =>', gi.close())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: gi.close()')
try: print('seen =>', seen)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: seen')
try: sys.unraisablehook = old_hook
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sys.unraisablehook = old_hook')
try: gi = gen()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: gi = gen()')
try: next(gi)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: next(gi)')
try: print(attempt(lambda: gi.send(1)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: attempt(lambda: gi.send(1))')
try: gi = gen()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: gi = gen()')
try: next(gi)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: next(gi)')
try: print(attempt(lambda: gi.throw(AttributeError)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: attempt(lambda: gi.throw(AttributeError))')

# misc
try: array = bytearray(b',')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: array = bytearray(b',')")
try:
    def iterator():
        array.clear()
        yield b'A'
        yield b'B'
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def iterator():')
try: print('attempt(lambda: array.join(iterator())) =>', attempt(lambda: array.join(iterator())))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: attempt(lambda: array.join(iterator()))')
try: print('array =>', array)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: array')
try: print('attempt(lambda: array.clear()) =>', attempt(lambda: array.clear()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: attempt(lambda: array.clear())')
try: print('array =>', array)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: array')
try: print(attempt(lambda: __import__('', {'__package__': None, '__spec__': None, '__name__': '__main__'}, locals={}, fromlist=('foo',), level=1)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: attempt(lambda: __import__('', {'__package__': None, '__spec__': None...")
try:
    class Spec: parent = "other"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Spec: parent = "other"')
try: print(attempt(lambda: __import__('', {'__package__': 'os', '__spec__': Spec, '__name__': 'os.x'}, fromlist=('path',), level=1).__name__))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: attempt(lambda: __import__('', {'__package__': 'os', '__spec__': Spec...")
try:
    class C_get_vars:
        def getDict(self): return {'a': 2}
        __dict__ = property(fget=getDict)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class C_get_vars:')
try: print(vars(C_get_vars()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: vars(C_get_vars())')
try:
    for s in (b'Tru\xe1\xb5\x89', b'x = Fal\xc5\xbfe', b'def N\xc2\xbane(): pass', b'a.N\xc2\xbane', 'ﬁ = 1; print(fi)'.encode()):
        try: print('attempt(lambda: ast.dump(ast.parse(s))[:60]) [' + 's=' + (repr(s) if type(s) in (str, int, float, bytes, bool, type(None)) or (type(s) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in s)) else s.__name__ if type(s) is type else type(s).__name__) + '] =>', attempt(lambda: ast.dump(ast.parse(s))[:60]))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: attempt(lambda: ast.dump(ast.parse(s))[:60])')
        try: print('attempt(lambda: exec(s)) [' + 's=' + (repr(s) if type(s) in (str, int, float, bytes, bool, type(None)) or (type(s) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in s)) else s.__name__ if type(s) is type else type(s).__name__) + '] =>', attempt(lambda: exec(s)))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: attempt(lambda: exec(s))')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: for s in (b'Tru\\xe1\\xb5\\x89', b'x = Fal\\xc5\\xbfe', b'def N\\xc2\\xbane(...")
