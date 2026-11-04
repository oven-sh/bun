# A generator that is dropped before its end is closed, and whoever listens is told of the GeneratorExit that goes through it, handlers or no
# handlers in it; after it has been told that the built-in function which was given the generator has returned.
import sys
def f():
    for i in range(2):
        yield i
def f2():
    yield 1
    yield 2
def g():
    next(f())
def g2():
    next(f2())
def g3():
    for x in f():
        break
def g4():
    x = f()
    next(x)
    x.close()
def g5():
    try:
        sum(f3())
    except TypeError:
        pass
def f3():
    yield 1
    yield 'a'
    yield 2
def g6():
    return any(f2()), min(f(), default=3), next(f2(), None)
ev = []
def prof(frame, event, arg):
    ev.append((event, frame.f_code.co_name, frame.f_lineno - frame.f_code.co_firstlineno, getattr(arg, '__name__', arg)))
def tr(frame, event, arg):
    ev.append((event, frame.f_code.co_name, frame.f_lineno - frame.f_code.co_firstlineno, repr(arg)[:40]))
    return tr
for fn in (g, g2, g3, g4, g5, g6):
    sys.setprofile(prof); fn(); sys.setprofile(None)
    print(fn.__name__, 'profile', ev); del ev[:]
    sys.settrace(tr); fn(); sys.settrace(None)
    print(fn.__name__, 'trace', ev); del ev[:]
E = sys.monitoring.events
names = {getattr(E, n): n for n in dir(E) if not n.startswith('_')}
sys.monitoring.use_tool_id(2, 't')
for e in (E.PY_START, E.PY_RESUME, E.PY_RETURN, E.PY_YIELD, E.PY_THROW, E.PY_UNWIND, E.RAISE, E.RERAISE, E.EXCEPTION_HANDLED, E.STOP_ITERATION):
    sys.monitoring.register_callback(2, e, (lambda e: lambda code, *a: ev.append((names[e], code.co_name)))(e))
# (Whether CPython closes the generator before or after it tells of an exception that the function raises depends on how often the call has run.)
for fn in (g, g2, g3, g4, g6):
    sys.monitoring.set_events(2, E.PY_START| E.PY_RESUME| E.PY_RETURN| E.PY_YIELD| E.PY_THROW| E.PY_UNWIND| E.RAISE| E.RERAISE| E.EXCEPTION_HANDLED| E.STOP_ITERATION)
    fn()
    sys.monitoring.set_events(2, 0)
    print(fn.__name__, 'monitoring', ev); del ev[:]
