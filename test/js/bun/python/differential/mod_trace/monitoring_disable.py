# DISABLE, restart_events(), local events, several tools, exceptions in callbacks.
import sys

m = sys.monitoring
E = m.events
log = []


def f(n=3):
    total = 0
    for i in range(n):
        total += i
    return total


def g():
    return f(1)


def lines(tool, disable=False):
    def callback(code, line):
        if code.co_filename == __file__ and code.co_name in ('f', 'g'):
            log.append((tool, code.co_name, line - code.co_firstlineno))
            if disable:
                return m.DISABLE
    return callback


def show(title):
    print(title, log)
    del log[:]


# DISABLE: each place once.
m.use_tool_id(1, 'one')
m.register_callback(1, E.LINE, lines(1, True))
m.set_events(1, E.LINE)
f()
f()
show('disabled')
m.restart_events()
f()
show('restarted')
m.set_events(1, 0)
f()
show('off')

# Two tools, one of which disables. The one with the higher number is told first.
m.use_tool_id(3, 'three')
m.register_callback(3, E.LINE, lines(3))
m.set_events(1, E.LINE)
m.set_events(3, E.LINE)
m.restart_events()
f(1)
f(1)
show('two tools')
m.set_events(1, 0)
m.set_events(3, 0)

# Local events: that code only.
m.set_local_events(3, f.__code__, E.LINE)
g()
show('local')
m.set_local_events(3, f.__code__, 0)
g()
show('local off')

# Local and global together
m.set_local_events(3, g.__code__, E.LINE)
m.set_events(1, E.LINE)
m.restart_events()
g()
show('both')
m.set_local_events(3, g.__code__, 0)
m.set_events(1, 0)


# Other events can be disabled too.
def counter(name, result=None):
    def callback(code, *args):
        if code.co_filename == __file__ and code.co_name in ('f', 'g', 'gen', 'raiser', 'catcher'):
            log.append((name, code.co_name))
            return result
    return callback


for name in ('PY_START', 'PY_RETURN', 'CALL'):
    m.register_callback(1, getattr(E, name), counter(name, m.DISABLE))
m.set_events(1, E.PY_START | E.PY_RETURN | E.CALL)
g()
g()
show('disabled others')
m.restart_events()
g()
show('restarted others')
m.set_events(1, 0)
for name in ('PY_START', 'PY_RETURN', 'CALL'):
    m.register_callback(1, getattr(E, name), None)


def gen():
    yield 1
    yield 2


for name in ('PY_YIELD', 'PY_RESUME'):
    m.register_callback(1, getattr(E, name), counter(name, m.DISABLE))
m.set_events(1, E.PY_YIELD | E.PY_RESUME)
list(gen())
list(gen())
show('disabled in a generator')
m.set_events(1, 0)


# Those that are not at a place in the code cannot, when they are asked for everywhere.
def raiser():
    raise ValueError('v')


def catcher():
    try:
        raiser()
    except ValueError:
        pass


for name in ('RAISE', 'PY_UNWIND', 'EXCEPTION_HANDLED'):
    m.register_callback(1, getattr(E, name), counter(name, m.DISABLE))
    m.set_events(1, getattr(E, name))
    try:
        catcher()
        print(name, 'no error')
    except ValueError as e:
        print(name, 'ValueError', e)
    catcher()
    show(name)
    m.set_events(1, 0)
    m.register_callback(1, getattr(E, name), None)

m.register_callback(1, E.C_RETURN, lambda *a: m.DISABLE)
m.set_events(1, E.CALL)


def calls_len():
    return len('abc')


try:
    calls_len()
    print('no error')
except ValueError as e:
    print('ValueError', e)
print(m.register_callback(1, E.C_RETURN, None))
m.set_events(1, 0)


# An exception in a callback goes to the code that is being monitored.
def failing(code, line):
    if code.co_name == 'f':
        raise RuntimeError('from the callback')


m.register_callback(1, E.LINE, failing)
m.set_events(1, E.LINE)
try:
    f()
except RuntimeError as e:
    print('RuntimeError', e, m.get_events(1) == E.LINE)
m.set_events(1, 0)

# Nothing is told of what a callback does.
def nested(code, line):
    if code.co_name == 'g':
        f(1)
        log.append('g')
    elif code.co_name == 'f':
        log.append('f')


m.register_callback(1, E.LINE, nested)
m.set_events(1, E.LINE)
g()
m.set_events(1, 0)
show('nested')

# Events set from inside the function that is running
def switches_on():
    x = 1
    m.set_events(1, E.LINE)
    y = 2
    z = 3
    m.set_events(1, 0)
    w = 4


def all_lines(code, line):
    if code.co_filename == __file__:
        log.append((code.co_name, line - code.co_firstlineno))


m.register_callback(1, E.LINE, all_lines)
switches_on()
show('switched on inside')


def switches_on_locally():
    x = 1
    m.set_local_events(1, switches_on_locally.__code__, E.LINE)
    y = 2
    for i in range(2):
        z = 3
    m.set_local_events(1, switches_on_locally.__code__, 0)
    w = 4


switches_on_locally()
show('switched on locally inside')

# A function made after the events were set
m.set_events(1, E.LINE)
exec(compile('def late():\n    a = 1\n    return a\nlate()\n', __file__, 'exec'))
m.set_events(1, 0)
show('made later')

m.free_tool_id(1)
m.free_tool_id(3)
