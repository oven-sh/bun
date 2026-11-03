try:
    def t(f):
        try:
            print(repr(f()))
        except BaseException as e:
            print(type(e).__name__ + ':', e)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def t(f):')

try:
    def inner():
        yield 1
        yield 2
        return "inner result"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def inner():')
try:
    def outer():
        r = yield from inner()
        print("got", r, end="; ")
        yield 3
        return "outer result"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def outer():')
try: print(list(outer()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list(outer())')
try: g = outer()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g = outer()')
try: print('next(g) =>', next(g))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: next(g)')
try: print('next(g) =>', next(g))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: next(g)')
try: print('next(g) =>', next(g))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: next(g)')
try:
    try: next(g)
    except StopIteration as e: print(e.value)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try: next(g)')
try:
    def from_iterables():
        yield from [1, 2]
        yield from (3, 4)
        yield from "ab"
        yield from range(2)
        yield from {5: 6}
        yield from {7}
        yield from iter([8])
        yield from (x * 2 for x in range(2))
        yield from b"\x01"
        yield from []
        yield from ()
        yield from map(str, [9])
        yield from zip("a", "b")
        yield from enumerate("z")
        r = yield from [10]
        yield ("result of a plain iterable", r)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def from_iterables():')
try: print(list(from_iterables()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list(from_iterables())')
try:
    def bad(x):
        yield from x
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def bad(x):')
try: print('list(bad(5)) =>', end=" "); t(lambda: list(bad(5)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: list(bad(5)))')
try: print('list(bad(None)) =>', end=" "); t(lambda: list(bad(None)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: list(bad(None)))')
try: print('list(bad(len)) =>', end=" "); t(lambda: list(bad(len)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: list(bad(len)))')
try: print('list(bad(object())) =>', end=" "); t(lambda: list(bad(object())))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: list(bad(object())))')
try: print('list(bad(1.5)) =>', end=" "); t(lambda: list(bad(1.5)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: list(bad(1.5)))')
try: print('list(bad(int)) =>', end=" "); t(lambda: list(bad(int)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: list(bad(int)))')
# send, throw and close are forwarded.
try:
    def sub():
        log = []
        while True:
            try: v = yield len(log)
            except ValueError as e: log.append("thrown " + str(e)); continue
            except GeneratorExit: print("sub closed with", log, end="; "); raise
            if v == "stop": return log
            log.append(v)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def sub():')
try:
    def deleg():
        r = yield from sub()
        yield ("sub returned", r)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def deleg():')
try: d = deleg()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: d = deleg()')
try: print('next(d) =>', next(d))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: next(d)')
try: print('d.send("a") =>', d.send("a"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: d.send("a")')
try: print('d.send("b") =>', d.send("b"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: d.send("b")')
try: print('d.throw(ValueError("x")) =>', d.throw(ValueError("x")))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: d.throw(ValueError("x"))')
try: print('d.send("c") =>', d.send("c"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: d.send("c")')
try: print('d.send("stop") =>', d.send("stop"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: d.send("stop")')
try: d = deleg()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: d = deleg()')
try: next(d)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: next(d)')
try: d.send("a")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: d.send("a")')
try: print(d.close())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: d.close()')
try: d = deleg()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: d = deleg()')
try: next(d)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: next(d)')
try: print('d.throw(KeyError("not handled by sub")) =>', end=" "); t(lambda: d.throw(KeyError("not handled by sub")))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: d.throw(KeyError("not handled by sub")))')
try: print('next(d) =>', end=" "); t(lambda: next(d))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: next(d))')
try:
    def deleg_catch():
        try: yield from sub()
        except KeyError as e: yield ("outer caught", repr(e))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def deleg_catch():')
try: d = deleg_catch()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: d = deleg_catch()')
try: next(d)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: next(d)')
try: print(d.throw(KeyError("k")))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: d.throw(KeyError("k"))')
# gi_yieldfrom
try:
    def yf():
        yield from inner()
        yield "own"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def yf():')
try: y = yf()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: y = yf()')
try: print(y.gi_yieldfrom)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: y.gi_yieldfrom')
try: next(y)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: next(y)')
try: print('type(y.gi_yieldfrom).__name__ =>', type(y.gi_yieldfrom).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(y.gi_yieldfrom).__name__')
try: print('y.gi_yieldfrom.__name__ =>', y.gi_yieldfrom.__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: y.gi_yieldfrom.__name__')
try: next(y)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: next(y)')
try: next(y)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: next(y)')
try: print(y.gi_yieldfrom)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: y.gi_yieldfrom')
try:
    def yfl(): yield from [1, 2]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def yfl(): yield from [1, 2]')
try: y = yfl()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: y = yfl()')
try: next(y)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: next(y)')
try: print(type(y.gi_yieldfrom).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(y.gi_yieldfrom).__name__')
# send() to a plain iterator: None uses next(), anything else needs send.
try:
    def to_list(): yield from [1, 2, 3]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def to_list(): yield from [1, 2, 3]')
try: g = to_list()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g = to_list()')
try: print('next(g) =>', next(g))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: next(g)')
try: print('g.send(None) =>', g.send(None))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g.send(None)')
try: print('g.send(5) =>', end=" "); t(lambda: g.send(5))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: g.send(5))')
try: print('next(g) =>', end=" "); t(lambda: next(g))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: next(g))')
try: g = to_list()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g = to_list()')
try: next(g)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: next(g)')
try: print('g.throw(ValueError("to a list iterator")) =>', end=" "); t(lambda: g.throw(ValueError("to a list iterator")))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: g.throw(ValueError("to a list iterator")))')
try: print('next(g) =>', end=" "); t(lambda: next(g))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: next(g))')
try: g = to_list()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g = to_list()')
try: next(g)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: next(g)')
try: print(g.close())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g.close()')
try:
    class It:
        def __init__(s): s.n = 0
        def __iter__(s): return s
        def __next__(s):
            s.n += 1
            if s.n > 2: raise StopIteration("iterator result")
            return s.n
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class It:')
try:
    def from_it():
        r = yield from It()
        yield r
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def from_it():')
try: print(list(from_it()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list(from_it())')
try:
    class Full(It):
        def send(s, v): return ("send", v)
        def throw(s, *a): return ("throw", a[0].__name__ if isinstance(a[0], type) else repr(a[0]), len(a))
        def close(s): print("Full.close", end="; ")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Full(It):')
try:
    def from_full(): yield from Full()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def from_full(): yield from Full()')
try: g = from_full()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g = from_full()')
try: print('next(g) =>', next(g))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: next(g)')
try: print('g.send(1) =>', g.send(1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g.send(1)')
try: print('g.throw(ValueError) =>', g.throw(ValueError))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g.throw(ValueError)')
try: print('g.throw(KeyError("k")) =>', g.throw(KeyError("k")))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g.throw(KeyError("k"))')
try: print('g.send(None) =>', g.send(None))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g.send(None)')
try: print('g.close() =>', g.close())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g.close()')
try:
    class CloseRaises(It):
        def close(s): raise RuntimeError("close failed")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class CloseRaises(It):')
try:
    def from_cr(): yield from CloseRaises()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def from_cr(): yield from CloseRaises()')
try: g = from_cr()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g = from_cr()')
try: next(g)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: next(g)')
try: print('g.close() =>', end=" "); t(g.close)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(g.close)')
try:
    class ThrowRaisesStop(It):
        def throw(s, *a): raise StopIteration("from throw")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class ThrowRaisesStop(It):')
try:
    def from_trs():
        r = yield from ThrowRaisesStop()
        yield ("resumed with", r)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def from_trs():')
try: g = from_trs()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g = from_trs()')
try: next(g)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: next(g)')
try: print(g.throw(ValueError))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g.throw(ValueError)')
try:
    class NoThrowButClose(It):
        def close(s): print("closed before re-raising", end="; ")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class NoThrowButClose(It):')
try:
    def from_ntc(): yield from NoThrowButClose()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def from_ntc(): yield from NoThrowButClose()')
try: g = from_ntc()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g = from_ntc()')
try: next(g)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: next(g)')
try: print('g.throw(ValueError("v")) =>', end=" "); t(lambda: g.throw(ValueError("v")))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: g.throw(ValueError("v")))')
# GeneratorExit thrown explicitly closes the sub-iterator.
try: g = deleg()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g = deleg()')
try: next(g)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: next(g)')
try: print('g.throw(GeneratorExit) =>', end=" "); t(lambda: g.throw(GeneratorExit))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: g.throw(GeneratorExit))')
# Deep delegation.
try:
    def level(n):
        if n == 0:
            v = yield "bottom"
            return [v]
        r = yield from level(n - 1)
        return r + [n]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def level(n):')
try: g = level(50)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g = level(50)')
try: print(next(g))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: next(g)')
try:
    try: g.send("sent")
    except StopIteration as e: print(e.value[:5], len(e.value))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try: g.send("sent")')
try:
    def chain(*its):
        for it in its: yield from it
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def chain(*its):')
try: print(list(chain([1], (2,), "3", range(4, 6), chain([6], chain([7])))))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list(chain([1], (2,), "3", range(4, 6), chain([6], chain([7]))))')
try:
    def flatten(x):
        for e in x:
            if isinstance(e, (list, tuple)): yield from flatten(e)
            else: yield e
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def flatten(x):')
try: print(list(flatten([1, (2, [3, (4, 5)], 6), [[[7]]]])))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list(flatten([1, (2, [3, (4, 5)], 6), [[[7]]]]))')
try:
    def inorder(t):
        if t:
            yield from inorder(t[0]); yield t[1]; yield from inorder(t[2])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def inorder(t):')
try: print(list(inorder(((None, 1, None), 2, ((None, 3, None), 4, None)))))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list(inorder(((None, 1, None), 2, ((None, 3, None), 4, None))))')
# Return values through several levels; exceptions in the sub-generator.
try:
    def r1(): return 1; yield
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def r1(): return 1; yield')
try:
    def r2(): return (yield from r1()) + 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def r2(): return (yield from r1()) + 1')
try:
    def r3(): return (yield from r2()) + (yield from r2())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def r3(): return (yield from r2()) + (yield from r2())')
try:
    def r4(): x = yield from r3(); yield x
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def r4(): x = yield from r3(); yield x')
try: print(list(r4()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list(r4())')
try:
    def sub_raises():
        yield 1
        raise ValueError("in sub")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def sub_raises():')
try:
    def outer_catches():
        try: yield from sub_raises()
        except ValueError as e: yield "caught " + str(e)
        yield "continues"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def outer_catches():')
try: print(list(outer_catches()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list(outer_catches())')
try:
    def outer_finally():
        try: yield from sub_raises()
        finally: print("outer finally", end="; ")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def outer_finally():')
try: print('list(outer_finally()) =>', end=" "); t(lambda: list(outer_finally()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: list(outer_finally()))')
try:
    def sub_stop():
        yield 1
        raise StopIteration("bad")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def sub_stop():')
try:
    def outer_stop(): yield from sub_stop()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def outer_stop(): yield from sub_stop()')
try: print('list(outer_stop()) =>', end=" "); t(lambda: list(outer_stop()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: list(outer_stop()))')
# The same generator delegated twice; already running; exhausted.
try: shared = inner()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: shared = inner()')
try:
    def two():
        a = yield from shared
        b = yield from shared
        yield (a, b)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def two():')
try: print(list(two()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list(two())')
try:
    def selfdel():
        yield 1
        yield from me
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def selfdel():')
try: me = selfdel()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: me = selfdel()')
try: next(me)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: next(me)')
try: print('next(me) =>', end=" "); t(lambda: next(me))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: next(me))')
try:
    def a_gen():
        yield 1
        yield from b_ref
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def a_gen():')
try:
    def b_gen():
        yield 2
        yield from a_ref
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def b_gen():')
try: a_ref = a_gen()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a_ref = a_gen()')
try: b_ref = b_gen()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: b_ref = b_gen()')
try: print('next(a_ref) =>', next(a_ref))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: next(a_ref)')
try: print('next(a_ref) =>', next(a_ref))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: next(a_ref)')
try: print('next(a_ref) =>', end=" "); t(lambda: next(a_ref))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: next(a_ref))')
# yield from as an expression in odd places.
try:
    def odd():
        x = [(yield from inner()), (yield from inner())]
        y = {"k": (yield from r1())}
        z = (yield from r1()) if (yield from r1()) else 0
        print((yield from r1()), end="; ")
        return x, y, z, f"{(yield from r1())}"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def odd():')
try: g = odd()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g = odd()')
try: out = []
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: out = []')
try:
    try:
        while True: out.append(next(g))
    except StopIteration as e: print(out, e.value)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try:')
try: lam = lambda: (yield from [1, 2])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: lam = lambda: (yield from [1, 2])')
try: print(list(lam()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list(lam())')
try:
    for src in ("yield from x", "def f(): yield from", "def f(): x = yield from y", "def f(): yield from x = 1", "def f(): yield from (yield)", "def f(): yield from yield x", "def f(): yield from x for x in y", "def f(): yield from (x for x in y)", "def f(): yield from [x for x in y]", "def f(): return yield from x", "def f(): return (yield from x)", "def f(): f(yield from x)", "def f(): f((yield from x))", "async def f(): yield from x", "class C: yield from x", "def f(): [(yield from x) for y in z]", "def f(): yield from x, ", "def f(): yield from lambda: 1", "def f(): yield from not x", "def f(): yield from x if y else z", "def f(): yield  from  x", "def f(): yield\\\nfrom x", "def f(): yieldfrom x", "def f(): await (yield from x)", "def f(): yield from x; yield from y", "def f(): yield from(x)", "def f(): yield from x := y", "def f(): yield from (x := y)"):
        try: compile(src, "<s>", "exec"); print("ok:", src.replace("\n", "\\n"))
        except SyntaxError as e: print("SyntaxError:", e.msg, "<-", src.replace("\n", "\\n"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for src in ("yield from x", "def f(): yield from", "def f(): x = yiel...')
