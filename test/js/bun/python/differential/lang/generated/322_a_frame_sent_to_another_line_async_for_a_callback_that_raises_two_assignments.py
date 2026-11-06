# frame.f_lineno = n: from the line of an `async for` that the jump back tells of; from a `return` on one line that is told of twice; by a callback that goes on to raise; twice by the same callback.
try: import sys, warnings
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import sys, warnings')
try: warnings.simplefilter('ignore')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: warnings.simplefilter('ignore')")
try: MON = sys.monitoring
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: MON = sys.monitoring')
try: EV = MON.events
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: EV = MON.events')
try:
    class X(Exception): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class X(Exception): pass')
try:
    class AIT:
        def __init__(s, n): s.n = n
        def __aiter__(s): return s
        async def __anext__(s):
            if not s.n: raise StopAsyncIteration
            s.n -= 1; return s.n
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class AIT:')
try:
    def c(v): return v
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def c(v): return v')
try:
    def drive(co):
        try:
            while True: co.send(None)
        except StopIteration as e: return e.value
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def drive(co):')
try: LOG = []
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: LOG = []')
try:
    async def a():
        x = 0
        async for i in AIT(2):     # + 2
            x += 1
            y = 2
        return x
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def a():')
try:
    async def a2():
        x = 0
        async for i in AIT(3):     # + 2
            x += 1
            if i == 1:
                continue
            y = 2
        else:
            x += 10
        return x
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def a2():')
try:
    def r(p, q, s):
        try:
            return (p or q) if c(s) else c(4)      # + 2
        finally:
            y = 2
            z = 3
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def r(p, q, s):')
try:
    def two_loops():
        LOG.append('begin')
        try:
            for i in iter([1, 2]):
                LOG.append(('first', i))           # + 4
        except X:
            LOG.append('caught')
        t = (c(5), c(6), c(7))
        LOG.append('between')
        for j in iter([3]):
            LOG.append(('second', j))              # + 10
        return 'end'
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def two_loops():')
try:
    def handlers():
        LOG.append('begin')                        # + 1
        try:
            raise KeyError(1)
        except KeyError:
            LOG.append(repr(sys.exception()))      # + 5
        return 'end'
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def handlers():')
try:
    def under_trace(make, code, act):
        ev = []
        def tr(fr, e, arg):
            if fr.f_code is not code: return None
            if e == 'line':
                ev.append(fr.f_lineno - code.co_firstlineno)
                if len(ev) > 60: raise KeyError
                act(fr, ev)
            return tr
        del LOG[:]
        sys.settrace(tr)
        try: result = make()
        except BaseException as x: result = type(x).__name__
        finally: sys.settrace(None)
        return ev, result, LOG[:]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def under_trace(make, code, act):')
try:
    def under_tool(make, code, act):
        ev = []
        def line(co, n):
            ev.append(n - code.co_firstlineno)
            if len(ev) > 60: raise KeyError
            act(sys._getframe(1), ev)
        del LOG[:]
        MON.use_tool_id(3, 't'); MON.register_callback(3, EV.LINE, line); MON.set_local_events(3, code, EV.LINE)
        try: result = make()
        except BaseException as x: result = type(x).__name__
        finally: MON.set_local_events(3, code, 0); MON.register_callback(3, EV.LINE, None); MON.free_tool_id(3)
        return ev, result, LOG[:]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def under_tool(make, code, act):')
try:
    def sends(source, nth, *targets, then=None):
        done = []
        def act(fr, ev):
            if ev[-1] == source and ev.count(source) == nth and not done:
                done.append(1)
                for t in targets:
                    try: fr.f_lineno = fr.f_code.co_firstlineno + t
                    except ValueError as x: ev.append(str(x))
                    else: ev.append('>%d' % t)
                if then: raise then
        return act
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def sends(source, nth, *targets, then=None):')
try:
    for under in (under_trace, under_tool):
        for f, last in ((a, 5), (a2, 9)):
            for nth in (1, 2, 3):
                for t in range(1, last + 1): print(under.__name__, f.__name__, nth, t, under(lambda: drive(f()), f.__code__, sends(2, nth, t)))
        for nth in (1, 2):
            for t in range(1, 6): print(under.__name__, 'r', nth, t, under(lambda: r(0, 5, 1), r.__code__, sends(2, nth, t)))
        for t in range(1, 12): print(under.__name__, 'assigns and raises', t, under(two_loops, two_loops.__code__, sends(4, 1, t, then=X)))
        for first in (0, 1, 2, 5, 6):
            for second in range(0, 7): print(under.__name__, 'assigns twice', first, second, under(handlers, handlers.__code__, sends(5, 1, first, second)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for under in (under_trace, under_tool):')
