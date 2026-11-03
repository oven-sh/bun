try:
    def t(f):
        try:
            print(repr(f()))
        except BaseException as e:
            print(type(e).__name__ + ':', e)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def t(f):')

try:
    def acc():
        total = 0
        while True:
            v = yield total
            if v is None: break
            total += v
        return total
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def acc():')
try: a = acc()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a = acc()')
try: print('next(a) =>', next(a))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: next(a)')
try: print('a.send(1) =>', a.send(1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a.send(1)')
try: print('a.send(2) =>', a.send(2))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a.send(2)')
try: print('a.send(10) =>', a.send(10))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a.send(10)')
try:
    try: a.send(None)
    except StopIteration as e: print("returned", e.value)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try: a.send(None)')
try: print('a.send(1) =>', end=" "); t(lambda: a.send(1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: a.send(1))')
try: print('next(a) =>', end=" "); t(lambda: next(a))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: next(a))')
try: print('acc().send(1) =>', end=" "); t(lambda: acc().send(1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: acc().send(1))')
try: print('acc().send("x") =>', end=" "); t(lambda: acc().send("x"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: acc().send("x"))')
try: print(acc().send(None))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: acc().send(None)')
try: print('acc().send() =>', end=" "); t(lambda: acc().send())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: acc().send())')
try: print('acc().send(1, 2) =>', end=" "); t(lambda: acc().send(1, 2))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: acc().send(1, 2))')
# throw
try:
    def th():
        while True:
            try: v = yield "ready"
            except ValueError as e: print("caught", repr(e), end="; ")
            except KeyError as e:
                yield ("key", e.args)
            else: print("sent", v, end="; ")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def th():')
try: g = th()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g = th()')
try: print('next(g) =>', next(g))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: next(g)')
try: print('g.throw(ValueError("v")) =>', g.throw(ValueError("v")))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g.throw(ValueError("v"))')
try: print('g.throw(ValueError) =>', g.throw(ValueError))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g.throw(ValueError)')
try: print('g.throw(KeyError("k")) =>', g.throw(KeyError("k")))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g.throw(KeyError("k"))')
try: print('next(g) =>', next(g))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: next(g)')
try: print('g.send(1) =>', g.send(1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g.send(1)')
try: print('g.throw(TypeError("escapes")) =>', end=" "); t(lambda: g.throw(TypeError("escapes")))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: g.throw(TypeError("escapes")))')
try: print('next(g) =>', end=" "); t(lambda: next(g))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: next(g))')
try: print('g.throw(ValueError("after the end")) =>', end=" "); t(lambda: g.throw(ValueError("after the end")))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: g.throw(ValueError("after the end")))')
try: print(g.gi_frame)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g.gi_frame')
try: g = th()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g = th()')
try: print('g.throw(ValueError("before start")) =>', end=" "); t(lambda: g.throw(ValueError("before start")))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: g.throw(ValueError("before start")))')
try: print('next(g) =>', end=" "); t(lambda: next(g))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: next(g))')
try: print(g.gi_frame)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g.gi_frame')
try: g = th()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g = th()')
try: next(g)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: next(g)')
try: print('g.throw() =>', end=" "); t(lambda: g.throw())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: g.throw())')
try: print('g.throw(1) =>', end=" "); t(lambda: g.throw(1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: g.throw(1))')
try: print('g.throw("s") =>', end=" "); t(lambda: g.throw("s"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: g.throw("s"))')
try: print('g.throw(None) =>', end=" "); t(lambda: g.throw(None))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: g.throw(None))')
try: print('g.throw(int) =>', end=" "); t(lambda: g.throw(int))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: g.throw(int))')
try: print('g.throw(ValueError, "msg", 1) =>', end=" "); t(lambda: g.throw(ValueError, "msg", 1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: g.throw(ValueError, "msg", 1))')
try: print('g.throw(ValueError(), 1) =>', end=" "); t(lambda: g.throw(ValueError(), 1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: g.throw(ValueError(), 1))')
try: print('g.throw(ValueError("i"), None, 5) =>', end=" "); t(lambda: g.throw(ValueError("i"), None, 5))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: g.throw(ValueError("i"), None, 5))')
try: print('g.throw(1, 2, 3, 4) =>', end=" "); t(lambda: g.throw(1, 2, 3, 4))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: g.throw(1, 2, 3, 4))')
try: print('g.throw(object()) =>', end=" "); t(lambda: g.throw(object()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: g.throw(object()))')
try: print(next(g))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: next(g)')
try:
    def show():
        try: yield
        except BaseException as e: yield (type(e).__name__, e.args, e.__traceback__ is not None)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def show():')
try: import sys
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import sys')
try:
    def thr(*a):
        g = show(); next(g); return g.throw(*a)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def thr(*a):')
try: print('thr(ValueError) =>', thr(ValueError))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: thr(ValueError)')
try: print('thr(ValueError("a")) =>', thr(ValueError("a")))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: thr(ValueError("a"))')
try: print('thr(ValueError("a", "b")) =>', thr(ValueError("a", "b")))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: thr(ValueError("a", "b"))')
try: print('thr(KeyboardInterrupt) =>', thr(KeyboardInterrupt))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: thr(KeyboardInterrupt)')
try: print('thr(SystemExit(3)) =>', thr(SystemExit(3)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: thr(SystemExit(3))')
try: print('thr(StopIteration(1)) =>', thr(StopIteration(1)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: thr(StopIteration(1))')
try: print('thr(GeneratorExit) =>', thr(GeneratorExit))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: thr(GeneratorExit)')
try: print('thr(ExceptionGroup("g", [ValueError()]))[0] =>', thr(ExceptionGroup("g", [ValueError()]))[0])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: thr(ExceptionGroup("g", [ValueError()]))[0]')
try:
    def th_return():
        try: yield 1
        except ValueError: return "returned from handler"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def th_return():')
try: g = th_return()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g = th_return()')
try: next(g)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: next(g)')
try:
    try: g.throw(ValueError)
    except StopIteration as e: print(e.value)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try: g.throw(ValueError)')
try:
    def th_convert():
        try: yield 1
        except ValueError as e: raise KeyError("converted") from e
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def th_convert():')
try: g = th_convert()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g = th_convert()')
try: next(g)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: next(g)')
try:
    try: g.throw(ValueError("orig"))
    except KeyError as e: print(repr(e), repr(e.__cause__))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try: g.throw(ValueError("orig"))')
try:
    def th_finally():
        try: yield 1
        finally: print("finally on throw", end="; ")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def th_finally():')
try: g = th_finally()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g = th_finally()')
try: next(g)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: next(g)')
try: print('g.throw(ValueError("x")) =>', end=" "); t(lambda: g.throw(ValueError("x")))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: g.throw(ValueError("x")))')
try:
    def th_same():
        try: yield
        except ValueError as e: raise
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def th_same():')
try: exc = ValueError("same object")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: exc = ValueError("same object")')
try: g = th_same()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g = th_same()')
try: next(g)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: next(g)')
try:
    try: g.throw(exc)
    except ValueError as e: print(e is exc)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try: g.throw(exc)')
# close
try:
    def cl():
        try:
            yield 1
            yield 2
        except GeneratorExit: print("GeneratorExit seen", end="; "); raise
        finally: print("finally on close", end="; ")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def cl():')
try: g = cl()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g = cl()')
try: next(g)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: next(g)')
try: print('g.close() =>', g.close())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g.close()')
try: print('g.gi_frame =>', g.gi_frame)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g.gi_frame')
try: print('next(g) =>', end=" "); t(lambda: next(g))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: next(g))')
try: print('g.close() =>', g.close())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g.close()')
try: print('g.close() =>', g.close())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g.close()')
try: g = cl()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g = cl()')
try: print('g.close() =>', g.close())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g.close()')
try: print("closing an unstarted generator runs nothing")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: "closing an unstarted generator runs nothing"')
try: print('next(g) =>', end=" "); t(lambda: next(g))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: next(g))')
try: g = cl()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g = cl()')
try: list(g)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list(g)')
try: print(g.close())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g.close()')
try:
    def cl_swallow():
        try: yield 1
        except GeneratorExit: pass
        print("continues after swallowing", end="; ")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def cl_swallow():')
try: g = cl_swallow()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g = cl_swallow()')
try: next(g)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: next(g)')
try: print(g.close())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g.close()')
try:
    def cl_return():
        try: yield 1
        except GeneratorExit: return "close() returns this"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def cl_return():')
try: g = cl_return()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g = cl_return()')
try: next(g)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: next(g)')
try: print('g.close() =>', g.close())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g.close()')
try: print('g.close() =>', g.close())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g.close()')
try:
    def cl_return_finally():
        try: yield 1
        finally: return "from finally"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def cl_return_finally():')
try: g = cl_return_finally()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g = cl_return_finally()')
try: next(g)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: next(g)')
try: print(g.close())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g.close()')
try:
    def cl_yield():
        try: yield 1
        except GeneratorExit: yield "ignoring"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def cl_yield():')
try: g = cl_yield()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g = cl_yield()')
try: next(g)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: next(g)')
try: print('g.close() =>', end=" "); t(g.close)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(g.close)')
try: print(g.gi_frame is None)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g.gi_frame is None')
try:
    def cl_yield_finally():
        try: yield 1
        finally: yield "in finally"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def cl_yield_finally():')
try: g = cl_yield_finally()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g = cl_yield_finally()')
try: next(g)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: next(g)')
try: print('g.close() =>', end=" "); t(g.close)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(g.close)')
try:
    def cl_raise():
        try: yield 1
        except GeneratorExit: raise ValueError("raised during close")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def cl_raise():')
try: g = cl_raise()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g = cl_raise()')
try: next(g)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: next(g)')
try: print('g.close() =>', end=" "); t(g.close)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(g.close)')
try:
    def cl_raise_finally():
        try: yield 1
        finally: raise KeyError("finally raises")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def cl_raise_finally():')
try: g = cl_raise_finally()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g = cl_raise_finally()')
try: next(g)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: next(g)')
try: print('g.close() =>', end=" "); t(g.close)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(g.close)')
try:
    def cl_stop():
        try: yield 1
        except GeneratorExit: raise StopIteration("stop")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def cl_stop():')
try: g = cl_stop()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g = cl_stop()')
try: next(g)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: next(g)')
try: print('g.close() =>', end=" "); t(g.close)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(g.close)')
try:
    def cl_nested():
        try:
            try: yield 1
            finally: print("inner", end="; ")
        finally: print("outer", end="; ")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def cl_nested():')
try: g = cl_nested()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g = cl_nested()')
try: next(g)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: next(g)')
try: print(g.close())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g.close()')
try:
    def cl_with():
        class CM:
            def __enter__(s): return s
            def __exit__(s, t, v, tb): print("__exit__", t.__name__, end="; ")
        with CM(): yield 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def cl_with():')
try: g = cl_with()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g = cl_with()')
try: next(g)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: next(g)')
try: print(g.close())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g.close()')
try:
    def cl_with_suppress():
        class CM:
            def __enter__(s): return s
            def __exit__(s, t, v, tb): return True
        with CM(): yield 1
        print("GeneratorExit suppressed by the with", end="; ")
        return "ret"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def cl_with_suppress():')
try: g = cl_with_suppress()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g = cl_with_suppress()')
try: next(g)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: next(g)')
try: print(g.close())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g.close()')
try: print('g.close(1) =>', end=" "); t(lambda: g.close(1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: g.close(1))')
try:
    def cl_except_exception():
        try: yield 1
        except Exception: print("GeneratorExit is not an Exception")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def cl_except_exception():')
try: g = cl_except_exception()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g = cl_except_exception()')
try: next(g)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: next(g)')
try: print(g.close())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g.close()')
try:
    def cl_bare():
        while True:
            try: yield 1
            except: pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def cl_bare():')
try: g = cl_bare()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g = cl_bare()')
try: next(g)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: next(g)')
try: print('g.close() =>', end=" "); t(g.close)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(g.close)')
try: g = th()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g = th()')
try: next(g)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: next(g)')
try: print('g.throw(GeneratorExit) =>', end=" "); t(lambda: g.throw(GeneratorExit))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: g.throw(GeneratorExit))')
try: print('next(g) =>', end=" "); t(lambda: next(g))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: next(g))')
# StopIteration inside a generator becomes RuntimeError.
try:
    def si1():
        yield 1
        raise StopIteration("explicit")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def si1():')
try:
    def si2():
        yield 1
        next(iter([]))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def si2():')
try:
    def si3():
        yield next(iter([]))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def si3():')
try:
    def si4():
        try:
            yield 1
            raise StopIteration
        except StopIteration: yield "can be caught inside"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def si4():')
try:
    def si5():
        yield from (next(iter([])) for _ in range(1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def si5():')
try:
    def si6():
        yield 1
        raise StopAsyncIteration("fine in a sync generator")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def si6():')
try:
    for f in (si1, si2, si3, si4, si5, si6):
        try: print(f.__name__, list(f()))
        except BaseException as e: print(f.__name__, type(e).__name__, e, "| cause:", repr(e.__cause__), "| ctx:", repr(e.__context__), e.__suppress_context__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for f in (si1, si2, si3, si4, si5, si6):')
try: g = show()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g = show()')
try: next(g)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: next(g)')
try: print(g.throw(StopIteration("thrown in")))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g.throw(StopIteration("thrown in"))')
try:
    def plain(): yield
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def plain(): yield')
try: g = plain()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g = plain()')
try: next(g)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: next(g)')
try: print('g.throw(StopIteration("thrown, uncaught")) =>', end=" "); t(lambda: g.throw(StopIteration("thrown, uncaught")))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: g.throw(StopIteration("thrown, uncaught")))')
# Re-entrancy.
try:
    def reenter():
        yield 1
        try: next(self_ref)
        except ValueError as e: yield "ValueError: " + str(e)
        try: self_ref.send(1)
        except ValueError as e: yield "ValueError: " + str(e)
        try: self_ref.throw(KeyError)
        except ValueError as e: yield "ValueError: " + str(e)
        try: self_ref.close()
        except ValueError as e: yield "ValueError: " + str(e)
        try: list(self_ref)
        except ValueError as e: yield "ValueError: " + str(e)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def reenter():')
try: self_ref = reenter()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: self_ref = reenter()')
try: print(list(self_ref))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list(self_ref)')
# An exception ends the generator for good.
try:
    def boom():
        yield 1
        raise ValueError("boom")
        yield 2
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def boom():')
try: g = boom()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g = boom()')
try: print(next(g))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: next(g)')
try: print('next(g) =>', end=" "); t(lambda: next(g))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: next(g))')
try: print('next(g) =>', end=" "); t(lambda: next(g))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: next(g))')
try: print('list(g) =>', list(g))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list(g)')
try: print('g.gi_frame =>', g.gi_frame)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g.gi_frame')
try:
    def partial():
        for i in range(3):
            if i == 2: 1 / 0
            yield i
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def partial():')
try: out = []
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: out = []')
try:
    try:
        for v in partial(): out.append(v)
    except ZeroDivisionError as e: print(out, e)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try:')
# Exception context inside generators.
try:
    def ctx():
        try: yield 1
        except ValueError:
            try: yield 2
            except KeyError as k: yield repr(k.__context__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def ctx():')
try: g = ctx()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g = ctx()')
try: next(g)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: next(g)')
try: g.throw(ValueError("v"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g.throw(ValueError("v"))')
try: print(g.throw(KeyError("k")))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g.throw(KeyError("k"))')
try:
    def ctx2():
        yield repr(sys.exception())
        try: raise KeyError("in")
        except KeyError: yield repr(sys.exception())
        yield repr(sys.exception())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def ctx2():')
try: g = ctx2()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g = ctx2()')
try:
    try: raise ValueError("outer")
    except ValueError: print(next(g), next(g))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try: raise ValueError("outer")')
try: print('next(g) =>', next(g))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: next(g)')
try: print('sys.exception() =>', sys.exception())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sys.exception()')
try:
    def ctx3():
        try: raise KeyError("gen")
        except KeyError:
            yield
            raise
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def ctx3():')
try: g = ctx3()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g = ctx3()')
try: next(g)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: next(g)')
try:
    try:
        try: raise ValueError("caller")
        except ValueError: next(g)
    except KeyError as e: print(repr(e), repr(e.__context__))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try:')
# send() values with for loops and comprehension-style pipelines.
try:
    def averager():
        n = s = 0; avg = None
        while True:
            v = yield avg
            n += 1; s += v; avg = s / n
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def averager():')
try: av = averager()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: av = averager()')
try: next(av)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: next(av)')
try: print([av.send(v) for v in (10, 20, 30)])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [av.send(v) for v in (10, 20, 30)]')
try:
    def pipeline_sink(out):
        while True: out.append((yield))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def pipeline_sink(out):')
try:
    def pipeline_filter(pred, target):
        while True:
            v = yield
            if pred(v): target.send(v)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def pipeline_filter(pred, target):')
try: res = []
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: res = []')
try: sink = pipeline_sink(res)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sink = pipeline_sink(res)')
try: next(sink)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: next(sink)')
try: flt = pipeline_filter(lambda v: v % 2, sink)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: flt = pipeline_filter(lambda v: v % 2, sink)')
try: next(flt)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: next(flt)')
try:
    for i in range(6): flt.send(i)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for i in range(6): flt.send(i)')
try: print(res)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: res')
try: flt.close()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: flt.close()')
try: sink.close()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sink.close()')
