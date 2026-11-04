# A generator that only the `for` loop refers to is closed when the loop is left, however it is left; one that anything else
# refers to is not.
import gc
import sys

log = []


def gen(name, n=9):
    try:
        for i in range(n):
            yield i
    finally:
        log.append('closed ' + name)


def show(label, *values):
    print(label, *values, log)
    log.clear()


print('--- closed at once')

for v in gen('break'):
    break
show('break')


def returns():
    for v in gen('return'):
        return v


returns()
show('return')

try:
    for v in gen('raise'):
        raise ValueError
except ValueError:
    show('in the handler')
show('after the handler')


def raises():
    for v in gen('leaves the frame'):
        raise KeyError


try:
    raises()
except KeyError:
    show("in the caller's handler")


def raises_below():
    for v in gen('raised by a callee'):
        raises()


try:
    raises_below()
except KeyError:
    show('two frames')


def two_loops():
    for a in gen('outer'):
        for b in gen('inner'):
            return


two_loops()
show('return through two loops')

for a in gen('outer'):
    for b in gen('inner'):
        break
    show('inner left')
    break
show('outer left')

for a in range(2):
    for b in gen('inner %d' % a):
        if b:
            break
    else:
        log.append('else')
    show('round %d' % a)

for v in gen('exhausted'):
    pass
else:
    log.append('else')
show('exhausted')

for v in gen('order'):
    try:
        break
    finally:
        log.append('finally in the body')
show('finally first')


def finally_and_return():
    try:
        for v in gen('order'):
            return log.append('value of return')
    finally:
        log.append('finally around the loop')


finally_and_return()
show('return, loop, finally')


class Manager:
    def __enter__(self):
        return self

    def __exit__(self, *exc):
        log.append('__exit__ %s' % (exc[0].__name__ if exc[0] else None))


for v in gen('with'):
    with Manager():
        break
show('with in the body')

try:
    with Manager():
        for v in gen('with around'):
            raise OSError
except OSError:
    show('with around the loop')


class C:
    def items(self, name):
        try:
            yield 1
            yield 2
        finally:
            log.append('closed ' + name)

    @staticmethod
    def static(name):
        return gen(name)


c = C()
for v in c.items('method'):
    break
show('method')
for v in C().items('method of a temporary'):
    break
show('method of a temporary')
for v in gen(*['star']):
    break
show('*args')
for v in gen(name='keyword', n=2):
    break
show('keyword')
for v in gen(**{'name': 'star star'}):
    break
show('**kwargs')


def Upper(name):
    try:
        yield 1
    finally:
        log.append('closed ' + name)


for v in Upper('name like a class'):
    break
show('name like a class')


def outer_generator():
    for v in gen('in a generator'):
        yield v


o = outer_generator()
next(o)
o.close()
show('the loop is in a generator that is closed')

o = outer_generator()
next(o)
try:
    o.throw(LookupError)
except LookupError:
    show('... that is thrown into')


def raising_finally():
    try:
        yield 1
    finally:
        raise RuntimeError('in finally')


def hook(args):
    log.append('unraisable %s %s' % (args.exc_type.__name__, args.err_msg.split(' at 0x')[0]))


sys.unraisablehook = hook
for v in raising_finally():
    break
show('a finally that raises')
sys.unraisablehook = sys.__unraisablehook__


def ignores_exit():
    while True:
        try:
            yield 1
        except GeneratorExit:
            log.append('ignored')


sys.unraisablehook = hook
for v in ignores_exit():
    break
show('a generator that ignores GeneratorExit')
sys.unraisablehook = sys.__unraisablehook__


def sees_exception():
    try:
        yield 1
    finally:
        log.append('%r in the context of %r' % (sys.exception(), sys.exception().__context__))


try:
    for v in sees_exception():
        raise ValueError('on its way')
except ValueError:
    show('the exception on its way is not being handled')

try:
    raise KeyError('handled')
except KeyError:
    for v in sees_exception():
        break
    show('the one being handled is')

for i in range(3):
    for v in gen('again %d' % i):
        break
show('the same loop three times')


def recursive(depth):
    for v in gen('depth %d' % depth):
        if depth:
            recursive(depth - 1)
        break


recursive(3)
show('recursion')

print('--- not closed: something else refers to it')

g1 = gen('variable')
for v in g1:
    break
show('a variable')
print(next(g1))

for v in (g2 := gen('walrus')):
    break
show('walrus')
print(next(g2))

kept = []


def make(name):
    x = gen(name)
    kept.append(x)
    return x


for v in make('kept by its maker'):
    break
show('kept by its maker')
print(next(kept[0]))


def identity(x):
    return x


g3 = gen('through a function')
for v in identity(g3):
    break
show('through a function')
print(next(g3))

for v in iter(g3):
    break
show('iter()')
print(next(g3))

g4 = gen('conditional')
for v in (g4 if len(kept) else gen('other')):
    break
show('conditional expression')
print(next(g4))


def site(function):
    for v in function('site'):
        break


log.clear()
site(gen)
show('a call site: its own generator')
g5 = gen('of somebody else')
site(lambda name: g5)
show('the same site: the generator of somebody else')
print(next(g5))
site(gen)
show('the same site: its own again')


def keeps_first(name, made=[]):
    if not made:
        made.append(gen(name))
    return made[0]


site(keeps_first)
site(keeps_first)
show('the same site: a function that keeps what it makes')
print(next(keeps_first('')))

leaked = None


def leaks_itself():
    global leaked
    leaked = sys._getframe().f_generator
    try:
        yield 1
        yield 2
    finally:
        log.append('closed leaks_itself')


for v in leaks_itself():
    break
show('it leaked itself through its frame')
print(next(leaked))
leaked.close()
log.clear()

for v in gen('found by gc'):
    found = [o for o in gc.get_objects() if type(o).__name__ == 'generator' and o.gi_code is gen.__code__ and o.gi_frame and o.gi_frame.f_locals['name'] == 'found by gc']
    break
show('gc.get_objects()')
print(len(found), next(found[0]))
found[0].close()
del found, o
log.clear()


def gen_with_argument(argument):
    try:
        yield 1
        yield 2
    finally:
        log.append('closed gen_with_argument')


marker = ['marker']
for v in gen_with_argument(marker):
    referrers = [o for o in gc.get_referrers(marker) if type(o).__name__ == 'generator']
    break
show('gc.get_referrers()')
print(len(referrers), next(referrers[0]))
referrers[0].close()
del referrers
log.clear()

frames = []


def tracer(frame, event, arg):
    if frame.f_code is gen.__code__ and not frames:
        frames.append(frame)
    return None


sys.settrace(tracer)
for v in gen('traced'):
    break
sys.settrace(None)
show('a trace function saw its frame')
print(frames[0].f_generator)
frames.clear()

sys.settrace(tracer)
for v in gen('traced and taken'):
    taken = frames[0].f_generator
    break
sys.settrace(None)
show('... and the generator was taken from it')
print(next(taken))
taken.close()
log.clear()

print('--- nobody is shown the generator when it is made')
returned = []


def return_tracer(frame, event, arg):
    if event == 'return' and type(arg).__name__ == 'generator':
        returned.append(arg)
    return return_tracer


sys.settrace(return_tracer)
for v in gen('return event'):
    break
sys.settrace(None)
show('trace function', len(returned))

sys.setprofile(return_tracer)
for v in gen('profile'):
    break
sys.setprofile(None)
show('profile function', len(returned))

monitoring = sys.monitoring
monitoring.use_tool_id(3, 'test')
for event in (monitoring.events.PY_RETURN, monitoring.events.PY_START, monitoring.events.CALL, monitoring.events.PY_YIELD):
    monitoring.register_callback(3, event, lambda *args: returned.extend(a for a in args if type(a).__name__ == 'generator'))
monitoring.set_events(3, monitoring.events.PY_RETURN | monitoring.events.PY_START | monitoring.events.CALL | monitoring.events.PY_YIELD)
for v in gen('monitored'):
    break
monitoring.set_events(3, 0)
monitoring.free_tool_id(3)
show('sys.monitoring', len(returned))

print('--- the loop holds its iterator even where no instruction will read it again')


def collects_then_raises():
    for v in gen('a collection before the raise'):
        gc.collect()
        log.append('collected')
        raise ValueError


try:
    collects_then_raises()
except ValueError:
    show('only the way of the exception is left')


def yields_then_raises():
    for v in gen('a yield before the raise'):
        yield v
        log.append('resumed')
        raise ValueError


g = yields_then_raises()
next(g)
[[i] for i in range(1000)]
gc.collect()
try:
    next(g)
except ValueError:
    show('in a generator')


def yields_twice_then_raises():
    for v in gen('two yields'):
        yield v
        gc.collect()
        yield v
        log.append('resumed')
        raise ValueError


g = yields_twice_then_raises()
next(g)
next(g)
gc.collect()
try:
    next(g)
except ValueError:
    show('in a generator, twice')

g = yields_then_raises()
next(g)
gc.collect()
g.close()
show('a generator that is closed there')

g = yields_then_raises()
next(g)
try:
    g.throw(KeyError)
except KeyError:
    show('or thrown into')


def raises_in_handler():
    for v in gen('raise in a handler'):
        try:
            raise KeyError
        except KeyError:
            gc.collect()
            log.append('handler')
            raise ValueError


try:
    raises_in_handler()
except ValueError:
    show('the handler comes first')

print('--- a generator with nothing of its own to clean up, and what it holds')


def delegates(name):
    yield from gen(name)


for v in delegates('delegated to'):
    break
show('yield from')


def delegates_twice(name):
    yield from delegates(name)


for v in delegates_twice('delegated to, twice'):
    break
show('yield from, twice')


def loops(name):
    for v in gen(name):
        yield v


for v in loops('looped over'):
    break
show('a loop')


def loops_twice(name):
    for v in loops(name):
        yield v


for v in loops_twice('looped over, twice'):
    break
show('a loop in a loop')


def leave_by_exception():
    for v in loops_twice('left by an exception'):
        raise KeyError


try:
    leave_by_exception()
except KeyError:
    show('an exception')
