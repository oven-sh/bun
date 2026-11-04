# A StopIteration that leaves the generator of a lambda.
try:
    def stop(value=None):
        raise StopIteration(value)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def stop(value=None):')

try:
    def show(label, function):
        try:
            print(label, function())
        except BaseException as e:
            print(label, type(e).__name__, e.args, type(e.__cause__).__name__, type(e.__context__).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def show(label, function):')

try: make = lambda: ((yield 1), stop(5), (yield 2))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: make = lambda: ((yield 1), stop(5), (yield 2))')
try:
    def function():
        yield 1
        stop(5)
        yield 2
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def function():')

try:
    for name, gen in (('lambda', make), ('def', function), ('genexpr', lambda: (stop(5) if x else x for x in (0, 1)))):
        try: print('---', 'name [' + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + ", " + 'gen=' + (repr(gen) if type(gen) in (str, int, float, bytes, bool, type(None)) or (type(gen) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in gen)) else gen.__name__ if type(gen) is type else type(gen).__name__) + '] =>', name)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: name')
        try: show('list', lambda: list(gen()))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('list', lambda: list(gen()))")
        def loop():
            out = []
            for x in gen():
                out.append(x)
            else:
                out.append('else')
            return out
        try: show('for', loop)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('for', loop)")
        def nexts():
            g = gen()
            return next(g), next(g, 'default')
        try: show('next with default', nexts)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('next with default', nexts)")
        def nexts2():
            g = gen()
            next(g)
            return next(g)
        try: show('next', nexts2)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('next', nexts2)")
        def after():
            g = gen()
            next(g)
            try:
                next(g)
            except BaseException as e:
                pass
            return g.gi_frame, g.gi_running, g.gi_suspended, next(g, 'finished')
        try: show('afterwards', after)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('afterwards', after)")
        def delegating():
            r = yield from gen()
            yield ('result', r)
        try: show('yield from', lambda: list(delegating()))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('yield from', lambda: list(delegating()))")
        def thrown():
            g = gen()
            next(g)
            return g.throw(StopIteration(9))
        try: show('throw', thrown)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('throw', thrown)")
        def thrown_at_start():
            return gen().throw(StopIteration(9))
        try: show('throw at the start', thrown_at_start)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('throw at the start', thrown_at_start)")
        def through():
            d = delegating()
            next(d)
            return d.throw(StopIteration(9))
        try: show('throw through yield from', through)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('throw through yield from', through)")
        try: show('unpack', lambda: [*gen()])
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('unpack', lambda: [*gen()])")
        try: show('tuple', lambda: tuple(gen()))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('tuple', lambda: tuple(gen()))")
        try: show('sum', lambda: sum(gen()))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('sum', lambda: sum(gen()))")
        try: show('in', lambda: 3 in gen())
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('in', lambda: 3 in gen())")
        try: show('zip', lambda: list(zip(gen(), 'abc')))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('zip', lambda: list(zip(gen(), 'abc')))")
        try: show('map', lambda: list(map(str, gen())))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('map', lambda: list(map(str, gen())))")
        try: show('a, b =', lambda: (lambda a, *b: (a, b))(*gen()))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('a, b =', lambda: (lambda a, *b: (a, b))(*gen()))")
        def unpack2():
            a, b = gen()
            return a, b
        try: show('unpacking', unpack2)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('unpacking', unpack2)")
        try: show('any', lambda: any(x > 5 for x in gen()))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('any', lambda: any(x > 5 for x in gen()))")
        try: show('dict', lambda: dict.fromkeys(gen()))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('dict', lambda: dict.fromkeys(gen()))")
        try: show('join', lambda: ''.join(str(x) for x in gen()))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('join', lambda: ''.join(str(x) for x in gen()))")
        def closing():
            g = gen()
            next(g)
            return g.close()
        try: show('close', closing)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('close', closing)")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: for name, gen in (('lambda', make), ('def', function), ('genexpr', la...")

try: print('--- a subclass, and in a handler')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: '--- a subclass, and in a handler'")
try:
    class Stop(StopIteration): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Stop(StopIteration): pass')
try: g = (lambda: ((yield 1), (_ for _ in ()).throw(Stop(1, 2))))()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g = (lambda: ((yield 1), (_ for _ in ()).throw(Stop(1, 2))))()')
try: show('subclass', lambda: list(g))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('subclass', lambda: list(g))")
try: import sys
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import sys')
try: events = []
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: events = []')
try:
    def trace(frame, event, arg):
        if frame.f_code.co_name == '<lambda>' and frame.f_code is make.__code__:
            events.append((event, arg if event != 'exception' else arg[0].__name__))
            return trace
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def trace(frame, event, arg):')
try: sys.settrace(trace)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sys.settrace(trace)')
try:
    try:
        list(make())
    finally:
        sys.settrace(None)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try:')
try: print(events)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: events')
try: renamed = make.__code__.replace(co_name='f')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: renamed = make.__code__.replace(co_name='f')")
try: import types
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import types')
try: show('renamed', lambda: list(types.FunctionType(renamed, globals())()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('renamed', lambda: list(types.FunctionType(renamed, globals())()))")
try: named = function.__code__.replace(co_name='<lambda>')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: named = function.__code__.replace(co_name='<lambda>')")
try: show('a def named <lambda>', lambda: list(types.FunctionType(named, globals())()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('a def named <lambda>', lambda: list(types.FunctionType(named, g...")
try: import marshal
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import marshal')
try: show('marshalled', lambda: list(types.FunctionType(marshal.loads(marshal.dumps(make.__code__)), globals())()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('marshalled', lambda: list(types.FunctionType(marshal.loads(mars...")
