# Generators and coroutines resumed by for, by yield from and await, and from outside, and all the ways they can stop.
try: import sys, traceback, gc, types, inspect
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import sys, traceback, gc, types, inspect')

try:
    def try_(f, *a):
        try:
            return f(*a)
        except BaseException as e:
            return type(e).__name__ + ": " + str(e)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def try_(f, *a):')

try:
    def tb_names(e):
        return [(f.name, f.line) for f in traceback.extract_tb(e.__traceback__)]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def tb_names(e):')

try: print("--- plain loops")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: "--- plain loops"')
try:
    def count(n):
        for i in range(n):
            yield i
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def count(n):')
try: print('[x for x in count(5)] =>', [x for x in count(5)])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [x for x in count(5)]')
try: print('list(count(3)) =>', list(count(3)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list(count(3))')
try: print('sum(count(10)) =>', sum(count(10)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sum(count(10))')
try: print('tuple(count(2)) =>', tuple(count(2)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: tuple(count(2))')
try: print('max(count(4)) =>', max(count(4)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: max(count(4))')
try: print('sorted(count(3), reverse=True) =>', sorted(count(3), reverse=True))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sorted(count(3), reverse=True)')
try: g = count(3)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g = count(3)')
try:
    for x in g: print("first loop", x)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for x in g: print("first loop", x)')
try:
    for x in g: print("never")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for x in g: print("never")')
try: print('next(g, "done") =>', next(g, "done"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: next(g, "done")')
try: print('g.gi_frame =>', g.gi_frame)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g.gi_frame')
try: print('g.gi_running =>', g.gi_running)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g.gi_running')
try: print('inspect.getgeneratorstate(g) =>', inspect.getgeneratorstate(g))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: inspect.getgeneratorstate(g)')
try: g = count(5)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g = count(5)')
try:
    for x in g:
        if x == 1: break
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for x in g:')
try: print('next(g) =>', next(g))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: next(g)')
try: print('[y for y in g] =>', [y for y in g])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [y for y in g]')
try: print('inspect.getgeneratorstate(g) =>', inspect.getgeneratorstate(g))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: inspect.getgeneratorstate(g)')
try:
    def empty():
        return
        yield
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def empty():')
try:
    for x in empty(): print("never")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for x in empty(): print("never")')
try: print(list(empty()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list(empty())')

try: print("--- values of many kinds, and many variables")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: "--- values of many kinds, and many variables"')
try:
    def kinds():
        a = 1; b = 2.0; c = "s"; d = None; e = [1]; f = (2,); h = {3: 4}; i = 1 << 70; j = 1.5; k = True
        yield a; yield b; yield c; yield d; yield e; yield f; yield h; yield i; yield j; yield k
        yield (a, b, c, d, e, f, h, i, j, k)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def kinds():')
try:
    for v in kinds(): print(repr(v), type(v).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for v in kinds(): print(repr(v), type(v).__name__)')

try: print("--- exceptions that leave the body")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: "--- exceptions that leave the body"')
try:
    def raises(n):
        yield 1
        raise ValueError("from the generator %d" % n)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def raises(n):')
try:
    def loop_over(g):
        out = []
        try:
            for x in g: out.append(x)
        except ValueError as e:
            out.append(("caught", str(e), tb_names(e)))
        return out
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def loop_over(g):')
try: g = raises(1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g = raises(1)')
try: print('loop_over(g) =>', loop_over(g))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: loop_over(g)')
try: print('inspect.getgeneratorstate(g) =>', inspect.getgeneratorstate(g))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: inspect.getgeneratorstate(g)')
try: print('g.gi_frame =>', g.gi_frame)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g.gi_frame')
try: print('list(g) =>', list(g))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list(g)')
try:
    def outer_for(n):
        for x in raises(n): yield x
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def outer_for(n):')
try:
    def outer_from(n):
        yield from raises(n)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def outer_from(n):')
try: print(loop_over(outer_for(2)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: loop_over(outer_for(2))')
try: print(loop_over(outer_from(3)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: loop_over(outer_from(3))')
try:
    def catches(n):
        try:
            for x in raises(n): yield x
        except ValueError as e:
            yield "caught inside: " + str(e)
        try:
            yield from raises(n + 1)
        except ValueError as e:
            yield "caught inside: " + str(e)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def catches(n):')
try: print(list(catches(4)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list(catches(4))')

try: print("--- StopIteration must not leave a generator")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: "--- StopIteration must not leave a generator"')
try:
    def stops():
        yield 1
        raise StopIteration("value")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def stops():')
try:
    def report(f):
        try:
            f()
        except RuntimeError as e:
            print(type(e).__name__, e, "|", repr(e.__cause__), repr(e.__context__), e.__suppress_context__, tb_names(e))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def report(f):')
try: report(lambda: [x for x in stops()])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: report(lambda: [x for x in stops()])')
try: report(lambda: list(stops()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: report(lambda: list(stops()))')
try:
    def via_next():
        yield next(iter(()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def via_next():')
try: report(lambda: [x for x in via_next()])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: report(lambda: [x for x in via_next()])')
try:
    def from_stops():
        yield from stops()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def from_stops():')
try: report(lambda: [x for x in from_stops()])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: report(lambda: [x for x in from_stops()])')
try:
    async def coro_stops():
        raise StopIteration("in a coroutine")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def coro_stops():')
try: report(lambda: coro_stops().send(None))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: report(lambda: coro_stops().send(None))')

try: print("--- a generator that is running")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: "--- a generator that is running"')
try:
    def reenters():
        yield 1
        for x in me: yield x
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def reenters():')
try: me = reenters()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: me = reenters()')
try: print(try_(list, me))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try_(list, me)')
try:
    def reenters_next():
        yield next(me2)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def reenters_next():')
try: me2 = reenters_next()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: me2 = reenters_next()')
try: print(try_(list, me2))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try_(list, me2)')
try:
    def shows_running():
        yield (me3.gi_running, inspect.getgeneratorstate(me3), me3.gi_frame is sys._getframe())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def shows_running():')
try: me3 = shows_running()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: me3 = shows_running()')
try:
    for v in me3: print(v)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for v in me3: print(v)')
try: print('me3.gi_running =>', me3.gi_running)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: me3.gi_running')
try: print('inspect.getgeneratorstate(me3) =>', inspect.getgeneratorstate(me3))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: inspect.getgeneratorstate(me3)')

try: print("--- frames")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: "--- frames"')
try:
    def names_up():
        f = sys._getframe(); out = []
        while f: out.append(f.f_code.co_name); f = f.f_back
        return out
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def names_up():')
try:
    def inner_frames():
        yield names_up()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def inner_frames():')
try:
    def middle_frames():
        for x in inner_frames(): yield x
        yield from inner_frames()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def middle_frames():')
try:
    def top_frames():
        return [x for x in middle_frames()] + list(middle_frames())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def top_frames():')
try:
    for names in top_frames(): print(names)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for names in top_frames(): print(names)')
try: g = count(2)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g = count(2)')
try: print('g.gi_frame.f_lineno - count.__code__.co_firstlineno =>', g.gi_frame.f_lineno - count.__code__.co_firstlineno)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g.gi_frame.f_lineno - count.__code__.co_firstlineno')
try: print('g.gi_frame.f_locals =>', g.gi_frame.f_locals)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g.gi_frame.f_locals')
try: print('g.gi_frame.f_back =>', g.gi_frame.f_back)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g.gi_frame.f_back')
try:
    for x in g:
        try: print('g.gi_frame.f_lineno - count.__code__.co_firstlineno [' + 'x=' + (repr(x) if type(x) in (str, int, float, bytes, bool, type(None)) or (type(x) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in x)) else x.__name__ if type(x) is type else type(x).__name__) + '] =>', g.gi_frame.f_lineno - count.__code__.co_firstlineno)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g.gi_frame.f_lineno - count.__code__.co_firstlineno')
        try: print('sorted(g.gi_frame.f_locals.items()) [' + 'x=' + (repr(x) if type(x) in (str, int, float, bytes, bool, type(None)) or (type(x) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in x)) else x.__name__ if type(x) is type else type(x).__name__) + '] =>', sorted(g.gi_frame.f_locals.items()))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sorted(g.gi_frame.f_locals.items())')
        try: print('g.gi_frame.f_back [' + 'x=' + (repr(x) if type(x) in (str, int, float, bytes, bool, type(None)) or (type(x) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in x)) else x.__name__ if type(x) is type else type(x).__name__) + '] =>', g.gi_frame.f_back)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g.gi_frame.f_back')
        try: print('g.gi_suspended [' + 'x=' + (repr(x) if type(x) in (str, int, float, bytes, bool, type(None)) or (type(x) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in x)) else x.__name__ if type(x) is type else type(x).__name__) + '] =>', g.gi_suspended)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g.gi_suspended')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for x in g:')
try: frame_kept = None
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: frame_kept = None')
try:
    def keeps_frame():
        global frame_kept
        frame_kept = sys._getframe()
        local = "value"
        yield 1
        yield 2
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def keeps_frame():')
try:
    for x in keeps_frame(): print(x, frame_kept.f_locals, frame_kept.f_lineno - keeps_frame.__code__.co_firstlineno)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for x in keeps_frame(): print(x, frame_kept.f_locals, frame_kept.f_li...')
try: print('frame_kept.f_lineno - keeps_frame.__code__.co_firstlineno =>', frame_kept.f_lineno - keeps_frame.__code__.co_firstlineno)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: frame_kept.f_lineno - keeps_frame.__code__.co_firstlineno')
try: print('frame_kept.f_back =>', frame_kept.f_back)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: frame_kept.f_back')

try: print("--- the exception being handled belongs to each generator")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: "--- the exception being handled belongs to each generator"')
try:
    def handling():
        try:
            raise KeyError("inner")
        except KeyError:
            yield repr(sys.exception())
            yield repr(sys.exception())
        yield repr(sys.exception())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def handling():')
try:
    def outer_handling():
        out = []
        try:
            raise ValueError("outer")
        except ValueError:
            for v in handling():
                out.append((v, repr(sys.exception())))
        for v in handling():
            out.append((v, repr(sys.exception())))
        return out
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def outer_handling():')
try:
    for line in outer_handling(): print(line)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for line in outer_handling(): print(line)')
try:
    def context_chain():
        try:
            raise KeyError("first")
        except KeyError:
            yield
            raise ValueError("second")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def context_chain():')
try:
    try:
        try:
            raise OSError("around the loop")
        except OSError:
            for _ in context_chain(): pass
    except ValueError as e:
        print('repr(e) =>', repr(e))
        print('repr(e.__context__) =>', repr(e.__context__))
        print('repr(e.__context__.__context__) =>', repr(e.__context__.__context__))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try:')

try: print("--- send, throw, close")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: "--- send, throw, close"')
try:
    def echo():
        got = None
        while True:
            try:
                got = yield got
            except ValueError as e:
                got = "threw " + str(e)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def echo():')
try: g = echo()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g = echo()')
try: print('try_(g.send, 1) =>', try_(g.send, 1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try_(g.send, 1)')
try: print('g.send(None) =>', g.send(None))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g.send(None)')
try: print('g.send(5) =>', g.send(5))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g.send(5)')
try: print('g.throw(ValueError("x")) =>', g.throw(ValueError("x")))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g.throw(ValueError("x"))')
try: print('g.send(6) =>', g.send(6))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g.send(6)')
try: print('g.close() =>', g.close())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g.close()')
try: print('try_(g.send, 7) =>', try_(g.send, 7))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try_(g.send, 7)')
try: print('try_(next, g) =>', try_(next, g))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try_(next, g)')
try:
    def delegating():
        r = yield from echo_until()
        yield ("returned", r)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def delegating():')
try:
    def echo_until():
        got = None
        while got != "stop":
            try:
                got = yield got
            except ValueError as e:
                got = "threw " + str(e)
        return "result"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def echo_until():')
try: g = delegating()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g = delegating()')
try: print('next(g) =>', next(g))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: next(g)')
try: print('g.gi_yieldfrom.__name__ =>', g.gi_yieldfrom.__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g.gi_yieldfrom.__name__')
try: print('g.send(1) =>', g.send(1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g.send(1)')
try: print('g.throw(ValueError("y")) =>', g.throw(ValueError("y")))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g.throw(ValueError("y"))')
try: print('g.send("stop") =>', g.send("stop"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g.send("stop")')
try: print('g.gi_yieldfrom =>', g.gi_yieldfrom)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g.gi_yieldfrom')
try: print('try_(next, g) =>', try_(next, g))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try_(next, g)')
try: log = []
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: log = []')
try:
    def cleans(name):
        try:
            yield name
            yield name
        finally:
            log.append("cleaned " + name)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def cleans(name):')
try:
    def cleans_outer():
        try:
            yield from cleans("inner")
        finally:
            log.append("cleaned outer")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def cleans_outer():')
try: g = cleans_outer()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g = cleans_outer()')
try: next(g)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: next(g)')
try: g.close()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g.close()')
try: print(log)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: log')
try: log.clear()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: log.clear()')
try:
    for x in cleans("loop"): break
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for x in cleans("loop"): break')
try: gc.collect()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: gc.collect()')
try: print(log)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: log')
try: log.clear()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: log.clear()')
try:
    def refuses():
        try: yield 1
        except GeneratorExit: yield 2
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def refuses():')
try: g = refuses()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g = refuses()')
try: next(g)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: next(g)')
try: print(try_(g.close))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try_(g.close)')
try:
    def returns_on_close():
        try: yield 1
        except GeneratorExit: return "closing value"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def returns_on_close():')
try: g = returns_on_close()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g = returns_on_close()')
try: next(g)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: next(g)')
try: print(g.close())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g.close()')
try: g = count(3)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g = count(3)')
try: print('try_(g.throw, KeyError("not started")) =>', try_(g.throw, KeyError("not started")))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try_(g.throw, KeyError("not started"))')
try: print('list(g) =>', list(g))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list(g)')

try: print("--- what yield from evaluates to")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: "--- what yield from evaluates to"')
try:
    def returns(v):
        yield "y"
        return v
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def returns(v):')
try:
    def takes():
        a = yield from returns(1)
        b = yield from returns(None)
        c = yield from returns((1, 2))
        d = yield from []
        e = yield from iter("ab")
        f = yield from returns(StopIteration("as a value"))
        return [a, b, c, d, e, f]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def takes():')
try:
    def drive(g):
        out = []
        try:
            while True: out.append(next(g))
        except StopIteration as e:
            return out, e.value
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def drive(g):')
try: print(drive(takes()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: drive(takes())')
try:
    class Iter:
        def __init__(self): self.n = 0
        def __iter__(self): return self
        def __next__(self):
            self.n += 1
            if self.n > 2: raise StopIteration("iterator's value")
            return self.n
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Iter:')
try:
    def from_object():
        r = yield from Iter()
        yield r
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def from_object():')
try: print(list(from_object()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list(from_object())')

try: print("--- depth")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: "--- depth"')
try:
    def deep(n):
        if n: yield from deep(n - 1)
        else: yield "bottom"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def deep(n):')
try: print(list(deep(200)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list(deep(200))')
try:
    def deep_for(n):
        if n:
            for x in deep_for(n - 1): yield x
        else: yield "bottom"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def deep_for(n):')
try: print(list(deep_for(200)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list(deep_for(200))')
try:
    def endless(n):
        yield from endless(n + 1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def endless(n):')
try: print(try_(list, endless(0))[:40])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try_(list, endless(0))[:40]')
try:
    def endless_for(n):
        for x in endless_for(n + 1): yield x
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def endless_for(n):')
try: print(try_(list, endless_for(0))[:40])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try_(list, endless_for(0))[:40]')
try: g = endless_for(0)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g = endless_for(0)')
try: try_(next, g)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try_(next, g)')
try: print(inspect.getgeneratorstate(g))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: inspect.getgeneratorstate(g)')
try: print('list(deep(50)) =>', list(deep(50)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list(deep(50))')
try: print('sum(count(5)) =>', sum(count(5)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sum(count(5))')

try: print("--- coroutines")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: "--- coroutines"')
try:
    class Suspend:
        def __init__(self, v): self.v = v
        def __await__(self):
            r = yield self.v
            return r
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Suspend:')
try:
    async def leaf(v): return await Suspend(v)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def leaf(v): return await Suspend(v)')
try:
    async def chain(k, v): return (await chain(k - 1, v)) if k else (await leaf(v))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def chain(k, v): return (await chain(k - 1, v)) if k else (awai...')
try:
    async def main():
        a = await chain(5, "first")
        b = await chain(0, "second")
        try:
            await failing(3)
        except LookupError as e:
            c = (str(e), tb_names(e))
        return a, b, c
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def main():')
try:
    async def failing(k):
        if k: return await failing(k - 1)
        await Suspend("before failing")
        raise LookupError("deep in the chain")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def failing(k):')
try: c = main()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c = main()')
try: print('c.send(None) =>', c.send(None))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c.send(None)')
try: print('c.cr_await.__name__ =>', c.cr_await.__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c.cr_await.__name__')
try: print('inspect.getcoroutinestate(c) =>', inspect.getcoroutinestate(c))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: inspect.getcoroutinestate(c)')
try: print('c.send("A") =>', c.send("A"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c.send("A")')
try: print('c.send("B") =>', c.send("B"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c.send("B")')
try:
    try: c.send(None)
    except StopIteration as e: print(e.value)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try: c.send(None)')
try: print('inspect.getcoroutinestate(c) =>', inspect.getcoroutinestate(c))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: inspect.getcoroutinestate(c)')
try: print('c.cr_await =>', c.cr_await)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c.cr_await')
try: print('try_(c.send, None) =>', try_(c.send, None))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try_(c.send, None)')
try:
    async def simple(): return 5
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def simple(): return 5')
try:
    async def awaits_twice():
        x = simple()
        return await x, try_(lambda: x.send(None))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def awaits_twice():')
try: print(try_(awaits_twice().send, None))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try_(awaits_twice().send, None)')
try: c = chain(3, "thrown into")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c = chain(3, "thrown into")')
try: c.send(None)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c.send(None)')
try: print('try_(c.throw, KeyError("from outside")) =>', try_(c.throw, KeyError("from outside")))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try_(c.throw, KeyError("from outside"))')
try: print('inspect.getcoroutinestate(c) =>', inspect.getcoroutinestate(c))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: inspect.getcoroutinestate(c)')
try: c = chain(3, "closed")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c = chain(3, "closed")')
try: c.send(None)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c.send(None)')
try: print('c.close() =>', c.close())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c.close()')
try: print('inspect.getcoroutinestate(c) =>', inspect.getcoroutinestate(c))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: inspect.getcoroutinestate(c)')
try:
    @types.coroutine
    def old_style(v):
        r = yield v
        return r
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def old_style(v):')
try:
    async def awaits_old(): return await old_style("old")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def awaits_old(): return await old_style("old")')
try: c = awaits_old()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c = awaits_old()')
try: print('c.send(None) =>', c.send(None))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c.send(None)')
try: print('try_(c.send, "answer") =>', try_(c.send, "answer"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try_(c.send, "answer")')

try: print("--- asynchronous generators, driven by hand")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: "--- asynchronous generators, driven by hand"')
try:
    async def agen():
        yield 1
        await Suspend("in the middle")
        yield 2
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def agen():')
try:
    async def consume():
        out = []
        async for x in agen(): out.append(x)
        return out
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def consume():')
try: c = consume()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c = consume()')
try: print('c.send(None) =>', c.send(None))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c.send(None)')
try: print('try_(c.send, None) =>', try_(c.send, None))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try_(c.send, None)')

try: print("--- generators in odd places")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: "--- generators in odd places"')
try: print('dict(zip(count(3), count(3))) =>', dict(zip(count(3), count(3))))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: dict(zip(count(3), count(3)))')
try: print('list(map(lambda a, b: a + b, count(3), count(3))) =>', list(map(lambda a, b: a + b, count(3), count(3))))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list(map(lambda a, b: a + b, count(3), count(3)))')
try: print('list(enumerate(count(2))) =>', list(enumerate(count(2))))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list(enumerate(count(2)))')
try: print('list(filter(None, count(3))) =>', list(filter(None, count(3))))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list(filter(None, count(3)))')
try: print('any(count(2)) =>', any(count(2)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: any(count(2))')
try: print('all(count(2)) =>', all(count(2)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: all(count(2))')
try: print('",".join(str(x) for x in count(3)) =>', ",".join(str(x) for x in count(3)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ",".join(str(x) for x in count(3))')
try: print('{x for x in count(3)} =>', {x for x in count(3)})
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: {x for x in count(3)}')
try: print('[*count(2), *count(2)] =>', [*count(2), *count(2)])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [*count(2), *count(2)]')
try: print('(lambda *a: a)(*count(3)) =>', (lambda *a: a)(*count(3)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: (lambda *a: a)(*count(3))')
try: a, b, *c = count(5)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a, b, *c = count(5)')
try: print('a =>', a)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a')
try: print('b =>', b)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: b')
try: print('c =>', c)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c')
try: print('3 in count(5) =>', 3 in count(5))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: 3 in count(5)')
try: print('7 in count(5) =>', 7 in count(5))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: 7 in count(5)')
try:
    def gen_in_gen():
        yield from (x * 2 for x in (y + 1 for y in count(3)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def gen_in_gen():')
try: print(list(gen_in_gen()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list(gen_in_gen())')
try:
    class HasGen:
        def __iter__(self):
            yield "from __iter__"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class HasGen:')
try:
    for x in HasGen(): print(x)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for x in HasGen(): print(x)')
try: print(list(HasGen()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list(HasGen())')
