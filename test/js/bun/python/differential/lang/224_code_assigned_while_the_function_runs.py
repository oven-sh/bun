# function.__code__ is set while the function runs: the call goes on in the code it began in, and all that is known about the call (its
# variables, its code object, its lines, what a tracer is told) is about that code.
import gc
import sys
import threading
import traceback


def many(a, b=2, c=3, d=4, e=5, f=6, g=7, h=8, i=9, j=10):
    k = l = m = n = o = p = 'many'
    return a, b, c, d, e, f, g, h, i, j, k, l, m, n, o, p


def become(function, other):
    function.__code__ = other.__code__
    function.__defaults__ = other.__defaults__


print('--- it raises afterwards')


def swaps(*args, **kwargs):
    local = 'of swaps'
    become(swaps, many)
    raise ValueError(local)


original = swaps.__code__
try:
    swaps(1)
except ValueError as e:
    frame = e.__traceback__.tb_next.tb_frame
    print(frame.f_code is original, frame.f_code.co_name, swaps.__code__ is many.__code__)
    print(sorted(frame.f_locals.items()))
    print(traceback.format_exc().replace(__file__, 'FILE'))
    del frame
print(swaps(1))

print('--- it calls itself, as what compiles a function when it is first called does')


def lazy(*args, **kwargs):
    become(lazy, many)
    return lazy(*args, **kwargs)


print(lazy(0, j=1))
print(lazy(0, j=2))


def fails(a, b=2, c=3, d=4, e=5, f=6, g=7, h=8):
    import no_such_module_at_all


def lazy(*args, **kwargs):
    become(lazy, fails)
    return lazy(*args, **kwargs)


def outer():
    return sum(lazy(1).values())


for attempt in range(3):
    try:
        outer()
    except ImportError as e:
        entries = traceback.extract_tb(e.__traceback__)
        print([(entry.name, entry.line) for entry in entries])
        frames = []
        tb = e.__traceback__
        while tb:
            frames.append(tb.tb_frame)
            tb = tb.tb_next
        print([(frame.f_code.co_name, sorted(frame.f_locals)) for frame in frames[1:]])
        del frames, tb
    gc.collect()

print('--- the frame is looked at while it runs')


def looks(x, y=2):
    z = 3
    before = sys._getframe()
    become(looks, many)
    frame = sys._getframe()
    print(frame is before, frame.f_code.co_name, frame.f_code.co_varnames[:3], frame.f_lineno - frame.f_code.co_firstlineno)
    print({name: value for name, value in frame.f_locals.items() if name in 'xyz'})
    print({name: value for name, value in locals().items() if name in 'xyz'})
    frame.f_locals['z'] = 4
    return z


print(looks(1))
print(looks(1))

print('--- super() and a class cell')


class Base:
    def method(self):
        return 'base'


class Derived(Base):
    def method(self):
        become(Derived.method, Derived.other)
        return super().method()

    def other(self, a=1, b=2, c=3):
        return __class__.__name__


print(Derived().method(), Derived().method())

print('--- generators')


def generates(n):
    first = 'first'
    yield first, n
    yield sorted(sys._getframe().f_locals)
    yield sys._getframe().f_code.co_name


def generates_other(a, b=2, c=3, d=4, e=5):
    x = y = z = 'other'
    yield a, b, c, d, e, x, y, z
    yield sys._getframe().f_code.co_name


old = generates(1)
old_code = generates.__code__
unstarted = generates(2)
print(next(old))
become(generates, generates_other)
new = generates(3)
print(next(old), next(new), next(unstarted))
print(old.gi_code is old_code, old.gi_code.co_name, new.gi_code.co_name, unstarted.gi_code.co_name, old.gi_frame.f_code.co_name, new.gi_frame.f_code.co_name)
print(sorted(old.gi_frame.f_locals), sorted(new.gi_frame.f_locals), sorted(unstarted.gi_frame.f_locals))
gc.collect()
print(next(old), next(new), list(unstarted))


def generates_and_swaps(n):
    become(generates_and_swaps, generates_other)
    local = n
    gc.collect()
    yield local
    yield sorted(sys._getframe().f_locals)


print(list(generates_and_swaps(1)), list(generates_and_swaps(1)))

print('--- tracing')
events = []


def tracer(frame, event, arg):
    if frame.f_code.co_filename == __file__:
        events.append((event, frame.f_code.co_name, frame.f_lineno - frame.f_code.co_firstlineno))
    return tracer


def traced(*args):
    become(traced, many)
    value = 1
    value += 1
    return value


sys.settrace(tracer)
traced()
traced(1)
sys.settrace(None)
print(events)

events = []
monitoring = sys.monitoring
monitoring.use_tool_id(1, 'test')
monitoring.register_callback(1, monitoring.events.LINE, lambda code, line: events.append((code.co_name, line - code.co_firstlineno)))
monitoring.register_callback(1, monitoring.events.PY_RETURN, lambda code, offset, value: events.append((code.co_name, 'return')))


def monitored(*args):
    become(monitored, many)
    value = 1
    return value


monitoring.set_local_events(1, monitored.__code__, monitoring.events.LINE | monitoring.events.PY_RETURN)
monitoring.set_local_events(1, many.__code__, monitoring.events.LINE | monitoring.events.PY_RETURN)
monitored()
monitored(1)
monitoring.free_tool_id(1)
print(events)

print('--- while the arguments are bound')


class Key(str):
    def __hash__(self):
        return str.__hash__(self)

    def __eq__(self, other):
        become(bound, many)
        return str.__eq__(self, other)


def bound(first, *, second=None, **rest):
    return first, second, sorted(rest)


print(bound(1, **{Key('second'): 2, Key('third'): 3}))

print('--- from another thread')
started = threading.Event()
go = threading.Event()
outcome = []


def blocked(x):
    local = 'of blocked'
    started.set()
    go.wait()
    try:
        raise KeyError(local)
    except KeyError as e:
        frame = e.__traceback__.tb_frame
        outcome.append((frame.f_code.co_name, sorted(frame.f_locals)))
        del frame
    return x, local


thread = threading.Thread(target=lambda: outcome.append(blocked(1)))
thread.start()
started.wait()
become(blocked, many)
frame = sys._current_frames()[thread.ident]
while frame.f_code.co_name != 'blocked':
    frame = frame.f_back
print(frame.f_code.co_name, sorted(frame.f_locals.items()))
del frame
gc.collect()
go.set()
thread.join()
print(outcome, blocked(1)[:2])
