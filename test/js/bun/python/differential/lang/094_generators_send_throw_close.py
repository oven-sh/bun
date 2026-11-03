def t(f):
    try:
        print(repr(f()))
    except BaseException as e:
        print(type(e).__name__ + ':', e)

def acc():
    total = 0
    while True:
        v = yield total
        if v is None: break
        total += v
    return total
a = acc(); print(next(a), a.send(1), a.send(2), a.send(10))
try: a.send(None)
except StopIteration as e: print("returned", e.value)
t(lambda: a.send(1)); t(lambda: next(a))
t(lambda: acc().send(1)); t(lambda: acc().send("x")); print(acc().send(None)); t(lambda: acc().send()); t(lambda: acc().send(1, 2))
# throw
def th():
    while True:
        try: v = yield "ready"
        except ValueError as e: print("caught", repr(e), end="; ")
        except KeyError as e:
            yield ("key", e.args)
        else: print("sent", v, end="; ")
g = th(); print(next(g), g.throw(ValueError("v")), g.throw(ValueError), g.throw(KeyError("k")), next(g), g.send(1))
t(lambda: g.throw(TypeError("escapes"))); t(lambda: next(g)); t(lambda: g.throw(ValueError("after the end"))); print(g.gi_frame)
g = th(); t(lambda: g.throw(ValueError("before start"))); t(lambda: next(g)); print(g.gi_frame)
g = th(); next(g)
t(lambda: g.throw()); t(lambda: g.throw(1)); t(lambda: g.throw("s")); t(lambda: g.throw(None)); t(lambda: g.throw(int)); t(lambda: g.throw(ValueError, "msg", 1)); t(lambda: g.throw(ValueError(), 1)); t(lambda: g.throw(ValueError("i"), None, 5)); t(lambda: g.throw(1, 2, 3, 4)); t(lambda: g.throw(object()))
print(next(g))
def show():
    try: yield
    except BaseException as e: yield (type(e).__name__, e.args, e.__traceback__ is not None)
import sys
def thr(*a):
    g = show(); next(g); return g.throw(*a)
print(thr(ValueError), thr(ValueError("a")), thr(ValueError("a", "b")), thr(KeyboardInterrupt), thr(SystemExit(3)), thr(StopIteration(1)), thr(GeneratorExit), thr(ExceptionGroup("g", [ValueError()]))[0])
def th_return():
    try: yield 1
    except ValueError: return "returned from handler"
g = th_return(); next(g)
try: g.throw(ValueError)
except StopIteration as e: print(e.value)
def th_convert():
    try: yield 1
    except ValueError as e: raise KeyError("converted") from e
g = th_convert(); next(g)
try: g.throw(ValueError("orig"))
except KeyError as e: print(repr(e), repr(e.__cause__))
def th_finally():
    try: yield 1
    finally: print("finally on throw", end="; ")
g = th_finally(); next(g); t(lambda: g.throw(ValueError("x")))
def th_same():
    try: yield
    except ValueError as e: raise
exc = ValueError("same object"); g = th_same(); next(g)
try: g.throw(exc)
except ValueError as e: print(e is exc)
# close
def cl():
    try:
        yield 1
        yield 2
    except GeneratorExit: print("GeneratorExit seen", end="; "); raise
    finally: print("finally on close", end="; ")
g = cl(); next(g); print(g.close(), g.gi_frame); t(lambda: next(g)); print(g.close(), g.close())
g = cl(); print(g.close(), "closing an unstarted generator runs nothing"); t(lambda: next(g))
g = cl(); list(g); print(g.close())
def cl_swallow():
    try: yield 1
    except GeneratorExit: pass
    print("continues after swallowing", end="; ")
g = cl_swallow(); next(g); print(g.close())
def cl_return():
    try: yield 1
    except GeneratorExit: return "close() returns this"
g = cl_return(); next(g); print(g.close(), g.close())
def cl_return_finally():
    try: yield 1
    finally: return "from finally"
g = cl_return_finally(); next(g); print(g.close())
def cl_yield():
    try: yield 1
    except GeneratorExit: yield "ignoring"
g = cl_yield(); next(g); t(g.close); print(g.gi_frame is None)
def cl_yield_finally():
    try: yield 1
    finally: yield "in finally"
g = cl_yield_finally(); next(g); t(g.close)
def cl_raise():
    try: yield 1
    except GeneratorExit: raise ValueError("raised during close")
g = cl_raise(); next(g); t(g.close)
def cl_raise_finally():
    try: yield 1
    finally: raise KeyError("finally raises")
g = cl_raise_finally(); next(g); t(g.close)
def cl_stop():
    try: yield 1
    except GeneratorExit: raise StopIteration("stop")
g = cl_stop(); next(g); t(g.close)
def cl_nested():
    try:
        try: yield 1
        finally: print("inner", end="; ")
    finally: print("outer", end="; ")
g = cl_nested(); next(g); print(g.close())
def cl_with():
    class CM:
        def __enter__(s): return s
        def __exit__(s, t, v, tb): print("__exit__", t.__name__, end="; ")
    with CM(): yield 1
g = cl_with(); next(g); print(g.close())
def cl_with_suppress():
    class CM:
        def __enter__(s): return s
        def __exit__(s, t, v, tb): return True
    with CM(): yield 1
    print("GeneratorExit suppressed by the with", end="; ")
    return "ret"
g = cl_with_suppress(); next(g); print(g.close())
t(lambda: g.close(1))
def cl_except_exception():
    try: yield 1
    except Exception: print("GeneratorExit is not an Exception")
g = cl_except_exception(); next(g); print(g.close())
def cl_bare():
    while True:
        try: yield 1
        except: pass
g = cl_bare(); next(g); t(g.close)
g = th(); next(g); t(lambda: g.throw(GeneratorExit)); t(lambda: next(g))
# StopIteration inside a generator becomes RuntimeError.
def si1():
    yield 1
    raise StopIteration("explicit")
def si2():
    yield 1
    next(iter([]))
def si3():
    yield next(iter([]))
def si4():
    try:
        yield 1
        raise StopIteration
    except StopIteration: yield "can be caught inside"
def si5():
    yield from (next(iter([])) for _ in range(1))
def si6():
    yield 1
    raise StopAsyncIteration("fine in a sync generator")
for f in (si1, si2, si3, si4, si5, si6):
    try: print(f.__name__, list(f()))
    except BaseException as e: print(f.__name__, type(e).__name__, e, "| cause:", repr(e.__cause__), "| ctx:", repr(e.__context__), e.__suppress_context__)
g = show(); next(g); print(g.throw(StopIteration("thrown in")))
def plain(): yield
g = plain(); next(g); t(lambda: g.throw(StopIteration("thrown, uncaught")))
# Re-entrancy.
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
self_ref = reenter(); print(list(self_ref))
# An exception ends the generator for good.
def boom():
    yield 1
    raise ValueError("boom")
    yield 2
g = boom(); print(next(g)); t(lambda: next(g)); t(lambda: next(g)); print(list(g), g.gi_frame)
def partial():
    for i in range(3):
        if i == 2: 1 / 0
        yield i
out = []
try:
    for v in partial(): out.append(v)
except ZeroDivisionError as e: print(out, e)
# Exception context inside generators.
def ctx():
    try: yield 1
    except ValueError:
        try: yield 2
        except KeyError as k: yield repr(k.__context__)
g = ctx(); next(g); g.throw(ValueError("v")); print(g.throw(KeyError("k")))
def ctx2():
    yield repr(sys.exception())
    try: raise KeyError("in")
    except KeyError: yield repr(sys.exception())
    yield repr(sys.exception())
g = ctx2()
try: raise ValueError("outer")
except ValueError: print(next(g), next(g))
print(next(g), sys.exception())
def ctx3():
    try: raise KeyError("gen")
    except KeyError:
        yield
        raise
g = ctx3(); next(g)
try:
    try: raise ValueError("caller")
    except ValueError: next(g)
except KeyError as e: print(repr(e), repr(e.__context__))
# send() values with for loops and comprehension-style pipelines.
def averager():
    n = s = 0; avg = None
    while True:
        v = yield avg
        n += 1; s += v; avg = s / n
av = averager(); next(av); print([av.send(v) for v in (10, 20, 30)])
def pipeline_sink(out):
    while True: out.append((yield))
def pipeline_filter(pred, target):
    while True:
        v = yield
        if pred(v): target.send(v)
res = []; sink = pipeline_sink(res); next(sink); flt = pipeline_filter(lambda v: v % 2, sink); next(flt)
for i in range(6): flt.send(i)
print(res); flt.close(); sink.close()
