# all(), any(), tuple(), list() and set() of a generator expression: the code goes through the generator itself, if the name is bound to the
# builtin. There is no call for a profiler to see, and a trace function sees the loop.
import sys
import traceback

ev = []


def t_all(x):
    return all(i for i in x)


def t_any(x):
    return any(i for i in x)


def t_list(x):
    return list(i for i in x)


def t_tuple(x):
    return tuple(i
                 for i in x)


def t_set(x):
    return set(
        i for i in x)


def t_assigned(x):
    x = list(x for x in x)
    y = all(x for x in x)
    return x, y


def t_nested(x):
    return list(tuple(j for j in range(i)) for i in x)


def t_condition(x):
    if any(i > 1 for i in x):
        return 'some'
    return 'none'


FUNCTIONS = (t_all, t_any, t_list, t_tuple, t_set, t_assigned, t_nested, t_condition)
for f in FUNCTIONS:
    print(f.__name__, f([1, 0, 2]), f([]), f([1]))


def mine(code):
    return code.co_name.startswith('t_') or code.co_name == '<genexpr>'


def profiler(frame, event, arg):
    if mine(frame.f_code):
        ev.append((event, frame.f_code.co_name, getattr(arg, '__name__', None) if event.startswith('c_') else None))


def tracer(frame, event, arg):
    if mine(frame.f_code):
        ev.append((event, frame.f_code.co_name, frame.f_lineno - frame.f_code.co_firstlineno))
    return tracer


for f in FUNCTIONS:
    sys.setprofile(profiler)
    f([1, 0])
    sys.setprofile(None)
    print('profile', f.__name__, ev)
    del ev[:]
for f in FUNCTIONS:
    sys.settrace(tracer)
    f([1, 0])
    sys.settrace(None)
    print('trace', f.__name__, ev)
    del ev[:]

m = sys.monitoring
E = m.events
m.use_tool_id(1, 'test')
for name in ('CALL', 'C_RETURN', 'PY_START', 'PY_RESUME', 'PY_YIELD', 'PY_RETURN', 'PY_THROW', 'PY_UNWIND'):
    m.register_callback(1, getattr(E, name), (lambda name: lambda code, *args: ev.append((name, code.co_name)) if mine(code) else None)(name))
for f in FUNCTIONS:
    m.set_events(1, E.CALL | E.PY_START | E.PY_RESUME | E.PY_YIELD | E.PY_RETURN | E.PY_THROW | E.PY_UNWIND)
    f([1, 0])
    m.set_events(1, 0)
    print('monitoring', f.__name__, ev)
    del ev[:]
m.free_tool_id(1)


# ---- The name may be bound to something else ----

def shadowed_local(x):
    all = len
    try:
        return all(i for i in x)
    except TypeError as e:
        return str(e)


def shadowed_global(x):
    return any(i for i in x), list(i for i in x)


print(shadowed_local([1]))
any = lambda it: ('mine', sorted(it))
print(shadowed_global([2, 1]))
del any
print(shadowed_global([2, 1]))
import builtins
original = builtins.list
builtins.list = lambda it: ('builtins', tuple(it))
print(shadowed_global([2, 1]))
builtins.list = original
print(shadowed_global([2, 1]))


class Sub(list):
    pass


def with_class(list):
    return type(list(i for i in (1, 2)))


print(with_class(Sub), with_class(original))


# ---- Exceptions ----

def raises(x):
    return all(1 / i for i in x)


try:
    raises([1, 0])
except ZeroDivisionError:
    traceback.print_exc(file=sys.stdout)


def unhashable():
    return set([i] for i in range(2))


try:
    unhashable()
except TypeError:
    traceback.print_exc(file=sys.stdout)


class Truth:
    def __bool__(self):
        raise ValueError('no truth')


try:
    any(t for t in [Truth()])
except ValueError:
    traceback.print_exc(file=sys.stdout)


# ---- A generator that is left before its end is closed at once ----

def source(log):
    try:
        yield 0
        yield 1
        yield 2
    finally:
        log.append('closed')


def left_early():
    log = []
    s = source(log)
    r = any(i for i in s)
    return r, next(s, 'nothing left')


print(left_early())


# ---- In a generator, a coroutine, a class body, a comprehension ----

def generator(x):
    yield all(i for i in x)
    yield tuple(i for i in x)


print(list(generator([1, 2])))


async def coroutine(x):
    return list(i for i in x)


try:
    coroutine([1]).send(None)
except StopIteration as e:
    print(e.value)


class Body:
    values = [1, 2]
    copy = tuple(v for v in values)


print(Body.copy, [list(j for j in range(i)) for i in range(3)])


async def asynchronous():
    async def numbers():
        yield 1
    # Not gone through in place: the generator is asynchronous.
    try:
        return list(i async for i in numbers())
    except TypeError as e:
        return str(e)


try:
    asynchronous().send(None)
except StopIteration as e:
    print(e.value)
