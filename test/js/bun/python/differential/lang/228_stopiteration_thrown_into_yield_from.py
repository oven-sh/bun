# throw(StopIteration) into a generator that waits in `yield from` or `await` for something without throw(): it is taken for the end of that.
def show(tag, f):
    try:
        print(tag, '=', f())
    except BaseException as e:
        print(tag, '!', type(e).__name__, e, '| context', type(e.__context__).__name__, '| cause', type(e.__cause__).__name__)
def g_tuple():
    r = yield from (1, 2)
    yield ('after', r)
def g_iter():
    r = yield from iter([1, 2])
    yield ('after', r)
def sub():
    yield 1
    yield 2
def g_gen():
    r = yield from sub()
    yield ('after', r)
class It:
    def __iter__(self): return self
    def __next__(self): return 1
class ItThrow(It):
    def throw(self, *a): raise a[0] if not isinstance(a[0], type) else a[0]()
def g_it():
    r = yield from It()
    yield ('after', r)
def g_itthrow():
    r = yield from ItThrow()
    yield ('after', r)
def g_plain():
    r = yield 1
    yield ('after', r)
async def c_aw():
    class A:
        def __await__(self): return iter((1, 2))
    r = await A()
    return ('after', r)
def t(make, exc):
    g = make()
    g.send(None)
    return g.throw(exc)
for make in (g_tuple, g_iter, g_gen, g_it, g_itthrow, g_plain, c_aw):
    show(make.__name__ + ' StopIteration(5)', lambda: t(make, StopIteration(5)))
    show(make.__name__ + ' StopIteration', lambda: t(make, StopIteration))
    show(make.__name__ + ' ValueError', lambda: t(make, ValueError('v')))
