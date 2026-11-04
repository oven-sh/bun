# generator.throw() with arguments that make no exception: a generator that waits for another hands them on before it looks at them.
try: import inspect, sys, types, warnings
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import inspect, sys, types, warnings')
try: warnings.simplefilter('ignore', DeprecationWarning)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: warnings.simplefilter('ignore', DeprecationWarning)")


try:
    def inner():
        yield 1
        yield 2
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def inner():')
try:
    def catches():
        try:
            yield from inner()
        except TypeError as e:
            yield ('caught', str(e))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def catches():')
try:
    def plain():
        yield from inner()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def plain():')
try:
    def twice():
        try:
            yield from plain()
        except TypeError as e:
            yield ('outermost caught', str(e))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def twice():')
try:
    def over_list():
        yield from [1, 2]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def over_list():')
try:
    def over_iterator():
        yield from iter([1, 2])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def over_iterator():')


try:
    class Accepts:
        def __iter__(self): return self
        def __next__(self): return 'next'
        def throw(self, *args): return ('throw got', args)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Accepts:')
try:
    class Stops(Accepts):
        def throw(self, *args): raise StopIteration(('stopped by', args))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Stops(Accepts):')
try:
    class Raises(Accepts):
        def throw(self, *args): raise KeyError(args)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Raises(Accepts):')
try:
    def over(obj):
        result = yield from obj
        yield ('result', result)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def over(obj):')


try: WRONG = (('int', (5,)), ('str', ('x',)), ('None', (None,)), ('instance and value', (ValueError('a'), 'b')), ('bad traceback', (ValueError, None, 5)), ('a class that is no exception', (int,)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: WRONG = (('int', (5,)), ('str', ('x',)), ('None', (None,)), ('instanc...")
try:
    for make in (inner, catches, plain, twice, over_list, over_iterator, lambda: over(Accepts()), lambda: over(Stops()), lambda: over(Raises())):
        for name, args in WRONG:
            try: g = make()
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g = make()')
            try: next(g)
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: next(g)')
            try:
                r = ('returned', g.throw(*args))
            except BaseException as e:
                r = (type(e).__name__, str(e))
            try: print("getattr(make, '__name__', '?') [" + 'make=' + (repr(make) if type(make) in (str, int, float, bytes, bool, type(None)) or (type(make) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in make)) else make.__name__ if type(make) is type else type(make).__name__) + ", " + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + ", " + 'args=' + (repr(args) if type(args) in (str, int, float, bytes, bool, type(None)) or (type(args) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in args)) else args.__name__ if type(args) is type else type(args).__name__) + '] =>', getattr(make, '__name__', '?'))
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: getattr(make, '__name__', '?')")
            try: print('name [' + 'make=' + (repr(make) if type(make) in (str, int, float, bytes, bool, type(None)) or (type(make) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in make)) else make.__name__ if type(make) is type else type(make).__name__) + ", " + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + ", " + 'args=' + (repr(args) if type(args) in (str, int, float, bytes, bool, type(None)) or (type(args) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in args)) else args.__name__ if type(args) is type else type(args).__name__) + '] =>', name)
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: name')
            try: print('r [' + 'make=' + (repr(make) if type(make) in (str, int, float, bytes, bool, type(None)) or (type(make) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in make)) else make.__name__ if type(make) is type else type(make).__name__) + ", " + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + ", " + 'args=' + (repr(args) if type(args) in (str, int, float, bytes, bool, type(None)) or (type(args) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in args)) else args.__name__ if type(args) is type else type(args).__name__) + '] =>', r)
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: r')
            try: print('inspect.getgeneratorstate(g) [' + 'make=' + (repr(make) if type(make) in (str, int, float, bytes, bool, type(None)) or (type(make) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in make)) else make.__name__ if type(make) is type else type(make).__name__) + ", " + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + ", " + 'args=' + (repr(args) if type(args) in (str, int, float, bytes, bool, type(None)) or (type(args) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in args)) else args.__name__ if type(args) is type else type(args).__name__) + '] =>', inspect.getgeneratorstate(g))
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: inspect.getgeneratorstate(g)')
            try: print("next(g, 'finished') [" + 'make=' + (repr(make) if type(make) in (str, int, float, bytes, bool, type(None)) or (type(make) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in make)) else make.__name__ if type(make) is type else type(make).__name__) + ", " + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + ", " + 'args=' + (repr(args) if type(args) in (str, int, float, bytes, bool, type(None)) or (type(args) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in args)) else args.__name__ if type(args) is type else type(args).__name__) + '] =>', next(g, 'finished'))
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: next(g, 'finished')")
            try: g.close()
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g.close()')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for make in (inner, catches, plain, twice, over_list, over_iterator, ...')

try:
    for name, args in WRONG[:2] + (('none at all', ()), ('four', (1, 2, 3, 4))):
        for state in ('new', 'finished'):
            try: g = plain()
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g = plain()')
            if state == 'finished':
                try: list(g)
                except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list(g)')
            try:
                r = g.throw(*args)
            except BaseException as e:
                r = (type(e).__name__, str(e))
            try: print('state [' + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + ", " + 'args=' + (repr(args) if type(args) in (str, int, float, bytes, bool, type(None)) or (type(args) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in args)) else args.__name__ if type(args) is type else type(args).__name__) + ", " + 'state=' + (repr(state) if type(state) in (str, int, float, bytes, bool, type(None)) or (type(state) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in state)) else state.__name__ if type(state) is type else type(state).__name__) + '] =>', state)
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: state')
            try: print('name [' + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + ", " + 'args=' + (repr(args) if type(args) in (str, int, float, bytes, bool, type(None)) or (type(args) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in args)) else args.__name__ if type(args) is type else type(args).__name__) + ", " + 'state=' + (repr(state) if type(state) in (str, int, float, bytes, bool, type(None)) or (type(state) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in state)) else state.__name__ if type(state) is type else type(state).__name__) + '] =>', name)
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: name')
            try: print('r [' + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + ", " + 'args=' + (repr(args) if type(args) in (str, int, float, bytes, bool, type(None)) or (type(args) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in args)) else args.__name__ if type(args) is type else type(args).__name__) + ", " + 'state=' + (repr(state) if type(state) in (str, int, float, bytes, bool, type(None)) or (type(state) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in state)) else state.__name__ if type(state) is type else type(state).__name__) + '] =>', r)
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: r')
            try: print('inspect.getgeneratorstate(g) [' + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + ", " + 'args=' + (repr(args) if type(args) in (str, int, float, bytes, bool, type(None)) or (type(args) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in args)) else args.__name__ if type(args) is type else type(args).__name__) + ", " + 'state=' + (repr(state) if type(state) in (str, int, float, bytes, bool, type(None)) or (type(state) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in state)) else state.__name__ if type(state) is type else type(state).__name__) + '] =>', inspect.getgeneratorstate(g))
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: inspect.getgeneratorstate(g)')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: for name, args in WRONG[:2] + (('none at all', ()), ('four', (1, 2, 3...")


try:
    @types.coroutine
    def suspends():
        yield 'suspended'
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def suspends():')
try:
    async def awaits():
        try:
            await suspends()
        except TypeError as e:
            return ('caught', str(e))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def awaits():')
try:
    for state in ('new', 'suspended', 'finished'):
        try: c = awaits()
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c = awaits()')
        if state != 'new':
            try: c.send(None)
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c.send(None)')
        if state == 'finished':
            try:
                c.send(None)
            except StopIteration:
                pass
        try:
            r = c.throw(5)
        except BaseException as e:
            r = (type(e).__name__, str(e))
        try: print('coroutine', 'state [' + 'state=' + (repr(state) if type(state) in (str, int, float, bytes, bool, type(None)) or (type(state) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in state)) else state.__name__ if type(state) is type else type(state).__name__) + '] =>', state)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: state')
        try: print('r [' + 'state=' + (repr(state) if type(state) in (str, int, float, bytes, bool, type(None)) or (type(state) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in state)) else state.__name__ if type(state) is type else type(state).__name__) + '] =>', r)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: r')
        try: print('inspect.getcoroutinestate(c) [' + 'state=' + (repr(state) if type(state) in (str, int, float, bytes, bool, type(None)) or (type(state) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in state)) else state.__name__ if type(state) is type else type(state).__name__) + '] =>', inspect.getcoroutinestate(c))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: inspect.getcoroutinestate(c)')
        try: c.close()
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c.close()')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: for state in ('new', 'suspended', 'finished'):")


# frame.f_locals.update() and |= with what is neither a dict nor such a proxy
try:
    def update(arg):
        a = 1
        p = sys._getframe().f_locals
        try:
            p.update(arg)
        except Exception as e:
            return type(e).__name__, str(e)
        return a
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def update(arg):')
try:
    def ior(arg):
        a = 1
        p = sys._getframe().f_locals
        try:
            p |= arg
        except Exception as e:
            return type(e).__name__, str(e)
        return a
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def ior(arg):')
try:
    for arg in ({'a': 2}, [('a', 2)], [], 5, None, sys._getframe().f_locals):
        try: print('f_locals', 'update(arg) [' + 'arg=' + (repr(arg) if type(arg) in (str, int, float, bytes, bool, type(None)) or (type(arg) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in arg)) else arg.__name__ if type(arg) is type else type(arg).__name__) + '] =>', update(arg))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: update(arg)')
        try: print('ior(arg) [' + 'arg=' + (repr(arg) if type(arg) in (str, int, float, bytes, bool, type(None)) or (type(arg) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in arg)) else arg.__name__ if type(arg) is type else type(arg).__name__) + '] =>', ior(arg))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ior(arg)')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: for arg in ({'a': 2}, [('a', 2)], [], 5, None, sys._getframe().f_loca...")


# A traceback made with line -1 has the line of tb_lasti.
try:
    def f():
        x = 1
        y = 2
        return sys._getframe()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def f():')
try: frame = f()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: frame = f()')
try: lines = list(f.__code__.co_lines())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: lines = list(f.__code__.co_lines())')
try: print('tb_lineno', 'all(types.TracebackType(None, frame, offset, -1).tb_lineno == line fo... =>', all(types.TracebackType(None, frame, offset, -1).tb_lineno == line for start, end, line in lines for offset in (start, end - 2)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: all(types.TracebackType(None, frame, offset, -1).tb_lineno == line fo...')
try: print('[types.TracebackType(None, frame, lasti, -1).tb_lineno for lasti in (... =>', [types.TracebackType(None, frame, lasti, -1).tb_lineno for lasti in (-5, -1, lines[-1][1], 10 ** 6)])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [types.TracebackType(None, frame, lasti, -1).tb_lineno for lasti in (...')
try: print('[types.TracebackType(None, frame, 0, line).tb_lineno for line in (0, ... =>', [types.TracebackType(None, frame, 0, line).tb_lineno for line in (0, 5, -2)])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [types.TracebackType(None, frame, 0, line).tb_lineno for line in (0, ...')
