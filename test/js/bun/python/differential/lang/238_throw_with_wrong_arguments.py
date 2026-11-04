# generator.throw() with arguments that make no exception: a generator that waits for another hands them on before it looks at them.
import inspect, sys, types, warnings
warnings.simplefilter('ignore', DeprecationWarning)


def inner():
    yield 1
    yield 2
def catches():
    try:
        yield from inner()
    except TypeError as e:
        yield ('caught', str(e))
def plain():
    yield from inner()
def twice():
    try:
        yield from plain()
    except TypeError as e:
        yield ('outermost caught', str(e))
def over_list():
    yield from [1, 2]
def over_iterator():
    yield from iter([1, 2])


class Accepts:
    def __iter__(self): return self
    def __next__(self): return 'next'
    def throw(self, *args): return ('throw got', args)
class Stops(Accepts):
    def throw(self, *args): raise StopIteration(('stopped by', args))
class Raises(Accepts):
    def throw(self, *args): raise KeyError(args)
def over(obj):
    result = yield from obj
    yield ('result', result)


WRONG = (('int', (5,)), ('str', ('x',)), ('None', (None,)), ('instance and value', (ValueError('a'), 'b')), ('bad traceback', (ValueError, None, 5)), ('a class that is no exception', (int,)))
for make in (inner, catches, plain, twice, over_list, over_iterator, lambda: over(Accepts()), lambda: over(Stops()), lambda: over(Raises())):
    for name, args in WRONG:
        g = make()
        next(g)
        try:
            r = ('returned', g.throw(*args))
        except BaseException as e:
            r = (type(e).__name__, str(e))
        print(getattr(make, '__name__', '?'), name, r, inspect.getgeneratorstate(g), next(g, 'finished'))
        g.close()

for name, args in WRONG[:2] + (('none at all', ()), ('four', (1, 2, 3, 4))):
    for state in ('new', 'finished'):
        g = plain()
        if state == 'finished':
            list(g)
        try:
            r = g.throw(*args)
        except BaseException as e:
            r = (type(e).__name__, str(e))
        print(state, name, r, inspect.getgeneratorstate(g))


@types.coroutine
def suspends():
    yield 'suspended'
async def awaits():
    try:
        await suspends()
    except TypeError as e:
        return ('caught', str(e))
for state in ('new', 'suspended', 'finished'):
    c = awaits()
    if state != 'new':
        c.send(None)
    if state == 'finished':
        try:
            c.send(None)
        except StopIteration:
            pass
    try:
        r = c.throw(5)
    except BaseException as e:
        r = (type(e).__name__, str(e))
    print('coroutine', state, r, inspect.getcoroutinestate(c))
    c.close()


# frame.f_locals.update() and |= with what is neither a dict nor such a proxy
def update(arg):
    a = 1
    p = sys._getframe().f_locals
    try:
        p.update(arg)
    except Exception as e:
        return type(e).__name__, str(e)
    return a
def ior(arg):
    a = 1
    p = sys._getframe().f_locals
    try:
        p |= arg
    except Exception as e:
        return type(e).__name__, str(e)
    return a
for arg in ({'a': 2}, [('a', 2)], [], 5, None, sys._getframe().f_locals):
    print('f_locals', update(arg), ior(arg))


# A traceback made with line -1 has the line of tb_lasti.
def f():
    x = 1
    y = 2
    return sys._getframe()
frame = f()
lines = list(f.__code__.co_lines())
print('tb_lineno', all(types.TracebackType(None, frame, offset, -1).tb_lineno == line for start, end, line in lines for offset in (start, end - 2)))
print([types.TracebackType(None, frame, lasti, -1).tb_lineno for lasti in (-5, -1, lines[-1][1], 10 ** 6)], [types.TracebackType(None, frame, 0, line).tb_lineno for line in (0, 5, -2)])
