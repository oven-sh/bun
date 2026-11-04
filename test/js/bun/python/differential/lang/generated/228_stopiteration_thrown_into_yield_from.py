# throw(StopIteration) into a generator that waits in `yield from` or `await` for something without throw(): it is taken for the end of that.
try:
    def show(tag, f):
        try:
            print(tag, '=', f())
        except BaseException as e:
            print(tag, '!', type(e).__name__, e, '| context', type(e.__context__).__name__, '| cause', type(e.__cause__).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def show(tag, f):')
try:
    def g_tuple():
        r = yield from (1, 2)
        yield ('after', r)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def g_tuple():')
try:
    def g_iter():
        r = yield from iter([1, 2])
        yield ('after', r)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def g_iter():')
try:
    def sub():
        yield 1
        yield 2
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def sub():')
try:
    def g_gen():
        r = yield from sub()
        yield ('after', r)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def g_gen():')
try:
    class It:
        def __iter__(self): return self
        def __next__(self): return 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class It:')
try:
    class ItThrow(It):
        def throw(self, *a): raise a[0] if not isinstance(a[0], type) else a[0]()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class ItThrow(It):')
try:
    def g_it():
        r = yield from It()
        yield ('after', r)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def g_it():')
try:
    def g_itthrow():
        r = yield from ItThrow()
        yield ('after', r)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def g_itthrow():')
try:
    def g_plain():
        r = yield 1
        yield ('after', r)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def g_plain():')
try:
    async def c_aw():
        class A:
            def __await__(self): return iter((1, 2))
        r = await A()
        return ('after', r)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def c_aw():')
try:
    def t(make, exc):
        g = make()
        g.send(None)
        return g.throw(exc)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def t(make, exc):')
try:
    for make in (g_tuple, g_iter, g_gen, g_it, g_itthrow, g_plain, c_aw):
        try: show(make.__name__ + ' StopIteration(5)', lambda: t(make, StopIteration(5)))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show(make.__name__ + ' StopIteration(5)', lambda: t(make, StopIterati...")
        try: show(make.__name__ + ' StopIteration', lambda: t(make, StopIteration))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show(make.__name__ + ' StopIteration', lambda: t(make, StopIteration))")
        try: show(make.__name__ + ' ValueError', lambda: t(make, ValueError('v')))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show(make.__name__ + ' ValueError', lambda: t(make, ValueError('v')))")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for make in (g_tuple, g_iter, g_gen, g_it, g_itthrow, g_plain, c_aw):')
