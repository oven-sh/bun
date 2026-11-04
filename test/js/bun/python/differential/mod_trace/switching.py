# Tools that are switched on and off while code is loaded, running or suspended: whatever runs afterwards is told of.
import sys
import threading

m = sys.monitoring
E = m.events
TOOL = 3
log = []


def record_line(code, line):
    if code.co_filename == __file__:
        log.append(('LINE', code.co_name, line - code.co_firstlineno))


def recorder(name):
    def record(code, offset, *args):
        if code.co_filename == __file__:
            log.append((name, code.co_name))
    return record


EVENTS = E.LINE | E.PY_START | E.PY_RETURN | E.PY_YIELD | E.PY_RESUME | E.PY_THROW | E.PY_UNWIND


def on(events=EVENTS):
    m.set_events(TOOL, events)


def off():
    m.set_events(TOOL, 0)


def show(title, only=None):
    print('==', title)
    for entry in log:
        if entry[1] not in ('on', 'off', 'show') and (only is None or entry[1] in only):
            print('  ', *entry)
    del log[:]


m.use_tool_id(TOOL, 'test')
m.register_callback(TOOL, E.LINE, record_line)
for name in ('PY_START', 'PY_RETURN', 'PY_YIELD', 'PY_RESUME', 'PY_THROW', 'PY_UNWIND'):
    m.register_callback(TOOL, getattr(E, name), recorder(name))


# ---- Code that has run before, and code that has not ----

def old(a):
    b = a + 1
    return b


def new(a):
    b = a + 2
    return b


old(1)
on()
old(2)
new(2)
off()
show('called before, and never called')
old(3)
new(3)
show('off')
on()
old(4)
off()
on()
new(4)
off()
show('on again')


# ---- Calls in progress ----

def inner(switch):
    x = 1
    switch()
    y = 2
    return x + y


def middle(switch):
    a = inner(switch)
    b = a + 1
    return b


def outer(switch):
    r = middle(switch)
    for i in range(2):
        r += i
    return r


outer(on)
off()
show('switched on three calls deep')
on()
outer(off)
show('switched off three calls deep')


def loop(n):
    total = 0
    for i in range(n):
        if i == 2:
            on()
        elif i == 4:
            off()
        total += i
    return total


loop(6)
show('in a loop')


# ---- Suspended generators ----

def gen():
    x = yield 1
    y = yield x
    try:
        yield y
    finally:
        z = 3
    return z


g = gen()
next(g)
on()
g.send('a')
off()
show('a generator that was suspended: send')
on()
next(g)
off()
g.close()
show('next, and close while off')

g = gen()
next(g)
on()
for item in g:
    pass
off()
show('a generator that was suspended: for')

g = gen()
next(g)
on()
try:
    g.throw(ValueError)
except ValueError:
    pass
off()
show('a generator that was suspended: throw')


def delegating(g):
    r = yield from g
    return r


g = gen()
d = delegating(g)
next(d)
on()
d.send('b')
off()
d.close()
show('yield from, both suspended')

g = gen()
on()
list(g)
off()
show('a generator made while off, started while on')

on()
g = gen()
next(g)
off()
next(g)
on()
next(g)
off()
show('on, off, on between the steps of a generator')


async def coroutine(awaitable):
    a = await awaitable
    return a


class Awaitable:
    def __await__(self):
        v = yield 'waiting'
        return v


c = coroutine(Awaitable())
c.send(None)
on()
try:
    c.send('done')
except StopIteration as e:
    print('returned', e.value)
off()
show('a coroutine that was suspended')


async def agen():
    yield 1
    yield 2


def drive(awaitable):
    try:
        awaitable.send(None)
    except StopIteration as e:
        return e.value
    except StopAsyncIteration:
        return 'end'


a = agen()
drive(a.__anext__())
on()
drive(a.__anext__())
drive(a.__anext__())
off()
show('an async generator that was suspended')


# ---- Events of one code object ----

def local_target(n):
    s = 0
    for i in range(n):
        s += i
    return s


local_target(1)
m.set_local_events(TOOL, local_target.__code__, E.LINE)
local_target(1)
old(1)
m.set_local_events(TOOL, local_target.__code__, 0)
local_target(1)
show('local events')


def sets_its_own(n):
    a = 1
    m.set_local_events(TOOL, sets_its_own.__code__, E.LINE | E.PY_RETURN)
    b = 2
    if n:
        m.set_local_events(TOOL, sets_its_own.__code__, 0)
    c = 3
    return a + b + c


sets_its_own(0)
sets_its_own(1)
sets_its_own(1)
m.set_local_events(TOOL, sets_its_own.__code__, 0)
show('local events of the code that is running')

g = gen()
next(g)
m.set_local_events(TOOL, gen.__code__, E.LINE | E.PY_RESUME | E.PY_YIELD)
next(g)
m.set_local_events(TOOL, gen.__code__, 0)
next(g)
show('local events of a suspended generator')

m.set_local_events(TOOL, old.__code__, E.LINE)
on(E.PY_START)
old(1)
new(1)
off()
old(1)
new(1)
m.set_local_events(TOOL, old.__code__, 0)
show('local and global events')


# ---- What a tool calls is not told of, but the same function is when the program calls it ----

def helper(x):
    return x * 2


def calls_helper(code, line):
    if code.co_filename == __file__:
        log.append(('LINE', code.co_name, helper(line - code.co_firstlineno)))


m.register_callback(TOOL, E.LINE, calls_helper)
on()
old(1)
helper(1)
old(1)
off()
m.register_callback(TOOL, E.LINE, record_line)
show('a function that the tool calls too')


# ---- DISABLE, switching and restart_events() ----

def once(code, line):
    record_line(code, line)
    return m.DISABLE


m.register_callback(TOOL, E.LINE, once)
on(E.LINE)
old(1)
old(1)
show('disabled after the first time')
m.restart_events()
old(1)
off()
show('restarted')
m.register_callback(TOOL, E.LINE, record_line)


# ---- Code made while a tool is on ----

on()
exec(compile('p = 1\nq = 2\n', __file__, 'exec'))


class Made:
    attribute = 1

    def method(self):
        return [i for i in range(2)]


Made().method()
(lambda: 1)()
off()
show('code made while on')


# ---- Two tools ----

OTHER = 4
m.use_tool_id(OTHER, 'other')
m.register_callback(OTHER, E.PY_START, lambda code, offset: log.append(('other PY_START', code.co_name)) if code.co_filename == __file__ else None)
on(E.LINE)
m.set_events(OTHER, E.PY_START)
old(1)
off()
old(1)
m.set_events(OTHER, 0)
old(1)
m.free_tool_id(OTHER)
show('two tools')


# ---- Trace and profile functions ----

def tracer(frame, event, arg):
    if frame.f_code.co_filename == __file__:
        log.append((event, frame.f_code.co_name, frame.f_lineno - frame.f_code.co_firstlineno))
    return tracer


def profiler(frame, event, arg):
    if frame.f_code.co_filename == __file__ and not event.startswith('c_'):
        log.append((event, frame.f_code.co_name, frame.f_lineno - frame.f_code.co_firstlineno))


sys.settrace(tracer)
old(1)
sys.settrace(None)
old(1)
sys.settrace(tracer)
new(1)
sys.settrace(None)
show('settrace on, off, on')

g = gen()
next(g)
sys.settrace(tracer)
next(g)
sys.settrace(None)
next(g)
g.close()
show('settrace and a suspended generator')

sys.setprofile(profiler)
old(1)
sys.setprofile(None)
old(1)
show('setprofile')

g = gen()
next(g)
sys.setprofile(profiler)
next(g)
sys.setprofile(None)
g.close()
show('setprofile and a suspended generator')


def traces_itself():
    a = 1
    sys.settrace(tracer)
    sys._getframe().f_trace = tracer
    b = 2
    old(1)
    c = 3
    sys.settrace(None)
    d = 4
    return a + b + c + d


traces_itself()
show('a function that begins to trace itself')


# ---- Another thread ----

ready = threading.Event()
go = threading.Event()


def worker():
    a = 1
    ready.set()
    go.wait()
    b = 2
    return old(a + b)


t = threading.Thread(target=worker)
t.start()
ready.wait()
on()
off()
on(E.LINE | E.PY_START | E.PY_RETURN)
go.set()
t.join()
off()
show('switched on while another thread is in a call', only=('worker', 'old'))

m.free_tool_id(TOOL)
