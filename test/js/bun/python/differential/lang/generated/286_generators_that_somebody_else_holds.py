# A loop, or a built-in function, that goes through a generator made for it closes it when it is done, as the generator would be
# with reference counts. Not if somebody else has got hold of it meanwhile: it must not be closed in their hands.
try: import sys, gc, inspect, itertools, weakref, threading, functools
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import sys, gc, inspect, itertools, weakref, threading, functools')
try: LOG = []
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: LOG = []')
try:
    def g(name='g'):
        try:
            yield 1
            yield 2
            yield 3
        finally:
            LOG.append('finally of ' + name)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: def g(name='g'):")
try: KEEP = []
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: KEEP = []')
try:
    def state():
        r = [inspect.getgeneratorstate(k) if inspect.isgenerator(k) else type(k).__name__ for k in KEEP]
        out = '%s %s' % (r, LOG)
        nxt = []
        for k in KEEP:
            try: nxt.append(next(k))
            except BaseException as e: nxt.append(type(e).__name__)
        del KEEP[:]; del LOG[:]
        return out + ' next: %s' % nxt
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def state():')
try:
    def case(f):
        try: f()
        except BaseException as e: LOG.append('raised ' + type(e).__name__)
        print(f.__name__, '|', state())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def case(f):')

# --- subclasses of built-in types whose code sees the argument
try:
    class L(list):
        def __init__(self, it): KEEP.append(it); super().__init__([next(it)])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class L(list):')
try:
    class T(tuple):
        def __new__(cls, it): KEEP.append(it); return super().__new__(cls, [next(it)])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class T(tuple):')
try:
    class S(set):
        def __init__(self, it): KEEP.append(it)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class S(set):')
try:
    class D(dict):
        def __init__(self, it): KEEP.append(it)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class D(dict):')
try:
    class Z(zip):
        def __new__(cls, *its): KEEP.extend(its); return super().__new__(cls, *its)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Z(zip):')
try:
    class En(enumerate):
        def __new__(cls, it): KEEP.append(it); return super().__new__(cls, it)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class En(enumerate):')
try:
    class Mp(map):
        def __new__(cls, f, it): KEEP.append(it); return super().__new__(cls, f, it)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Mp(map):')
try:
    class Fl(filter):
        def __new__(cls, f, it): KEEP.append(it); return super().__new__(cls, f, it)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Fl(filter):')
try:
    class Ch(itertools.chain):
        def __new__(cls, *its): KEEP.extend(its); return super().__new__(cls, *its)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Ch(itertools.chain):')
try:
    class Isl(itertools.islice):
        def __new__(cls, it, n): KEEP.append(it); return super().__new__(cls, it, n)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Isl(itertools.islice):')
try:
    class Rv(reversed): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Rv(reversed): pass')
try:
    def sub_list(): L(g())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def sub_list(): L(g())')
try:
    def sub_tuple(): T(g())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def sub_tuple(): T(g())')
try:
    def sub_set(): S(g())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def sub_set(): S(g())')
try:
    def sub_dict(): D(g())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def sub_dict(): D(g())')
try:
    def sub_zip():
        for x in Z(g('a'), g('b')): break
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def sub_zip():')
try:
    def sub_enumerate():
        for x in En(g()): break
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def sub_enumerate():')
try:
    def sub_map():
        for x in Mp(str, g()): break
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def sub_map():')
try:
    def sub_filter():
        for x in Fl(None, g()): break
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def sub_filter():')
try:
    def sub_chain():
        for x in Ch(g('a'), g('b')): break
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def sub_chain():')
try:
    def sub_islice():
        for x in Isl(g(), 2): break
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def sub_islice():')
try:
    def sub_zip_next(): next(Z(g('a'), g('b')))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: def sub_zip_next(): next(Z(g('a'), g('b')))")
try:
    def sub_enumerate_list_raises():
        class Bad(enumerate):
            def __new__(cls, it): KEEP.append(it); raise KeyError
        for x in Bad(g()): break
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def sub_enumerate_list_raises():')

# --- the frame of a generator expression shows what it goes through
try:
    def probe(depth=1):
        KEEP.append(sys._getframe(depth).f_locals['.0']); return True
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def probe(depth=1):')
try:
    def genexpr_locals_break():
        for v in (x for x in g() if probe()): break
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def genexpr_locals_break():')
try:
    def genexpr_locals_next(): next(x for x in g() if probe())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def genexpr_locals_next(): next(x for x in g() if probe())')
try:
    def genexpr_locals_any(): any(x for x in g() if probe())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def genexpr_locals_any(): any(x for x in g() if probe())')
try:
    def genexpr_locals_in(): 1 in (x for x in g() if probe())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def genexpr_locals_in(): 1 in (x for x in g() if probe())')
try:
    def genexpr_locals_unpack():
        a, b = (x for x in g() if probe())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def genexpr_locals_unpack():')
try:
    def genexpr_locals_enumerate():
        for v in (x for x in enumerate(g()) if probe()): break
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def genexpr_locals_enumerate():')
try:
    def genexpr_frame_kept():
        frames = []
        def keep(): frames.append(sys._getframe(1)); return True
        for v in (x for x in g() if keep()): break
        KEEP.append(frames[0].f_locals.get('.0'))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def genexpr_frame_kept():')
try:
    def genexpr_gi_frame():
        def keep(): KEEP.append(sys._getframe(1).f_generator.gi_frame.f_locals['.0']); return True
        for v in (x for x in g() if keep()): break
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def genexpr_gi_frame():')
try:
    def listcomp_locals():
        [x for x in g() if probe() and 1 / (2 - x)]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def listcomp_locals():')
try:
    def traced_genexpr():
        def trace(frame, event, arg):
            if frame.f_code.co_name == '<genexpr>' and not KEEP: KEEP.append(frame.f_locals['.0'])
            return trace
        sys.settrace(trace)
        try:
            for v in (x for x in g()): break
        finally: sys.settrace(None)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def traced_genexpr():')
try:
    def profiled_genexpr():
        def prof(frame, event, arg):
            if frame.f_code.co_name == '<genexpr>' and not KEEP: KEEP.append(frame.f_locals['.0'])
        sys.setprofile(prof)
        try:
            for v in (x for x in g()): break
        finally: sys.setprofile(None)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def profiled_genexpr():')
try:
    def monitored_genexpr():
        M = sys.monitoring
        M.use_tool_id(2, 'h')
        def start(code, offset):
            if code.co_name == '<genexpr>' and not KEEP: KEEP.append(sys._getframe(1).f_locals['.0'])
        M.register_callback(2, M.events.PY_START, start)
        M.set_events(2, M.events.PY_START)
        try:
            for v in (x for x in g()): break
        finally:
            M.set_events(2, 0); M.free_tool_id(2)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def monitored_genexpr():')

# --- the generator's own frame
try:
    def self_by_frame():
        def h():
            try:
                KEEP.append(sys._getframe().f_generator); yield 1; yield 2
            finally: LOG.append('finally of h')
        for x in h(): break
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def self_by_frame():')
try:
    def self_by_callee():
        def grab(): KEEP.append(sys._getframe(1).f_generator)
        def h():
            try:
                grab(); yield 1; yield 2
            finally: LOG.append('finally of h')
        for x in h(): break
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def self_by_callee():')
try:
    def self_by_traceback():
        def h():
            try:
                try: 1 / 0
                except ZeroDivisionError as e: KEEP.append(e.__traceback__.tb_frame.f_generator)
                yield 1; yield 2
            finally: LOG.append('finally of h')
        for x in h(): break
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def self_by_traceback():')
try:
    def self_by_weakref():
        refs = []
        def h():
            try:
                refs.append(weakref.ref(sys._getframe().f_generator)); yield 1; yield 2
            finally: LOG.append('finally of h')
        for x in h():
            KEEP.append(refs[0]())
            break
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def self_by_weakref():')
try:
    def self_by_gc_objects():
        for x in g():
            KEEP.extend(o for o in gc.get_objects() if inspect.isgenerator(o) and o.gi_code is g.__code__)
            break
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def self_by_gc_objects():')
try:
    def self_by_gc_referrers():
        def h():
            try:
                KEEP.extend(o for o in gc.get_referrers(sys._getframe()) if inspect.isgenerator(o)); yield 1; yield 2
            finally: LOG.append('finally of h')
        for x in h(): break
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def self_by_gc_referrers():')
try:
    def self_by_current_frames():
        def h():
            try:
                KEEP.append(sys._current_frames()[threading.get_ident()].f_generator); yield 1; yield 2
            finally: LOG.append('finally of h')
        for x in h(): break
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def self_by_current_frames():')
try:
    def self_by_trace():
        def trace(frame, event, arg):
            if frame.f_code is g.__code__ and not KEEP: KEEP.append(frame.f_generator)
            return trace
        sys.settrace(trace)
        try:
            for x in g(): break
        finally: sys.settrace(None)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def self_by_trace():')
try:
    def self_by_frame_kept_then_asked():
        frames = []
        def h():
            try:
                frames.append(sys._getframe()); yield 1; yield 2
            finally: LOG.append('finally of h')
        for x in h():
            KEEP.append(frames[0].f_generator)
            break
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def self_by_frame_kept_then_asked():')
try:
    def self_by_frame_asked_after():
        frames = []
        def h():
            try:
                frames.append(sys._getframe()); yield 1; yield 2
            finally: LOG.append('finally of h')
        for x in h(): break
        KEEP.append(frames[0].f_generator)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def self_by_frame_asked_after():')

# --- what iterators give away
try:
    def iterator_reduce():
        for i, x in (e := enumerate(g())):
            KEEP.append(e.__reduce__()[1][0]); break
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def iterator_reduce():')
try:
    def key_function_frame():
        def key(v): KEEP.append(sys._getframe(1)); return v
        sorted(g(), key=key)
        del KEEP[:]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def key_function_frame():')
try:
    def map_function_raises():
        def f(v): raise KeyError
        for x in map(f, g()): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def map_function_raises():')
try:
    def star_arguments():
        def f(*a): pass
        f(*g())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def star_arguments():')
try:
    def tee():
        a, b = itertools.tee(g())
        next(a); KEEP.append(b)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def tee():')
try:
    def groupby():
        for k, grp in itertools.groupby(g()):
            KEEP.append(grp); break
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def groupby():')
try:
    def zip_longest_fill():
        for x in itertools.zip_longest(g('a'), g('b')): break
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def zip_longest_fill():')
try:
    def accumulate_func():
        def f(a, b): KEEP.append(sys._getframe(1)); return a + b
        for x in itertools.accumulate(g(), f): pass
        del KEEP[:]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def accumulate_func():')
try:
    def iter_of():
        for x in iter(g()): break
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def iter_of():')
try:
    def next_default(): KEEP.append(next(iter(()), g()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def next_default(): KEEP.append(next(iter(()), g()))')
try:
    def contains_eq():
        class E:
            def __eq__(self, other): KEEP.append(sys._getframe(1)); return True
        E() in g()
        del KEEP[:]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def contains_eq():')
try:
    def call_event_argument():
        M = sys.monitoring
        M.use_tool_id(2, 'h')
        M.register_callback(2, M.events.CALL, lambda code, off, f, a0: KEEP.append(a0) if inspect.isgenerator(a0) and not KEEP else None)
        M.set_events(2, M.events.CALL)
        try:
            next(g())
        finally:
            M.set_events(2, 0); M.free_tool_id(2)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def call_event_argument():')
try:
    def call_event_argument_loop():
        M = sys.monitoring
        M.use_tool_id(2, 'h')
        M.register_callback(2, M.events.CALL, lambda code, off, f, a0: KEEP.append(a0) if inspect.isgenerator(a0) and not KEEP else None)
        M.set_events(2, M.events.CALL)
        try:
            for x in enumerate(g()): break
        finally:
            M.set_events(2, 0); M.free_tool_id(2)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def call_event_argument_loop():')

# --- locals() in a generator expression, and its frame in a traceback
try:
    def genexpr_locals_builtin():
        for d in (locals() for x in g()):
            KEEP.append(d['.0']); break
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def genexpr_locals_builtin():')
try:
    def genexpr_vars_builtin():
        for d in (vars() for x in g()):
            KEEP.append(d['.0']); break
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def genexpr_vars_builtin():')
try:
    def genexpr_eval_locals():
        for d in (eval('locals()') for x in g()):
            KEEP.append(d['.0']); break
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def genexpr_eval_locals():')
try:
    def genexpr_traceback():
        try:
            for v in (1 / 0 for x in g()): pass
        except ZeroDivisionError as e:
            KEEP.append(e.__traceback__.tb_next.tb_frame.f_locals['.0'])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def genexpr_traceback():')

# --- asynchronous generators: the hook that is told of the first iteration is handed the generator
try:
    def drive(coroutine):
        try:
            while True: coroutine.send(None)
        except StopIteration as e: return e.value
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def drive(coroutine):')
try:
    async def ag():
        try:
            yield 1
            yield 2
        finally:
            LOG.append('finally of ag')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def ag():')
try:
    def settle():
        LOG.extend('closed' if k.ag_frame is None else 'alive' for k in KEEP)
        for k in KEEP: drive(k.aclose())
        del KEEP[:]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def settle():')
try:
    def hooked(function, hook=KEEP.append):
        sys.set_asyncgen_hooks(firstiter=hook)
        try: drive(function())
        finally: sys.set_asyncgen_hooks(None, None)
        settle()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def hooked(function, hook=KEEP.append):')
try:
    def hook_break():
        async def f():
            async for x in ag(): break
        hooked(f)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def hook_break():')
try:
    def hook_return():
        async def f():
            async for x in ag(): return 5
        hooked(f)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def hook_return():')
try:
    def hook_exception():
        async def f():
            try:
                async for x in ag(): raise KeyError(1)
            except KeyError: pass
        hooked(f)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def hook_exception():')
try:
    def hook_aiter():
        async def f():
            async for x in aiter(ag()): break
        hooked(f)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def hook_aiter():')
try:
    def hook_comprehension():
        async def f():
            try: [1 / (2 - x) async for x in ag()]
            except ZeroDivisionError: pass
        hooked(f)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def hook_comprehension():')
try:
    def hook_generator_expression():
        async def f():
            async for x in (y async for y in ag()): break
        hooked(f)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def hook_generator_expression():')
try:
    def hook_weak_set():
        weak = weakref.WeakSet()
        async def f():
            async for x in ag():
                KEEP.append(list(weak)[-1]); break
        hooked(f, weak.add)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def hook_weak_set():')
try:
    def hook_weak_reference():
        weak = []
        async def f():
            async for x in ag():
                KEEP.append(weak[0]()); break
        hooked(f, lambda a: weak.append(weakref.ref(a)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def hook_weak_reference():')
try:
    def async_self_by_frame():
        async def h():
            try:
                KEEP.append(sys._getframe().f_generator); yield 1; yield 2
            finally: LOG.append('finally of h')
        async def f():
            async for x in h(): break
        drive(f())
        settle()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def async_self_by_frame():')

try:
    for name, f in list(globals().items()):
        if inspect.isfunction(f) and f.__module__ == __name__ and name not in ('g', 'state', 'case', 'probe', 'drive', 'ag', 'hooked', 'settle'):
            try: case(f)
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: case(f)')
            try: gc.collect()
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: gc.collect()')
            try: del LOG[:]
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del LOG[:]')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for name, f in list(globals().items()):')
