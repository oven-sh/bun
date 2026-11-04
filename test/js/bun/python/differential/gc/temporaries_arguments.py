# A generator that is made for a call of a built-in function which goes through it and keeps nothing is closed when the call is over,
# if the function has left it unfinished; one that anything else refers to is not.
import functools
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
show('any', any(gen('any')))
show('all', all(gen('all')))
show('next', next(gen('next')))
show('next with a default', next(gen('next'), 'default'))
show('next of an empty one', next(gen('empty', 0), 'default'))
x = any(gen('assigned'))
show('assigned', x)
if any(gen('tested')):
    show('tested')
show('nested', any([next(gen('inner'))]), next(gen('second')))
show('method', [].append(next(gen('argument'))))


def function():
    return next(gen('returned'))


show('in a function', function())
show('lambda', (lambda: any(gen('lambda')))())
show('comprehension', [next(gen('c%d' % i)) for i in range(2)])


class Unhashable:
    __hash__ = None


def items(name):
    try:
        yield 1
        yield 'a'
        yield 3
    finally:
        log.append('closed ' + name)


for function in (sum, min, max, sorted):
    try:
        function(items(function.__name__))
    except TypeError as e:
        show('in the handler of ' + function.__name__)

try:
    next(gen('bad default'), *1)
except TypeError:
    show('the call never began')


def raises(name):
    try:
        yield 0
        raise ValueError(name)
    finally:
        log.append('closed ' + name)


try:
    any(raises('raises'))
except ValueError:
    show('raised by the generator')

print('--- exhausted')
show('any', any(gen('any', 1)))
show('all', all(gen('all', 0)))
show('sum', sum(gen('sum', 3)))
show('max', max(gen('max', 3)))
show('sorted', sorted(gen('sorted', 3)))

print('--- what closing does')


def slow_to_close(name):
    try:
        yield 1
    finally:
        log.append('closing ' + name)
        log.append(next(gen('inside ' + name)))
        log.append('closed ' + name)


show('closes another', next(slow_to_close('outer')))


def ignores_exit():
    try:
        yield 1
    except GeneratorExit:
        yield 2


def hook(unraisable):
    log.append((type(unraisable.exc_value).__name__, str(unraisable.exc_value)))


sys.unraisablehook = hook
show('ignores GeneratorExit', next(ignores_exit()))


def raises_on_close():
    try:
        yield 1
    finally:
        raise KeyError('on close')


show('raises when closed', next(raises_on_close()))


def raises_on_close_too():
    try:
        yield 1
        yield 'a'
    finally:
        raise KeyError('with an error pending')


try:
    sum(raises_on_close_too())
except TypeError as e:
    show('the error stays', type(e).__name__, e.__context__)
sys.unraisablehook = sys.__unraisablehook__


def delegates(name):
    try:
        yield from gen('delegate of ' + name)
    finally:
        log.append('closed ' + name)


show('delegates', next(delegates('outer')))

print('--- not closed, or not before the collector comes')
g = gen('variable')
show('variable', next(g))
show('again', next(g))
g.close()
show('closed by the program')
kept = []
show('walrus', next(h := gen('walrus')))
h.close()
log.clear()


def keeps(iterable):
    kept.append(iterable)
    return next(iterable)


show('a function of the program', keeps(gen('kept')))
show('still going', next(kept[0]))
kept.pop().close()
log.clear()

mine = next


def next(iterable):
    kept.append(iterable)
    return mine(iterable)


show('a name that is bound to something else', next(gen('shadowed')))
show('still going', mine(kept[0]))
kept.pop().close()
log.clear()
del next

result = next(gen('first of two'), next(gen('second of two')))
gc.collect()
show('two', result)
show('iter', type(iter(gen('iter'))).__name__)
gc.collect()
show('collected')
z = zip(gen('zip'), 'a')
show('zip', next(z))
del z
gc.collect()
show('collected')
result = functools.partial(next)(gen('partial'))
gc.collect()
show('partial', result)
result = list(map(next, [gen('mapped')]))
gc.collect()
show('map', result)
result = next(*[gen('star')])
gc.collect()
show('star', result)


def knows_itself():
    kept.append(sys._getframe().f_generator)
    try:
        yield 1
        yield 2
    finally:
        log.append('closed itself')


show('a generator that gives itself away', next(knows_itself()))
show('still going', next(kept[0]))
kept.pop().close()
log.clear()

print('--- the same instructions with other functions')


def keep(iterable, *more):
    kept.append(iterable)
    return 'kept'


def apply(use, make):
    return use(make())


def apply_with_default(use, make, other):
    return use(make(), other())


def apply_to_second(use, first, make):
    return use(first(), make())


def made():
    return gen('made')


for use, make in ((keep, made), (next, lambda: kept[0]), (any, lambda: kept[0]), (next, lambda: kept[0])):
    result = apply(use, make)
    show('in a function', result)
kept.pop().close()
log.clear()
for use, make in ((keep, made), (next, lambda: kept[0]), (any, lambda: kept[0]), (next, lambda: kept[0])):
    result = use(make())
    show('in a loop', result)
kept.pop().close()
log.clear()
for use, make in ((keep, made), (next, lambda: kept[0]), (next, lambda: kept[0])):
    result = apply_with_default(use, make, int)
    show('with another argument', result)
kept.pop().close()
log.clear()
# The call that has made a generator for a function that keeps it returns the same generator the next time, to a function that keeps nothing.
def plain():
    try:
        yield 1
        yield 2
        yield 3
    finally:
        log.append('closed plain')


for use, make in ((keep, plain), (next, lambda: kept[0]), (any, lambda: kept[0]), (next, lambda: kept[0])):
    result = apply(use, make)
    show('made by the call itself, in a function', result)
kept.pop().close()
log.clear()
for use, make in ((keep, plain), (next, lambda: kept[0]), (any, lambda: kept[0]), (next, lambda: kept[0])):
    result = use(make())
    show('made by the call itself, in a loop', result)
kept.pop().close()
log.clear()
for use, make in ((kept.append, plain), (next, lambda: kept[0]), (next, lambda: kept[0])):
    result = use(make())
    show('kept by a method of a list', result)
kept.pop().close()
log.clear()
# What next() returns when there is nothing left is its second argument.
for first, make in ((lambda: iter(()), made), (lambda: kept[0], int), (lambda: kept[0], int)):
    result = apply_to_second(next, first, make)
    if type(result) is not int:
        kept.append(result)
        result = 'the generator'
    show('the default', result)
kept.pop().close()
log.clear()
# An error before the function looks at its arguments.
for use, make in ((next, made), (next, lambda: gen('other'))):
    try:
        result = use(make(), 1, 2)
    except TypeError:
        gc.collect()
        show('too many arguments')

print('--- traced')
events = []


def tracer(frame, event, arg):
    if frame.f_code.co_name in ('gen', 'traced'):
        events.append((frame.f_code.co_name, event, frame.f_lineno - frame.f_code.co_firstlineno))
    return tracer


def traced():
    x = any(gen('traced', 2)) or next(gen('second'))
    return x


sys.settrace(tracer)
traced()
sys.settrace(None)
show('traced', events)

seen = []
monitoring = sys.monitoring
monitoring.use_tool_id(3, 'test')
monitoring.register_callback(3, monitoring.events.CALL, lambda code, offset, function, argument: seen.append(argument) if function is mine else None)
monitoring.set_events(3, monitoring.events.CALL)
first = next(gen('shown to a tool'))
monitoring.set_events(3, 0)
monitoring.free_tool_id(3)
show('shown to a tool', first)
show('still going', next(seen[0]))
seen.pop().close()
log.clear()
