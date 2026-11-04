# Code written on the line of its `def`, `lambda` or `class`. A trace function is told of the line. A tool is if the start of the code is told
# of too, as it is in CPython.
import sys

m = sys.monitoring
E = m.events
ev = []
m.use_tool_id(1, 'test')


def line(code, number):
    if code.co_filename in (__file__, 'x'):
        ev.append((code.co_name, number))


m.register_callback(1, E.LINE, line)
f = lambda: []
def g(): return 1
def h():
    return 1
d = {
    1: lambda: [],
    2: lambda: [
       ],
}
gen = lambda: (yield)


def run():
    f()
    g()
    h()
    d[1]()
    d[2]()
    class D: y = 1
    list(gen())
    [i for i in (1,)]
    list(i for i in (1,))
    exec(compile('', 'x', 'exec'))
    exec(compile('# c\n\n"""doc"""\n', 'x', 'exec'))
    exec(compile('\n\nx = 1\n', 'x', 'exec'))


def show(title):
    print(title, [e for e in ev if e[0] != 'run'])
    del ev[:]


m.set_events(1, E.LINE)
run()
m.set_events(1, 0)
show('LINE')

m.register_callback(1, E.PY_START, lambda code, offset: None)
m.set_events(1, E.LINE | E.PY_START)
run()
m.set_events(1, 0)
show('LINE and PY_START')


def start(code, offset):
    if code.co_filename in (__file__, 'x'):
        m.set_local_events(1, code, E.LINE)
    return m.DISABLE


m.register_callback(1, E.PY_START, start)
m.set_events(1, E.PY_START)
m.restart_events()
run()
show('LINE of the code, from PY_START')
run()
show('again')
m.set_events(1, 0)
for code in (f.__code__, g.__code__, h.__code__, d[1].__code__, d[2].__code__, gen.__code__, run.__code__):
    m.set_local_events(1, code, 0)

m.use_tool_id(2, 'other')
m.register_callback(2, E.PY_START, lambda code, offset: None)
m.set_events(2, E.PY_START)
m.set_events(1, E.LINE)
run()
m.set_events(1, 0)
m.set_events(2, 0)
show('PY_START for another tool')
m.free_tool_id(2)
m.free_tool_id(1)


def tracer(frame, event, arg):
    if frame.f_code.co_filename in (__file__, 'x') and frame.f_code.co_name != 'run':
        ev.append((frame.f_code.co_name, event, frame.f_lineno))
    return tracer


sys.settrace(tracer)
run()
sys.settrace(None)
show('settrace')
