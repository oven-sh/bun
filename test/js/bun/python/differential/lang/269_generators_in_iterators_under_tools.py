# The same under tools: when the generators are closed, among the events.
import sys
from collections import deque
from itertools import islice

EVENTS = []


def g(name, n=5):
    try:
        for i in range(n):
            yield i
    finally:
        EVENTS.append('closed ' + name)


def loop():
    for x in enumerate(g('a')):
        break
    EVENTS.append('after the loop')


def loop_over_two():
    for x in zip(g('a'), g('b')):
        break
    EVENTS.append('after the loop')


def function():
    next(map(str, g('a')))
    EVENTS.append('after next')


def type_():
    list(islice(g('a'), 2))
    EVENTS.append('after list')


def two_levels():
    any(zip(enumerate(g('a')), g('b')))
    EVENTS.append('after any')


def method():
    ''.join(map(str, islice(g('a'), 2)))
    EVENTS.append('after join')
    [].extend(islice(g('a'), 2))
    EVENTS.append('after extend')
    deque(islice(g('a'), 2), 1).extend(islice(g('b'), 2))
    EVENTS.append('after deque')
    bytes(islice(g('a'), 2)) + b''.join(map(bytes, islice(g('b'), 2)))
    EVENTS.append('after bytes')


def raises():
    try:
        ''.join(g('a'))
    except TypeError:
        EVENTS.append('in the handler')
    try:
        bytes(x * 200 for x in enumerate(g('a')))
    except TypeError:
        EVENTS.append('in the handler')
    try:
        a, b = enumerate(g('a'))
    except ValueError:
        EVENTS.append('in the handler')


def unpacks():
    a, b = islice(g('a'), 2)
    EVENTS.append('after the assignment')
    a, *b = zip(g('a', 2), g('b'))
    EVENTS.append('after the assignment')


def identity(x):
    return x


def elements_that_call():
    next(identity(x) for x in g('a'))
    EVENTS.append('after next')
    any(identity(x + 1) for x in g('a'))
    EVENTS.append('after any')
    for x in (identity(x) for x in g('a')):
        break
    EVENTS.append('after the loop')


FORMS = (loop, loop_over_two, function, type_, two_levels, method, raises, unpacks, elements_that_call)


def name_of(arg):
    return getattr(arg, '__qualname__', None) or type(arg).__name__


def profile(frame, event, arg):
    EVENTS.append((event, name_of(arg) if event.startswith('c_') else frame.f_code.co_name))


def trace(frame, event, arg):
    EVENTS.append((event, frame.f_code.co_name, frame.f_lineno - frame.f_code.co_firstlineno))
    return trace


def report(what):
    print('--', what)
    for event in EVENTS:
        print('  ', event)
    EVENTS.clear()


for form in FORMS:
    form()
    report(form.__name__)
    sys.setprofile(profile)
    form()
    sys.setprofile(None)
    report(form.__name__ + ', profiled')
    sys.settrace(trace)
    form()
    sys.settrace(None)
    report(form.__name__ + ', traced')

mon = sys.monitoring
E = mon.events
mon.use_tool_id(3, 'test')
for event in (E.PY_START, E.PY_RETURN, E.PY_UNWIND, E.PY_THROW, E.PY_YIELD, E.PY_RESUME):
    def callback(code, offset, *args, name=event):
        EVENTS.append((name, code.co_name))
    mon.register_callback(3, event, callback)
for form in FORMS:
    mon.set_events(3, E.PY_START | E.PY_RETURN | E.PY_UNWIND | E.PY_THROW | E.PY_YIELD | E.PY_RESUME)
    form()
    mon.set_events(3, 0)
    report(form.__name__ + ', monitored')
