# throw() into a generator, a coroutine or an asynchronous generator that has not started: it starts, and that is as far as it gets.
# Tools are told, the traceback has its frame, and the frame has the arguments.
import sys
import traceback
import warnings

M = sys.monitoring
E = M.events


def g(a=1, *rest, k=2):
    b = a
    try:
        yield 1
    except KeyError:
        yield 3


def with_cell(a, b):
    def inner():
        return a
    yield inner


def outer(free):
    def closes_over(x):
        yield free, x
    return closes_over


async def co(a):
    return a


async def ag(a):
    yield a


def delegating(a):
    yield from g(a)


def genexpr():
    return (x for x in [1])


class Thrown(Exception):
    pass


MAKERS = [
    ('generator', lambda: g(5, 6, k=7)),
    ('cell', lambda: with_cell(1, 2)),
    ('closure', lambda: outer('f')(3)),
    ('coroutine', lambda: co(4)),
    ('delegating', lambda: delegating(8)),
    ('genexpr', genexpr),
]


def entries(exception):
    return [(frame.f_code.co_name, line) for frame, line in traceback.walk_tb(exception.__traceback__)]


def variables(frame):
    return sorted((name, type(value).__name__ if name == '.0' else value) for name, value in frame.f_locals.items() if not callable(value))


print('== the traceback, and what the frame in it has')
for label, make in MAKERS:
    x = make()
    try:
        x.throw(Thrown('t'))
    except Thrown as e:
        last = e.__traceback__
        while last.tb_next:
            last = last.tb_next
        print(label, entries(e)[1:], variables(last.tb_frame), last.tb_frame.f_back)
    for attribute in ('gi_frame', 'cr_frame', 'gi_running', 'cr_running', 'gi_suspended', 'cr_suspended'):
        if hasattr(x, attribute):
            print('   ', attribute, getattr(x, attribute))
    try:
        print('    again', x.send(None))
    except BaseException as e:
        print('    again', type(e).__name__, e)

print('== the frame object that was there before')
x = g(5)
frame = x.gi_frame
print(frame.f_lineno, variables(frame))
try:
    x.throw(Thrown)
except Thrown as e:
    print(e.__traceback__.tb_next.tb_frame is frame, variables(frame), frame.f_back, e.__traceback__.tb_next.tb_lineno)

print('== an exception with a traceback of its own, and one with a context')
try:
    1 / 0
except ZeroDivisionError as z:
    saved = z
x = g()
try:
    x.throw(saved)
except ZeroDivisionError as e:
    print(entries(e))
x = g()
try:
    try:
        raise KeyError('handled')
    except KeyError:
        x.throw(Thrown('in a handler'))
except Thrown as e:
    print(repr(e.__context__), entries(e))

print('== StopIteration, GeneratorExit')
for exception in (StopIteration('s'), GeneratorExit('x'), StopAsyncIteration('a')):
    for label, make in MAKERS[:1] + MAKERS[3:4]:
        x = make()
        try:
            print(label, x.throw(exception))
        except BaseException as e:
            print(label, type(e).__name__, e, repr(e.__cause__), entries(e)[1:])

print('== sys.monitoring')
names = {getattr(E, name): name for name in dir(E) if not name.startswith('_') and name not in ('NO_EVENTS', 'BRANCH')}
log = []


def callback(event):
    def told(code, *arguments):
        if code.co_filename == __file__ and code.co_name not in ('<lambda>', '<module>', 'outer'):
            log.append((names[event], code.co_name) + tuple(type(a).__name__ for a in arguments[1:]))
    return told


M.use_tool_id(1, 'test')
wanted = 0
for event, name in names.items():
    if name in ('INSTRUCTION', 'C_RETURN', 'C_RAISE', 'CALL', 'JUMP', 'BRANCH_LEFT', 'BRANCH_RIGHT'):
        continue
    M.register_callback(1, event, callback(event))
    wanted |= event
for label, make in MAKERS:
    x = make()
    log.clear()
    M.set_events(1, wanted)
    try:
        x.throw(Thrown)
    except Thrown:
        pass
    M.set_events(1, 0)
    print(label, log)
print('local events')
for label, make in MAKERS[:1]:
    x = make()
    log.clear()
    M.set_local_events(1, g.__code__, E.PY_START | E.PY_RESUME | E.LINE | E.PY_RETURN | E.PY_YIELD)
    M.set_events(1, E.PY_THROW | E.RAISE | E.PY_UNWIND)
    try:
        x.throw(Thrown)
    except Thrown:
        pass
    M.set_events(1, 0)
    M.set_local_events(1, g.__code__, 0)
    print(label, log)
print('a callback that raises')


def raises(code, offset, exception):
    raise LookupError('from the tool')


M.register_callback(1, E.PY_THROW, raises)
M.set_events(1, E.PY_THROW)
x = g()
try:
    x.throw(Thrown('t'))
except BaseException as e:
    M.set_events(1, 0)
    print(type(e).__name__, e, repr(e.__context__), [name for name, line in entries(e)])
M.set_events(1, 0)
print(x.gi_frame)
M.free_tool_id(1)

print('== sys.settrace, sys.setprofile')
for setter in (sys.settrace, sys.setprofile):
    for label, make in MAKERS:
        events = []

        def tool(frame, event, argument):
            if frame.f_code.co_filename == __file__ and frame.f_code.co_name not in ('<lambda>', '<module>', 'outer'):
                back = frame.f_back.f_code.co_name if frame.f_back else None
                events.append((event, frame.f_code.co_name, frame.f_lineno, back, variables(frame), argument[0].__name__ if isinstance(argument, tuple) else argument))
            return tool

        x = make()
        setter(tool)
        try:
            x.throw(Thrown)
        except Thrown:
            pass
        setter(None)
        print(setter.__name__, label)
        for event in events:
            print('   ', event)

print('== asynchronous generators')


def drive(awaitable):
    try:
        awaitable.send(None)
    except BaseException as e:
        return type(e).__name__, str(e), entries(e)[1:]
    return 'yielded'


a = ag(1)
print(drive(a.athrow(Thrown('t'))), a.ag_frame, a.ag_running)
print(drive(a.asend(None)))
a = ag(1)
print(drive(a.aclose()), a.ag_frame)
a = ag(1)
print(drive(a.athrow(GeneratorExit)), a.ag_frame)

print('== a coroutine that something was thrown into has been awaited')
with warnings.catch_warnings(record=True) as caught:
    warnings.simplefilter('always')
    c = co(1)
    try:
        c.throw(Thrown)
    except Thrown:
        pass
    del c
    import gc
    gc.collect()
print([str(w.message) for w in caught])

print('== close() is another matter: nobody is told, nothing is run')
events = []
sys.settrace(lambda frame, event, argument: events.append((event, frame.f_code.co_name)))
x = g()
x.close()
sys.settrace(None)
print(events, x.gi_frame)

print('== through yield from, next to a delegate that has not started')


def late():
    inner = g(9)
    yield 'first'
    yield from inner


x = late()
next(x)
try:
    x.throw(Thrown)
except Thrown as e:
    print(entries(e)[1:])

print('== a generator expression is passed what was written')
one = 1
for label, expression in [('list', (x for x in [1, 2])), ('set', (x for x in {1, 2})), ('names', (x for x in [one, one])), ('empty', (x for x in [])),
                          ('tuple', (x for x in (1, 2))), ('inner', (y for x in (1,) for y in [1, 2]))]:
    print(label, [(name, type(value).__name__, value) for name, value in expression.gi_frame.f_locals.items()], expression.gi_code.co_consts)


def constants(function):
    return [constant for constant in function.__code__.co_consts if not hasattr(constant, 'co_code')]


print(constants(lambda: (x for x in [1, 2])), constants(lambda: [x for x in [1, 2]]), constants(lambda: {x for x in {1, 2}}),
      constants(lambda: (x for x in {1, 2})), constants(lambda: sum(x for x in [1, 2])), constants(lambda: list(x for x in [1, 2])),
      constants(lambda: (x for x in [])), constants(lambda: all(x for x in [1, 2])))

print('== no instruction of it is run, and nothing of this shows where one is started in the usual way')
log = []
M.use_tool_id(1, 'test')
told_of = ('INSTRUCTION', 'LINE', 'PY_THROW', 'RAISE', 'PY_UNWIND', 'PY_START', 'JUMP', 'BRANCH_LEFT', 'BRANCH_RIGHT')
for name in told_of:
    M.register_callback(1, getattr(E, name), lambda code, *arguments, name=name: log.append(name) if code is with_cell.__code__ else None)
M.set_events(1, sum(getattr(E, name) for name in told_of))
x = with_cell(1, 2)
try:
    x.throw(Thrown)
except Thrown:
    pass
M.set_events(1, 0)
print(log)
log.clear()
M.set_events(1, sum(getattr(E, name) for name in told_of if name != 'INSTRUCTION'))
list(with_cell(1, 2))
M.set_events(1, 0)
M.free_tool_id(1)
print(log)

print('== a trace function that raises when it is told of the call')


def refuses(frame, event, argument):
    if frame.f_code is g.__code__:
        raise LookupError(event)
    return refuses


x = g()
sys.settrace(refuses)
try:
    x.throw(Thrown)
except BaseException as e:
    sys.settrace(None)
    print(type(e).__name__, e, repr(e.__context__), x.gi_frame, [name for name, line in entries(e)])
sys.settrace(None)
