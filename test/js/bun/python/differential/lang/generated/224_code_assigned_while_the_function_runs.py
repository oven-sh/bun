# function.__code__ is set while the function runs: the call goes on in the code it began in, and all that is known about the call (its
# variables, its code object, its lines, what a tracer is told) is about that code.
try: import gc
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import gc')
try: import sys
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import sys')
try: import threading
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import threading')
try: import traceback
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import traceback')


try:
    def many(a, b=2, c=3, d=4, e=5, f=6, g=7, h=8, i=9, j=10):
        k = l = m = n = o = p = 'many'
        return a, b, c, d, e, f, g, h, i, j, k, l, m, n, o, p
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def many(a, b=2, c=3, d=4, e=5, f=6, g=7, h=8, i=9, j=10):')


try:
    def become(function, other):
        function.__code__ = other.__code__
        function.__defaults__ = other.__defaults__
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def become(function, other):')


try: print('--- it raises afterwards')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: '--- it raises afterwards'")


try:
    def swaps(*args, **kwargs):
        local = 'of swaps'
        become(swaps, many)
        raise ValueError(local)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def swaps(*args, **kwargs):')


try: original = swaps.__code__
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: original = swaps.__code__')
try:
    try:
        swaps(1)
    except ValueError as e:
        frame = e.__traceback__.tb_next.tb_frame
        print('frame.f_code is original =>', frame.f_code is original)
        print('frame.f_code.co_name =>', frame.f_code.co_name)
        print('swaps.__code__ is many.__code__ =>', swaps.__code__ is many.__code__)
        print(sorted(frame.f_locals.items()))
        print(traceback.format_exc().replace(__file__, 'FILE'))
        del frame
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try:')
try: print(swaps(1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: swaps(1)')

try: print('--- it calls itself, as what compiles a function when it is first called does')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: '--- it calls itself, as what compiles a function when it is first ca...")


try:
    def lazy(*args, **kwargs):
        become(lazy, many)
        return lazy(*args, **kwargs)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def lazy(*args, **kwargs):')


try: print(lazy(0, j=1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: lazy(0, j=1)')
try: print(lazy(0, j=2))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: lazy(0, j=2)')


try:
    def fails(a, b=2, c=3, d=4, e=5, f=6, g=7, h=8):
        import no_such_module_at_all
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def fails(a, b=2, c=3, d=4, e=5, f=6, g=7, h=8):')


try:
    def lazy(*args, **kwargs):
        become(lazy, fails)
        return lazy(*args, **kwargs)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def lazy(*args, **kwargs):')


try:
    def outer():
        return sum(lazy(1).values())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def outer():')


try:
    for attempt in range(3):
        try:
            outer()
        except ImportError as e:
            entries = traceback.extract_tb(e.__traceback__)
            print('[(entry.name, entry.line) for entry in entries] [' + 'attempt=' + (repr(attempt) if type(attempt) in (str, int, float, bytes, bool, type(None)) or (type(attempt) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in attempt)) else attempt.__name__ if type(attempt) is type else type(attempt).__name__) + '] =>', [(entry.name, entry.line) for entry in entries])
            frames = []
            tb = e.__traceback__
            while tb:
                frames.append(tb.tb_frame)
                tb = tb.tb_next
            print('[(frame.f_code.co_name, sorted(frame.f_locals)) for frame in frames[1:]] [' + 'attempt=' + (repr(attempt) if type(attempt) in (str, int, float, bytes, bool, type(None)) or (type(attempt) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in attempt)) else attempt.__name__ if type(attempt) is type else type(attempt).__name__) + '] =>', [(frame.f_code.co_name, sorted(frame.f_locals)) for frame in frames[1:]])
            del frames, tb
        try: gc.collect()
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: gc.collect()')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for attempt in range(3):')

try: print('--- the frame is looked at while it runs')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: '--- the frame is looked at while it runs'")


try:
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
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def looks(x, y=2):')


try: print(looks(1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: looks(1)')
try: print(looks(1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: looks(1)')

try: print('--- super() and a class cell')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: '--- super() and a class cell'")


try:
    class Base:
        def method(self):
            return 'base'
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Base:')


try:
    class Derived(Base):
        def method(self):
            become(Derived.method, Derived.other)
            return super().method()

        def other(self, a=1, b=2, c=3):
            return __class__.__name__
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Derived(Base):')


try: print('Derived().method() =>', Derived().method())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Derived().method()')
try: print('Derived().method() =>', Derived().method())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Derived().method()')

try: print('--- generators')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: '--- generators'")


try:
    def generates(n):
        first = 'first'
        yield first, n
        yield sorted(sys._getframe().f_locals)
        yield sys._getframe().f_code.co_name
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def generates(n):')


try:
    def generates_other(a, b=2, c=3, d=4, e=5):
        x = y = z = 'other'
        yield a, b, c, d, e, x, y, z
        yield sys._getframe().f_code.co_name
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def generates_other(a, b=2, c=3, d=4, e=5):')


try: old = generates(1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: old = generates(1)')
try: old_code = generates.__code__
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: old_code = generates.__code__')
try: unstarted = generates(2)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: unstarted = generates(2)')
try: print(next(old))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: next(old)')
try: become(generates, generates_other)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: become(generates, generates_other)')
try: new = generates(3)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: new = generates(3)')
try: print('next(old) =>', next(old))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: next(old)')
try: print('next(new) =>', next(new))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: next(new)')
try: print('next(unstarted) =>', next(unstarted))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: next(unstarted)')
try: print('old.gi_code is old_code =>', old.gi_code is old_code)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: old.gi_code is old_code')
try: print('old.gi_code.co_name =>', old.gi_code.co_name)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: old.gi_code.co_name')
try: print('new.gi_code.co_name =>', new.gi_code.co_name)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: new.gi_code.co_name')
try: print('unstarted.gi_code.co_name =>', unstarted.gi_code.co_name)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: unstarted.gi_code.co_name')
try: print('old.gi_frame.f_code.co_name =>', old.gi_frame.f_code.co_name)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: old.gi_frame.f_code.co_name')
try: print('new.gi_frame.f_code.co_name =>', new.gi_frame.f_code.co_name)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: new.gi_frame.f_code.co_name')
try: print('sorted(old.gi_frame.f_locals) =>', sorted(old.gi_frame.f_locals))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sorted(old.gi_frame.f_locals)')
try: print('sorted(new.gi_frame.f_locals) =>', sorted(new.gi_frame.f_locals))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sorted(new.gi_frame.f_locals)')
try: print('sorted(unstarted.gi_frame.f_locals) =>', sorted(unstarted.gi_frame.f_locals))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sorted(unstarted.gi_frame.f_locals)')
try: gc.collect()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: gc.collect()')
try: print('next(old) =>', next(old))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: next(old)')
try: print('next(new) =>', next(new))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: next(new)')
try: print('list(unstarted) =>', list(unstarted))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list(unstarted)')


try:
    def generates_and_swaps(n):
        become(generates_and_swaps, generates_other)
        local = n
        gc.collect()
        yield local
        yield sorted(sys._getframe().f_locals)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def generates_and_swaps(n):')


try: print('list(generates_and_swaps(1)) =>', list(generates_and_swaps(1)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list(generates_and_swaps(1))')
try: print('list(generates_and_swaps(1)) =>', list(generates_and_swaps(1)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list(generates_and_swaps(1))')

try: print('--- tracing')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: '--- tracing'")
try: events = []
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: events = []')


try:
    def tracer(frame, event, arg):
        if frame.f_code.co_filename == __file__:
            events.append((event, frame.f_code.co_name, frame.f_lineno - frame.f_code.co_firstlineno))
        return tracer
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def tracer(frame, event, arg):')


try:
    def traced(*args):
        become(traced, many)
        value = 1
        value += 1
        return value
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def traced(*args):')


try: sys.settrace(tracer)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sys.settrace(tracer)')
try: traced()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: traced()')
try: traced(1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: traced(1)')
try: sys.settrace(None)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sys.settrace(None)')
try: print(events)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: events')

try: events = []
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: events = []')
try: monitoring = sys.monitoring
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: monitoring = sys.monitoring')
try: monitoring.use_tool_id(1, 'test')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: monitoring.use_tool_id(1, 'test')")
try: monitoring.register_callback(1, monitoring.events.LINE, lambda code, line: events.append((code.co_name, line - code.co_firstlineno)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: monitoring.register_callback(1, monitoring.events.LINE, lambda code, ...')
try: monitoring.register_callback(1, monitoring.events.PY_RETURN, lambda code, offset, value: events.append((code.co_name, 'return')))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: monitoring.register_callback(1, monitoring.events.PY_RETURN, lambda c...')


try:
    def monitored(*args):
        become(monitored, many)
        value = 1
        return value
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def monitored(*args):')


try: monitoring.set_local_events(1, monitored.__code__, monitoring.events.LINE | monitoring.events.PY_RETURN)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: monitoring.set_local_events(1, monitored.__code__, monitoring.events....')
try: monitoring.set_local_events(1, many.__code__, monitoring.events.LINE | monitoring.events.PY_RETURN)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: monitoring.set_local_events(1, many.__code__, monitoring.events.LINE ...')
try: monitored()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: monitored()')
try: monitored(1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: monitored(1)')
try: monitoring.free_tool_id(1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: monitoring.free_tool_id(1)')
try: print(events)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: events')

try: print('--- while the arguments are bound')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: '--- while the arguments are bound'")


try:
    class Key(str):
        def __hash__(self):
            return str.__hash__(self)

        def __eq__(self, other):
            become(bound, many)
            return str.__eq__(self, other)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Key(str):')


try:
    def bound(first, *, second=None, **rest):
        return first, second, sorted(rest)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def bound(first, *, second=None, **rest):')


try: print(bound(1, **{Key('second'): 2, Key('third'): 3}))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: bound(1, **{Key('second'): 2, Key('third'): 3})")

try: print('--- from another thread')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: '--- from another thread'")
try: started = threading.Event()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: started = threading.Event()')
try: go = threading.Event()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: go = threading.Event()')
try: outcome = []
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: outcome = []')


try:
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
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def blocked(x):')


try: thread = threading.Thread(target=lambda: outcome.append(blocked(1)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: thread = threading.Thread(target=lambda: outcome.append(blocked(1)))')
try: thread.start()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: thread.start()')
try: started.wait()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: started.wait()')
try: become(blocked, many)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: become(blocked, many)')
try: frame = sys._current_frames()[thread.ident]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: frame = sys._current_frames()[thread.ident]')
try:
    while frame.f_code.co_name != 'blocked':
        try: frame = frame.f_back
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: frame = frame.f_back')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: while frame.f_code.co_name != 'blocked':")
try: print('frame.f_code.co_name =>', frame.f_code.co_name)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: frame.f_code.co_name')
try: print('sorted(frame.f_locals.items()) =>', sorted(frame.f_locals.items()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sorted(frame.f_locals.items())')
try: del frame
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del frame')
try: gc.collect()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: gc.collect()')
try: go.set()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: go.set()')
try: thread.join()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: thread.join()')
try: print('outcome =>', outcome)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: outcome')
try: print('blocked(1)[:2] =>', blocked(1)[:2])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: blocked(1)[:2]')
