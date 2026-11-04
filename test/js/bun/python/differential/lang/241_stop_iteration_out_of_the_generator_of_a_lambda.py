# A StopIteration that leaves the generator of a lambda.
def stop(value=None):
    raise StopIteration(value)

def show(label, function):
    try:
        print(label, function())
    except BaseException as e:
        print(label, type(e).__name__, e.args, type(e.__cause__).__name__, type(e.__context__).__name__)

make = lambda: ((yield 1), stop(5), (yield 2))
def function():
    yield 1
    stop(5)
    yield 2

for name, gen in (('lambda', make), ('def', function), ('genexpr', lambda: (stop(5) if x else x for x in (0, 1)))):
    print('---', name)
    show('list', lambda: list(gen()))
    def loop():
        out = []
        for x in gen():
            out.append(x)
        else:
            out.append('else')
        return out
    show('for', loop)
    def nexts():
        g = gen()
        return next(g), next(g, 'default')
    show('next with default', nexts)
    def nexts2():
        g = gen()
        next(g)
        return next(g)
    show('next', nexts2)
    def after():
        g = gen()
        next(g)
        try:
            next(g)
        except BaseException as e:
            pass
        return g.gi_frame, g.gi_running, g.gi_suspended, next(g, 'finished')
    show('afterwards', after)
    def delegating():
        r = yield from gen()
        yield ('result', r)
    show('yield from', lambda: list(delegating()))
    def thrown():
        g = gen()
        next(g)
        return g.throw(StopIteration(9))
    show('throw', thrown)
    def thrown_at_start():
        return gen().throw(StopIteration(9))
    show('throw at the start', thrown_at_start)
    def through():
        d = delegating()
        next(d)
        return d.throw(StopIteration(9))
    show('throw through yield from', through)
    show('unpack', lambda: [*gen()])
    show('tuple', lambda: tuple(gen()))
    show('sum', lambda: sum(gen()))
    show('in', lambda: 3 in gen())
    show('zip', lambda: list(zip(gen(), 'abc')))
    show('map', lambda: list(map(str, gen())))
    show('a, b =', lambda: (lambda a, *b: (a, b))(*gen()))
    def unpack2():
        a, b = gen()
        return a, b
    show('unpacking', unpack2)
    show('any', lambda: any(x > 5 for x in gen()))
    show('dict', lambda: dict.fromkeys(gen()))
    show('join', lambda: ''.join(str(x) for x in gen()))
    def closing():
        g = gen()
        next(g)
        return g.close()
    show('close', closing)

print('--- a subclass, and in a handler')
class Stop(StopIteration): pass
g = (lambda: ((yield 1), (_ for _ in ()).throw(Stop(1, 2))))()
show('subclass', lambda: list(g))
import sys
events = []
def trace(frame, event, arg):
    if frame.f_code.co_name == '<lambda>' and frame.f_code is make.__code__:
        events.append((event, arg if event != 'exception' else arg[0].__name__))
        return trace
sys.settrace(trace)
try:
    list(make())
finally:
    sys.settrace(None)
print(events)
renamed = make.__code__.replace(co_name='f')
import types
show('renamed', lambda: list(types.FunctionType(renamed, globals())()))
named = function.__code__.replace(co_name='<lambda>')
show('a def named <lambda>', lambda: list(types.FunctionType(named, globals())()))
import marshal
show('marshalled', lambda: list(types.FunctionType(marshal.loads(marshal.dumps(make.__code__)), globals())()))
